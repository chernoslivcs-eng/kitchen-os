// Р146 (рішення власника 13.09): «факт дому» під чіпами порожньої розмови.
//
// GET /v1/home-fact → { text, date, source: 'llm' | 'template' | null, pending }.
// Кеш у БД по (household_id, локальний день). Перший запит дня: збираємо
// три списки без моделі (горить · сезон · останні страви), відповідаємо
// одразу шаблоном (source: template, логіка homeFactTemplate з @kitchen/domain)
// і позначаємо pending; модель — у фоні. Наступний запит дня (клієнт повторює
// раз через 1,5–3 с) віддає llm. На серверлесі фон після відповіді не
// доживає (telemetry.ts), тому там генерація йде на ДРУГОМУ запиті синхронно,
// в межах тих самих 8 с. Усі три списки порожні — модель не викликається.
// Без HOME_FACT_LLM=1 ендпоінт віддає лише шаблон. Будь-яка помилка моделі →
// лишається шаблон, у Sentry — guard (не broke), і того дня спроб більше нема.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  type Repo, type HomeFactRow, type HomeFacts,
  nowItems, subscribedRows, isoDay, spanDays, effectiveExpiry, daysLeft,
  homeFactTemplate, homeFactsEmpty, serializeHomeFacts, cleanHomeFactText,
} from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { callHomeFact, type HomeFactCall } from '../model.js';
import { recordUsage } from '../usage.js';
import { incident } from '../incident.js';
import { localDay } from '../local-day.js';

export interface HomeFactOpts {
  /** HOME_FACT_LLM=1: модель увімкнена. Без прапорця — лише шаблон. */
  llm?: boolean;
  /** Тести: власний генератор замість моделі. */
  generate?: (facts: string) => Promise<HomeFactCall>;
  /** Фон після відповіді (довгоживучий процес). На Vercel — false: генерація на другому запиті. */
  background?: boolean;
}

export const BURNING_DAYS = 3;
export const BURNING_MAX = 6;
export const SEASONS_MAX = 6;
export const DISHES_MAX = 5;

/** Три списки для моделі + вхід шаблону — з репозиторію, без моделі. */
export async function collectHomeFacts(repo: Repo, household_id: string, user_id: string, now = new Date()) {
  const nowMs = now.getTime();
  const today = isoDay(now);
  const batches = await repo.listBatches(household_id);
  const active = batches.filter((b) => b.state !== 'depleted');
  const withDays = active
    .map((b) => ({ label: b.label, days: daysLeft(effectiveExpiry(b, b.catalog_key, nowMs), nowMs) }))
    .filter((x): x is { label: string; days: number } => x.days != null);
  const burning = withDays.filter((x) => x.days <= BURNING_DAYS).sort((a, b) => a.days - b.days).slice(0, BURNING_MAX);
  const overdue = withDays.filter((x) => x.days < 0).length;

  const occasions = subscribedRows(await repo.listOccasionCatalog(), await repo.listOccasionSubscriptions(household_id));
  const events = await repo.listOwnEvents(household_id, user_id);
  const items = nowItems(occasions, events, now);
  const seasons = items
    .filter((i) => i.kind === 'season' && i.source === 'catalog')
    .map((i) => ({ title: i.title, startedThisWeek: i.from <= today && spanDays(i.from, today) <= 6 }))
    .slice(0, SEASONS_MAX);
  const strict = items.find((i) => i.strict);

  const runs = (await repo.listCookRuns(user_id, 12)).filter((r) => !r.undone_at);
  const dishes = runs.slice(0, DISHES_MAX).map((r) => ({
    title: r.recipe.title,
    daysAgo: Math.max(0, Math.round((nowMs - Date.parse(r.finished_at ?? r.started_at)) / 86_400_000)),
  }));

  const facts: HomeFacts = { burning, seasons, dishes };
  const writtenOff = batches.find((b) => b.state === 'depleted' && (b.depleted_at ?? '').startsWith(today));
  const template = homeFactTemplate({
    writtenOffToday: overdue === 0 && writtenOff ? writtenOff.label : null,
    fast: strict ? { day: spanDays(strict.from, today) + 1, total: spanDays(strict.from, strict.to) + 1 } : null,
    seasonStarted: seasons.find((s) => s.startedThisWeek)?.title ?? null,
    library: { saved: (await repo.listRecipes(user_id, 200)).length, cooked: runs.length },
  });
  return { facts, template };
}

const out = (row: HomeFactRow) => ({ text: row.text, date: row.date, source: row.source, pending: row.llm_state === 'pending' });

export function homeFactRoutes(app: FastifyInstance, repo: Repo, opts: HomeFactOpts = {}): void {
  const llm = opts.llm ?? false;
  const generate = opts.generate ?? callHomeFact;
  const background = opts.background ?? !process.env.VERCEL;
  // Один виклик моделі на дім і день у межах процесу: другий запит чекає на той самий.
  const inflight = new Map<string, Promise<HomeFactRow>>();

  function runLlm(req: FastifyRequest, row: HomeFactRow, facts: HomeFacts, ids: { user_id: string; household_id: string }): Promise<HomeFactRow> {
    const key = `${row.household_id}:${row.date}`;
    const cur = inflight.get(key);
    if (cur) return cur;
    const p = (async () => {
      const started = Date.now();
      let next: HomeFactRow;
      try {
        const r = await generate(serializeHomeFacts(facts));
        if (r.meta.mode === 'live') await recordUsage(repo, ids, 'home_fact', r.meta, r.calls, started);
        const text = cleanHomeFactText(r.text);
        if (r.meta.mode === 'stub') {
          // Без ключа моделі (тести, стенд) — тихо: шаблон і крапка.
          next = { ...row, llm_state: 'failed', updated_at: new Date().toISOString() };
        } else if (!text) {
          throw new Error(r.text ? `over ${r.text.length} chars or not plain text` : 'empty reply');
        } else {
          next = { ...row, text, source: 'llm', llm_state: 'done', updated_at: new Date().toISOString() };
        }
      } catch (err) {
        next = { ...row, llm_state: 'failed', updated_at: new Date().toISOString() };
        incident({ repo, req }, 'guard', 'home-fact-llm-failed', { ...ids, date: row.date, err: String(err) });
      }
      await repo.saveHomeFact(next);
      return next;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  app.get('/v1/home-fact', { preHandler: authenticated(repo) }, async (req) => {
    const ids = requireUser(req);
    const { user_id, household_id } = ids;
    const now = new Date();
    const date = localDay(now);
    let row = await repo.getHomeFact(household_id, date);
    if (!row) {
      const { facts, template } = await collectHomeFacts(repo, household_id, user_id, now);
      const pending = llm && !homeFactsEmpty(facts);
      if (!template && !pending) return { text: null, date, source: null, pending: false };
      row = {
        household_id, date, text: template, source: template ? 'template' : null,
        llm_state: pending ? 'pending' : 'none', updated_at: now.toISOString(),
      };
      await repo.saveHomeFact(row);
      if (pending && background) void runLlm(req, row, facts, { user_id, household_id });
      return out(row);
    }
    if (row.llm_state === 'pending' && llm) {
      const running = inflight.get(`${household_id}:${date}`);
      if (running) return out(await running);
      // Фон не дожив (серверлес) або процес інший — генеруємо тут, у межах 8 с.
      const { facts } = await collectHomeFacts(repo, household_id, user_id, now);
      row = homeFactsEmpty(facts)
        ? await (async () => { const r: HomeFactRow = { ...row!, llm_state: 'none' }; await repo.saveHomeFact(r); return r; })()
        : await runLlm(req, row, facts, { user_id, household_id });
    }
    return out(row);
  });
}
