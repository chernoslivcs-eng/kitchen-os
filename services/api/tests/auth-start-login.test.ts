// AUTH-BRIEF-0915: «Почати / Увійти» на лендингу. Той самий блок входу, два
// режими — mode:'start' (типово, як і було) створює акаунт для невідомого
// ключа; mode:'login' — ніколи. Три способи, той самий контракт:
//   POST /v1/auth/request { mode: 'login' } + невідома пошта → {error:'no_account'}, листа нема
//   GET  /v1/auth/google?mode=login → callback з невідомою поштою → редирект ?err=no_account&via=google
//   POST /v1/auth/telegram/begin { mode: 'login' } → бот /start login_<token> з невідомим telegram_user_id
//     → GET /v1/auth/telegram/poll → {status:'no_account'}
// В усіх трьох — акаунт НЕ створюється. mode:'start' (типово) поведінки не міняє.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { handleTelegramText, resetSeenUpdates, COPY, resetBotUsernameCache } from '../src/telegram.js';
import type { GoogleProfile } from '../src/routes/auth-google.js';

const BOT = 'KitchenOSAppBot';

function stateCookieOf(res: { headers: Record<string, unknown> }, name: string): string {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc];
  const row = arr.find((c) => String(c).startsWith(`${name}=`));
  return String(row).split(';')[0]!.split('=')[1]!;
}

describe('AUTH-BRIEF-0915 · «Увійти» ніколи не створює акаунт', () => {
  describe('пошта', () => {
    let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
    beforeEach(async () => {
      repo = new InMemoryRepo(); mailer = new ConsoleMailer();
      app = buildApp(repo, new InMemoryStore(), mailer);
      await app.ready();
    });

    it('mode login + невідома пошта → {error:no_account}, листа нема, challenge не заводиться', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'nobody@example.com', mode: 'login' } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ error: 'no_account' });
      expect(mailer.sent).toHaveLength(0);
      expect(await repo.findUserByEmail('nobody@example.com')).toBeNull();
    });

    it('mode login + відома пошта → лист іде як зазвичай', async () => {
      await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'known@example.com' } });
      const link = mailer.last()!.link;
      await app.inject({ method: 'GET', url: new URL(link).pathname + new URL(link).search });
      mailer.sent.length = 0;

      const res = await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'known@example.com', mode: 'login' } });
      expect(res.statusCode).toBe(202);
      expect(mailer.sent).toHaveLength(1);
    });

    it('mode start (типово) — поведінка не змінилась, лист іде і для невідомої пошти', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'fresh@example.com' } });
      expect(res.statusCode).toBe(202);
      expect(mailer.sent).toHaveLength(1);
    });
  });

  describe('google', () => {
    function appWith(exchange: (code: string, redirectUri: string) => Promise<GoogleProfile>) {
      const repo = new InMemoryRepo();
      const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer(), {
        google: { clientId: 'test-client-id', clientSecret: 'test-secret', exchange },
      });
      return { repo, app };
    }

    it('mode login + невідомий google-акаунт → редирект /?err=no_account&via=google, юзера нема', async () => {
      const { repo, app } = appWith(async () => ({ email: 'gnobody@example.com', email_verified: true, name: 'Хтось' }));
      await app.ready();
      const start = await app.inject({ method: 'GET', url: '/v1/auth/google?mode=login' });
      const state = stateCookieOf(start, 'kos_oauth_state');
      const mode = stateCookieOf(start, 'kos_oauth_mode');
      expect(mode).toBe('login');
      const res = await app.inject({
        method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state}`,
        cookies: { kos_oauth_state: state, kos_oauth_mode: mode },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/?err=no_account&via=google');
      expect(String(res.headers['set-cookie'] ?? '')).not.toContain('kos=');
      expect(await repo.findUserByEmail('gnobody@example.com')).toBeNull();
    });

    it('mode login + відомий google-акаунт → вхід як зазвичай', async () => {
      const { repo, app } = appWith(async () => ({ email: 'gknown@example.com', email_verified: true, name: 'Хтось' }));
      await app.ready();
      await app.inject({ method: 'GET', url: '/v1/auth/google' }).then(async (start) => {
        const state = stateCookieOf(start, 'kos_oauth_state');
        await app.inject({ method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state}`, cookies: { kos_oauth_state: state } });
      });
      const start2 = await app.inject({ method: 'GET', url: '/v1/auth/google?mode=login' });
      const state2 = stateCookieOf(start2, 'kos_oauth_state');
      const mode2 = stateCookieOf(start2, 'kos_oauth_mode');
      const res = await app.inject({
        method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state2}`,
        cookies: { kos_oauth_state: state2, kos_oauth_mode: mode2 },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(String(res.headers['set-cookie'])).toContain('kos=');
      expect(await repo.findUserByEmail('gknown@example.com')).toBeTruthy();
    });

    it('без mode (типово start) — невідомий google-акаунт усе одно створюється', async () => {
      const { repo, app } = appWith(async () => ({ email: 'gstart@example.com', email_verified: true, name: 'Хтось' }));
      await app.ready();
      const start = await app.inject({ method: 'GET', url: '/v1/auth/google' });
      const state = stateCookieOf(start, 'kos_oauth_state');
      const res = await app.inject({ method: 'GET', url: `/v1/auth/google/callback?code=abc&state=${state}`, cookies: { kos_oauth_state: state } });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(await repo.findUserByEmail('gstart@example.com')).toBeTruthy();
    });
  });

  describe('telegram (begin → бот /start login_ → poll)', () => {
    let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>;
    let seq = 0;
    const upd = (telegram_user_id: number, text: string) =>
      ({ update_id: ++seq, telegram_user_id, chat_id: telegram_user_id + 1000, text, first_name: 'Хтось', username: 'someone' });
    const deps = () => ({ repo, store: new InMemoryStore(), appUrl: 'https://kos.example' });

    beforeEach(async () => {
      repo = new InMemoryRepo(); resetSeenUpdates(); resetBotUsernameCache();
      process.env.TELEGRAM_BOT_USERNAME = BOT;
      app = buildApp(repo, new InMemoryStore(), new ConsoleMailer(), {
        telegramAuth: { botToken: '123456789:test-bot-token-not-real', botId: '123456789', botUsername: BOT },
      });
      await app.ready();
    });

    it('mode login + невідомий telegram_user_id → бот каже loginNoAccount, poll: no_account, юзера нема', async () => {
      const { token } = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin', payload: { mode: 'login' } })).json() as { token: string };
      const r = await handleTelegramText(deps(), upd(801, `/start login_${token}`));
      expect(r?.messages[0]).toBe(COPY.loginNoAccount);
      expect(await repo.getUserByTelegramId(801)).toBeNull();

      const poll = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` });
      expect(poll.statusCode).toBe(200);
      expect(poll.json()).toEqual({ status: 'no_account' });
      expect(poll.headers['set-cookie']).toBeUndefined();

      // Повторний poll того самого токена — status 'no_account' лишається на
      // challenge (не consumed), тож poll і вдруге бачить той самий стан.
      const again = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` });
      expect(again.json()).toEqual({ status: 'no_account' });
    });

    it('mode login + вже відомий telegram_user_id → вхід як зазвичай', async () => {
      // Спершу mode:start заводить акаунт.
      const first = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin', payload: { mode: 'start' } })).json() as { token: string };
      await handleTelegramText(deps(), upd(802, `/start login_${first.token}`));
      await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${first.token}` });

      // Тепер mode:login тим самим telegram_id — уже відомий, впускає.
      const second = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin', payload: { mode: 'login' } })).json() as { token: string };
      const r = await handleTelegramText(deps(), upd(802, `/start login_${second.token}`));
      expect(r?.messages[0]).toContain('Привіт');
      const poll = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${second.token}` });
      expect(poll.json()).toEqual({ status: 'ok' });
      expect(String(poll.headers['set-cookie'])).toContain('kos=');
    });

    it('без mode (типово start) — невідомий telegram_user_id усе одно створюється', async () => {
      const { token } = (await app.inject({ method: 'POST', url: '/v1/auth/telegram/begin', payload: {} })).json() as { token: string };
      const r = await handleTelegramText(deps(), upd(803, `/start login_${token}`));
      expect(r?.messages[0]).toContain('Привіт');
      expect(await repo.getUserByTelegramId(803)).toBeTruthy();
      const poll = await app.inject({ method: 'GET', url: `/v1/auth/telegram/poll?token=${token}` });
      expect(poll.json()).toEqual({ status: 'ok' });
    });
  });

  describe('новий акаунт (будь-яким способом) отримує plan beta', () => {
    it('magic-link', async () => {
      const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
      const app = buildApp(repo, new InMemoryStore(), mailer);
      await app.ready();
      await app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email: 'beta@example.com' } });
      const link = mailer.last()!.link;
      const res = await app.inject({ method: 'GET', url: new URL(link).pathname + new URL(link).search, headers: { accept: 'application/json' } });
      const cookie = String(res.headers['set-cookie']).split(';')[0]!;
      const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
      expect(me.json().user.plan).toBe('beta');
    });
  });
});
