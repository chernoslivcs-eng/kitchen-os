// Вечірнє нагадування (spec 2026-09-20): вибір форми за пріоритетом, рядки конкретики,
// гейт «3 години», 18:00 по поясах, опт-аут, порожньо, речення голосу.
import { describe, it, expect } from 'vitest';
import {
  pickForm, listLine, burningLine, burningBatches, eventLine, voiceSentence, digestText, digestRequest,
  shouldSendDigest, localClock, DIGEST_REQUEST_PREFIX,
} from '../digest.js';
import { subscribedRows } from '../periods.js';
import { BUILTIN_OCCASIONS } from '../occasion-data.js';
import type { PantryBatch, ShoppingItemRow } from '../types.js';

const NOW = new Date('2026-09-17T15:30:00.000Z'); // 18:30 Київ
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const batch = (over: Partial<PantryBatch>): PantryBatch => ({
  id: 'b', household_id: 'h', catalog_key: 'x', label: 'x', zone: 'fridge', value: 1, unit: 'pcs', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: NOW.toISOString(), depleted_at: null,
  confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id: null, ...over,
});
const item = (label: string, checked = false): ShoppingItemRow => ({ id: label, household_id: 'h', label, reason: null, value: null, unit: null, zone: null, checked, added_by: null, source: 'user', created_at: NOW.toISOString() });
const base = { pantry: [] as PantryBatch[], shopping: [] as ShoppingItemRow[], trads: [] as never[], occasionRows: [] as never[], now: NOW };

describe('форма 1 · список', () => {
  it('до 6 позицій через «·», далі +N; відмічені не рахуються', () => {
    const items = ['хліб', 'молоко', 'лимони', 'вершки 33%', 'яйця', 'масло', 'сіль', 'цукор'].map((l) => item(l));
    expect(listLine(items)).toBe('Дорогою додому: хліб · молоко · лимони · вершки 33% · яйця · масло +2');
    expect(listLine([item('хліб'), item('молоко', true)])).toBe('Дорогою додому: хліб');
    expect(listLine([item('молоко', true)])).toBeNull();
  });
  it('список має пріоритет над рештою', () => {
    const p = pickForm({ ...base, shopping: [item('хліб')], pantry: [batch({ expires_at: day(1) })] });
    expect(p).toMatchObject({ form: 1, facts: 'Дорогою додому: хліб', button: { text: 'Список', next: '/list' } });
  });
});

describe('форма 2 · подія в межах 7 днів', () => {
  it('формат дат: «у середу, 14.10» / «відходять до 21.09» / «із суботи, 28.11»', () => {
    expect(eventLine({ at: Date.parse('2026-10-14T09:00:00Z'), title: 'Покрова', kind: 'tradition' })).toBe('Покрова у середу, 14.10');
    expect(eventLine({ at: Date.parse('2026-09-21T09:00:00Z'), title: 'Сливи — останні дні', kind: 'season' })).toBe('Сливи відходять до 21.09');
    expect(eventLine({ at: Date.parse('2026-11-28T09:00:00Z'), title: 'Різдвяний піст — починається', kind: 'tradition' })).toBe('Різдвяний піст із суботи, 28.11');
  });
  it('лише підписані рядки; далі за 7 днів — ні; вибір ставить кнопку «Календар»', () => {
    // Дім підписаний лише на Спас (сезони вимкнені явно) — 12.08 він за 5 днів.
    const subs = [{ occasion_id: 'spas', enabled: true }, ...BUILTIN_OCCASIONS.filter((r) => r.id !== 'spas').map((r) => ({ occasion_id: r.id, enabled: false }))];
    const rows = subscribedRows(BUILTIN_OCCASIONS, subs);
    const p = pickForm({ ...base, trads: ['orthodox'], occasionRows: rows, now: new Date('2026-08-12T15:30:00Z') });
    expect(p?.form).toBe(2);
    expect(p?.facts).toBe('Яблучний Спас із понеділка, 17.08');
    expect(p?.button).toEqual({ text: 'Календар', next: '/calendar' });
    expect(pickForm({ ...base, trads: ['orthodox'], occasionRows: rows, now: new Date('2026-07-01T15:30:00Z') })).toBeNull();
  });
});

describe('форма 3 · горить', () => {
  it('≤ 2 дні або прострочено, лише з catalog_key; до 4 позицій; строк за найближчим', () => {
    const p = [
      batch({ id: '1', label: 'вершки', expires_at: day(1) }), batch({ id: '2', label: 'лимонний сік', expires_at: day(2) }),
      batch({ id: '3', label: 'сметана', expires_at: day(5) }), batch({ id: '4', label: 'без ключа', catalog_key: null, expires_at: day(0) }),
      batch({ id: '5', label: 'списане', expires_at: day(0), depleted_at: NOW.toISOString(), state: 'depleted' }),
    ];
    expect(burningLine(burningBatches(p, NOW))).toBe('вершки й лимонний сік — до завтра');
    const many = ['а', 'б', 'в', 'г', 'д'].map((l, i) => batch({ id: l, label: l, expires_at: day(i === 0 ? -1 : 2) }));
    expect(burningLine(burningBatches(many, NOW))).toBe('а, б, в й г — уже прострочено');
    expect(burningLine([{ label: 'сир', days: 0 }])).toBe('сир — сьогодні');
    expect(burningLine([{ label: 'сир', days: 2 }])).toBe('сир — два дні');
  });
  it('кнопка «Що зготувати» → /app (входу ?ask=burning у вебі ще нема)', () => {
    expect(pickForm({ ...base, pantry: [batch({ expires_at: day(1) })] })?.button).toEqual({ text: 'Що зготувати', next: '/app' });
  });
});

describe('форма 4 і порожньо', () => {
  it('комора не порожня, нічого не горить → форма 4 (назву дає api); порожньо → null', () => {
    expect(pickForm({ ...base, pantry: [batch({ expires_at: day(20) })] })?.form).toBe(4);
    expect(pickForm({ ...base, pantry: [batch({ expires_at: day(0), depleted_at: NOW.toISOString(), state: 'depleted' })] })).toBeNull();
    expect(pickForm(base)).toBeNull();
  });
});

describe('речення голосу', () => {
  it('команда — з темою і фактами, з упізнаваною головою', () => {
    const r = digestRequest('список покупок дорогою додому', 'Дорогою додому: хліб');
    expect(r.startsWith(DIGEST_REQUEST_PREFIX)).toBe(true);
    expect(r).toContain('Тема: список покупок дорогою додому. Факти: Дорогою додому: хліб.');
    expect(r).toContain('Без переліку, без порад, без питань');
    expect(r).toContain('НЕ повторює факти');
  });
  it('обрізання до першого речення, стеля 140, порожньо/JSON → null', () => {
    expect(voiceSentence('Вершки — бо камамбер чекає компанію. А ще хліб.')).toBe('Вершки — бо камамбер чекає компанію.');
    expect(voiceSentence('**Ого!** Хліб')).toBe('Ого!');
    expect(voiceSentence('x'.repeat(200))).toHaveLength(140);
    expect(voiceSentence('')).toBeNull();
    expect(voiceSentence('{"reply":"…"}')).toBeNull();
  });
  it('розкладка: конкретика, голос; без голосу — лише конкретика', () => {
    expect(digestText('Дорогою додому: хліб', 'Хліб — і дім пахне.')).toBe('Дорогою додому: хліб\nХліб — і дім пахне.');
    expect(digestText('Дорогою додому: хліб', null)).toBe('Дорогою додому: хліб');
  });
});

describe('кому і коли', () => {
  const c = { digest_enabled: true, digest_sent_on: null, tz: 'Europe/Kyiv', wrote_recently: false };
  it('вікно 17..19 місцевого: 16:59 — ні, 17:00 — так, 19:59 — так, 20:00 — ні; вже сьогодні — ні; писала за 3 год — ні; опт-аут — ні', () => {
    expect(shouldSendDigest(c, NOW)).toEqual({ send: true, day: '2026-09-17' });
    expect(shouldSendDigest(c, new Date('2026-09-17T13:59:00Z')).reason).toBe('not_hour');   // 16:59 Київ
    expect(shouldSendDigest(c, new Date('2026-09-17T14:00:00Z')).send).toBe(true);           // 17:00
    expect(shouldSendDigest(c, new Date('2026-09-17T16:59:00Z')).send).toBe(true);           // 19:59
    expect(shouldSendDigest(c, new Date('2026-09-17T17:00:00Z')).reason).toBe('not_hour');   // 20:00
    expect(shouldSendDigest({ ...c, digest_sent_on: '2026-09-17' }, NOW).reason).toBe('already_sent');
    expect(shouldSendDigest({ ...c, wrote_recently: true }, NOW).reason).toBe('already_active');
    expect(shouldSendDigest({ ...c, digest_enabled: false }, NOW).reason).toBe('opted_out');
  });
  it('крон о 15:00 UTC: Київ улітку (18:00) і взимку (17:00) — обидва у вікні; Лісабон (16:00) — ні', () => {
    expect(shouldSendDigest(c, new Date('2026-09-17T15:00:00Z')).send).toBe(true);
    expect(shouldSendDigest(c, new Date('2026-12-17T15:00:00Z')).send).toBe(true);
    expect(shouldSendDigest({ ...c, tz: 'Europe/Lisbon' }, new Date('2026-09-17T15:00:00Z')).reason).toBe('not_hour');
    expect(shouldSendDigest({ ...c, tz: 'Europe/Lisbon' }, new Date('2026-09-17T17:30:00Z')).send).toBe(true);
    expect(localClock(NOW, 'Not/AZone')).toEqual({ hour: 18, day: '2026-09-17' });
  });
});
