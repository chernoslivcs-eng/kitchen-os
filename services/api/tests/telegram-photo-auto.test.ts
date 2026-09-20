// Рішення власника 20.09 (жива перевірка на проді): фото в Telegram — ЗАВЖДИ
// як текст/голос: intake_diff застосовується одразу, репліка доконана
// «Записав у комору · N», одна кнопка «Скасувати» (undo тим самим токеном).
// Серії «наповнюю комору» (19.09) більше нема; «все у комору» — просто текст.
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
const png = Buffer.from('89504e470d0a1a0a', 'hex');

describe('фото → одразу в комору', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let store: InMemoryStore; let app: ReturnType<typeof buildApp>;
  let seq = 0;
  let me: { user_id: string; household_id: string; cookie: string };
  const seen: ChatTurnInput[] = [];
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); store = new InMemoryStore(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, store, mailer); await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText(deps(), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: `/start ${token}` });
    seen.length = 0;
  });
  /** Мок ходу: фото → intake_diff «молоко»; auto — застосована одразу з undo (як chat-turn); dish — без картки. */
  const turn = (kind: 'intake' | 'dish' | 'empty' | 'ask' = 'intake') => async (input: ChatTurnInput) => {
    seen.push(input);
    if (kind === 'dish') return { reply: 'Гарна паста.', card: null, card_id: null, raw_kind: 'dish' };
    if (kind === 'ask') {
      // Як chat-turn при intent ask: картка pending, репліка — відповідь по суті.
      const card: Card = { type: 'intake_diff', ops: [{ op: 'add', label: 'фует', value: 150, unit: 'g' }] };
      const card_id = randomUUID();
      await createPending(repo, { message_id: card_id, household_id: me.household_id, user_id: me.user_id, card });
      return { reply: 'Так, фует до пасти підійде.', card, card_id, auto_applied: false };
    }
    if (kind === 'empty') return { reply: 'Нічого не розібрав.', card: { type: 'intake_diff', ops: [] } as Card, card_id: null };
    const card: Card = { type: 'intake_diff', ops: [{ op: 'add', label: `молоко ${seq}`, value: 1000, unit: 'ml' }] };
    const card_id = randomUUID();
    await createPending(repo, { message_id: card_id, household_id: me.household_id, user_id: me.user_id, card });
    if (input.attachmentApply === 'auto') { const r = await applyCard(repo, card_id, [], me.user_id); return { reply: 'Розібрав чек — розкладаємо?', card, card_id, auto_applied: true, undo_token: r.undo_token ?? undefined }; }
    return { reply: 'Розібрав чек — розкладаємо?', card, card_id, auto_applied: false };
  };
  const deps = (extra: Record<string, unknown> = {}) => ({ repo, store, appUrl: APP, downloadFile: async () => ({ buffer: png, content_type: 'image/jpeg' }), ...extra });
  const photo = (kind: 'intake' | 'dish' | 'empty' | 'ask' = 'intake', source: 'photo' | 'document' = 'photo', caption?: string) =>
    handleTelegramFile(deps({ turn: turn(kind) }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, source, file_id: `f${seq}`, mime_type: 'image/jpeg', caption });
  const cb = (data: string) => handleTelegramCallback(deps(), { update_id: ++seq, telegram_user_id: 500, data });
  const idOf = (r: Awaited<ReturnType<typeof photo>>, prefix: string) => (r?.keyboard?.[0]?.find((b) => b.data?.startsWith(prefix))?.data ?? '').slice(prefix.length);
  const batches = async () => (await repo.listBatches(me.household_id)).filter((b) => !b.depleted_at).length;

  it('фото → застосовано одразу: «Записав у комору · N», картка, одна кнопка «Скасувати»; репліка розбору не показується', async () => {
    const r = await photo();
    expect(seen[0]!.attachmentApply).toBe('auto');
    expect(r?.messages[0]).toContain(COPY.photoAdded(1));
    expect(r?.messages[0]).toContain('молоко');
    expect(r?.messages[0]).not.toContain('розкладаємо');
    expect(r?.keyboard).toEqual([[{ text: COPY.undo, data: `undo:${idOf(r, 'undo:')}` }]]);
    expect(await batches()).toBe(1);
  });

  it('фото як файл (document, image) — те саме', async () => {
    const r = await photo('intake', 'document');
    expect(seen[0]!.attachmentApply).toBe('auto');
    expect(r?.keyboard?.[0]?.[0]?.text).toBe(COPY.undo);
    expect(await batches()).toBe(1);
  });

  it('«Скасувати» → undo: партії нема, статус «Скасував.»', async () => {
    const r = await photo();
    expect(await batches()).toBe(1);
    const s = await cb(`undo:${idOf(r, 'undo:')}`);
    expect(s?.status).toBe(COPY.undone);
    expect(await batches()).toBe(0);
  });

  it('фото-страва — без картки й без кнопок; порожня картка — підказка про файл', async () => {
    const dish = await photo('dish');
    expect(dish?.keyboard).toBeUndefined();
    expect(dish?.messages.join('\n')).toContain('Гарна паста.');
    const empty = await photo('empty');
    expect(empty?.keyboard).toBeUndefined();
    expect(empty?.messages.at(-1)).toContain(COPY.photoHint);
    expect(await batches()).toBe(0);
  });

  it('«все у комору» — звичайний текст для моделі, нічого особливого', async () => {
    await handleTelegramText(deps({ turn: turn('dish') }), { update_id: ++seq, telegram_user_id: 500, chat_id: 500, text: 'все у комору' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.text).toBe('все у комору');
  });

  it('підпис-питання («підійде до пасти?») → картка pending з «У комору / Не треба», репліка — відповідь по суті', async () => {
    const r = await photo('ask', 'photo', 'це підійде до пасти з фуетом?');
    expect(seen[0]!.attachmentApply).toBe('auto');                    // рішення про pending — у chat-turn, не тут
    expect(r?.messages[0]).toContain('Так, фует до пасти підійде.');
    expect(r?.messages[0]).not.toContain('Записав у комору');
    expect(r?.keyboard?.[0]?.map((b) => b.text)).toEqual([COPY.toPantry, COPY.notNeeded]);
    expect(await batches()).toBe(0);
  });
});
