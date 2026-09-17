// Ранковий дайджест (DIGEST-PLAN-0917, PR 1): крон-вибірка за поясами, «порожньо → не
// шлемо», «писала до 07:00 → не шлемо», хід через action 'digest' без репліки
// людини в історії, доставка в Telegram з емодзі-маркерами, /digest on|off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo, signInWithTelegram, signInWithVerifiedEmail, DIGEST_REQUEST, type PantryBatch, type ShoppingItemRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { runDigestFor, runDigestCron, localMidnightIso, type DigestDeps } from '../src/digest.js';
import { handleTelegramText, resetSeenUpdates, COPY } from '../src/telegram.js';

const NOW = new Date('2026-09-17T04:30:00.000Z'); // 07:30 Київ
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: () => log } as never;

async function seed(withData = true) {
  const repo = new InMemoryRepo();
  const tg = await signInWithTelegram(repo, { telegram_user_id: 777, chat_id: 777, first_name: 'Яна' });
  if (withData) {
    await repo.insertBatch({ id: randomUUID(), household_id: tg.household_id, catalog_key: null, label: 'молоко', zone: 'fridge', value: 200, unit: 'ml', state: 'opened', opened_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(), best_before_opened_days: null, added_at: NOW.toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id: null } as PantryBatch);
    await repo.insertShoppingItem({ id: randomUUID(), household_id: tg.household_id, label: 'хліб', reason: null, value: null, unit: null, zone: null, checked: false, added_by: null, source: 'user', created_at: NOW.toISOString() } as ShoppingItemRow);
  }
  return { repo, tg };
}
const deps = (repo: InMemoryRepo, over: Partial<DigestDeps> = {}): DigestDeps & { sent: { chat_id: number; text: string }[]; turns: unknown[] } => {
  const sent: { chat_id: number; text: string }[] = []; const turns: unknown[] = [];
  return {
    repo, store: new InMemoryStore(), chatOpts: {}, log, now: () => NOW,
    send: async (chat_id, text) => { sent.push({ chat_id, text }); },
    turn: async (input) => { turns.push(input); return { reply: 'Доброго ранку.\n\nГорить\n· молоко — 200 мл, до завтра\n\nУ списку\n· хліб\n\nЖарт про молоко.', card: null, card_id: null }; },
    sent, turns, ...over,
  };
};

describe('runDigestFor', () => {
  it('07 місцевого, є що казати → хід action:digest без тексту людини, Telegram з маркерами, sent_on = сьогодні, app_event', async () => {
    const { repo, tg } = await seed();
    const d = deps(repo);
    const [c] = await repo.listDigestCandidates();
    const r = await runDigestFor(d, c!);
    expect(r).toMatchObject({ status: 'sent' });
    expect(d.turns[0]).toMatchObject({ action: 'digest', channel: 'telegram', user: { user_id: tg.user_id } });
    expect((d.turns[0] as { text?: string }).text).toBeUndefined();
    expect(d.sent[0]!.chat_id).toBe(777);
    expect(d.sent[0]!.text).toContain('🔥 Горить');
    expect(d.sent[0]!.text).toContain('🛒 У списку');
    expect((await repo.listDigestCandidates())[0]!.digest_sent_on).toBe('2026-09-17');
    // Повторно того ж дня — не шлемо.
    expect(await runDigestFor(d, (await repo.listDigestCandidates())[0]!)).toMatchObject({ status: 'skipped', reason: 'already_sent' });
    expect(d.sent).toHaveLength(1);
  });
  it('порожньо (нічого не горить, список порожній, подій нема) → хід НЕ робиться, день закритий', async () => {
    const { repo } = await seed(false);
    const d = deps(repo);
    const r = await runDigestFor(d, (await repo.listDigestCandidates())[0]!);
    expect(r).toMatchObject({ status: 'skipped', reason: 'empty' });
    expect(d.turns).toHaveLength(0); expect(d.sent).toHaveLength(0);
    expect((await repo.listDigestCandidates())[0]!.digest_sent_on).toBe('2026-09-17');
  });
  it('писала в чат до 07:00 → не шлемо', async () => {
    const { repo, tg } = await seed();
    const s = await repo.getOrCreateSessionForDay(tg.user_id, '2026-09-17');
    await repo.saveMessage({ id: randomUUID(), session_id: s.id, role: 'user', text: 'привіт', card: null, applied: 0, created_at: '2026-09-17T03:10:00.000Z' });
    const r = await runDigestFor(deps(repo), (await repo.listDigestCandidates())[0]!);
    expect(r).toMatchObject({ status: 'skipped', reason: 'already_active' });
  });
  it('не та година → not_hour; опт-аут → opted_out', async () => {
    const { repo, tg } = await seed();
    expect(await runDigestFor(deps(repo, { now: () => new Date('2026-09-17T06:30:00.000Z') }), (await repo.listDigestCandidates())[0]!)).toMatchObject({ status: 'skipped', reason: 'not_hour' });
    await repo.setDigestEnabled(tg.user_id, false);
    expect(await runDigestFor(deps(repo), (await repo.listDigestCandidates())[0]!)).toMatchObject({ status: 'skipped', reason: 'opted_out' });
  });
  it('хід реально йде з DIGEST_REQUEST у user-turn і не пише репліку людини в історію', async () => {
    const { repo, tg } = await seed();
    const d = deps(repo, { turn: undefined });
    // Без ключа моделі runChatTurn іде стабом — нам важливо лише, що в історії нема user-репліки.
    const r = await runDigestFor(d, (await repo.listDigestCandidates())[0]!);
    const msgs = await repo.listMessages((await repo.getOrCreateSessionForDay(tg.user_id, '2026-09-17')).id);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(0);
    if (r.status === 'sent') expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
    expect(DIGEST_REQUEST.startsWith('[СЕРВЕР]')).toBe(true);
  });
});

describe('runDigestCron: вибірка за поясами', () => {
  it('київ о 07 — шлемо; Лісабон (06 місцевого) — ні; веб-only без Telegram — не кандидат', async () => {
    const { repo } = await seed();
    const lisbon = await signInWithTelegram(repo, { telegram_user_id: 888, chat_id: 888, first_name: 'Л' });
    repo.setUserTz(lisbon.user_id, 'Europe/Lisbon');
    await repo.insertShoppingItem({ id: randomUUID(), household_id: lisbon.household_id, label: 'сир', reason: null, value: null, unit: null, zone: null, checked: false, added_by: null, source: 'user', created_at: NOW.toISOString() } as ShoppingItemRow);
    await signInWithVerifiedEmail(repo, 'web@example.com', 'W');
    const d = deps(repo);
    const s = await runDigestCron(d);
    expect(s).toMatchObject({ candidates: 2, sent: 1, skipped: { not_hour: 1 }, failed: 0 });
    expect(d.sent.map((x) => x.chat_id)).toEqual([777]);
    // Наступний тик (06:30 UTC = 07:30 Лісабон): Лісабон — так, Київ — уже надіслано.
    const s2 = await runDigestCron(deps(repo, { now: () => new Date('2026-09-17T06:30:00.000Z'), send: d.send }));
    expect(s2).toMatchObject({ sent: 1, skipped: { not_hour: 1 } });
    expect(d.sent.map((x) => x.chat_id)).toEqual([777, 888]);
  });
});

describe('localMidnightIso', () => {
  it('Київ (UTC+3 у вересні) і Лісабон (UTC+1)', () => {
    expect(localMidnightIso('2026-09-17', 'Europe/Kyiv')).toBe('2026-09-16T21:00:00.000Z');
    expect(localMidnightIso('2026-09-17', 'Europe/Lisbon')).toBe('2026-09-16T23:00:00.000Z');
    expect(localMidnightIso('2026-09-17', 'America/New_York')).toBe('2026-09-17T04:00:00.000Z');
  });
});

describe('/digest on|off у боті', () => {
  let seq = 0;
  beforeEach(() => resetSeenUpdates());
  const upd = (id: number, text: string) => ({ update_id: ++seq, telegram_user_id: id, chat_id: id, text });
  it('off → вимкнено, on → увімкнено, без аргументу — стан', async () => {
    const { repo, tg } = await seed();
    const d = { repo, store: new InMemoryStore(), appUrl: 'https://app.test' };
    expect(await handleTelegramText(d, upd(777, '/digest off'))).toEqual({ messages: [COPY.digestOff], html: false });
    expect(await repo.getDigestEnabled(tg.user_id)).toBe(false);
    expect(await handleTelegramText(d, upd(777, '/digest'))).toEqual({ messages: [COPY.digestStatus(false)], html: false });
    expect(await handleTelegramText(d, upd(777, '/digest on'))).toEqual({ messages: [COPY.digestOn], html: false });
    expect(await repo.getDigestEnabled(tg.user_id)).toBe(true);
  });
});
