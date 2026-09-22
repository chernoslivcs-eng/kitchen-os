// Шерінг v3 (spec §2, «Надсилання в Telegram»): POST /v1/share/telegram —
// кадр (PNG) прямо в тілі multipart, без attachment-id; окрема одноразова
// Bot без розмовних хендлерів (не чіпає telegram-bot.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type Recipe } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

const sentPhotos: { chat_id: number; caption?: string }[] = [];
vi.mock('undici', () => ({
  fetch: vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('sendPhoto')) {
      // grammY передає chat_id/caption у формі FormData — читаємо для перевірки.
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }),
  Agent: class {},
}));

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const RECIPE: Recipe = { t: 'Паста з томатами', sv: 2, tm: 20, ch: '', d: '', rk: '', ing: [{ n: 'паста', v: 200, u: 'g' }], st: [] };

function multipartBody(fields: { recipe_id: string; frame: string }): { body: Buffer; contentType: string } {
  const boundary = '----kos-test-boundary';
  const parts: string[] = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="png"; filename="share.png"\r\nContent-Type: image/png\r\n\r\n`);
  const head = Buffer.from(parts[0]!, 'utf8');
  const tail = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="recipe_id"\r\n\r\n${fields.recipe_id}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="frame"\r\n\r\n${fields.frame}\r\n` +
    `--${boundary}--\r\n`, 'utf8',
  );
  return { body: Buffer.concat([head, PNG, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('POST /v1/share/telegram', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>; let mailer: ConsoleMailer;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    sentPhotos.length = 0;
    process.env.TELEGRAM_BOT_TOKEN = '123456:test-token';
  });

  async function saveRecipeFor(user_id: string, household_id: string): Promise<string> {
    const id = crypto.randomUUID();
    await repo.saveRecipe({ id, owner_id: user_id, household_id, origin: 'generated', title: RECIPE.t, descr: '', character: '', risk: '', base_servings: 2, time_total: 20, nutrition: null, payload: RECIPE, created_at: new Date().toISOString(), saved_at: new Date().toISOString(), hidden_at: null } as never);
    return id;
  }

  it('без токена бота (env не задано) — 503', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const me = await signIn(app, mailer, 'me@example.com');
    const { body, contentType } = multipartBody({ recipe_id: 'x', frame: 'poster' });
    const res = await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { cookie: me.cookie, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'telegram_not_configured' });
  });

  it('Telegram не привʼязаний (нема chat_id) — 409 telegram_no_chat', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const id = await saveRecipeFor(me.user_id, me.household_id);
    const { body, contentType } = multipartBody({ recipe_id: id, frame: 'poster' });
    const res = await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { cookie: me.cookie, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'telegram_no_chat' });
  });

  it('чужий/неіснуючий recipe_id — 404, навіть коли Telegram привʼязаний', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await repo.linkTelegram({ telegram_user_id: 500, user_id: me.user_id, chat_id: 777, linked_at: new Date().toISOString(), revoked_at: null });
    const { body, contentType } = multipartBody({ recipe_id: 'nope', frame: 'poster' });
    const res = await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { cookie: me.cookie, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(404);
  });

  it('привʼязаний + свій рецепт — sendPhoto відправлено, caption — назва рецепта', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await repo.linkTelegram({ telegram_user_id: 500, user_id: me.user_id, chat_id: 777, linked_at: new Date().toISOString(), revoked_at: null });
    const id = await saveRecipeFor(me.user_id, me.household_id);
    const { body, contentType } = multipartBody({ recipe_id: id, frame: 'poster' });
    const res = await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { cookie: me.cookie, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
  });

  it('без авторизації — 401/редирект (той самий authenticated middleware, що решта роутів)', async () => {
    const { body, contentType } = multipartBody({ recipe_id: 'x', frame: 'poster' });
    const res = await app.inject({ method: 'POST', url: '/v1/share/telegram', headers: { 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
