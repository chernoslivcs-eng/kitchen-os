import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from './in-memory-repo.js';
import { signInWithTelegram, signInWithVerifiedEmail, createWebLoginChallenge, verifyChallenge, resolveSession } from './auth.js';

// TELEGRAM-AUTH-PAY-PLAN-0915, PR 1: акаунт народжується з Telegram-id, без
// пошти. Той самий контракт, що в signInWithVerifiedEmail: сесія + user.

const tg = (over: Partial<{ telegram_user_id: number; chat_id: number | null; first_name: string; username: string | null }> = {}) =>
  ({ telegram_user_id: 777, chat_id: 555, first_name: 'Олена', username: 'olena', ...over });

describe('signInWithTelegram', () => {
  it('перший вхід: user без пошти, дім, telegram_account, сесія; created: true', async () => {
    const repo = new InMemoryRepo();
    const r = await signInWithTelegram(repo, tg(), null, null);
    expect(r.created).toBe(true);
    expect(r.user.email).toBeNull();
    expect(r.user.name).toBe('Олена');
    expect(await repo.firstHouseholdOf(r.user.id)).toBe(r.household_id);
    const acc = await repo.getTelegramByTelegramUser(777);
    expect(acc?.user_id).toBe(r.user.id);
    expect(acc?.chat_id).toBe(555);
    const ctx = await resolveSession(repo, r.raw_cookie);
    expect(ctx?.user_id).toBe(r.user.id);
  });

  it('повторний вхід: той самий user, created: false, нова сесія', async () => {
    const repo = new InMemoryRepo();
    const a = await signInWithTelegram(repo, tg(), null, null);
    const b = await signInWithTelegram(repo, tg(), null, null);
    expect(b.created).toBe(false);
    expect(b.user.id).toBe(a.user.id);
    expect(b.session.id).not.toBe(a.session.id);
  });

  it('вхід із віджета без chat_id: рядок з chat_id null; перший /start його заповнює, а не плодить акаунт', async () => {
    const repo = new InMemoryRepo();
    const w = await signInWithTelegram(repo, tg({ chat_id: null }), null, null);
    expect((await repo.getTelegramByTelegramUser(777))?.chat_id).toBeNull();
    const s = await signInWithTelegram(repo, tg({ chat_id: 555 }), null, null);
    expect(s.created).toBe(false);
    expect(s.user.id).toBe(w.user.id);
    expect((await repo.getTelegramByTelegramUser(777))?.chat_id).toBe(555);
  });

  it('привʼязка до існуючого з поштою (профіль → «Підключити») не змінюється: Telegram-вхід веде в той самий акаунт', async () => {
    const repo = new InMemoryRepo();
    const mail = await signInWithVerifiedEmail(repo, 'me@x.local', 'Я', null, null);
    await repo.linkTelegram({ telegram_user_id: 777, user_id: mail.user_id, chat_id: 555, linked_at: new Date().toISOString(), revoked_at: null });
    const r = await signInWithTelegram(repo, tg(), null, null);
    expect(r.created).toBe(false);
    expect(r.user.id).toBe(mail.user_id);
    expect(r.user.email).toBe('me@x.local');
  });

  it('після /stop (revoked) новий /start оживляє той самий акаунт, не створює другий', async () => {
    const repo = new InMemoryRepo();
    const a = await signInWithTelegram(repo, tg(), null, null);
    await repo.revokeTelegram(a.user.id, new Date().toISOString());
    const b = await signInWithTelegram(repo, tg(), null, null);
    expect(b.user.id).toBe(a.user.id);
    expect((await repo.getTelegramByTelegramUser(777))?.revoked_at).toBeNull();
  });

  it('пошта акаунта з Telegram лишається вільною: інший user з поштою створюється без конфлікту', async () => {
    const repo = new InMemoryRepo();
    await signInWithTelegram(repo, tg(), null, null);
    await signInWithTelegram(repo, tg({ telegram_user_id: 778, first_name: 'Ігор' }), null, null);
    const m = await signInWithVerifiedEmail(repo, 'x@x.local', 'X', null, null);
    expect(m.user_id).toBeTruthy();
  });
});

describe('createWebLoginChallenge', () => {
  it('токен → verifyChallenge відкриває сесію того самого user; вдруге — consumed', async () => {
    const repo = new InMemoryRepo();
    const r = await signInWithTelegram(repo, tg(), null, null);
    const { raw_token } = await createWebLoginChallenge(repo, r.user.id);
    const v = await verifyChallenge(repo, raw_token, null, null);
    expect(v.ok && v.result.user_id).toBe(r.user.id);
    const again = await verifyChallenge(repo, raw_token, null, null);
    expect(!again.ok && again.reason).toBe('consumed');
  });
});
