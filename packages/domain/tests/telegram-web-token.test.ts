import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { signInWithVerifiedEmail } from '../auth.js';
import { getOrCreateTelegramWebToken, verifyTelegramWebToken, TELEGRAM_WEB_TOKEN_TTL_MS } from '../telegram-web-token.js';

const SECRET = 'test-secret';

async function user(repo: InMemoryRepo, email = 'a@example.com') {
  const r = await signInWithVerifiedEmail(repo, email, 'A');
  return r.user_id;
}

describe('E · багаторазовий лінк у веб', () => {
  it('другий виклик за 24 год — той самий токен; після TTL — новий', async () => {
    const repo = new InMemoryRepo();
    const uid = await user(repo);
    const t0 = new Date('2026-09-20T10:00:00Z');
    const a = await getOrCreateTelegramWebToken(repo, uid, SECRET, t0);
    const b = await getOrCreateTelegramWebToken(repo, uid, SECRET, new Date(t0.getTime() + 3_600_000));
    expect(a.reused).toBe(false);
    expect(b).toEqual({ ...a, reused: true });
    const c = await getOrCreateTelegramWebToken(repo, uid, SECRET, new Date(t0.getTime() + TELEGRAM_WEB_TOKEN_TTL_MS + 1));
    expect(c.raw_token).not.toBe(a.raw_token);
  });

  it('перехід не споживає: двічі ok; після TTL — expired; після відкликання — revoked; вигаданий — not_found', async () => {
    const repo = new InMemoryRepo();
    const uid = await user(repo);
    const t0 = new Date('2026-09-20T10:00:00Z');
    const { raw_token } = await getOrCreateTelegramWebToken(repo, uid, SECRET, t0);
    expect(await verifyTelegramWebToken(repo, raw_token, t0)).toMatchObject({ ok: true, user_id: uid });
    expect(await verifyTelegramWebToken(repo, raw_token, new Date(t0.getTime() + 20 * 3_600_000))).toMatchObject({ ok: true });
    expect(await verifyTelegramWebToken(repo, raw_token, new Date(t0.getTime() + TELEGRAM_WEB_TOKEN_TTL_MS))).toEqual({ ok: false, reason: 'expired' });
    await repo.revokeTelegramWebTokens(uid, t0.toISOString());
    expect(await verifyTelegramWebToken(repo, raw_token, t0)).toEqual({ ok: false, reason: 'revoked' });
    expect(await verifyTelegramWebToken(repo, 'nope', t0)).toEqual({ ok: false, reason: 'not_found' });
    // Після відкликання — новий токен, інший.
    const n = await getOrCreateTelegramWebToken(repo, uid, SECRET, t0);
    expect(n.raw_token).not.toBe(raw_token);
  });

  it('зміна секрету — старий лінк не перевидається, видається новий, старий вмирає', async () => {
    const repo = new InMemoryRepo();
    const uid = await user(repo);
    const a = await getOrCreateTelegramWebToken(repo, uid, 's1');
    const b = await getOrCreateTelegramWebToken(repo, uid, 's2');
    expect(b.raw_token).not.toBe(a.raw_token);
    expect(await verifyTelegramWebToken(repo, a.raw_token)).toEqual({ ok: false, reason: 'revoked' });
    expect(await verifyTelegramWebToken(repo, b.raw_token)).toMatchObject({ ok: true });
  });

  it('у базі лише хеш, сирого токена нема', async () => {
    const repo = new InMemoryRepo();
    const uid = await user(repo);
    const { raw_token } = await getOrCreateTelegramWebToken(repo, uid, SECRET);
    const row = await repo.getLiveTelegramWebToken(uid, new Date().toISOString());
    expect(JSON.stringify(row)).not.toContain(raw_token);
  });
});
