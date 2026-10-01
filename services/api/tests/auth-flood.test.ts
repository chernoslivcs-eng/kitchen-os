// Захист від заливання запитами магічного лінка (інцидент 30.09: бот зробив
// 3 374 запити на вигадані адреси й вичерпав денну квоту Resend).
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { isUndeliverable, checkAuthFlood, FLOOD_LIMITS } from '../src/auth-flood.js';

describe('isUndeliverable', () => {
  it('ріже те, чим користувався бот, і зарезервоване RFC 2606', () => {
    for (const e of [
      'te@example.test', 'x@example2.test2', 'x@foo.invalid', 'x@foo.localhost',
      'x@foo.example', 'x@example.com', 'x@example.org',
      'x@localhost',          // домен без крапки
      'нема-собаки',
    ]) expect(isUndeliverable(e), e).toBe(true);
  });

  it('справжні адреси пропускає', () => {
    for (const e of ['philip@gmail.com', 'a.b@kitchen-os.app', 'x@exa.com', 'x@mail.test.ua']) {
      expect(isUndeliverable(e), e).toBe(false);
    }
  });
});

describe('checkAuthFlood', () => {
  let repo: InMemoryRepo;
  const NOW = new Date('2026-10-01T12:00:00.000Z');
  beforeEach(() => { repo = new InMemoryRepo(); });

  const seed = async (n: number, over: { ip?: string; email?: string; minsAgo?: number } = {}) => {
    for (let i = 0; i < n; i += 1) {
      await repo.saveChallenge({
        id: `c${i}-${Math.random()}`, email: over.email ?? `x${i}@mail.ua`, token_hash: `h${i}-${Math.random()}`,
        created_at: new Date(NOW.getTime() - (over.minsAgo ?? 1) * 60_000).toISOString(),
        expires_at: new Date(NOW.getTime() + 900_000).toISOString(),
        consumed_at: null, ip: over.ip ?? '1.1.1.1', user_agent: null,
      } as never);
    }
  };
  const check = (email: string, ip: string | null, delivers = true) =>
    checkAuthFlood({ repo, email, ip, delivers, now: NOW });

  it('порожня база — пускаємо', async () => {
    expect(await check('me@mail.ua', '1.1.1.1')).toEqual({ ok: true });
  });

  it('межа по IP: пʼять за чверть години', async () => {
    await seed(FLOOD_LIMITS.ip.max, { ip: '7.7.7.7' });
    expect(await check('new@mail.ua', '7.7.7.7')).toEqual({ ok: false, reason: 'ip' });
    // Інший IP не покараний за чужі гріхи.
    expect(await check('new@mail.ua', '8.8.8.8')).toEqual({ ok: true });
  });

  it('старі запити поза вікном не рахуються', async () => {
    await seed(FLOOD_LIMITS.ip.max, { ip: '7.7.7.7', minsAgo: 60 });
    expect(await check('new@mail.ua', '7.7.7.7')).toEqual({ ok: true });
  });

  it('межа по пошті: три за годину, з будь-яких IP', async () => {
    for (let i = 0; i < FLOOD_LIMITS.email.max; i += 1) {
      await seed(1, { email: 'victim@mail.ua', ip: `2.2.2.${i}` });
    }
    expect(await check('victim@mail.ua', '9.9.9.9')).toEqual({ ok: false, reason: 'email' });
  });

  it('глобальна межа ловить бота, який міняє і IP, і адреси', async () => {
    for (let i = 0; i < FLOOD_LIMITS.global.max; i += 1) {
      await seed(1, { email: `bot${i}@mail.ua`, ip: `3.3.3.${i}` });
    }
    expect(await check('real-person@mail.ua', '5.5.5.5')).toEqual({ ok: false, reason: 'global' });
  });

  it('вигаданий домен ріжеться ДО лічильників — бот не замикає ними людей', async () => {
    expect(await check('x@example.test', '1.2.3.4')).toEqual({ ok: false, reason: 'undeliverable' });
    // І не лишає сліду: справжня людина з того самого IP проходить.
    expect(await check('real@mail.ua', '1.2.3.4')).toEqual({ ok: true });
  });

  it('мейлер, який нікуди не шле (стенд, тести) — домени не ріже', async () => {
    expect(await check('dev@local.test', '1.2.3.4', false)).toEqual({ ok: true });
  });
});

describe('POST /v1/auth/request · відмова виглядає як успіх', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer); await app.ready();
  });
  const ask = (email: string) => app.inject({ method: 'POST', url: '/v1/auth/request', payload: { email } });

  it('перевищення по IP: та сама 202, без листа й без запису', async () => {
    const ok = await ask('a@mail.ua');
    expect(ok.statusCode).toBe(202);
    for (let i = 0; i < FLOOD_LIMITS.ip.max; i += 1) await ask(`b${i}@mail.ua`);
    const sentBefore = mailer.sent.length;
    const rowsBefore = await repo.countChallengesSince(new Date(0));

    const dropped = await ask('c@mail.ua');
    // Для скрипта це невідрізняльно від успіху — ні коду, ні тіла іншого.
    expect(dropped.statusCode).toBe(202);
    expect(dropped.json()).toEqual(ok.json());
    // А насправді нічого не сталось.
    expect(mailer.sent.length).toBe(sentBefore);
    expect(await repo.countChallengesSince(new Date(0))).toBe(rowsBefore);
  });

  it('справжній IP береться з x-forwarded-for, а не 127.0.0.1', async () => {
    await app.inject({
      method: 'POST', url: '/v1/auth/request',
      headers: { 'x-forwarded-for': '203.0.113.7' }, payload: { email: 'ip@mail.ua' },
    });
    const [c] = [...(repo as unknown as { challenges: Map<string, { ip: string | null }> }).challenges.values()];
    expect(c?.ip).toBe('203.0.113.7');
  });

  it('підроблений лівий запис x-forwarded-for не стає адресою', async () => {
    await app.inject({
      method: 'POST', url: '/v1/auth/request',
      // Так виглядає заголовок, коли клієнт сам підставив чужу адресу, а
      // проксі дописав справжню праворуч: брати треба ПРАВУ.
      headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }, payload: { email: 'spoof@mail.ua' },
    });
    const [c] = [...(repo as unknown as { challenges: Map<string, { ip: string | null }> }).challenges.values()];
    expect(c?.ip).toBe('203.0.113.9');
  });
});
