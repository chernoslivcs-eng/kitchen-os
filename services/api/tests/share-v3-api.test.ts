// Шерінг v3, частина API/бота (spec docs/superpowers/specs/2026-09-22-share-v3-design.md):
// ?recipe_id= на /v1/cook-runs; telegram_linked у /v1/me; POST /v1/share/telegram (409 без
// привʼязки, sendPhoto зі стабом, ліміт/тип); кнопки бота — «Поділитись у сторіз» після
// «Зафіксував у журналі», «Поділитись у сторіз» + «Лінк на рецепт» під рецептом.
import { describe, it, expect, beforeEach } from 'vitest';
import FormData from 'form-data';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, signInWithTelegram, type Card } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { handleTelegramText, handleTelegramFile, handleTelegramCallback, handleQuickCallback, createTelegramLinkToken, resetSeenUpdates, resetBotUsernameCache, COPY } from '../src/telegram.js';
import type { ChatTurnInput } from '../src/chat-turn.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const APP = 'https://app.test'; const BOT = 'KitchenOSBot';

async function seedRecipeAndRun(repo: InMemoryRepo, me: { user_id: string; household_id: string }, hoursAgo = 0.2, photo_url: string | null = null) {
  const recipe_id = randomUUID();
  await repo.saveRecipe({ id: recipe_id, owner_id: me.user_id, origin: 'generated', title: 'Різото з білими', descr: null, character: null, risk: null, base_servings: 2, time_total: 25, nutrition: null, payload: { t: 'Різото з білими', ing: [], st: [] }, created_at: new Date().toISOString(), saved_at: null });
  const id = randomUUID(); const at = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  await repo.saveCookRun({ id, household_id: me.household_id, user_id: me.user_id, recipe_id, servings: 2, started_at: at, finished_at: at, rating: null, verdict: null, photo_url, changes: null, undone_at: null });
  return { recipe_id, run_id: id };
}

describe('API', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
  const sent: { chat_id: number; bytes: number; caption: string }[] = [];
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); sent.length = 0;
    app = buildApp(repo, new InMemoryStore(), mailer, { share: { sendPhoto: async (chat_id, png, caption) => { sent.push({ chat_id, bytes: png.byteLength, caption }); } } });
    await app.ready();
  });
  const shareForm = (recipe_id: string, frame = 'poster', buf: Buffer = PNG, type = 'image/png') => {
    const form = new FormData();
    form.append('png', buf, { filename: 'frame.png', contentType: type });
    form.append('recipe_id', recipe_id); form.append('frame', frame);
    return form;
  };

  it('GET /v1/cook-runs?recipe_id= — лише записи цього рецепта; без фільтра — усі', async () => {
    const me = await signIn(app, mailer, 's1@example.com');
    const a = await seedRecipeAndRun(repo, me); const b = await seedRecipeAndRun(repo, me);
    const all = (await app.inject({ method: 'GET', url: '/v1/cook-runs', headers: { cookie: me.cookie } })).json().runs;
    expect(all.map((r: { id: string }) => r.id).sort()).toEqual([a.run_id, b.run_id].sort());
    const only = (await app.inject({ method: 'GET', url: `/v1/cook-runs?recipe_id=${a.recipe_id}`, headers: { cookie: me.cookie } })).json().runs;
    expect(only).toHaveLength(1); expect(only[0].id).toBe(a.run_id);
  });

  it('GET /v1/me: telegram_linked false без привʼязки, true — з нею (акаунт із поштою теж)', async () => {
    const me = await signIn(app, mailer, 's2@example.com');
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: me.cookie } })).json().telegram_linked).toBe(false);
    process.env.TELEGRAM_BOT_USERNAME = BOT; resetSeenUpdates(); resetBotUsernameCache();
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText({ repo, store: new InMemoryStore(), appUrl: APP }, { update_id: 1, telegram_user_id: 500, chat_id: 500, text: `/start ${token}` });
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: me.cookie } })).json().telegram_linked).toBe(true);
  });

  it('POST /v1/share/telegram: без Telegram — 409; з ним — sendPhoto у chat_id із підписом-назвою, app_event share', async () => {
    const me = await signIn(app, mailer, 's3@example.com');
    const { recipe_id } = await seedRecipeAndRun(repo, me);
    const f1 = shareForm(recipe_id);
    const r409 = await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { ...f1.getHeaders(), cookie: me.cookie }, payload: f1 });
    expect(r409.statusCode).toBe(409); expect(r409.json().error).toBe('telegram_not_linked');
    process.env.TELEGRAM_BOT_USERNAME = BOT; resetSeenUpdates(); resetBotUsernameCache();
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText({ repo, store: new InMemoryStore(), appUrl: APP }, { update_id: 2, telegram_user_id: 501, chat_id: 7501, text: `/start ${token}` });
    const f2 = shareForm(recipe_id, 'vertical');
    const ok = await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { ...f2.getHeaders(), cookie: me.cookie }, payload: f2 });
    expect(ok.statusCode).toBe(200);
    expect(sent).toEqual([{ chat_id: 7501, bytes: PNG.byteLength, caption: 'Різото з білими' }]);
    const ev = await repo.listAppEvents(me.user_id, { from: new Date(0), to: new Date(Date.now() + 60_000), limit: 10 });
    expect(ev.find((e) => e.name === 'share')?.props).toMatchObject({ frame: 'vertical', via: 'telegram', photo: true });
  });

  it('POST /v1/share/telegram: не PNG — 415; чужий рецепт — 404; без стабу sendPhoto — 503', async () => {
    const me = await signIn(app, mailer, 's4@example.com');
    process.env.TELEGRAM_BOT_USERNAME = BOT; resetSeenUpdates(); resetBotUsernameCache();
    const { token } = await createTelegramLinkToken(repo, me.user_id, BOT);
    await handleTelegramText({ repo, store: new InMemoryStore(), appUrl: APP }, { update_id: 3, telegram_user_id: 502, chat_id: 502, text: `/start ${token}` });
    const { recipe_id } = await seedRecipeAndRun(repo, me);
    const jpg = shareForm(recipe_id, 'poster', PNG, 'image/jpeg');
    expect((await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { ...jpg.getHeaders(), cookie: me.cookie }, payload: jpg })).statusCode).toBe(415);
    const other = await signIn(app, mailer, 's5@example.com');
    const { recipe_id: foreign } = await seedRecipeAndRun(repo, other);
    const f = shareForm(foreign);
    expect((await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { ...f.getHeaders(), cookie: me.cookie }, payload: f })).statusCode).toBe(404);
    const bareMailer = new ConsoleMailer();
    const bare = buildApp(new InMemoryRepo(), new InMemoryStore(), bareMailer); await bare.ready();
    const me2 = await signIn(bare, bareMailer, 's6@example.com');
    const f3 = shareForm(recipe_id);
    expect((await bare.inject({ method: 'POST', url: '/v1/share/telegram', headers: { ...f3.getHeaders(), cookie: me2.cookie }, payload: f3 })).statusCode).toBe(503);
    expect(sent).toHaveLength(0);
  });
});

describe('бот', () => {
  let repo: InMemoryRepo; let seq = 100;
  let me: { user_id: string; household_id: string };
  const deps = (turn?: (i: ChatTurnInput) => Promise<{ reply: string | null; card: Card | null; card_id: string | null }>) =>
    ({ repo, store: new InMemoryStore(), appUrl: APP, webTokenSecret: 's', ...(turn ? { turn } : {}), downloadFile: async () => ({ buffer: PNG, content_type: 'image/png' }) });
  beforeEach(async () => {
    repo = new InMemoryRepo(); resetSeenUpdates(); resetBotUsernameCache(); process.env.TELEGRAM_BOT_USERNAME = BOT;
    const r = await signInWithTelegram(repo, { telegram_user_id: 600, chat_id: 600, first_name: 'Яна' });
    me = { user_id: r.user_id, household_id: r.household_id };
  });
  const upd = (text: string) => ({ update_id: ++seq, telegram_user_id: 600, chat_id: 600, text });

  it('фото страви → кнопки «Прикріпити до журналу / Не треба»; «Прикріпити» → «Зафіксував у журналі» + url «Поділитись у сторіз» на /share/<recipe>?run=<run>', async () => {
    const { recipe_id, run_id } = await seedRecipeAndRun(repo, me);
    const turn = async (input: ChatTurnInput) => {
      const card: Card = { type: 'cook_photo', run_id, recipe_title: 'Різото з білими', attachment_id: input.attachments![0]!.id };
      const card_id = randomUUID();
      await createPending(repo, { message_id: card_id, household_id: me.household_id, user_id: me.user_id, card });
      return { reply: 'Гарний вигляд. Це «Різото з білими» — прикріпити фото до запису в журналі?', card, card_id };
    };
    const r = await handleTelegramFile(deps(turn), { update_id: ++seq, telegram_user_id: 600, chat_id: 600, source: 'photo', file_id: 'f1', mime_type: 'image/png' });
    expect(r?.keyboard?.[0]?.map((b) => b.text)).toEqual([COPY.toJournal, COPY.notNeeded]);
    const cardId = r!.keyboard![0]![0]!.data!.slice('apply:'.length);
    const cb = await handleTelegramCallback(deps(), { update_id: ++seq, telegram_user_id: 600, data: `apply:${cardId}` });
    expect(cb?.status).toBe(COPY.journalFixed);
    expect(cb?.keyboard?.[0]?.[0]?.text).toBe(COPY.shareStory);
    expect(cb?.keyboard?.[0]?.[0]?.url).toMatch(new RegExp(`^${APP}/v1/auth/telegram\\?token=[A-Za-z0-9_-]+&next=${encodeURIComponent(`/share/${recipe_id}?run=${run_id}`)}$`));
  });

  it('під карткою рецепта — «Поділитись у сторіз» (url /share/<id>) і «Лінк на рецепт» (callback → текст host/r/<id>)', async () => {
    const { recipe_id } = await seedRecipeAndRun(repo, me);
    const turn = async () => ({ reply: 'Тримай рецепт.', card: { type: 'recipe_link', recipe_id, title: 'Різото з білими', recipe: { t: 'Різото з білими', sv: 2, tm: 25, ch: '', d: '', rk: '', ing: [{ n: 'рис', v: 200, u: 'g' }], st: [{ t: 'Вари', c: '18 хв' }] } } as Card, card_id: null });
    const r = await handleTelegramText(deps(turn), upd('давай різото'));
    const btns = r?.keyboard?.[0] ?? [];
    expect(btns.map((b) => b.text)).toEqual([COPY.shareStory, COPY.recipeLink]);
    expect(btns[0]!.url).toContain(`next=${encodeURIComponent(`/share/${recipe_id}`)}`);
    expect(btns[1]!.data).toBe(`share-link:${recipe_id}`);
    const q = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 600, data: `share-link:${recipe_id}` });
    expect(q).toEqual({ kind: 'reply', reply: { messages: [`${APP}/r/${recipe_id}`], html: false } });
    // /recipes → рядок «Рецепти» → повний рецепт із тими самими кнопками
    const list = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 600, data: `recipe:${recipe_id}` });
    expect(list?.kind === 'reply' && list.reply.keyboard?.[0]?.map((b) => b.text)).toEqual([COPY.shareStory, COPY.recipeLink]);
  });
});
