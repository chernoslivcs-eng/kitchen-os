// Telegram Login Widget — той самий контракт, що Google: довести володіння
// ідентичністю, далі спільна сесійна кука. Тут — сама перевірка підпису
// (валідний / підроблений / протухлий auth_date) і showcase у /v1/auth/providers.
import { createHash, createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';

const BOT_TOKEN = '123456789:test-bot-token-not-real';

// Незалежний підписувач — той самий алгоритм, що офіційний віджет Telegram,
// написаний окремо від verifyTelegramWidgetHash, щоб тест ловив розбіжність
// у формулі, а не повторював реалізацію.
function sign(payload: Record<string, string | number>, botToken = BOT_TOKEN): string {
  const dataCheckString = Object.keys(payload).sort().map((k) => `${k}=${payload[k]}`).join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

interface WidgetBase { id: number; first_name: string; username: string; auth_date: number }

function widgetPayload(overrides: Partial<WidgetBase> = {}): WidgetBase & { hash: string } {
  const base: WidgetBase = {
    id: 555000111,
    first_name: 'Тест',
    username: 'testuser',
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  return { ...base, hash: sign({ ...base }) };
}

function appWith() {
  const repo = new InMemoryRepo();
  const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer(), {
    telegramAuth: { botToken: BOT_TOKEN, botId: '123456789', botUsername: 'KitchenOSAppBot' },
  });
  return { repo, app };
}

describe('telegram login widget', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    ({ repo, app } = appWith());
    await app.ready();
  });

  it('без конфігурації роуту нема (404)', async () => {
    const bare = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer());
    await bare.ready();
    const res = await bare.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: widgetPayload() });
    expect(res.statusCode).toBe(404);
  });

  it('/v1/auth/providers каже telegram: true лише коли є конфігурація', async () => {
    const on = await app.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(on.json()).toMatchObject({ telegram: true, telegramBotId: '123456789' });
    const bare = buildApp(new InMemoryRepo(), new InMemoryStore(), new ConsoleMailer());
    await bare.ready();
    const off = await bare.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(off.json()).toMatchObject({ telegram: false, telegramBotId: null });
  });

  it('валідний підпис → 200, kos-кука, новий акаунт (created)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: widgetPayload() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, next: '/app' });
    const sc = res.headers['set-cookie'];
    const cookieRaw = Array.isArray(sc) ? sc[0]! : String(sc);
    expect(cookieRaw).toContain('kos=');
    expect(cookieRaw).toContain('HttpOnly');
    expect(cookieRaw).toContain('SameSite=Lax');
    expect(cookieRaw).toContain('Path=/');
    const linked = await repo.getTelegramByTelegramUser(555000111);
    expect(linked?.revoked_at).toBeNull();
  });

  it('повторний вхід тим самим telegram id — той самий акаунт, не дублікат', async () => {
    const first = await app.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: widgetPayload() });
    const firstCookie = String(first.headers['set-cookie']).split(';')[0];
    const second = await app.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: widgetPayload({ auth_date: Math.floor(Date.now() / 1000) }) });
    const secondCookie = String(second.headers['set-cookie']).split(';')[0];
    // Різні сесії (нові куки), той самий user_id за telegram_id.
    expect(firstCookie).not.toBe(secondCookie);
    const user = await repo.getUserByTelegramId(555000111);
    const linked = await repo.getTelegramByTelegramUser(555000111);
    expect(linked?.user_id).toBe(user?.id);
    expect(user?.email).toBeNull();
  });

  it('підроблений hash → 403, кука не ставиться', async () => {
    const p = widgetPayload();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: { ...p, hash: 'f'.repeat(64) } });
    expect(res.statusCode).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('підписаний іншим ботом (чужий токен) → 403', async () => {
    const p = widgetPayload();
    const wrongSig = sign({ id: p.id, first_name: p.first_name, username: p.username, auth_date: p.auth_date }, 'different-bot-token');
    const res = await app.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: { ...p, hash: wrongSig } });
    expect(res.statusCode).toBe(403);
  });

  it('протухлий auth_date (> 24 год) → 403', async () => {
    const stale = Math.floor(Date.now() / 1000) - 25 * 3600;
    const res = await app.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: widgetPayload({ auth_date: stale }) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'stale auth_date' });
  });

  it('без обовʼязкових полів (id/first_name/auth_date/hash) → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/telegram/widget', payload: { first_name: 'Т' } });
    expect(res.statusCode).toBe(400);
  });
});
