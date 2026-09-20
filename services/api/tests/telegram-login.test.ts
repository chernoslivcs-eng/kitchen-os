import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { handleTelegramText, resetSeenUpdates, COPY } from '../src/telegram.js';
import { resetBotUsernameCache } from '../src/telegram.js';

// TELEGRAM-AUTH-PAY-PLAN-0915, PR 2-бот: /start без токена — акаунт одразу;
// /web і всі «Відкрити у вебі» — лінк входу GET /v1/auth/telegram?token=…&next=….
// E (20.09): токен багаторазовий на 24 год — telegram-web-link.test.ts.

const APP = 'https://kos.example';
const BOT = 'KitchenOSBot';

describe('PR 2-бот · вхід із Telegram', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>;
  let seq = 0;
  const upd = (telegram_user_id: number, text: string, extra: Record<string, unknown> = {}) => ({ update_id: ++seq, telegram_user_id, chat_id: telegram_user_id + 1000, text, first_name: 'Олена', username: 'olena', ...extra });
  const deps = () => ({ repo, store: new InMemoryStore(), appUrl: APP });
  beforeEach(async () => {
    repo = new InMemoryRepo(); resetSeenUpdates(); resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, new InMemoryStore(), new ConsoleMailer());
    await app.ready();
  });
  const tokenOf = (s: string) => decodeURIComponent(s.match(/token=([^&\s]+)/)![1]!);

  it('/start без токена → акаунт без пошти, chat_id відомий, hello на імʼя; вдруге — той самий акаунт', async () => {
    const r1 = await handleTelegramText(deps(), upd(900, '/start'));
    expect(r1?.messages[0]).toBe(COPY.hello('Олена'));
    const u = await repo.getUserByTelegramId(900);
    expect(u?.email).toBeNull();
    expect((await repo.getTelegramByTelegramUser(900))?.chat_id).toBe(1900);
    const r2 = await handleTelegramText(deps(), upd(900, '/start'));
    expect(r2?.messages[0]).toBe(COPY.hello('Олена'));
    expect((await repo.getUserByTelegramId(900))?.id).toBe(u!.id);
  });

  it('/start із битим токеном з профілю — не плодить акаунт, каже натиснути «Підключити» ще раз', async () => {
    const r = await handleTelegramText(deps(), upd(901, '/start nope'));
    expect(r?.messages[0]).toBe(COPY.linkExpired);
    expect(await repo.getUserByTelegramId(901)).toBeNull();
  });

  it('текст від незнайомого → «натисни /start»', async () => {
    const r = await handleTelegramText(deps(), upd(902, 'привіт'));
    expect(r?.messages[0]).toBe(COPY.startFirst);
  });

  it('/web → лінк входу; GET ставить cookie і веде на /app; вдруге (E) — теж ok', async () => {
    await handleTelegramText(deps(), upd(903, '/start'));
    const r = await handleTelegramText(deps(), upd(903, '/web'));
    const text = r!.messages[0]!;
    expect(text).toMatch(new RegExp(`${APP}/v1/auth/telegram\\?token=[A-Za-z0-9_-]+&next=%2Fapp`));
    expect(r!.keyboard?.[0]?.[0]?.url).toContain('/v1/auth/telegram?token=');
    const res = await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(tokenOf(text))}&next=%2Fapp` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/app');
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.json().user.name).toBe('Олена');
    const again = await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(tokenOf(text))}` });
    expect(again.statusCode).toBe(302);
  });

  it('next: відносний шлях проходить, зовнішній → /app; без токена → 400', async () => {
    await handleTelegramText(deps(), upd(904, '/start'));
    const a = await handleTelegramText(deps(), upd(904, '/web'));
    const res = await app.inject({ method: 'GET', url: `/v1/auth/telegram?token=${encodeURIComponent(tokenOf(a!.messages[0]!))}&next=https%3A%2F%2Fevil.example` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/app');
    expect((await app.inject({ method: 'GET', url: '/v1/auth/telegram' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/telegram?token=zzz' })).statusCode).toBe(404);
  });

  it('/home: «Відкрити у вебі» у тексті — лінк входу з next=/app', async () => {
    await handleTelegramText(deps(), upd(905, '/start'));
    const r = await handleTelegramText(deps(), upd(905, '/home'));
    expect(r!.messages.join(' ')).toMatch(/\/v1\/auth\/telegram\?token=[A-Za-z0-9_-]+&amp;next=%2Fapp/);
  });
});
