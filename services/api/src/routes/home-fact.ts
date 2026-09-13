// Р146 (рішення власника 13.09, спрощення): «факт дому» під чіпами порожньої
// розмови — жарт до трьох речень, як модель уже робить у чаті.
//
// GET /v1/home-fact → { text } або { text: null }. Сервер нічого не кешує (кеш
// на день — у клієнта, localStorage). Факти — ті самі блоки, що годують чат:
// [СЬОГОДНІ] + [ЗАРАЗ] (приводи крізь підписку дому, записи дому), [КОМОРА]
// (та сама серіалізація з «!Nдн», ⚠) і [ОСТАННІ ГОТУВАННЯ] — тими самими
// функціями @kitchen/domain, без нового збирача; профіль, список покупок,
// чеки — не передаються. Один виклик MODEL_FAST з блоком home-fact, таймаут
// 8 с, без retry; помилка або порожня відповідь → { text: null } і guard
// (не broke). Без HOME_FACT_LLM=1 — { text: null } без виклику.
import type { FastifyInstance } from 'fastify';
import {
  type Repo, type RecentCookRunSummary,
  subscribedRows, subscribedTraditions, periodVetoRows, fastingActive,
  serializeNow, serializePantry, serializeCookRun, todayLabel, cleanHomeFactText,
} from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { callHomeFact, type HomeFactCall } from '../model.js';
import { recordUsage } from '../usage.js';
import { incident } from '../incident.js';

export interface HomeFactOpts {
  /** HOME_FACT_LLM=1: модель увімкнена. Без прапорця — { text: null } без виклику. */
  llm?: boolean;
  /** Тести: власний генератор замість моделі. */
  generate?: (facts: string) => Promise<HomeFactCall>;
}

/** Ті самі блоки, що бачить чат-модель (routes/chat.ts → buildKitchenContext), без профілю й покупок. */
export async function homeFactInput(repo: Repo, household_id: string, user_id: string, now = new Date()): Promise<string> {
  const pantry = await repo.listBatches(household_id);
  const products = await repo.listProducts(household_id);
  const events = await repo.listOwnEvents(household_id, user_id);
  const occasions = subscribedRows(await repo.listOccasionCatalog(), await repo.listOccasionSubscriptions(household_id));
  const vetoIndex = [...await repo.getVetoIndex(user_id), ...periodVetoRows(occasions, events, now, user_id)];
  const recentCookRuns: RecentCookRunSummary[] = (await repo.listCookRuns(user_id, 8))
    .filter((r) => !r.undone_at)
    .slice(0, 5)
    .map((r) => ({ title: r.recipe.title, rating: r.rating, verdict: r.verdict, finished_at: r.finished_at ?? r.started_at }));
  const trads = subscribedTraditions(occasions);
  const cookLog = recentCookRuns.length
    ? '\n\n[ОСТАННІ ГОТУВАННЯ]\n' + recentCookRuns.map((r, i) => serializeCookRun(r, now.getTime(), i === 0)).join('\n')
    : '\n\n[ОСТАННІ ГОТУВАННЯ] порожньо — жодного завершеного готування ще немає.';
  return '[СЬОГОДНІ] ' + todayLabel(now)
    + serializeNow(occasions, events, now)
    + '\n\n[КОМОРА]\n' + serializePantry(pantry, now.getTime(), fastingActive(now, occasions, trads), 'none', 120, products, '', vetoIndex)
    + cookLog;
}

/** «—» (промпт: нема ні простроченого, ні сезону, ні страв). */
export function isNoFactReply(raw: string | null | undefined): boolean {
  return /^[—–-]$/.test((raw ?? '').replace(/[\s.«»"”“]/g, ''));
}

export function homeFactRoutes(app: FastifyInstance, repo: Repo, opts: HomeFactOpts = {}): void {
  const llm = opts.llm ?? false;
  const generate = opts.generate ?? callHomeFact;
  app.get('/v1/home-fact', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id, household_id } = requireUser(req);
    if (!llm) return { text: null };
    const started = Date.now();
    try {
      const input = await homeFactInput(repo, household_id, user_id);
      const r = await generate(input);
      if (r.meta.mode === 'live') await recordUsage(repo, { user_id, household_id }, 'home_fact', r.meta, r.calls, started);
      if (r.meta.mode === 'stub') return { text: null };   // без ключа (тести, стенд) — тихо
      if (isNoFactReply(r.text)) return { text: null };     // модель не знайшла фактів — рядка нема, це не помилка
      const text = cleanHomeFactText(r.text);
      if (!text) throw new Error(r.text ? `over ${r.text.length} chars or not plain text` : 'empty reply');
      return { text };
    } catch (err) {
      incident({ repo, req }, 'guard', 'home-fact-llm-failed', { user_id, household_id, err: String(err) });
      return { text: null };
    }
  });
}
