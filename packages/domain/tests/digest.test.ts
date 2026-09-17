// Ранковий дайджест (DIGEST-PLAN-0917, PR 1): що є для дайджесту, кому і коли слати, розкладка для Telegram.
import { describe, it, expect } from 'vitest';
import { digestFacts, digestIsEmpty, shouldSendDigest, localClock, digestForTelegram, DIGEST_REQUEST } from '../digest.js';
import type { PantryBatch, ShoppingItemRow, HouseholdEventRow } from '../types.js';

const NOW = new Date('2026-09-17T04:30:00.000Z'); // 07:30 Київ
const batch = (over: Partial<PantryBatch>): PantryBatch => ({
  id: 'b', household_id: 'h', catalog_key: null, label: 'x', zone: 'fridge', value: 1, unit: 'pcs', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: NOW.toISOString(), depleted_at: null,
  confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id: null, ...over,
});
const item = (checked = false): ShoppingItemRow => ({ id: 's', household_id: 'h', label: 'хліб', reason: null, value: null, unit: null, zone: null, checked, added_by: null, source: 'user', created_at: NOW.toISOString() });
const event = (at: string, days?: number, done: string | null = null): HouseholdEventRow => ({
  id: 'e', household_id: 'h', kind: 'custom', title: 'гості', note: null, rule: { t: 'once', at, ...(days ? { days } : {}) }, force: 'hint', restricts: null,
  from: null, to: null, rule_text: null, strict: false, buy: [], recipe_id: null, servings: null, supply: null, created_by: 'u', source: 'user',
  expires_at: null, done_at: done, created_at: NOW.toISOString(),
});

describe('digestFacts / digestIsEmpty', () => {
  it('горить — строк ≤ 5 днів або прострочено; списані не рахуються', () => {
    const soon = batch({ expires_at: new Date(NOW.getTime() + 2 * 86_400_000).toISOString() });
    const later = batch({ id: 'c', expires_at: new Date(NOW.getTime() + 20 * 86_400_000).toISOString() });
    const gone = batch({ id: 'd', expires_at: new Date(NOW.getTime() + 1 * 86_400_000).toISOString(), depleted_at: NOW.toISOString(), state: 'depleted' });
    const expired = batch({ id: 'e', expires_at: new Date(NOW.getTime() - 86_400_000).toISOString() });
    expect(digestFacts([soon, later, gone, expired], [], [], NOW)).toEqual({ burning: 2, list: 0, events: 0 });
  });
  it('список — лише невідмічене; події — на 7 днів, з тривалістю, без done', () => {
    expect(digestFacts([], [item(false), item(true)], [], NOW).list).toBe(1);
    const f = digestFacts([], [], [event('2026-09-20'), event('2026-09-30'), event('2026-09-12', 7), event('2026-09-18', undefined, NOW.toISOString())], NOW);
    expect(f.events).toBe(2); // 20.09 у горизонті; 12.09+7 дн ще триває; 30.09 — за горизонтом; done — ні
  });
  it('порожньо — коли всі три нулі', () => {
    expect(digestIsEmpty({ burning: 0, list: 0, events: 0 })).toBe(true);
    expect(digestIsEmpty({ burning: 0, list: 1, events: 0 })).toBe(false);
  });
});

describe('localClock / shouldSendDigest', () => {
  it('пояс із профілю або Europe/Kyiv; хибний пояс — Київ', () => {
    expect(localClock(NOW, 'Europe/Kyiv')).toEqual({ hour: 7, day: '2026-09-17' });
    expect(localClock(NOW, null)).toEqual({ hour: 7, day: '2026-09-17' });
    expect(localClock(NOW, 'America/New_York')).toEqual({ hour: 0, day: '2026-09-17' });
    expect(localClock(NOW, 'Not/AZone')).toEqual({ hour: 7, day: '2026-09-17' });
  });
  const base = { digest_enabled: true, digest_sent_on: null, tz: 'Europe/Kyiv', wrote_today_before: false };
  it('о 07 місцевого — так; о 08 — ні; уже надіслано сьогодні — ні; писала до 07 — ні; опт-аут — ні', () => {
    expect(shouldSendDigest(base, NOW)).toEqual({ send: true, day: '2026-09-17' });
    expect(shouldSendDigest(base, new Date('2026-09-17T05:30:00.000Z')).reason).toBe('not_hour');
    expect(shouldSendDigest({ ...base, digest_sent_on: '2026-09-17' }, NOW).reason).toBe('already_sent');
    expect(shouldSendDigest({ ...base, digest_sent_on: '2026-09-16' }, NOW).send).toBe(true);
    expect(shouldSendDigest({ ...base, wrote_today_before: true }, NOW).reason).toBe('already_active');
    expect(shouldSendDigest({ ...base, digest_enabled: false }, NOW).reason).toBe('opted_out');
  });
  it('крон щогодини: людину в Лісабоні (07 = 06:xx UTC) ловить інший тик, не київський', () => {
    expect(shouldSendDigest({ ...base, tz: 'Europe/Lisbon' }, NOW).reason).toBe('not_hour');
    expect(shouldSendDigest({ ...base, tz: 'Europe/Lisbon' }, new Date('2026-09-17T06:30:00.000Z')).send).toBe(true);
  });
});

describe('DIGEST_REQUEST / digestForTelegram', () => {
  it('команда — серверний рядок про анекдот: сюжет, панчлайн, без заголовків, маркерів, грамів, запитань', () => {
    expect(DIGEST_REQUEST.startsWith('[СЕРВЕР]')).toBe(true);
    for (const w of ['анекдот', 'панчлайн', 'без заголовків і маркерів', 'без грамів', 'без запитань', 'Нічого не вигадуй']) expect(DIGEST_REQUEST).toContain(w);
  });
  it('Telegram: текст як є, лише обрізані пробіли; жодних емодзі всередині', () => {
    expect(digestForTelegram('  Зустрічаються в морозилці лосось і тунець…  ')).toBe('Зустрічаються в морозилці лосось і тунець…');
  });
});
