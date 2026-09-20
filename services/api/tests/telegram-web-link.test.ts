// E (20.09): лінк «Відкрити у вебі» — багаторазовий на 24 год, один живий на
// акаунт; перехід ставить cookie або лишає наявну того ж user_id; logout і
// «відвʼязати Telegram» відкликають; email-магік-лінк як був — разовий.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { handleTelegramText, resetSeenUpdates, resetBotUsernameCache } from '../src/telegram.js';
import { signIn } from './helpers.js';

const APP = 'https://kos.example';
const BOT = 'KitchenOSBot';

describe('E · лінк у веб з бота', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>; let mailer: ConsoleMailer;
  let seq = 0;
  const upd = (telegram_user_id: number, text: string) => ({ update_id: ++seq, telegram_user_id, chat_id: telegram_user_id + 1000, text, first_name: 'Олена', username: 'olena' });
  const deps = () => ({ repo, store: new InMemoryStore(), appUrl: APP, webTokenSecret: 'test-secret' });
  const tokenOf = (s: string) => decodeURIComponent(s.match(/token=([^&\s]+)/)![1]!);
  const html = { accept: 'text/html' };
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });
  async function webToken(tg: number): Promise<string> {
    await handleTelegramText(deps(), upd(tg, '/start'));
    const r = await handleTelegramText(deps(), upd(tg, '/web'));
    return tokenOf(r!.messages[0]!);
  }

  it('два /web поспіль — той самий токен, не 130 різних', async () => {
    const a = await webToken(910);
    const r = await handleTelegramText(deps(), upd(910, '/web'));
    expect(tokenOf(r!.messages[0]!)).toBe(a);
  });

  it('другий перехід — ok, redirect на next; cookie є того ж user → без нової сесії', async () => {
    const token = await webToken(911);
    const q = (next: string) => `/v1/auth/telegram?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
    const first = await app.inject({ method: 'GET', url: q('/pantry') });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe('/pantry');
    const cookie = String(first.headers['set-cookie']).split(';')[0]!;
    const second = await app.inject({ method: 'GET', url: q('/list') });
    expect(second.statusCode).toBe(302);
    expect(second.headers.location).toBe('/list');
    expect(second.headers['set-cookie']).toBeTruthy();                 // інший браузер → своя сесія
    const withCookie = await app.inject({ method: 'GET', url: q('/recipe/r1?cook=1'), headers: { cookie } });
    expect(withCookie.statusCode).toBe(302);
    expect(withCookie.headers.location).toBe('/recipe/r1?cook=1');
    expect(withCookie.headers['set-cookie']).toBeUndefined();         // сесія вже є — нову не відкриваємо
  });

  it('після logout — 410 (браузер → /link/expired?kind=telegram); наступний /web дає новий токен', async () => {
    const token = await webToken(912);
    const res = await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(token)}` });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });
    const gone = await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(token)}` });
    expect(gone.statusCode).toBe(410);
    const page = await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(token)}`, headers: html });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe('/link/expired?kind=telegram');
    const r = await handleTelegramText(deps(), upd(912, '/web'));
    expect(tokenOf(r!.messages[0]!)).not.toBe(token);
  });

  it('«відвʼязати Telegram» (DELETE /v1/telegram) відкликає токен', async () => {
    const token = await webToken(913);
    const res = await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(token)}` });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'DELETE', url: '/v1/telegram', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(token)}` })).statusCode).toBe(410);
  });

  it('вигаданий токен → 404; без токена → 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/auth/telegram?token=zzz' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/telegram' })).statusCode).toBe(400);
  });

  it('email-магік-лінк лишається разовим: вдруге — 410 /link/consumed', async () => {
    const me = await signIn(app, mailer, 'once@example.com');
    expect(me.cookie).toBeTruthy();
    const link = new URL(mailer.last()!.link);
    const again = await app.inject({ method: 'GET', url: `${link.pathname}${link.search}`, headers: html });
    expect(again.statusCode).toBe(302);
    expect(again.headers.location).toBe('/link/consumed');
  });
});
