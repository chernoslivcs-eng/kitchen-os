// Хотфікс 15.09 (заміна Login Widget): повний цикл входу через бота —
// begin (веб) → /start login_<token> (бот) → poll (веб) → cookie-сесія.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { handleTelegramText, resetSeenUpdates, COPY } from '../src/telegram.js';
import { resetBotUsernameCache } from '../src/telegram.js';

const APP = 'https://kos.example';
const BOT = 'KitchenOSAppBot';

describe('хотфікс 15.09 · вхід через бота (begin → /start login_ → poll)', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;
  let seq = 0;
  const upd = (telegram_user_id: number, text: string, extra: Record<string, unknown> = {}) =>
    ({ update_id: ++seq, telegram_user_id, chat_id: telegram_user_id + 1000, text, first_name: 'Олена', username: 'olena', ...extra });
  const deps = () => ({ repo, store: new InMemoryStore(), appUrl: APP });

  beforeEach(async () => {
    repo = new InMemoryRepo();
    resetSeenUpdates();
    resetBotUsernameCache();
    process.env.TELEGRAM_BOT_USERNAME = BOT;
    app = buildApp(repo, new InMemoryStore(), new ConsoleMailer(), {
      telegramAuth: { botToken: '123456789:test-bot-token-not-real', botId: '123456789', botUsername: BOT },
    });
    await app.ready();
  });

  it('begin → poll pending → бот /start login_x → poll ok + cookie-сесія на новий акаунт', async () => {
    const { token, url } = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).json() as { token: string; url: string };
    expect(url).toBe(`https://t.me/${BOT}?start=login_${token}`);
    expect((await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` })).json()).toEqual({ status: 'pending' });

    const r = await handleTelegramText(deps(), upd(700, `/start login_${token}`));
    expect(r?.messages[0]).toBe(COPY.hello('Олена'));
    expect(r?.keyboard?.[0]?.[0]?.text).toBe('Відкрити сайт');
    expect(r?.keyboard?.[0]?.[0]?.url).toContain('/v1/auth/telegram?token=');

    const user = await repo.getUserByTelegramId(700);
    expect(user?.email).toBeNull();
    expect((await repo.getTelegramByTelegramUser(700))?.chat_id).toBe(1700);

    const poll = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` });
    expect(poll.statusCode).toBe(200);
    expect(poll.json()).toEqual({ status: 'ok' });
    const cookie = String(poll.headers['set-cookie']).split(';')[0]!;
    expect(cookie).toContain('kos=');
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.json().user.name).toBe('Олена');
  });

  it('повторний poll після ok → expired (token одноразовий), нової сесії не відкриває', async () => {
    const { token } = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).json() as { token: string };
    await handleTelegramText(deps(), upd(701, `/start login_${token}`));
    const first = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` });
    expect(first.json()).toEqual({ status: 'ok' });
    const again = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'expired' });
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('/start login_<протухлий/вигаданий токен> → COPY.loginExpired, акаунт НЕ створюється', async () => {
    const r = await handleTelegramText(deps(), upd(702, '/start login_not-a-real-token'));
    expect(r?.messages[0]).toBe(COPY.loginExpired);
    expect(await repo.getUserByTelegramId(702)).toBeNull();
  });

  it('вже спожитий (двічі Start тим самим лінком) → COPY.loginExpired вдруге, акаунт лишається один', async () => {
    const { token } = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).json() as { token: string };
    await handleTelegramText(deps(), upd(703, `/start login_${token}`));
    await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` }); // consume
    const second = await handleTelegramText(deps(), upd(703, `/start login_${token}`));
    expect(second?.messages[0]).toBe(COPY.loginExpired);
  });

  it('вхід тим самим telegram_id, яким уже користувались — той самий акаунт, не дублікат', async () => {
    const first = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).json() as { token: string };
    await handleTelegramText(deps(), upd(704, `/start login_${first.token}`));
    await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${first.token}` });
    const u1 = await repo.getUserByTelegramId(704);

    const second = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin' })).json() as { token: string };
    await handleTelegramText(deps(), upd(704, `/start login_${second.token}`));
    const poll2 = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${second.token}` });
    expect(poll2.json()).toEqual({ status: 'ok' });
    const u2 = await repo.getUserByTelegramId(704);
    expect(u2?.id).toBe(u1?.id);
  });
});
