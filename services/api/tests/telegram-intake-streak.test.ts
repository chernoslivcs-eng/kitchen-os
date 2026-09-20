// Серія «наповнюю комору» в Telegram (19.09): два apply → третє фото auto з
// «Скасувати»; «все у комору» → pending за 30 хв застосовані і серія; dismiss /
// «Скасувати» / фото-страва рвуть серію; після until — знову pending.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard, type Card } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { handleTelegramText, handleTelegramFile, handleTelegramCallback, createTelegramLinkToken, resetSeenUpdates, resetBotUsernameCache, COPY } from '../src/telegram.js';
import type { ChatTurnInput } from '../src/chat-turn.js';

const BOT = 'KitchenOSAppBot'; const APP = 'https://app.test';
const T0 = new Date('2026-09-19T10:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const png = Buffer.from('89504e470d0a1a0a', 'hex');

describe('серія «наповнюю комору»', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let store: InMemoryStore; let app: ReturnType<typeof buildApp>;
  let seq = 0; let clock = T0;
  let me: { user_id: string; household_id: string; cookie: string };
  const seen: ChatTurnInput[] = [];
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); store = new InMemoryStore(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, store, mailer); await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText(deps(), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: `/start ${token}` });
    seen.length = 0; clock = T0;
  });
  /** Мок ходу: кожне фото → intake_diff «молоко» як pending-картка; auto — застосована одразу з undo (як chat-turn). */
  const turn = (kind: 'intake' | 'dish' = 'intake') => async (input: ChatTurnInput) => {
    seen.push(input);
    if (kind === 'dish') return { reply: 'Гарна паста.', card: null, card_id: null, raw_kind: 'dish' };
    const card: Card = { type: 'intake_diff', ops: [{ op: 'add', label: `молоко ${seq}`, value: 1000, unit: 'ml' }] };
    const card_id = randomUUID();
    await createPending(repo, { message_id: card_id, household_id: me.household_id, user_id: me.user_id, card });
    // Пов'язане повідомлення з датою — listOpenPending читає created_at звідти.
    const s = await repo.getOrCreateSessionForDay(me.user_id, '2026-09-19');
    await repo.saveMessage({ id: card_id, session_id: s.id, role: 'assistant', text: 'Розібрав.', card, applied: 0, created_at: clock.toISOString() });
    if (input.attachmentApply === 'auto') { const r = await applyCard(repo, card_id, [], me.user_id); return { reply: 'Записав.', card, card_id, auto_applied: true, undo_token: r.undo_token ?? undefined }; }
    return { reply: 'Розібрав чек — розкладаємо?', card, card_id, auto_applied: false };
  };
  const deps = (extra: Record<string, unknown> = {}) => ({ repo, store, appUrl: APP, now: () => clock, downloadFile: async () => ({ buffer: png, content_type: 'image/jpeg' }), ...extra });
  const photo = (kind: 'intake' | 'dish' = 'intake') => handleTelegramFile(deps({ turn: turn(kind) }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, source: 'photo', file_id: `f${seq}` });
  const cb = (data: string) => handleTelegramCallback(deps(), { update_id: ++seq, telegram_user_id: 500, data });
  const idOf = (r: Awaited<ReturnType<typeof photo>>, prefix: string) => (r?.keyboard?.[0]?.find((b) => b.data?.startsWith(prefix))?.data ?? '').slice(prefix.length);
  const batches = async () => (await repo.listBatches(me.household_id)).filter((b) => !b.depleted_at).length;

  it('два apply поспіль (≤ 15 хв) → третє фото auto: «Записав у комору · N», одна кнопка «Скасувати», партія вже в коморі', async () => {
    const r1 = await photo(); expect(seen[0]!.attachmentApply).toBe('pending');
    await cb(`apply:${idOf(r1, 'apply:')}`);
    clock = at(5);
    const r2 = await photo(); expect(seen[1]!.attachmentApply).toBe('pending');
    await cb(`apply:${idOf(r2, 'apply:')}`);
    clock = at(8);
    const r3 = await photo();
    expect(seen[2]!.attachmentApply).toBe('auto');
    expect(r3?.messages[0]).toContain(COPY.streakAdded(1));
    expect(r3?.messages[0]).not.toContain('розкладаємо');           // нотатка розбору не показується
    expect(r3?.keyboard).toEqual([[{ text: COPY.streakUndo, data: `undo:${idOf(r3, 'undo:')}` }]]);
    expect(await batches()).toBe(3);
  });

  it('«все у комору» → pending за 30 хв застосовані без моделі, серія увімкнена, наступне фото auto', async () => {
    await photo(); clock = at(3); await photo();                       // два pending
    clock = at(5);
    const r = await handleTelegramText(deps({ turn: turn() }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: 'все у комору' });
    expect(r).toEqual({ messages: [COPY.allToPantry(2)], html: false });
    expect(seen).toHaveLength(2);                                      // модель не кликали
    expect(await batches()).toBe(2);
    await photo();
    expect(seen[2]!.attachmentApply).toBe('auto');
    expect(await batches()).toBe(3);
  });

  it('dismiss рве серію; «Скасувати» під авто-карткою робить undo і рве серію', async () => {
    await handleTelegramText(deps({ turn: turn() }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: 'все у комору' });
    const r = await photo(); expect(seen[0]!.attachmentApply).toBe('auto');
    expect(await batches()).toBe(1);
    const st = await cb(`undo:${idOf(r, 'undo:')}`);
    expect(st).toEqual({ status: COPY.streakUndone });
    expect(await batches()).toBe(0);                                   // undo тим самим токеном
    await photo(); expect(seen[1]!.attachmentApply).toBe('pending');   // серія розірвана
    // dismiss теж рве
    await handleTelegramText(deps({ turn: turn() }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: 'все у комору' });
    const r2 = await photo(); expect(seen[2]!.attachmentApply).toBe('auto'); void r2;
    const r3 = await photo(); await cb(`dismiss:${idOf(r3, 'undo:') || idOf(r3, 'apply:')}`).catch(() => null);
    // (dismiss на авто-картці — 409 у dismissCard, але серія рветься все одно)
    await photo(); expect(seen[seen.length - 1]!.attachmentApply).toBe('pending');
  });

  it('фото-страва рве серію; після until — знову pending', async () => {
    await handleTelegramText(deps({ turn: turn() }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: 'все у комору' });
    await photo('dish');
    await photo(); expect(seen[seen.length - 1]!.attachmentApply).toBe('pending');
    await handleTelegramText(deps({ turn: turn() }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: 'все у комору' });
    clock = at(21);                                                    // > 20 хв без apply
    await photo(); expect(seen[seen.length - 1]!.attachmentApply).toBe('pending');
  });
});
