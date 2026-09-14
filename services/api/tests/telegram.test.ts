// Р147/Р149 (TELEGRAM-PLAN-0913, PR 1–2): привʼязка (токен разовий, 15 хв), текст →
// ТОЙ САМИЙ хід чату, що /v1/chat (user + assistant у сесію дня з channel), картка →
// текст, помилка → E1, /stop, дубль update_id, контракт профілю. Модель — стаб.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, type Card, type Recipe } from '@kitchen/domain';
import type { ChatTurnInput } from '../src/chat-turn.js';
import { audioFormatOf, STT_INSTRUCTION } from '../src/telegram-stt.js';
import { audioContentTypeOf } from '../src/telegram.js';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import {
  handleTelegramText, handleTelegramFile, handleTelegramVoice, handleTelegramCallback, handleQuickCallback, createTelegramLinkToken, resetSeenUpdates, resetBotUsernameCache,
  renderCardText, renderTurnMessages, renderRecipeBlocks, splitTelegramText, escapeHtml, formatQty, COPY, TELEGRAM_LINK_TTL_MS, TELEGRAM_MSG_MAX,
} from '../src/telegram.js';
import { QUICK_KEYBOARD } from '../src/telegram-nomodel.js';
import { randomUUID } from 'node:crypto';
import { ChatTurnHttpError } from '../src/chat-turn.js';
import { localDay } from '../src/local-day.js';

const APP = 'https://kos.example';
const BOT = 'KitchenOSBot';

describe('Р147/Р149 · Telegram', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let store: InMemoryStore; let app: ReturnType<typeof buildApp>;
  let seq = 0;
  const upd = (telegram_user_id: number, text: string, chat_id = telegram_user_id) => ({ update_id: ++seq, telegram_user_id, chat_id, text });
  const deps = (extra: Record<string, unknown> = {}) => ({ repo, store, appUrl: APP, ...extra });
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); store = new InMemoryStore(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, store, mailer);
    await app.ready();
  });
  const get = (cookie: string) => app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie } });
  async function linked(email = 'me@example.com', tgId = 500) {
    const me = await signIn(app, mailer, email);
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText(deps(), upd(tgId, `/start ${token}`));
    return me;
  }

  it('без username (нема env і токена) — link-token → 503, GET username null', async () => {
    delete process.env.TELEGRAM_BOT_USERNAME; delete process.env.TELEGRAM_BOT_TOKEN;
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await get(me.cookie)).json()).toEqual({ linked: false, username: null, linked_at: null });
    const tok = await app.inject({ method: 'POST', url: '/v1/telegram/link-token', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(tok.statusCode).toBe(503);
  });

  it('/start без токена або з чужим — «Спершу підключи…»; текст від непривʼязаного — те саме', async () => {
    expect(await handleTelegramText(deps(), upd(100, '/start'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    expect(await handleTelegramText(deps(), upd(100, '/start nope'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    expect(await handleTelegramText(deps(), upd(100, 'привіт'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });

  it('контракт профілю: GET → { linked, username, linked_at }; POST link-token → { url, expires_at }; /start <token> → привʼязка; токен разовий', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await get(me.cookie)).json()).toEqual({ linked: false, username: BOT, linked_at: null });
    const tok = await app.inject({ method: 'POST', url: '/v1/telegram/link-token', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: '{}' });
    const body = tok.json() as { url: string; expires_at: string };
    expect(Object.keys(body).sort()).toEqual(['expires_at', 'url']);
    expect(body.url).toMatch(new RegExp(`^https://t\\.me/${BOT}\\?start=[A-Za-z0-9_-]+$`));
    const token = decodeURIComponent(body.url.split('start=')[1]!);
    const reply = await handleTelegramText(deps(), upd(500, `/start ${token}`, 777));
    expect(reply?.messages[0]).toMatch(/^Привіт, .*Це кухня дому/);
    expect(await repo.getTelegramByTelegramUser(500)).toMatchObject({ user_id: me.user_id, chat_id: 777, revoked_at: null });
    expect((await get(me.cookie)).json()).toMatchObject({ linked: true, username: BOT });
    expect(await handleTelegramText(deps(), upd(501, `/start ${token}`))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });

  it('токен живе 15 хвилин', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const t0 = new Date('2026-09-13T10:00:00Z');
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT, t0);
    const late = new Date(t0.getTime() + TELEGRAM_LINK_TTL_MS + 1000);
    expect(await handleTelegramText(deps({ now: () => late }), upd(600, `/start ${token}`))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    const { token: t2 } = await createTelegramLinkToken(repo, me.user_id, BOT, t0);
    const inTime = new Date(t0.getTime() + TELEGRAM_LINK_TTL_MS - 1000);
    expect((await handleTelegramText(deps({ now: () => inTime }), upd(601, `/start ${t2}`)))?.messages[0]).toMatch(/^Привіт/);
  });

  it('текст привʼязаного → той самий хід, що /v1/chat: user і assistant у сесії дня з channel telegram; веб бачить channel; відповідь HTML + «Відкрити у вебі»', async () => {
    const me = await linked();
    const reply = await handleTelegramText(deps(), upd(500, 'купив молоко і хліб'));
    expect(reply?.html).toBe(true);
    expect(reply?.messages.at(-1)).toContain(COPY.openWeb(APP));
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const msgs = await repo.listMessages(session.id);
    const user = msgs.filter((m) => m.role === 'user');
    const bot = msgs.filter((m) => m.role === 'assistant' && m.text !== null);
    expect(user).toHaveLength(1);
    expect(user[0]).toMatchObject({ text: 'купив молоко і хліб', channel: 'telegram' });
    expect(bot.length, 'відповідь стаба моделі записана').toBeGreaterThanOrEqual(1);
    expect(bot.at(-1)?.channel).toBe('telegram');
    expect((await repo.getSession(session.id))?.title).toBeTruthy();
    const web = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    const shown = (web.json() as { messages: { role: string; channel?: string }[] }).messages.filter((m) => m.channel === 'telegram');
    expect(shown.map((m) => m.role)).toEqual(expect.arrayContaining(['user', 'assistant']));
  });

  it('хід через /v1/chat з вебу — без channel (web не возиться)', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie, 'content-type': 'application/json' }, payload: { text: 'привіт' } });
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    for (const m of await repo.listMessages(session.id)) expect(m.channel).toBeUndefined();
  });

  it('картка → текст: proposal, recipe, intake_diff, shopping; невідома — null; екранування й розбиття', () => {
    const proposal: Card = { type: 'proposal', items: [{ title: 'Паста', desc: '20 хв' }, { title: 'Омлет', desc: '10 хв' }] };
    expect(renderCardText(proposal)).toBe('Варіанти:\n1) Паста · 20 хв\n2) Омлет · 10 хв');
    const recipe: Card = { type: 'recipe', recipe: { t: 'Паста з томатами', sv: 2, tm: 20, ch: '', d: '', rk: '', ing: [{ p: 'b1', n: 'паста', v: 200, u: 'g' }, { n: 'сіль' }], st: [] } };
    expect(renderCardText(recipe)).toBe('Паста з томатами · 20 хв · 2 порц.\n— паста · 200 г\n— сіль');
    const intake: Card = { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1, unit: 'ml' }, { op: 'deplete', label: 'хліб' }] };
    expect(renderCardText(intake)).toBe('Розібрав: 2 позиції\n+ молоко · 1 мл\n− хліб');
    const shopping: Card = { type: 'shopping', items: [{ op: 'add', label: 'яйця', v: 10, u: 'pcs' }, { op: 'remove', label: 'сіль' }] };
    expect(renderCardText(shopping)).toBe('Список:\n+ яйця · 10 pcs\n− сіль');
    expect(renderCardText({ type: 'cook_go', title: 'x' })).toBeNull();
    const msgs = renderTurnMessages({ reply: 'a < b & c', card: proposal }, APP);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBe(`a &lt; b &amp; c\n\n${escapeHtml(renderCardText(proposal)!)}\n\n${escapeHtml(COPY.openWeb(APP))}`);
    const long = Array.from({ length: 300 }, (_, i) => `рядок ${i} ${'x'.repeat(20)}`).join('\n');
    const parts = splitTelegramText(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
    expect(parts.join('\n')).toBe(long);
  });

  // Власник 14.09: після вибору варіанта — повний рецепт, як панель «Рецепт» у вебі.
  const FIX: Recipe = {
    t: 'Фарфалле з креветками, жовтими томатами та шпинатом', sv: 2, tm: 20, ch: 'швидко', d: 'Легка паста на вечір.', rk: 'Креветки — не більше двох хвилин на сковороді.',
    nu: { kcal: 480, p: 24, f: 14, c: 60 },
    ing: [
      { p: 'b-salt', n: 'сіль', v: 5, u: 'g' },
      { p: 'b-pasta', n: 'фарфалле Barilla №65', v: 200, u: 'g' },
      { p: 'b-shrimp', n: 'креветки Metro Chef 58/66', v: 250, u: 'g' },
      { p: 'b-tomato', n: 'жовті томати', v: 300, u: 'g' },
      { p: 'b-spinach', n: 'шпинат', v: 100, u: 'g' },
      { n: 'вершки 20%', v: 150, u: 'ml' },
    ],
    st: [
      { t: 'Розморозка морепродуктів', c: 'Викласти {2} у друшляк під холодну воду.', s: 180 },
      { t: 'Паста', c: 'Закипʼятити воду, посолити ({0}), варити {1} до al dente.', s: 600 },
      { t: 'Соус', c: 'Обсмажити {3}, додати {5} і {4}, прогріти.' },
      { t: 'Креветки', c: 'На сильному вогні {2} — по хвилині з кожного боку.', s: 120 },
      { t: 'Зібрати', c: 'Змішати пасту з соусом і креветками, подавати одразу.' },
    ],
  };
  it('рецепт → повний текст як панель: заголовок · мета · примітки · склад із кількостями й «— нема» · кроки з таймерами й текстом · відкрити у вебі', () => {
    const msgs = renderTurnMessages({ reply: 'Ось рецепт.', card: { type: 'recipe', recipe: FIX } }, APP);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBe([
      'Ось рецепт.',
      '',
      '<b>Фарфалле з креветками, жовтими томатами та шпинатом</b>',
      '20 хв · ≈ 480 ккал · 2 порції · є 5 з 6',
      '<i>Легка паста на вечір.</i>',
      '<i>Креветки — не більше двох хвилин на сковороді.</i>',
      '',
      '<b>Склад · 6</b>',
      '• сіль — 5 г',
      '• фарфалле Barilla №65 — 200 г',
      '• креветки Metro Chef 58/66 — 250 г',
      '• жовті томати — 300 г',
      '• шпинат — 100 г',
      '• вершки 20% — 150 мл — нема',
      '',
      '<b>Кроки · 5</b>',
      '1. Розморозка морепродуктів · 3:00',
      '   Викласти креветки Metro Chef 58/66 у друшляк під холодну воду.',
      '2. Паста · 10:00',
      '   Закипʼятити воду, посолити (сіль), варити фарфалле Barilla №65 до al dente.',
      '3. Соус',
      '   Обсмажити жовті томати, додати вершки 20% і шпинат, прогріти.',
      '4. Креветки · 2:00',
      '   На сильному вогні креветки Metro Chef 58/66 — по хвилині з кожного боку.',
      '5. Зібрати',
      '   Змішати пасту з соусом і креветками, подавати одразу.',
      '',
      `Відкрити у вебі: ${APP}/app`,
    ].join('\n'));
    // recipe_link з рецептом (після вибору варіанта) — той самий повний текст
    expect(renderTurnMessages({ reply: null, card: { type: 'recipe_link', recipe_id: 'r1', title: FIX.t, recipe: FIX } }, APP)[0]).toContain('<b>Кроки · 5</b>');
    expect(formatQty(1200, 'g')).toBe('1,2 кг'); expect(formatQty(1500, 'ml')).toBe('1,5 л'); expect(formatQty(3, 'pcs')).toBe('3 шт');
  });
  it('довгий рецепт — два повідомлення: заголовок + склад і кроки; крок не рветься', () => {
    const long: Recipe = { ...FIX, st: Array.from({ length: 40 }, (_, i) => ({ t: `Крок ${i + 1}`, c: 'Довгий текст кроку. '.repeat(8), s: 60 })) };
    const msgs = renderTurnMessages({ reply: null, card: { type: 'recipe', recipe: long } }, APP);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(TELEGRAM_MSG_MAX);
    expect(msgs[0]).toContain('<b>Склад · 6</b>');
    expect(msgs[0]).not.toContain('<b>Кроки');
    expect(msgs[1]).toMatch(/^<b>Кроки · 40<\/b>\n1\. Крок 1/);
    for (const m of msgs.slice(1)) for (const line of m.split('\n')) expect(line.length).toBeLessThanOrEqual(TELEGRAM_MSG_MAX);
    // кожен крок цілий: після номера йде його текст у тому самому повідомленні
    for (const m of msgs.slice(1)) { const nums = m.match(/^\d+\. /gm) ?? []; const texts = m.match(/^ {3}\S/gm) ?? []; expect(texts.length).toBe(nums.length); }
    expect(msgs.at(-1)).toContain(`Відкрити у вебі: ${APP}/app`);
    const { head, steps } = renderRecipeBlocks(long);
    expect(head.length + steps.length).toBeGreaterThan(TELEGRAM_MSG_MAX);
  });

  // ── Р150: фото / документи ──
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const fileDeps = (turn: (input: ChatTurnInput) => Promise<{ reply: string | null; card: Card | null; card_id: string | null; auto_applied?: boolean }>, extra: Record<string, unknown> = {}) =>
    deps({ downloadFile: async () => ({ buffer: png, content_type: 'image/jpeg' }), turn, ...extra });
  const intakeOut = (card_id: string) => ({ reply: 'Розібрав чек.', card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml' }, { op: 'add', label: 'хліб', value: 1, unit: 'pcs' }] } as Card, card_id, auto_applied: false });

  it('фото → той самий store і attachment, хід із вкладенням (pending), список позицій і кнопки «У комору / Не треба»; caption — текст ходу', async () => {
    const me = await linked();
    const seen: ChatTurnInput[] = [];
    const r = await handleTelegramFile(fileDeps(async (input) => { seen.push(input); return intakeOut('11111111-1111-4111-8111-111111111111'); }), { update_id: 1001, telegram_user_id: 500, chat_id: 500, source: 'photo', file_id: 'f1', file_size: 12345, caption: 'чек із Сільпо' });
    expect(seen).toHaveLength(1);
    const input = seen[0]!;
    expect(input.text).toBe('чек із Сільпо');
    expect(input.channel).toBe('telegram');
    expect(input.attachmentApply).toBe('pending');
    expect(input.attachments).toHaveLength(1);
    const att = await repo.getAttachment(input.attachments![0]!.id);
    expect(att).toMatchObject({ user_id: me.user_id, kind: 'image', content_type: 'image/jpeg', bytes: png.length });
    expect((await store.get(att!.url)).buffer.equals(png)).toBe(true);
    expect(r?.html).toBe(true);
    expect(r?.messages[0]).toContain('Розібрав: 2 позиції');
    expect(r?.messages[0]).toContain('+ молоко · 1 л');
    expect(r?.keyboard).toEqual([[{ text: 'У комору', data: 'apply:11111111-1111-4111-8111-111111111111' }, { text: 'Не треба', data: 'dismiss:11111111-1111-4111-8111-111111111111' }]]);
  });

  it('документ PDF і text/plain — той самий шлях; невідомий тип → відмова; завеликий → відмова; непривʼязаний → «Спершу підключи…»', async () => {
    await linked();
    const seen: ChatTurnInput[] = [];
    const d = fileDeps(async (input) => { seen.push(input); return { reply: 'Ок.', card: null, card_id: null }; }, { downloadFile: async () => ({ buffer: Buffer.from('%PDF-1.4'), content_type: 'application/pdf' }) });
    expect((await handleTelegramFile(d, { update_id: 1101, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'f2', mime_type: 'application/pdf', file_size: 100 }))?.html).toBe(true);
    expect((await repo.getAttachment(seen[0]!.attachments![0]!.id))?.kind).toBe('pdf');
    await handleTelegramFile(d, { update_id: 1102, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'f3', mime_type: 'text/plain', file_size: 100 });
    expect((await repo.getAttachment(seen[1]!.attachments![0]!.id))?.kind).toBe('text');
    expect(await handleTelegramFile(d, { update_id: 1103, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'f4', mime_type: 'application/zip', file_size: 100 })).toEqual({ messages: [COPY.fileUnsupported], html: false });
    expect(await handleTelegramFile(d, { update_id: 1104, telegram_user_id: 500, chat_id: 500, source: 'photo', file_id: 'f5', file_size: 21 * 1024 * 1024 })).toEqual({ messages: [COPY.fileTooBig], html: false });
    expect(seen).toHaveLength(2);
    expect(await handleTelegramFile(d, { update_id: 1105, telegram_user_id: 999, chat_id: 999, source: 'photo', file_id: 'f6' })).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });

  it('стиснуте фото без позицій — підказка про файл без стиснення', async () => {
    await linked();
    const r = await handleTelegramFile(fileDeps(async () => ({ reply: 'Схоже на чек, але рядків не видно.', card: null, card_id: null })), { update_id: 1201, telegram_user_id: 500, chat_id: 500, source: 'photo', file_id: 'f7' });
    expect(r?.messages.at(-1)).toBe(COPY.photoHint);
    const r2 = await handleTelegramFile(fileDeps(async () => ({ reply: 'Порожньо.', card: { type: 'intake_diff', ops: [] } as Card, card_id: 'x', auto_applied: false })), { update_id: 1202, telegram_user_id: 500, chat_id: 500, source: 'photo', file_id: 'f8' });
    expect(r2?.messages.at(-1)).toBe(COPY.photoHint);
    expect(r2?.keyboard).toBeUndefined();
  });

  it('фото через справжній хід: вкладення привʼязане до ходу з channel telegram, картка не застосована сама', async () => {
    const me = await linked();
    await handleTelegramFile(deps({ downloadFile: async () => ({ buffer: png, content_type: 'image/jpeg' }) }), { update_id: 1301, telegram_user_id: 500, chat_id: 500, source: 'photo', file_id: 'f9', caption: 'чек' });
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const msgs = await repo.listMessages(session.id);
    const userMsg = msgs.find((m) => m.role === 'user');
    expect(userMsg).toMatchObject({ channel: 'telegram' });
    expect(userMsg?.attachments?.length ?? 0).toBe(1);
    const applied = msgs.filter((m) => m.role === 'assistant' && m.applied > 0);
    expect(applied, 'у Telegram intake_diff чекає кнопки').toHaveLength(0);
  });

  it('кнопка «У комору» → той самий applyCard, «Не треба» → dismissCard; статус для редагування; повтор → без падіння', async () => {
    const me = await linked();
    const mk = async () => {
      const card: Card = { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко', value: 1000, unit: 'ml', zone: 'fridge' }, { op: 'add', label: 'хліб', value: 1, unit: 'pcs', zone: 'dry' }] };
      const id = crypto.randomUUID();
      await createPending(repo, { message_id: id, household_id: me.household_id, user_id: me.user_id, card });
      return id;
    };
    const a = await mk();
    expect(await handleTelegramCallback(deps(), { update_id: 1401, telegram_user_id: 500, data: `apply:${a}` })).toEqual({ status: 'Додав у комору · 2' });
    expect((await repo.listBatches(me.household_id)).filter((b) => b.state !== 'depleted').map((b) => b.label).sort()).toEqual(['молоко', 'хліб']);
    expect(await handleTelegramCallback(deps(), { update_id: 1402, telegram_user_id: 500, data: `apply:${a}` })).toEqual({ status: 'Додав у комору · 0' });
    const b = await mk();
    expect(await handleTelegramCallback(deps(), { update_id: 1403, telegram_user_id: 500, data: `dismiss:${b}` })).toEqual({ status: COPY.notAdded });
    expect((await repo.listBatches(me.household_id)).filter((x) => x.state !== 'depleted')).toHaveLength(2);
    expect(await handleTelegramCallback(deps(), { update_id: 1404, telegram_user_id: 500, data: 'weird' })).toBeNull();
    expect(await handleTelegramCallback(deps(), { update_id: 1405, telegram_user_id: 999, data: `apply:${b}` })).toEqual({ status: COPY.linkFirst(APP) });
  });

  // ── Р151: голос ──
  const ogg = Buffer.from('4f676753', 'hex');
  const voiceDeps = (stt: (b: Buffer, ct: string | null) => Promise<{ text: string; model: string; usage: { input: number; output: number }; prompt_hash: string }>, turn?: (input: ChatTurnInput) => Promise<{ reply: string | null; card: Card | null; card_id: string | null }>) =>
    deps({ downloadFile: async () => ({ buffer: ogg, content_type: 'audio/ogg' }), stt, ...(turn ? { turn } : {}) });
  const heardStt = async () => ({ text: 'купив молоко і хліб', model: 'google/gemini-test', usage: { input: 80, output: 10 }, prompt_hash: 'abc123' });

  it('голосове → транскрипція (стаб) → «Почув: «…»» + той самий хід; usage як telegram_stt', async () => {
    const me = await linked();
    const seen: ChatTurnInput[] = [];
    const r = await handleTelegramVoice(voiceDeps(heardStt, async (input) => { seen.push(input); return { reply: 'Записав молоко і хліб.', card: null, card_id: null }; }), { update_id: 2001, telegram_user_id: 500, chat_id: 500, file_id: 'v1', duration: 4, file_size: 9000, mime_type: 'audio/ogg' });
    expect(r?.html).toBe(true);
    expect(r?.messages[0]).toBe('Почув: «купив молоко і хліб»');
    expect(r?.messages[1]).toContain('Записав молоко і хліб.');
    expect(seen[0]).toMatchObject({ text: 'купив молоко і хліб', channel: 'telegram' });
    const usage = (await repo.listTokenUsage(me.user_id)).filter((u) => u.call === 'telegram_stt');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ profile: 'smart', model: 'google/gemini-test', input_tokens: 80, output_tokens: 10, prompt_hash: 'abc123', mode: 'live' });
  });

  it('голосове через справжній хід (стаб моделі): «Почув» + хід у сесію дня з channel', async () => {
    const me = await linked();
    const r = await handleTelegramVoice(voiceDeps(heardStt), { update_id: 2101, telegram_user_id: 500, chat_id: 500, file_id: 'v2', duration: 4 });
    expect(r?.messages[0]).toBe('Почув: «купив молоко і хліб»');
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    expect((await repo.listMessages(session.id)).find((m) => m.role === 'user')).toMatchObject({ text: 'купив молоко і хліб', channel: 'telegram' });
  });

  it('задовге (> 2 хв або > 5 МБ) → «Задовге — скажи коротше», без транскрипції', async () => {
    await linked();
    let calls = 0;
    const d = voiceDeps(async () => { calls++; return heardStt(); });
    expect(await handleTelegramVoice(d, { update_id: 2201, telegram_user_id: 500, chat_id: 500, file_id: 'v3', duration: 121 })).toEqual({ messages: [COPY.voiceTooLong], html: false });
    expect(await handleTelegramVoice(d, { update_id: 2202, telegram_user_id: 500, chat_id: 500, file_id: 'v4', duration: 10, file_size: 6 * 1024 * 1024 })).toEqual({ messages: [COPY.voiceTooLong], html: false });
    expect(calls).toBe(0);
  });

  it('помилка або порожня транскрипція → «Не розібрав — напиши текстом»; непривʼязаний → «Спершу підключи…»', async () => {
    await linked();
    expect(await handleTelegramVoice(voiceDeps(async () => { throw new Error('openrouter 500'); }), { update_id: 2301, telegram_user_id: 500, chat_id: 500, file_id: 'v5', duration: 3 })).toEqual({ messages: [COPY.voiceUnclear], html: false });
    expect(await handleTelegramVoice(voiceDeps(async () => ({ text: '  ', model: 'm', usage: { input: 1, output: 0 }, prompt_hash: 'h' })), { update_id: 2302, telegram_user_id: 500, chat_id: 500, file_id: 'v6', duration: 3 })).toEqual({ messages: [COPY.voiceUnclear], html: false });
    expect(await handleTelegramVoice(voiceDeps(heardStt), { update_id: 2303, telegram_user_id: 999, chat_id: 999, file_id: 'v7', duration: 3 })).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });

  it('аудіофайл як «Файл» (document audio/x-m4a) → той самий STT-шлях: «Почув» + хід, формат m4a', async () => {
    await linked();
    let fmt: string | null = null;
    const d = deps({
      downloadFile: async () => ({ buffer: ogg, content_type: 'audio/x-m4a' }),
      stt: async (_b: Buffer, ct: string | null) => { fmt = audioFormatOf(ct); return heardStt(); },
      turn: async () => ({ reply: 'Записав.', card: null, card_id: null }),
    });
    const r = await handleTelegramFile(d, { update_id: 2401, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'a1', file_size: 15000, mime_type: 'audio/x-m4a' });
    expect(r?.messages[0]).toBe('Почув: «купив молоко і хліб»');
    expect(r?.messages[1]).toContain('Записав.');
    expect(fmt).toBe('m4a');
    expect(await handleTelegramFile(d, { update_id: 2402, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'a2', file_size: 6 * 1024 * 1024, mime_type: 'audio/mpeg' })).toEqual({ messages: [COPY.voiceTooLong], html: false });
  });

  it('document application/octet-stream + x.m4a (і video/mp4, і порожній mime) → STT як m4a; невідоме → «не читаю» з логом', async () => {
    await linked();
    const fmts: string[] = [];
    const warned: unknown[] = [];
    const d = deps({
      downloadFile: async () => ({ buffer: ogg, content_type: 'application/octet-stream' }),
      stt: async (_b: Buffer, ct: string | null) => { fmts.push(audioFormatOf(ct)); return heardStt(); },
      turn: async () => ({ reply: 'Записав.', card: null, card_id: null }),
      log: { warn: (o: unknown) => warned.push(o), info() {}, error() {}, debug() {} },
    });
    expect((await handleTelegramFile(d, { update_id: 2501, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'a3', file_size: 158_000, mime_type: 'application/octet-stream', file_name: 'voice-sample.m4a' }))?.messages[0]).toBe('Почув: «купив молоко і хліб»');
    expect((await handleTelegramFile(d, { update_id: 2502, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'a4', file_size: 158_000, mime_type: 'video/mp4', file_name: 'voice-sample.M4A' }))?.messages[0]).toBe('Почув: «купив молоко і хліб»');
    expect((await handleTelegramFile(d, { update_id: 2503, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'a5', file_size: 158_000, mime_type: null, file_name: 'note.opus' }))?.messages[0]).toBe('Почув: «купив молоко і хліб»');
    expect(fmts).toEqual(['m4a', 'm4a', 'ogg']);
    expect(await handleTelegramFile(d, { update_id: 2504, telegram_user_id: 500, chat_id: 500, source: 'document', file_id: 'a6', file_size: 100, mime_type: 'application/octet-stream', file_name: 'archive.zip' })).toEqual({ messages: [COPY.fileUnsupported], html: false });
    expect(warned.at(-1)).toMatchObject({ mime_type: 'application/octet-stream', file_name: 'archive.zip', source: 'document' });
    expect(JSON.stringify(warned.at(-1))).not.toContain('a6');
    expect(audioContentTypeOf('audio/mp4', 'x.m4a')).toBe('audio/mp4');
    expect(audioContentTypeOf('video/mp4', null)).toBeNull();
    expect(audioContentTypeOf('application/pdf', 'doc.pdf')).toBeNull();
  });

  it('формат аудіо для OpenRouter — з mime; інструкція без файлу в prompts', () => {
    expect(audioFormatOf('audio/ogg')).toBe('ogg'); expect(audioFormatOf('audio/ogg; codecs=opus')).toBe('ogg');
    expect(audioFormatOf('audio/mpeg')).toBe('mp3'); expect(audioFormatOf('audio/x-wav')).toBe('wav'); expect(audioFormatOf('audio/mp4')).toBe('m4a'); expect(audioFormatOf('audio/x-m4a')).toBe('m4a'); expect(audioFormatOf(null)).toBe('ogg');
    expect(STT_INSTRUCTION).toMatch(/дослівно/);
  });

  it('помилка ходу (502 model_unavailable або виняток) → текст E1, обидві сторони живі', async () => {
    await linked();
    const fail = deps({ turn: async () => { throw new ChatTurnHttpError(502, { error: 'model_unavailable' }); } });
    expect(await handleTelegramText(fail, upd(500, 'що на вечерю'))).toEqual({ messages: [COPY.replyFailed], html: false });
    const boom = deps({ turn: async () => { throw new Error('boom'); } });
    expect(await handleTelegramText(boom, upd(500, 'що на вечерю'))).toEqual({ messages: [COPY.replyFailed], html: false });
  });

  it('дубль update_id — ігнорується, другого ходу нема', async () => {
    const me = await linked();
    const u = upd(500, 'привіт');
    expect((await handleTelegramText(deps(), u))?.html).toBe(true);
    expect(await handleTelegramText(deps(), { ...u })).toBeNull();
    const session = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    expect((await repo.listMessages(session.id)).filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('/stop і DELETE /v1/telegram — відключають; текст після цього — «Спершу підключи…»; новий /start оживляє', async () => {
    const me = await linked();
    expect(await handleTelegramText(deps(), upd(500, '/stop'))).toEqual({ messages: [COPY.stopped], html: false });
    expect(await handleTelegramText(deps(), upd(500, 'привіт'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    expect((await get(me.cookie)).json()).toMatchObject({ linked: false });
    const { token: t2 } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText(deps(), upd(500, `/start ${t2}`));
    expect((await get(me.cookie)).json()).toMatchObject({ linked: true });
    const del = await app.inject({ method: 'DELETE', url: '/v1/telegram', headers: { cookie: me.cookie } });
    expect(del.json()).toEqual({ ok: true });
    expect(await handleTelegramText(deps(), upd(500, 'ще раз'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
  });

  // ── Р152 (PR 5, «Подивитись без моделі»): /pantry /list /recipes /home ──
  async function seedPantry(household_id: string) {
    await repo.insertBatch({ id: randomUUID(), household_id, catalog_key: 'tomato', label: 'помідори', zone: 'fresh', value: 500, unit: 'g', state: 'sealed', opened_at: null, expires_at: new Date(Date.now() - 86_400_000).toISOString(), best_before_opened_days: null, added_at: new Date().toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null });
    await repo.insertBatch({ id: randomUUID(), household_id, catalog_key: 'rice', label: 'рис', zone: 'dry', value: 1000, unit: 'g', state: 'sealed', opened_at: null, expires_at: new Date(Date.now() + 300 * 86_400_000).toISOString(), best_before_opened_days: null, added_at: new Date().toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null });
  }
  async function seedShopping(household_id: string) {
    const id1 = randomUUID(); const id2 = randomUUID();
    await repo.insertShoppingItem({ id: id1, household_id, label: 'яйця', reason: null, value: 10, unit: 'pcs', zone: null, checked: false, added_by: null, source: 'user', created_at: new Date().toISOString() });
    await repo.insertShoppingItem({ id: id2, household_id, label: 'сіль', reason: null, value: null, unit: null, zone: null, checked: false, added_by: null, source: 'user', created_at: new Date().toISOString() });
    return { id1, id2 };
  }
  async function seedRecipe(user_id: string, household_id: string) {
    const id = randomUUID();
    const recipe = { t: 'Паста з томатами', sv: 2, tm: 20, ch: '', d: '', rk: '', ing: [{ n: 'паста', v: 200, u: 'g' }], st: [{ t: 'Варимо', c: 'Закипʼятити воду.' }] };
    await repo.saveRecipe({ id, owner_id: user_id, household_id, origin: 'generated', title: recipe.t, descr: '', character: '', risk: '', base_servings: 2, time_total: 20, nutrition: null, payload: recipe, created_at: new Date().toISOString(), saved_at: new Date().toISOString(), hidden_at: null } as never);
    return id;
  }

  it('/pantry (усі три форми) → «Комора · N», «Горить» зверху, reply-клавіатура QUICK_KEYBOARD; «Спливає»/«Усе» редагують на місці', async () => {
    const me = await linked();
    await seedPantry(me.household_id);
    for (const cmd of ['/pantry', '/комора', 'Комора']) {
      const r = await handleTelegramText(deps(), upd(500, cmd));
      expect(r?.html).toBe(true);
      expect(r?.messages[0]).toContain('<b>Комора · 2</b>');
      expect(r?.messages[0]).toContain('<b>Горить · 1</b>');
      expect(r?.replyKeyboard).toEqual(QUICK_KEYBOARD);
      expect(r?.keyboard).toEqual([[{ text: 'Спливає', data: 'pantry:soon' }, { text: 'Усе', data: 'pantry:all' }], [{ text: 'Відкрити у вебі', data: 'noop' }]]);
    }
    const soon = await handleQuickCallback(deps(), { update_id: 9001, telegram_user_id: 500, data: 'pantry:soon' });
    expect(soon).toMatchObject({ kind: 'edit' });
    expect((soon as { text: string }).text).toContain('<b>Горить · 1</b>');
    expect((soon as { text: string }).text).not.toContain('рис');
    const all = await handleQuickCallback(deps(), { update_id: 9002, telegram_user_id: 500, data: 'pantry:all' });
    expect((all as { text: string }).text).toContain('рис');
    expect(await handleQuickCallback(deps(), { update_id: 9003, telegram_user_id: 500, data: 'noop' })).toEqual({ kind: 'noop' });
  });

  it('/list → рядки з тоглами; callback list-toggle → repo.toggleShoppingItem і повідомлення редагується', async () => {
    const me = await linked();
    const { id1 } = await seedShopping(me.household_id);
    const r = await handleTelegramText(deps(), upd(500, '/список'));
    expect(r?.messages[0]).toContain('<b>Список · 2</b>');
    expect(r?.messages[0]).toContain('☐ яйця · 10 шт');
    expect(r?.keyboard?.[0]).toEqual([{ text: '☐ яйця', data: `list-toggle:${id1}` }]);
    const q = await handleQuickCallback(deps(), { update_id: 9101, telegram_user_id: 500, data: `list-toggle:${id1}` });
    expect(q).toMatchObject({ kind: 'edit' });
    expect((q as { text: string }).text).toContain('☑ яйця');
    const items = await repo.listShoppingItems(me.household_id);
    expect(items.find((i) => i.id === id1)?.checked).toBe(true);
    // повторний тогл повертає назад
    const q2 = await handleQuickCallback(deps(), { update_id: 9102, telegram_user_id: 500, data: `list-toggle:${id1}` });
    expect((q2 as { text: string }).text).toContain('☐ яйця');
  });

  it('/list порожній — «Список порожній.» + «Відкрити у вебі», без клавіатури', async () => {
    await linked();
    const r = await handleTelegramText(deps(), upd(500, '/list'));
    expect(r?.messages[0]).toBe('Список порожній.');
    expect(r?.keyboard).toBeUndefined();
  });

  it('/recipes → останні збережені з кнопками; callback recipe:<id> → повний рецепт тим самим renderRecipeBlocks', async () => {
    const me = await linked();
    const id = await seedRecipe(me.user_id, me.household_id);
    const r = await handleTelegramText(deps(), upd(500, '/рецепти'));
    expect(r?.messages[0]).toContain('<b>Рецепти · 1</b>');
    expect(r?.messages[0]).toContain('Паста з томатами · 20 хв · 2 порц.');
    expect(r?.keyboard).toEqual([[{ text: 'Паста з томатами', data: `recipe:${id}` }]]);
    const q = await handleQuickCallback(deps(), { update_id: 9201, telegram_user_id: 500, data: `recipe:${id}` });
    expect(q).toMatchObject({ kind: 'reply' });
    const reply = (q as { reply: { messages: string[]; html: boolean } }).reply;
    expect(reply.html).toBe(true);
    expect(reply.messages[0]).toContain('<b>Паста з томатами</b>');
    expect(reply.messages[0]).toContain('<b>Кроки · 1</b>');
    // видалений рецепт — увічливо, не падає
    await repo.deleteRecipe(id);
    const gone = await handleQuickCallback(deps(), { update_id: 9202, telegram_user_id: 500, data: `recipe:${id}` });
    expect((gone as { reply: { messages: string[] } }).reply.messages[0]).toMatch(/не знайдено/);
  });

  it('/recipes порожньо — «Збережених рецептів ще нема.»', async () => {
    await linked();
    const r = await handleTelegramText(deps(), upd(500, '/recipes'));
    expect(r?.messages[0]).toBe('Збережених рецептів ще нема.');
  });

  it('/home (/дім, «Дім зараз») → рядки прострочено/горить/список; спокійний дім — окремий рядок', async () => {
    const me = await linked();
    const r0 = await handleTelegramText(deps(), upd(500, '/дім'));
    expect(r0?.messages[0]).toContain('Дім спокійний. Нічого не горить.');
    await seedPantry(me.household_id);
    await seedShopping(me.household_id);
    const r = await handleTelegramText(deps(), upd(500, 'Дім зараз'));
    expect(r?.messages[0]).toContain('<b>Дім зараз</b>');
    expect(r?.messages[0]).toContain('Горить: помідори');
    expect(r?.messages[0]).toContain('Список · 2');
    expect(r?.replyKeyboard).toEqual(QUICK_KEYBOARD);
  });

  it('непривʼязаний або чужий — «Спершу підключи…»; звичайний хід і /stop не плутаються з командами', async () => {
    const me = await linked();
    expect(await handleTelegramText(deps(), upd(999, '/pantry'))).toEqual({ messages: [COPY.linkFirst(APP)], html: false });
    expect(await handleQuickCallback(deps(), { update_id: 9301, telegram_user_id: 999, data: 'pantry:all' })).toEqual({ kind: 'reply', reply: { messages: [COPY.linkFirst(APP)], html: false } });
    // «Комора» саме по собі — команда; довший текст із тим самим словом — звичайний хід.
    const turn = deps({ turn: async () => ({ reply: 'Ок.', card: null, card_id: null }) });
    const reply = await handleTelegramText(turn, upd(500, 'у коморі закінчилось молоко'));
    expect(reply?.messages[0]).not.toContain('<b>Комора');
    void me;
  });

  it('привʼязка дає reply-клавіатуру одразу', async () => {
    const meRepo = repo;
    const { token } = await createTelegramLinkToken(meRepo, (await signIn(app, mailer, 'kb@example.com')).user_id, BOT);
    const r = await handleTelegramText(deps(), upd(777, `/start ${token}`));
    expect(r?.replyKeyboard).toEqual(QUICK_KEYBOARD);
  });
});
