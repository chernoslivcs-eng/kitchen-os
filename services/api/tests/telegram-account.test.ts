import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, signInWithTelegram } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { COOKIE_NAME } from '../src/routes/auth.js';

// PR 1 (TELEGRAM-AUTH-PAY-PLAN-0915): акаунт без пошти скрізь, де сервер
// читав user.email як обовʼязкове — /v1/me, адмін-гейт, зошит виходу, учасники дому.

describe('акаунт із Telegram без пошти', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>;
  const prevAdmins = process.env.ADMIN_EMAILS;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    app = buildApp(repo, new InMemoryStore(), new ConsoleMailer());
    await app.ready();
  });
  afterEach(() => { process.env.ADMIN_EMAILS = prevAdmins; });
  const tgSignIn = async () => {
    const r = await signInWithTelegram(repo, { telegram_user_id: 777, chat_id: 555, first_name: 'Олена', username: 'olena' }, null, null);
    return { ...r, cookie: `${COOKIE_NAME}=${r.raw_cookie}` };
  };

  it('/v1/me: email null, учасник дому без пошти — без 500', async () => {
    const me = await tgSignIn();
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBeNull();
    expect(body.user.name).toBe('Олена');
    expect(body.household.members[0].name).toBe('Олена');
  });

  it('адмін-гейт: акаунт без пошти не адмін навіть за порожнього ADMIN_EMAILS-збігу', async () => {
    process.env.ADMIN_EMAILS = 'owner@kitchen.local';
    const me = await tgSignIn();
    const res = await app.inject({ method: 'GET', url: '/v1/admin/households', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(404);
  });

  it('видалення акаунта: зошит виходу отримує telegram:<id> замість пошти', async () => {
    const me = await tgSignIn();
    const res = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { cookie: me.cookie }, payload: { reason: 'test' } });
    expect(res.statusCode).toBe(204);
    const rows = await repo.listExitSurveys();
    expect(rows[0]?.email).toBe('telegram:777');
    expect(await repo.getUser(me.user_id)).toBeNull();
  });

  it('GET /v1/telegram для такого акаунта — linked, username з привʼязки', async () => {
    const me = await tgSignIn();
    const res = await app.inject({ method: 'GET', url: '/v1/telegram', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().linked).toBe(true);
  });
});
