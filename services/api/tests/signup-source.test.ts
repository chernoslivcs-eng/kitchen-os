// Джерело реєстрації (міграція 0052) наскрізь через HTTP: мітки з лендінгу
// мусять дожити до створення акаунта в кожному з трьох способів входу — і в
// кожному вони їдуть по-своєму, бо сторінка по-різному закінчується:
//   пошта    — на challenge (лист відкривають де завгодно);
//   Google   — у куці поруч зі state (редирект на accounts.google.com і назад);
//   Telegram — на challenge токена входу (акаунт створює бот на /start login_<token>).
// Плюс запрошення в чужий дім і те, що сервер клієнту не вірить: чистить сам.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { handleTelegramText, resetSeenUpdates, resetBotUsernameCache } from '../src/telegram.js';
import { signIn } from './helpers.js';

const BOT = 'KitchenOSAppBot';
const NO_MARKS = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, ref: null };

function cookieOf(res: { headers: Record<string, unknown> }, name: string): string | null {
  const sc = res.headers['set-cookie'];
  const arr = (Array.isArray(sc) ? sc : [sc]).map(String);
  const row = arr.find((c) => c.startsWith(`${name}=`));
  return row ? row.split(';')[0]!.slice(name.length + 1) : null;
}

describe('джерело реєстрації · три способи входу', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let seq = 0;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    resetSeenUpdates();
    resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, new InMemoryStore(), mailer, {
      google: { clientId: 'id', clientSecret: 'secret', exchange: async () => ({ email: 'g@example.com', email_verified: true, name: 'Ґуґл' }) },
      telegramAuth: { botToken: '123456789:test-bot-token-not-real', botId: '123456789', botUsername: BOT },
    });
    await app.ready();
  });

  async function verifyLastLink() {
    const url = new URL(mailer.last()!.link);
    // У лінку з листа міток немає: адреса їде в пошту, і мітити її нема чим.
    expect(url.search).not.toContain('utm_');
    const res = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    return res.json() as { user_id: string; household_id: string };
  }

  it('пошта: src із тіла запиту → challenge → рядок при verify', async () => {
    await app.inject({
      method: 'POST', url: '/v1/auth/request',
      payload: { email: 'new@example.com', src: { utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'launch', utm_content: 'post-1', ref: 'olena' } },
    });
    const { user_id, household_id } = await verifyLastLink();
    expect(await repo.getSignupSource(user_id)).toMatchObject({
      user_id, household_id, via: 'email',
      utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'launch', utm_content: 'post-1', ref: 'olena',
    });
  });

  it('сервер чистить сам: регістр, зайві символи, довжина, чужі ключі, пошта в мітці', async () => {
    await app.inject({
      method: 'POST', url: '/v1/auth/request',
      payload: { email: 'dirty@example.com', src: { utm_source: 'Linked In<script>', utm_medium: 'x'.repeat(200), utm_content: 'john@gmail.com', fbclid: 'IwAR1', ref: 42 } },
    });
    const { user_id } = await verifyLastLink();
    const row = await repo.getSignupSource(user_id);
    expect(row).toMatchObject({ ...NO_MARKS, utm_source: 'linked_inscript', utm_medium: 'x'.repeat(64) });
    expect(Object.keys(row!).sort()).toEqual(['created_at', 'household_id', 'ref', 'user_id', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'via']);
  });

  it('пошта без міток: рядок є, мітки порожні', async () => {
    const s = await signIn(app, mailer, 'plain@example.com');
    expect(await repo.getSignupSource(s.user_id)).toMatchObject({ household_id: s.household_id, via: 'email', ...NO_MARKS });
  });

  it('src — сміття (рядок, масив): вхід працює, мітки порожні', async () => {
    for (const [email, src] of [['s1@example.com', 'utm_source=x'], ['s2@example.com', ['x']]] as const) {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email, src } });
      expect(res.statusCode).toBe(202);
      const { user_id } = await verifyLastLink();
      expect(await repo.getSignupSource(user_id)).toMatchObject({ via: 'email', ...NO_MARKS });
    }
  });

  it('Google: мітки з адреси → кука на час входу → рядок у колбеку, кука гаситься', async () => {
    const start = await app.inject({ method: 'GET', url: '/v1/auth/google?utm_source=Ads&utm_medium=cpc&utm_campaign=oct&gclid=abc' });
    expect(start.statusCode).toBe(302);
    // У Google мітки не їдуть: у його адресі лише наш state.
    expect(String(start.headers.location)).not.toContain('utm_');
    const state = cookieOf(start, 'kos_oauth_state')!;
    const src = cookieOf(start, 'kos_oauth_src')!;
    expect(decodeURIComponent(src)).toBe('utm_source=ads&utm_medium=cpc&utm_campaign=oct');
    const setSrc = (start.headers['set-cookie'] as string[]).find((c) => c.startsWith('kos_oauth_src='))!;
    expect(setSrc).toContain('HttpOnly');
    expect(setSrc).toContain('Max-Age=900');

    const cb = await app.inject({
      method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state}`,
      cookies: { kos_oauth_state: state, kos_oauth_src: decodeURIComponent(src) },
    });
    expect(cb.statusCode).toBe(302);
    expect(cookieOf(cb, 'kos_oauth_src')).toBe('');
    const user = (await repo.findUserByEmail('g@example.com'))!;
    expect(await repo.getSignupSource(user.id)).toMatchObject({
      household_id: await repo.firstHouseholdOf(user.id), via: 'google',
      ...NO_MARKS, utm_source: 'ads', utm_medium: 'cpc', utm_campaign: 'oct',
    });
  });

  it('Google без міток: куки немає, рядок із via google і порожніми мітками', async () => {
    const start = await app.inject({ method: 'GET', url: '/v1/auth/google?mode=start' });
    expect(cookieOf(start, 'kos_oauth_src')).toBeNull();
    const state = cookieOf(start, 'kos_oauth_state')!;
    await app.inject({ method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state}`, cookies: { kos_oauth_state: state } });
    const user = (await repo.findUserByEmail('g@example.com'))!;
    expect(await repo.getSignupSource(user.id)).toMatchObject({ via: 'google', ...NO_MARKS });
  });

  it('Google: підмінена кука чиститься так само, як усе від клієнта', async () => {
    const start = await app.inject({ method: 'GET', url: '/v1/auth/google' });
    const state = cookieOf(start, 'kos_oauth_state')!;
    await app.inject({
      method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state}`,
      cookies: { kos_oauth_state: state, kos_oauth_src: 'utm_source=EVIL%3Cb%3E&utm_content=a@b.c&x=1' },
    });
    const user = (await repo.findUserByEmail('g@example.com'))!;
    expect(await repo.getSignupSource(user.id)).toMatchObject({ ...NO_MARKS, utm_source: 'evilb' });
  });

  it('Telegram: src у begin → привʼязка до токена → бот створює акаунт із мітками', async () => {
    const begin = await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin', payload: { mode: 'start', src: { utm_source: 'Instagram', ref: 'reel' } } });
    const { token, url } = begin.json() as { token: string; url: string };
    // У лінку на бота — лише токен: мітки лишаються на сервері.
    expect(url).toBe(`https://t.me/${BOT}?start=login_${token}`);
    await handleTelegramText(
      { repo, store: new InMemoryStore(), appUrl: 'https://kos.example' },
      { update_id: ++seq, telegram_user_id: 700, chat_id: 1700, text: `/start login_${token}`, first_name: 'Олена', username: 'olena' },
    );
    const user = (await repo.getUserByTelegramId(700))!;
    expect(await repo.getSignupSource(user.id)).toMatchObject({
      household_id: await repo.firstHouseholdOf(user.id), via: 'telegram', ...NO_MARKS, utm_source: 'instagram', ref: 'reel',
    });
    expect((await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` })).json()).toEqual({ status: 'ok' });
  });

  it('Telegram: begin без тіла й прямий /start у боті — рядок без міток', async () => {
    const { token } = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).json() as { token: string };
    const deps = { repo, store: new InMemoryStore(), appUrl: 'https://kos.example' };
    await handleTelegramText(deps, { update_id: ++seq, telegram_user_id: 701, chat_id: 1701, text: `/start login_${token}`, first_name: 'А', username: null });
    await handleTelegramText(deps, { update_id: ++seq, telegram_user_id: 702, chat_id: 1702, text: '/start', first_name: 'Б', username: null });
    for (const id of [701, 702]) {
      const user = (await repo.getUserByTelegramId(id))!;
      expect(await repo.getSignupSource(user.id)).toMatchObject({ via: 'telegram', ...NO_MARKS });
    }
  });

  it('наявний акаунт: жоден зі способів входу його джерело не переписує', async () => {
    await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'g@example.com', src: { utm_source: 'linkedin' } } });
    const { user_id } = await verifyLastLink();
    const before = await repo.getSignupSource(user_id);

    await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'g@example.com', src: { utm_source: 'instagram' } } });
    await verifyLastLink();
    const start = await app.inject({ method: 'GET', url: '/v1/auth/google?utm_source=ads' });
    const state = cookieOf(start, 'kos_oauth_state')!;
    await app.inject({ method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state}`, cookies: { kos_oauth_state: state, kos_oauth_src: 'utm_source=ads' } });

    expect(await repo.getSignupSource(user_id)).toEqual(before);
    expect(before).toMatchObject({ via: 'email', utm_source: 'linkedin' });
  });

  it('запрошення: мітки гостя лягають без дому, джерело дому не чіпається', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const invite = async (email: string) => {
      await app.inject({ method: 'POST', url: `/v1/households/${A.household_id}/invite`, headers: { cookie: A.cookie }, payload: { email } });
      return new URL(mailer.last()!.link).searchParams.get('token')!;
    };
    const tok = await invite('b@example.com');
    const res = await app.inject({ method: 'GET', url: `/v1/invites/accept?token=${encodeURIComponent(tok)}&utm_source=Instagram&ref=olena` });
    expect(res.statusCode).toBe(200);
    expect(await repo.getSignupSource(res.json().user_id)).toMatchObject({ household_id: null, via: 'invite', ...NO_MARKS, utm_source: 'instagram', ref: 'olena' });
    // Джерело дому — те, з яким прийшов власник (тут: сам, без міток).
    expect(await repo.getSignupSource(A.user_id)).toMatchObject({ household_id: A.household_id, via: 'email', ...NO_MARKS });
  });
});
