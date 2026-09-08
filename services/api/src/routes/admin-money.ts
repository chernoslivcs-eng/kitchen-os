// Крок А4: GET /v1/admin/money — на що йдуть гроші і скільки вийде на місяць.
//
// Питання власника не «скільки», а НА ЩО. Пульс показував суму за день і рядок
// на людину; з цього не видно нічого корисного — один розбір чека коштує як
// десять питань про олію, і поки це не розділено, «$0.12 за день» просто
// число.
//
// Дві речі, які тут вирішені й на які варто дивитись при читанні:
//
// 1. АГРЕГАТИ РАХУЄ SQL. Два запити на весь блок: групи (обидва періоди
//    одразу) і середні. Поруч, у pulse.ts, лежить приклад того, як не треба —
//    цикл по учасниках із запитом на кожне повідомлення.
//
// 2. ДОЛАРИ СТАВИТЬ NODE, але вже на ЗГОРНУТИХ групах. Прайс залежить від
//    моделі й живе в pricing.ts; тягти його в SQL означало б завести другий
//    прайс. Груп десятки, тож ціна цього — ніщо.

import type { FastifyInstance } from 'fastify';
import type { AdminMoneyGroup, Repo } from '@kitchen/domain';
import { authenticated } from '../middleware/session.js';
import { requireAdmin } from '../middleware/admin.js';
import { priceOf, priceFor, cacheWriteRate } from '../pricing.js';
import { periodBounds, previousBounds, localDay, elapsedShare, type Period } from '../period.js';
import { TECHNICAL_DOMAIN } from './admin-households.js';

/** Скільки подій має бути за спиною, щоб відсоток не брехав. */
export const PERCENT_FLOOR = 20;

/** Типи виклику словом. Невідомий лишається як є — вигадувати назву гірше. */
const CALL_WORD: Record<string, string> = {
  chat: 'розмова',
  attachment_parse: 'розбір вкладення',
  recipe_gen: 'генерація рецепта',
  recipe_import: 'імпорт рецепта',
  pantry_search: 'пошук по коморі',
};

export interface MoneySlice {
  key: string;
  label: string;
  calls: number;
  usd: number;
  /** Скільки коштує ОДИН такий виклик — те число, заради якого блок існує. */
  usd_per_call: number | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  /** Викликів, ціни яких прайс не знає. Не нуль і не «безкоштовно». */
  unpriced_calls: number;
}

export interface MoneyTotals {
  calls: number;
  usd: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  /** Частка кешу серед вхідних. null — вхідних не було, ділити нема на що. */
  cached_share: number | null;
  /** Скільки викликів були стабові. У гроші не входять, але були. */
  stub_calls: number;
  unpriced_calls: number;
  /**
   * Крок А5: токени, записані в кеш, і скільки це коштувало окремо.
   * Найдорожчий рід вхідних — 1,25× ставки входу, у 12,5 раза дорожче за
   * читання. Стоїть на початку кожної холодної сесії, тобто це найбільший
   * важіль, який у нас є.
   */
  cache_write_tokens: number;
  cache_write_usd: number;
  /**
   * Викликів у періоді, для яких запис не рахувався взагалі (рядок старший за
   * міграцію 0032). Поки їх більше нуля, підсумок ЗАНИЖЕНИЙ, і екран мусить
   * сказати це, а не змовчати.
   */
  calls_without_write: number;
}

const empty = (): MoneyTotals => ({
  calls: 0, usd: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0,
  cached_share: null, stub_calls: 0, unpriced_calls: 0,
  cache_write_tokens: 0, cache_write_usd: 0, calls_without_write: 0,
});

/**
 * Ціна групи. `null` від `priceOf` — «моделі немає в прайсі», і це НЕ нуль:
 * нуль у підсумку читався б як «безкоштовно», а це інша новина. Такі виклики
 * рахуються окремим лічильником і в суму не входять.
 */
function priceGroup(g: AdminMoneyGroup): { usd: number; unpriced: number } {
  const one = priceOf({
    model: g.model,
    input_tokens: g.input_tokens,
    output_tokens: g.output_tokens,
    cached_tokens: g.cached_tokens,
    cache_write_tokens: g.cache_write_tokens,
  });
  return one === null ? { usd: 0, unpriced: g.calls } : { usd: one, unpriced: 0 };
}

/** Скільки з ціни групи припадає саме на ЗАПИС у кеш. */
function writeCostOf(g: AdminMoneyGroup): number {
  const p = priceFor(g.model);
  return p === null ? 0 : (g.cache_write_tokens * cacheWriteRate(p)) / 1_000_000;
}

/** Живі виклики — ті, за які справді платять. Стаб у гроші не входить. */
const isLive = (g: AdminMoneyGroup) => g.mode !== 'stub';

function fold(groups: AdminMoneyGroup[]): MoneyTotals {
  const t = empty();
  for (const g of groups) {
    if (!isLive(g)) { t.stub_calls += g.calls; continue; }
    const { usd, unpriced } = priceGroup(g);
    t.calls += g.calls;
    t.usd += usd;
    t.unpriced_calls += unpriced;
    t.input_tokens += g.input_tokens;
    t.output_tokens += g.output_tokens;
    t.cached_tokens += g.cached_tokens;
    t.cache_write_tokens += g.cache_write_tokens;
    t.cache_write_usd += writeCostOf(g);
    t.calls_without_write += g.rows_without_write;
  }
  t.cache_write_usd = Number(t.cache_write_usd.toFixed(6));
  t.usd = Number(t.usd.toFixed(6));
  // Крок А4а: знаменник — ВХІД + КЕШ, бо це два окремі лічильники, а не один
  // усередині іншого. Зі старим знаменником частка виходила 256% — число, яке
  // не могло існувати й показувало саме цю плутанину.
  const inputAll = t.input_tokens + t.cached_tokens;
  t.cached_share = inputAll > 0 ? t.cached_tokens / inputAll : null;
  return t;
}

function sliceBy(
  groups: AdminMoneyGroup[],
  keyOf: (g: AdminMoneyGroup) => string,
  labelOf: (key: string, g: AdminMoneyGroup) => string,
): MoneySlice[] {
  const acc = new Map<string, MoneySlice & { _g: AdminMoneyGroup }>();
  for (const g of groups) {
    if (!isLive(g)) continue;              // стаб не бере участі в розрізах
    const key = keyOf(g);
    let s = acc.get(key);
    if (!s) {
      s = {
        key, label: labelOf(key, g), calls: 0, usd: 0, usd_per_call: null,
        input_tokens: 0, output_tokens: 0, cached_tokens: 0, unpriced_calls: 0, _g: g,
      };
      acc.set(key, s);
    }
    const { usd, unpriced } = priceGroup(g);
    s.calls += g.calls;
    s.usd += usd;
    s.unpriced_calls += unpriced;
    s.input_tokens += g.input_tokens;
    s.output_tokens += g.output_tokens;
    s.cached_tokens += g.cached_tokens;
  }
  return [...acc.values()]
    .map(({ _g, ...s }) => ({
      ...s,
      usd: Number(s.usd.toFixed(6)),
      // Ціна одного виклику рахується по ТИХ, ціну яких знаємо. Ділити на всі
      // означало б занизити її рівно на частку невідомих моделей.
      usd_per_call: s.calls - s.unpriced_calls > 0
        ? Number((s.usd / (s.calls - s.unpriced_calls)).toFixed(6))
        : null,
    }))
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls);
}

export function moneyRoutes(app: FastifyInstance, repo: Repo) {
  app.get<{ Querystring: { period?: string; day?: string; technical?: string } }>(
    '/v1/admin/money',
    { preHandler: [authenticated(repo), requireAdmin(repo)] },
    async (req) => {
      const period: Period = req.query.period === 'week' || req.query.period === 'month'
        ? req.query.period : 'day';
      const day = req.query.day ?? localDay();
      const now = periodBounds(period, day);
      const prev = previousBounds(period, day);

      // Технічні доми в собівартість не входять — інакше витрати QA-прогонів
      // осядуть у ціні продукту. Правило те саме, що в списку домів; сюди
      // їде шаблон, а не друге визначення.
      const technicalLike = req.query.technical === '1' ? null : `%${TECHNICAL_DOMAIN}`;

      const [groups, averages] = await Promise.all([
        repo.adminMoneyGroups({ now, prev, technicalLike }),
        repo.adminMoneyAverages({ now, technicalLike, tz: processTz() }),
      ]);

      const nowGroups = groups.filter((g) => g.period === 'now');
      const prevGroups = groups.filter((g) => g.period === 'prev');

      const totals = fold(nowGroups);
      const previous = fold(prevGroups);

      // Крок А4а: назви замість uuid. Розріз без імен технічно правильний і
      // непридатний для читання — власник не впізнає в ньому нікого.
      // Довідник імен береться з того самого запиту, що вже потрібен списку
      // домів; окремого циклу «на дім» тут не з'явилось.
      const houses = await repo.listAdminHouseholds();
      const houseName = new Map(houses.map((h) => [h.id, h.name] as const));
      const personName = new Map<string, string>();
      for (const h of houses) if (h.owner_id && h.owner_name) personName.set(h.owner_id, h.owner_name);

      const byCall = sliceBy(nowGroups, (g) => g.call, (k) => CALL_WORD[k] ?? k);
      const byModel = sliceBy(nowGroups, (g) => g.model, (k) => k);
      // Ім'я, а якщо його немає — короткий id, а не тридцять шість знаків.
      // Довідник знає ВЛАСНИКІВ домів; на пілоті це всі, бо кожен дім
      // одноосібний. Запрошений учасник (їх поки нема жодного) лишиться
      // коротким id: щоб знати його ім'я, потрібен ще один довідник, а
      // цикл «на людину» — рівно те, чого цей блок і уникає.
      const short = (k: string) => (k.length > 12 ? `${k.slice(0, 8)}…` : k);
      const byHousehold = sliceBy(nowGroups, (g) => g.household_id ?? '—',
        (k) => houseName.get(k) ?? short(k));
      const byPerson = sliceBy(nowGroups, (g) => g.user_id,
        (k) => personName.get(k) ?? short(k));

      // ---- Середні ------------------------------------------------------
      const households = new Set(nowGroups.filter(isLive).map((g) => g.household_id).filter(Boolean));
      const people = new Set(nowGroups.filter(isLive).map((g) => g.user_id));
      const usdWithTurn = fold(nowGroups.filter((g) => g.has_turn)).usd;

      const avg = {
        /** Ціна ХОДА, не виклику: сума рядків одного message_id. */
        usd_per_turn: averages.turns > 0 ? Number((usdWithTurn / averages.turns).toFixed(6)) : null,
        turns: averages.turns,
        latency_avg_ms: averages.latency_avg_ms,
        latency_p95_ms: averages.latency_p95_ms,
        latency_n: averages.latency_n,
        /**
         * Ходів на людину в день, коли вона писала. Знаменник — саме такі дні,
         * а не всі дні періоду: інакше на пілоті це ділення на тишу.
         */
        turns_per_person_day: averages.person_days > 0
          ? Number((averages.turns / averages.person_days).toFixed(2)) : null,
        person_days: averages.person_days,
        /**
         * Скільки чекала ЛЮДИНА — не міряємо, і кажемо це прямо. Заливка фото,
         * розбір і малювання картки поза виміром; це інше число, і воно більше.
         */
        human_wait_ms: null as number | null,
      };

      // ---- Прогноз ------------------------------------------------------
      const monthBounds = periodBounds('month', day);
      const monthGone = elapsedShare(monthBounds);
      // Темп беремо з ВИБРАНОГО періоду — він і є «поточний темп».
      const perDayUsd = totals.usd / Math.max(1, spanDays(now) * elapsedShare(now));
      const daysInMonth = spanDays(monthBounds);

      const forecast = {
        /** Оцінка, не факт. Клієнт показує її зі знаком «≈». */
        month_usd: Number((perDayUsd * daysInMonth).toFixed(4)),
        month_elapsed: Number(monthGone.toFixed(3)),
        per_household_usd: households.size > 0
          ? Number((perDayUsd * daysInMonth / households.size).toFixed(4)) : null,
        per_person_usd: people.size > 0
          ? Number((perDayUsd * daysInMonth / people.size).toFixed(4)) : null,
        households: households.size,
        people: people.size,
        /**
         * На що прогноз чутливий. Не прикраса: без цього число виглядає
         * точнішим, ніж воно є.
         */
        sensitive_to: {
          cached_share: totals.cached_share,
          parse_share: shareOfCalls(byCall, 'attachment_parse'),
          long_tail_ms: averages.latency_p95_ms,
        },
        /**
         * Місце під майбутню ціну підписки. Платежів немає — це пілот, ніхто
         * не платить, і рахувати маржу проти неіснуючої підписки означало б
         * вигадувати. Число вмикається однією зміною, коли ціна з'явиться.
         */
        price_usd: null as number | null,
      };

      return {
        period,
        day,
        from: now.from.toISOString(),
        to: now.to.toISOString(),
        prev_from: prev.from.toISOString(),
        prev_to: prev.to.toISOString(),
        totals,
        previous,
        byCall,
        byModel,
        byHousehold,
        byPerson,
        avg,
        forecast,
        /**
         * Найперший облікований виклик. Якщо період починається раніше — ми
         * не «витратили нуль», ми стільки ще не збирали, і це інша новина.
         */
        collected_since: averages.first_usage_at,
        /**
         * Крок А5: відколи взагалі рахується запис у кеш. Період, що
         * починається раніше, показує занижене число, і екран каже це рядком.
         */
        cache_write_since: averages.cache_write_since,
        percent_floor: PERCENT_FLOOR,
        technical_included: req.query.technical === '1',
      };
    },
  );
}

/** Днів у періоді. Через UTC-мітки, щоб перехід на літній час не з'їв день. */
function spanDays(b: { from: Date; to: Date }): number {
  return Math.max(1, Math.round((b.to.getTime() - b.from.getTime()) / 86_400_000));
}

function shareOfCalls(slices: MoneySlice[], key: string): number | null {
  const total = slices.reduce((n, s) => n + s.calls, 0);
  if (!total) return null;
  return (slices.find((s) => s.key === key)?.calls ?? 0) / total;
}

/** Пояс процесу — той самий, у якому period.ts рахує межі доби. */
function processTz(): string {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
