// Ранковий дайджест дому (DIGEST-PLAN-0917, PR 1). Жанр — рішення власника
// 17.09 (друге): не зведення зі списками, а АНЕКДОТ про поточний стан дому.
//
// Один хід моделі за серверною командою — як PROFILE_SUMMARY_REQUEST
// (onboarding.ts): рядок [СЕРВЕР] у user-turn, в історію не пишеться, картки
// нема, відповідь — звичайне повідомлення асистента в розмові дня. Контекст
// той самий, що в чаті ([КОМОРА], [СПИСОК ПОКУПОК], [ЗАРАЗ], [ОСТАННІ ГОТУВАННЯ]).
//
// Тут — команда (текст промпту живе в домені, не в packages/prompts) і правила
// «кому і коли». Чи є з чого жартувати — рахує сервер ДО виклику: якщо в домі
// порожньо (нічого не горить, список порожній, подій нема), хід не робиться.
import type { PantryBatch, ShoppingItemRow, HouseholdEventRow } from './types.js';
import { daysLeft, effectiveExpiry } from './pantry-view.js';

export const DIGEST_HOUR = 7;
export const DIGEST_DEFAULT_TZ = 'Europe/Kyiv';
/** «Горить» — до стількох днів (як «догоряє» у коморі). */
export const DIGEST_BURNING_DAYS = 5;
export const DIGEST_EVENT_HORIZON_DAYS = 7;

/** Серверна команда — дослівно від власника 17.09 (третє рішення): лише це; голос і межі тримає role/voice, як у чаті. */
export const DIGEST_REQUEST = '[СЕРВЕР] Розкажи анекдот про поточний стан дому.';

export interface DigestFacts { burning: number; list: number; events: number }

/** Що є в домі. Порожні всі три → не шлемо. */
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

/** Telegram: анекдот іде як є — без заголовків, маркерів і емодзі всередині тексту (правило telegram-emoji). */
export function digestForTelegram(text: string): string {
  return text.trim();
}
