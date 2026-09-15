// Хотфікс 15.09 (TELEGRAM-AUTH-PAY-PLAN-0915, PR 2-веб) — Login Widget
// ЗАМІНЕНИЙ входом через бота: на десктопі «Запит на вхід» від Telegram не
// приходив, на мобайлі власний popup мовчки блокувався iOS Safari.
//
//   POST /v1/auth/telegram/begin → challenge kind 'tg_login' без user_id,
//     { token, url: t.me/<bot>?start=login_<token> }
//   GET  /v1/auth/telegram/poll?token=… → { status: 'pending'|'ok'|'expired' };
//     'ok' ставить ту саму cookie-сесію, що й усюди
//
// Сам /start login_<token> — telegram-login-begin.test.ts (handleTelegramText,
// не HTTP-роут): тут лише контракт begin/poll і providers.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';

function appWith() {
  const app = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer(), {
    telegramAuth: { botToken: '123456789:test-bot-token-not-real', botId: '123456789', botUsername: 'KitchenOSAppBot' },
  });
  return { app };
}

describe('вхід через бота · begin/poll', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    ({ app } = appWith());
    await app.ready();
  });

  it('без конфігурації (немає TELEGRAM_BOT_USERNAME/TOKEN) роутів нема — 404', async () => {
    const bare = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer());
    await bare.ready();
    expect((await bare.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).statusCode).toBe(404);
    expect((await bare.inject({ method: 'GET', url: '/v1/auth/telegram/poll?token=x' })).statusCode).toBe(404);
  });

  it('/v1/auth/providers каже telegram: true лише коли є конфігурація', async () => {
    const on = await app.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(on.json()).toMatchObject({ telegram: true });
    const bare = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer());
    await bare.ready();
    const off = await bare.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(off.json()).toMatchObject({ telegram: false });
  });

  it('POST begin → token + url на t.me/<bot>?start=login_<token>', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' });
    expect(res.statusCode).toBe(200);
    const { token, url } = res.json() as { token: string; url: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url).toBe(`https://t.me/KitchenOSAppBot?start=login_${token}`);
  });

  it('poll одразу після begin (бот ще не тиснув Start) → pending', async () => {
    const { token } = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).json() as { token: string };
    const res = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'pending' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('poll без token → 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/auth/telegram/poll' })).statusCode).toBe(400);
  });

  it('poll із вигаданим токеном → expired (не 500, не витік деталей)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/telegram/poll?token=zzz-not-real' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'expired' });
  });
});
