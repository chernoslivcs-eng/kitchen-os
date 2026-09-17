// Ранковий дайджест дому (DIGEST-PLAN-0917, PR 1).
//
// Один хід моделі за серверною командою — як PROFILE_SUMMARY_REQUEST
// (onboarding.ts): рядок [СЕРВЕР] у user-turn, в історію не пишеться, картки
// нема, відповідь — звичайне повідомлення асистента в розмові дня. Контекст
// той самий, що в чаті ([КОМОРА], [СПИСОК ПОКУПОК], [ЗАРАЗ], [ПРО ЛЮДИНУ]).
//
// Тут — команда (текст промпту живе в домені, не в packages/prompts), правила
// «кому і коли» та розкладка для Telegram. Що з даних вважати «горить»,
// «у списку», «попереду» — рахує сервер ДО виклику: якщо порожні всі три,
// хід не робиться взагалі (без «у вас усе тихо»).
import type { PantryBatch, ShoppingItemRow, HouseholdEventRow } from './types.js';
import { daysLeft, effectiveExpiry } from './pantry-view.js';
import { TG_EMOJI } from './telegram-emoji.js';

export const DIGEST_HOUR = 7;
export const DIGEST_DEFAULT_TZ = 'Europe/Kyiv';
/** «Горить» — до стількох днів (як «догоряє» у коморі). */
export const DIGEST_BURNING_DAYS = 5;
export const DIGEST_EVENT_HORIZON_DAYS = 7;

export const DIGEST_HEADINGS = { burning: 'Горить', list: 'У списку', ahead: 'Попереду' } as const;
export const DIGEST_LIST_EMPTY = 'У списку порожньо';

/**
 * Серверна команда. Формат за планом: вступне речення → «Горить» (до 5,
 * відкриті першими) → «У списку» (до 5; порожній → «У списку порожньо») →
 * «Попереду» (7 днів, до 3) → гумореска окремим абзацом. Заголовки блоків —
 * окремим рядком, без «**»; рядки списку — з «·». Блок без даних — пропустити.
 */
export const DIGEST_REQUEST =
  '[СЕРВЕР] Ранок. Зроби дайджест стану дому для людини, яка сьогодні ще не заходила. '
  + 'Plain text, без markdown і без «**». Абзаци через порожній рядок. Порядок і верстка суворо такі: '
  + '(1) одне вступне речення у своєму голосі — можна з відсилкою до останнього готування з [ОСТАННІ ГОТУВАННЯ], якщо воно є; '
  + `(2) рядок-заголовок «${DIGEST_HEADINGS.burning}», під ним до 5 рядків, кожен починається з «· » — назва, тире, скільки лишилось і до коли (з [КОМОРА]: спершу відкрите й те, що «!Nдн» чи «~строк≈», найтерміновіше першим); `
  + `(3) рядок-заголовок «${DIGEST_HEADINGS.list}», під ним до 5 рядків «· назва» з [СПИСОК ПОКУПОК]; якщо список порожній — один рядок «${DIGEST_LIST_EMPTY}» замість блоку; `
  + `(4) рядок-заголовок «${DIGEST_HEADINGS.ahead}», під ним до 3 рядків «· дата — назва» з подій дому і приводів у [ЗАРАЗ] на найближчі ${DIGEST_EVENT_HORIZON_DAYS} днів; `
  + '(5) окремим абзацом гумореска — одне-два речення про стан цього дому, добра, без сарказму й без порад. '
  + 'Блок, для якого даних нема, пропусти разом із заголовком (крім «У списку» — там рядок про порожнє). '
  + 'Нічого не вигадуй: лише те, що є в контексті; кількості й дні — як у [КОМОРА]. Не став запитань і не пропонуй страв. Без картки.';

export interface DigestFacts { burning: number; list: number; events: number }

/** Що є для дайджесту. Порожні всі три → не шлемо. */
export function digestFacts(
  pantry: readonly PantryBatch[],
  shopping: readonly ShoppingItemRow[],
  events: readonly HouseholdEventRow[],
  now = new Date(),
): DigestFacts {
  const nowMs = now.getTime();
  const burning = pantry.filter((b) => {
    if (b.depleted_at || b.state === 'depleted') return false;
    const d = daysLeft(effectiveExpiry(b, b.catalog_key), nowMs);
    return d !== null && d <= DIGEST_BURNING_DAYS;
  }).length;
  const list = shopping.filter((s) => !s.checked).length;
  const until = nowMs + DIGEST_EVENT_HORIZON_DAYS * 86_400_000;
  const events_ = events.filter((e) => {
    if (e.done_at) return false;
    const at = e.rule.t === 'once' ? Date.parse(e.rule.at) : e.from ? Date.parse(e.from) : null;
    if (at === null || Number.isNaN(at)) return false;
    const end = e.rule.t === 'once' && e.rule.days ? at + e.rule.days * 86_400_000 : e.to ? Date.parse(e.to) + 86_400_000 : at + 86_400_000;
    return end >= nowMs && at <= until;
  }).length;
  return { burning, list, events: events_ };
}

export const digestIsEmpty = (f: DigestFacts): boolean => f.burning === 0 && f.list === 0 && f.events === 0;

/** Локальна година й день (YYYY-MM-DD) у поясі людини; невідомий пояс → Europe/Kyiv. */
export function localClock(now: Date, tz: string | null | undefined): { hour: number; day: string } {
  const zone = tz && safeTz(tz) ? tz : DIGEST_DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { hour: Number(get('hour')) % 24, day: `${get('year')}-${get('month')}-${get('day')}` };
}
function safeTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export interface DigestCandidate {
  digest_enabled: boolean;
  digest_sent_on: string | null;
  tz: string | null;
  /** Чи людина сьогодні (за її поясом) уже писала в чат до 07:00 — тоді вона й так у додатку. */
  wrote_today_before: boolean;
}

/** Слати зараз? Крон щогодини: лише в годину 07 місцевого часу, раз на день, не опт-аут, не «вже в чаті». */
export function shouldSendDigest(c: DigestCandidate, now = new Date()): { send: boolean; day: string; reason?: string } {
  const { hour, day } = localClock(now, c.tz);
  if (!c.digest_enabled) return { send: false, day, reason: 'opted_out' };
  if (hour !== DIGEST_HOUR) return { send: false, day, reason: 'not_hour' };
  if (c.digest_sent_on === day) return { send: false, day, reason: 'already_sent' };
  if (c.wrote_today_before) return { send: false, day, reason: 'already_active' };
  return { send: true, day };
}

/** Telegram: ті самі рядки, лише емодзі-маркер перед заголовком блоку. */
export function digestForTelegram(text: string): string {
  const marks: Record<string, string> = {
    [DIGEST_HEADINGS.burning]: TG_EMOJI.burning,
    [DIGEST_HEADINGS.list]: TG_EMOJI.cmd.list,
    [DIGEST_HEADINGS.ahead]: TG_EMOJI.calendar.upcoming,
    [DIGEST_LIST_EMPTY]: TG_EMOJI.cmd.list,
  };
  return text.split('\n').map((line) => {
    const t = line.trim();
    return marks[t] ? `${marks[t]} ${t}` : line;
  }).join('\n');
}
