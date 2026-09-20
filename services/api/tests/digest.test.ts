// Вечірнє нагадування (spec 2026-09-20): гейт 18:00 і «писала за 3 год», форми за
// пріоритетом, хід моделі з правильною командою, обрізання до одного речення,
// порожня відповідь → без речення, кнопка з правильним next (24-годинний токен),
// app_event digest_sent {form, voice}, /digest on|off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo, signInWithTelegram, signInWithVerifiedEmail, DIGEST_REQUEST_PREFIX, verifyTelegramWebToken, BUILTIN_OCCASIONS, type PantryBatch, type ShoppingItemRow, type Card } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { runDigestFor, runDigestCron, DIGEST_PROPOSAL_TEXT, type DigestDeps } from '../src/digest.js';
import { handleTelegramText, resetSeenUpdates, COPY } from '../src/telegram.js';

const NOW = new Date('2026-09-17T15:30:00.000Z'); // 18:30 Київ
const APP = 'https://app.test';
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: () => log } as never;
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

async function seed() {
  const repo = new InMemoryRepo();
  const tg = await signInWithTelegram(repo, { telegram_user_id: 777, chat_id: 777, first_name: 'Яна' });
  // Сезони підписані типово — 17.09 вони б дали форму 2; тести форм 3/4 їх вимикають.
  for (const r of BUILTIN_OCCASIONS) await repo.setOccasionSubscription(tg.household_id, r.id, false);
  return { repo, tg };
}
const batch = (household_id: string, label: string, expires_at: string | null, catalog_key: string | null = 'k'): PantryBatch => ({ id: randomUUID(), household_id, catalog_key, label, zone: 'fridge', value: 200, unit: 'ml', state: 'sealed', opened_at: null, expires_at, best_before_opened_days: null, added_at: NOW.toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id: null } as PantryBatch);
const item = (household_id: string, label: string): ShoppingItemRow => ({ id: randomUUID(), household_id, label, reason: null, value: null, unit: null, zone: null, checked: false, added_by: null, source: 'user', created_at: NOW.toISOString() } as ShoppingItemRow);

type Sent = { chat_id: number; text: string; keyboard: { text: string; url?: string }[][] };
const deps = (repo: InMemoryRepo, over: Partial<DigestDeps> = {}) => {
  const sent: Sent[] = []; const turns: { text?: string; action?: string }[] = [];
  const d: DigestDeps & { sent: Sent[]; turns: typeof turns } = {
    repo, store: new InMemoryStore(), chatOpts: {}, appUrl: APP, log, now: () => NOW, webTokenSecret: 's',
    send: async (chat_id, text, keyboard) => { sent.push({ chat_id, text, keyboard }); },
    turn: async (input) => {
      turns.push({ text: input.text, action: input.action });
      if (input.text === DIGEST_PROPOSAL_TEXT) return { reply: 'Є ідея.', card: { type: 'proposal', items: [{ title: 'Омлет із сиром', desc: '' }] } as Card, card_id: null };
      return { reply: 'Вершки — бо камамбер у холодильнику вже третій день чекає компанію. І ще одне речення.', card: null, card_id: null };
    },
    generate: async () => 'rec-1',
    sent, turns, ...over,
  };
  return d;
};
const cand = async (repo: InMemoryRepo) => (await repo.listDigestCandidates())[0]!;

describe('runDigestFor · форми і розкладка', () => {
  it('форма 1: список → «Дорогою додому: …», речення голосу другим рядком (обрізане до одного), кнопка [Список] → /list через 24-годинний токен; app_event {form:1, voice:true}', async () => {
    const { repo, tg } = await seed();
    for (const l of ['хліб', 'молоко', 'лимони', 'вершки 33%']) await repo.insertShoppingItem(item(tg.household_id, l));
    await repo.insertBatch(batch(tg.household_id, 'вершки', day(1)));
    const d = deps(repo);
    const r = await runDigestFor(d, await cand(repo));
    expect(r).toMatchObject({ status: 'sent', form: 1, voice: true });
    expect(d.sent[0]!.text).toBe('Дорогою додому: хліб · молоко · лимони · вершки 33%\nВершки — бо камамбер у холодильнику вже третій день чекає компанію.');
    expect(d.sent[0]!.text).not.toContain('Відкрити у вебі');
    const btn = d.sent[0]!.keyboard[0]![0]!;
    expect(btn.text).toBe('Список');
    expect(btn.url).toMatch(new RegExp(`^${APP}/v1/auth/telegram\\?token=[A-Za-z0-9_-]+&next=%2Flist$`));
    const token = decodeURIComponent(btn.url!.match(/token=([^&]+)/)![1]!);
    expect(await verifyTelegramWebToken(repo, token, NOW)).toMatchObject({ ok: true, user_id: tg.user_id });
    // Команда моделі — з темою і фактами; один хід.
    expect(d.turns).toHaveLength(1);
    expect(d.turns[0]!.action).toBe('digest');
    expect(d.turns[0]!.text!.startsWith(DIGEST_REQUEST_PREFIX)).toBe(true);
    expect(d.turns[0]!.text).toContain('Факти: Дорогою додому: хліб · молоко · лимони · вершки 33%.');
    expect((await cand(repo)).digest_sent_on).toBe('2026-09-17');
    const ev = await repo.listAppEvents(tg.user_id, { from: new Date(0), to: new Date(NOW.getTime() + 60_000), limit: 10 });
    expect(ev.find((e) => e.name === 'digest_sent')?.props).toMatchObject({ form: 1, voice: true });
    // Повторно того ж дня — ні.
    expect(await runDigestFor(d, await cand(repo))).toMatchObject({ status: 'skipped', reason: 'already_sent' });
  });

  it('форма 3: горить → «… — до завтра», кнопка [Що зготувати] → /app; порожня відповідь моделі → без речення, voice:false', async () => {
    const { repo, tg } = await seed();
    await repo.insertBatch(batch(tg.household_id, 'вершки', day(1)));
    await repo.insertBatch(batch(tg.household_id, 'лимонний сік', day(2)));
    await repo.insertBatch(batch(tg.household_id, 'без ключа', day(0), null));
    const d = deps(repo, { turn: async () => ({ reply: '', card: null, card_id: null }) });
    const r = await runDigestFor(d, await cand(repo));
    expect(r).toMatchObject({ status: 'sent', form: 3, voice: false });
    expect(d.sent[0]!.text).toBe('вершки й лимонний сік — до завтра');
    expect(d.sent[0]!.keyboard[0]![0]).toMatchObject({ text: 'Що зготувати' });
    expect(d.sent[0]!.keyboard[0]![0]!.url).toContain('next=%2Fapp');
  });

  it('форма 4: комора є, нічого не горить → proposal-хід → назва страви, рецепт, кнопка [Рецепт] → /recipe/<id>?cook=1; картка у відповіді голосу → без речення', async () => {
    const { repo, tg } = await seed();
    await repo.insertBatch(batch(tg.household_id, 'яйця', day(20)));
    const d = deps(repo);
    d.turn = async (input) => {
      d.turns.push({ text: input.text, action: input.action });
      if (input.text === DIGEST_PROPOSAL_TEXT) return { reply: 'Є ідея.', card: { type: 'proposal', items: [{ title: 'Омлет із сиром', desc: '' }] } as Card, card_id: null };
      return { reply: 'ось', card: { type: 'shopping', items: [] } as unknown as Card, card_id: null };
    };
    const r = await runDigestFor(d, await cand(repo));
    expect(r).toMatchObject({ status: 'sent', form: 4, voice: false });
    expect(d.sent[0]!.text).toBe('Омлет із сиром');
    expect(d.sent[0]!.keyboard[0]![0]).toMatchObject({ text: 'Рецепт' });
    expect(d.sent[0]!.keyboard[0]![0]!.url).toContain('next=%2Frecipe%2Frec-1%3Fcook%3D1');
    expect(d.turns.map((t) => t.action ?? 'chat')).toEqual(['chat', 'digest']);
  });

  it('порожньо (нема списку, подій, комора порожня) → не шлемо, хід не робиться, день закритий', async () => {
    const { repo } = await seed();
    const d = deps(repo);
    expect(await runDigestFor(d, await cand(repo))).toMatchObject({ status: 'skipped', reason: 'empty' });
    expect(d.turns).toHaveLength(0);
    expect(d.sent).toHaveLength(0);
    expect((await cand(repo)).digest_sent_on).toBe('2026-09-17');
  });

  it('писала за останні 3 год → already_active (15:31 — ні; 15:29 — шлемо); не та година; опт-аут', async () => {
    const { repo, tg } = await seed();
    await repo.insertShoppingItem(item(tg.household_id, 'хліб'));
    const s = await repo.getOrCreateSessionForDay(tg.user_id, '2026-09-17');
    const say = (at: string) => repo.saveMessage({ id: randomUUID(), session_id: s.id, role: 'user', text: 'привіт', card: null, applied: 0, created_at: at });
    await say('2026-09-17T12:20:00.000Z');                                   // 15:20 Київ — понад 3 год до 18:30
    expect(await runDigestFor(deps(repo), await cand(repo))).toMatchObject({ status: 'sent' });
    const { repo: r2, tg: t2 } = await seed();
    await r2.insertShoppingItem(item(t2.household_id, 'хліб'));
    const s2 = await r2.getOrCreateSessionForDay(t2.user_id, '2026-09-17');
    await r2.saveMessage({ id: randomUUID(), session_id: s2.id, role: 'user', text: 'привіт', card: null, applied: 0, created_at: '2026-09-17T12:31:00.000Z' });   // 15:31
    expect(await runDigestFor(deps(r2), await cand(r2))).toMatchObject({ status: 'skipped', reason: 'already_active' });
    expect(await runDigestFor(deps(r2, { now: () => new Date('2026-09-17T14:30:00Z') }), await cand(r2))).toMatchObject({ status: 'skipped', reason: 'not_hour' });
    await r2.setDigestEnabled(t2.user_id, false);
    expect(await runDigestFor(deps(r2), await cand(r2))).toMatchObject({ status: 'skipped', reason: 'opted_out' });
  });

  it('хід реально йде через runChatTurn (стаб) із командою в user-turn і не пише репліку людини в історію', async () => {
    const { repo, tg } = await seed();
    await repo.insertShoppingItem(item(tg.household_id, 'хліб'));
    const d = deps(repo, { turn: undefined });
    const r = await runDigestFor(d, await cand(repo));
    expect(r.status).toBe('sent');
    const sessions = await repo.listSessionsForUser(tg.user_id);
    const msgs = (await Promise.all(sessions.map((x) => repo.listMessages(x.id)))).flat();
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(0);
    expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
  });
});

describe('runDigestCron: вибірка за поясами', () => {
  it('Київ о 18 — шлемо; Лісабон (17 місцевого) — ні; веб-only без Telegram — не кандидат', async () => {
    const { repo, tg } = await seed();
    await repo.insertShoppingItem(item(tg.household_id, 'хліб'));
    const lisbon = await signInWithTelegram(repo, { telegram_user_id: 888, chat_id: 888, first_name: 'Л' });
    repo.setUserTz(lisbon.user_id, 'Europe/Lisbon');
    await repo.insertShoppingItem(item(lisbon.household_id, 'сир'));
    await signInWithVerifiedEmail(repo, 'web@example.com', 'W');
    const d = deps(repo);
    const s = await runDigestCron(d);
    expect(s).toMatchObject({ candidates: 2, sent: 1, skipped: { not_hour: 1 }, failed: 0 });
    expect(d.sent[0]!.chat_id).toBe(777);
  });
});

describe('/digest on|off у боті', () => {
  let seq = 0;
  beforeEach(() => resetSeenUpdates());
  const upd = (id: number, text: string) => ({ update_id: ++seq, telegram_user_id: id, chat_id: id, text });
  it('off → вимкнено, on → увімкнено, без аргументу — стан', async () => {
    const { repo, tg } = await seed();
    const d = { repo, store: new InMemoryStore(), appUrl: APP };
    expect(await handleTelegramText(d, upd(777, '/digest off'))).toEqual({ messages: [COPY.digestOff], html: false });
    expect(await repo.getDigestEnabled(tg.user_id)).toBe(false);
    expect(await handleTelegramText(d, upd(777, '/digest'))).toEqual({ messages: [COPY.digestStatus(false)], html: false });
    expect(await handleTelegramText(d, upd(777, '/digest on'))).toEqual({ messages: [COPY.digestOn], html: false });
    expect(await repo.getDigestEnabled(tg.user_id)).toBe(true);
  });
});
