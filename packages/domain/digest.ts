// Вечірнє нагадування в Telegram (spec docs/superpowers/specs/2026-09-20-evening-
// notification-design.md, замінює DIGEST-PLAN-0917 і «анекдот про стан дому»).
//
// Людина о 18:00 рухається додому й може зайти в магазин. За три секунди —
// КОНКРЕТИКА (сервер, детерміновано), одна кнопка назад у продукт, одне речення
// голосу (модель). Чотири форми за пріоритетом: список → подія (7 днів) →
// горить (≤ 2 дні, лише з каталожним ключем) → страва з того, що є.
//
// Тут — вибір форми, рядок конкретики, команда для моделі, обрізання речення,
// правила «кому і коли». Telegram-обробники (services/api) це кличуть.
import type { PantryBatch, ShoppingItemRow } from './types.js';
import type { Tradition } from './occasion-rules.js';
import { daysLeft, effectiveExpiry } from './pantry-view.js';
import { upcomingEvents, type UpcomingEvent } from './occasions.js';
import { BUILTIN_OCCASIONS, type OccasionRow } from './occasion-data.js';

export const DIGEST_HOUR = 18;
export const DIGEST_DEFAULT_TZ = 'Europe/Kyiv';
/** Писала в чат за останні 3 години — вона й так у додатку. */
export const DIGEST_ACTIVE_WINDOW_MS = 3 * 60 * 60_000;
/** «Горить» — до стількох днів (або прострочено). */
export const DIGEST_BURNING_DAYS = 2;
export const DIGEST_EVENT_HORIZON_DAYS = 7;
export const DIGEST_LIST_MAX = 6;
export const DIGEST_BURNING_MAX = 4;
/** Стеля речення голосу. */
export const DIGEST_VOICE_MAX = 140;

export type DigestForm = 1 | 2 | 3 | 4;

export interface DigestPick {
  form: DigestForm;
  /** Тема для команди моделі — 1–4 словами. */
  theme: string;
  /** Рядок конкретики (сервер). Для форми 4 — назву страви підставляє api (proposal-хід). */
  facts: string;
  /** Кнопка: підпис і next глибокого лінка. */
  button: { text: string; next: string };
}

// ── Форма 1: список ────────────────────────────────────────────────────────
export function listLine(shopping: readonly ShoppingItemRow[]): string | null {
  const open = shopping.filter((s) => !s.checked);
  if (!open.length) return null;
  const shown = open.slice(0, DIGEST_LIST_MAX).map((s) => s.label);
  const rest = open.length - shown.length;
  return `Дорогою додому: ${shown.join(' · ')}${rest > 0 ? ` +${rest}` : ''}`;
}

// ── Форма 2: підписана подія в межах 7 днів ───────────────────────────────
const WEEKDAY_IN = ['у неділю', 'у понеділок', 'у вівторок', 'у середу', 'у четвер', 'у пʼятницю', 'у суботу'];
const WEEKDAY_FROM = ['із неділі', 'із понеділка', 'із вівторка', 'із середи', 'із четверга', 'із пʼятниці', 'із суботи'];
const ddmm = (at: number) => { const d = new Date(at); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** «Покрова у середу, 14.10» / «Сливи відходять до 21.09» / «Різдвяний піст із суботи, 28.11». */
export function eventLine(e: UpcomingEvent): string {
  const wd = new Date(e.at).getDay();
  const starts = / — починається$/.exec(e.title);
  const ends = / — останні дні$/.exec(e.title);
  if (starts) return `${e.title.slice(0, starts.index)} ${WEEKDAY_FROM[wd]}, ${ddmm(e.at)}`;
  if (ends) {
    const title = e.title.slice(0, ends.index);
    return e.kind === 'season' ? `${title} відходять до ${ddmm(e.at)}` : `${title} до ${ddmm(e.at)}`;
  }
  return `${e.title} ${WEEKDAY_IN[wd]}, ${ddmm(e.at)}`;
}

export function nextSubscribedEvent(now: Date, trads: Tradition[], rows: OccasionRow[] = BUILTIN_OCCASIONS): UpcomingEvent | null {
  return upcomingEvents(now, trads, DIGEST_EVENT_HORIZON_DAYS, rows)[0] ?? null;
}

// ── Форма 3: горить ────────────────────────────────────────────────────────
export interface Burning { label: string; days: number }
export function burningBatches(pantry: readonly PantryBatch[], now = new Date()): Burning[] {
  const nowMs = now.getTime();
  return pantry
    .filter((b) => !b.depleted_at && b.state !== 'depleted' && !!b.catalog_key)
    .map((b) => ({ label: b.label, days: daysLeft(effectiveExpiry(b, b.catalog_key), nowMs) }))
    .filter((x): x is Burning => x.days !== null && x.days <= DIGEST_BURNING_DAYS)
    .sort((a, b) => a.days - b.days);
}
/** «Вершки й лимонний сік — до завтра»; до 4 позицій; строк — за найближчим. */
export function burningLine(rows: readonly Burning[]): string | null {
  if (!rows.length) return null;
  const shown = rows.slice(0, DIGEST_BURNING_MAX).map((r) => r.label);
  const names = shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(', ')} й ${shown[shown.length - 1]}`;
  const min = rows[0]!.days;
  const when = min < 0 ? 'уже прострочено' : min === 0 ? 'сьогодні' : min === 1 ? 'до завтра' : 'два дні';
  return `${names} — ${when}`;
}

// ── Вибір форми ────────────────────────────────────────────────────────────
export interface DigestInput {
  pantry: readonly PantryBatch[];
  shopping: readonly ShoppingItemRow[];
  /** Традиції, на які підписаний дім, і рядки довідника крізь підписку (periods.ts). */
  trads: Tradition[];
  occasionRows?: OccasionRow[];
  now?: Date;
}

/** Перша форма, для якої є зміст; null — нема що сказати (не шлемо). */
export function pickForm(input: DigestInput): DigestPick | null {
  const now = input.now ?? new Date();
  const list = listLine(input.shopping);
  if (list) return { form: 1, theme: 'список покупок дорогою додому', facts: list, button: { text: 'Список', next: '/list' } };
  const ev = nextSubscribedEvent(now, input.trads, input.occasionRows);
  if (ev) return { form: 2, theme: 'подія попереду', facts: eventLine(ev), button: { text: 'Календар', next: '/calendar' } };
  const burning = burningLine(burningBatches(input.pantry, now));
  // Спека хоче /app?ask=burning (чат одразу з запитом «що зготувати з того, що горить») — такого входу
  // у вебі ще нема (Feed не читає ?ask=), тому поки /app; вхід — окремий борг.
  if (burning) return { form: 3, theme: 'що горить у коморі', facts: burning, button: { text: 'Що зготувати', next: '/app' } };
  const alive = input.pantry.some((b) => !b.depleted_at && b.state !== 'depleted');
  // Форма 4: назву дає proposal-хід (api); рецепт НЕ генеруємо — він народиться по тапу «Готуємо» в розмові дня.
  if (alive) return { form: 4, theme: 'страва з того, що є', facts: '', button: { text: 'Що зготувати', next: '/app' } };
  return null;
}

// ── Речення голосу ─────────────────────────────────────────────────────────
/** Серверна команда для одного речення (як PROFILE_SUMMARY_REQUEST). */
export function digestRequest(theme: string, facts: string): string {
  return `[СЕРВЕР] Одне речення до вечірнього нагадування. Тема: ${theme}. Факти: ${facts}. Без переліку, без порад, без питань, без звертання до обмежень і алергій. Речення НЕ повторює факти з рядка вище і не перелічує їх. Воно про ДІМ: чому це потрібно (що в коморі чекає на ці покупки / що з цим приготується) або спостереження про стан дому з легкою усмішкою. Приклад тону: «Вершки — бо камамбер у холодильнику вже третій день чекає компанію.»`;
}
/** Впізнавана голова команди — chat-turn по ній розуміє серверний хід. */
export const DIGEST_REQUEST_PREFIX = '[СЕРВЕР] Одне речення до вечірнього нагадування.';

/** Відповідь → одне речення ≤ 140; порожньо / JSON / нічого путнього → null (шлемо без речення). */
export function voiceSentence(reply: string | null | undefined): string | null {
  const t = (reply ?? '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
  if (!t || t.startsWith('{') || t.startsWith('[')) return null;
  const m = /^[\s\S]*?[.!?…](?=\s|$)/.exec(t);
  let s = (m ? m[0] : t).replace(/\s+/g, ' ').trim();
  if (Array.from(s).length > DIGEST_VOICE_MAX) s = Array.from(s).slice(0, DIGEST_VOICE_MAX - 1).join('').trimEnd() + '…';
  return s || null;
}

/** Розкладка: рядок конкретики, рядок голосу; кнопка — окремо (inline). Без «Відкрити у вебі». */
export function digestText(facts: string, voice: string | null): string {
  return voice ? `${facts}\n${voice}` : facts;
}

// ── Кому і коли ────────────────────────────────────────────────────────────
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
  /** Чи людина писала в чат за останні 3 години — тоді вона й так у додатку. */
  wrote_recently: boolean;
}

/** Слати зараз? Крон щогодини: лише в годину 18 місцевого часу, раз на день, не опт-аут, не «щойно в чаті». */
export function shouldSendDigest(c: DigestCandidate, now = new Date()): { send: boolean; day: string; reason?: string } {
  const { hour, day } = localClock(now, c.tz);
  if (!c.digest_enabled) return { send: false, day, reason: 'opted_out' };
  if (hour !== DIGEST_HOUR) return { send: false, day, reason: 'not_hour' };
  if (c.digest_sent_on === day) return { send: false, day, reason: 'already_sent' };
  if (c.wrote_recently) return { send: false, day, reason: 'already_active' };
  return { send: true, day };
}
