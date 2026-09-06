// Крок О1: димовий тест символікації, серверна половина.
//
// Три речі, і кожна ламається тихо:
//   — чужий бачить 404, а не 403 і не текст нашого винятку;
//   — виняток справді ЛЕТИТЬ нагору, а не ловиться в обробнику: інакше ми
//     перевіряли б не той шлях, яким піде справжня аварія;
//   — у стеку є наші функції на три кадри вглиб — саме те, заради чого
//     сорсмепи існують. Виняток, кинутий у самому обробнику, дав би стек з
//     одного рядка, і символікацію на ньому не перевіриш.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { initSentry, flushSentry, __resetSentry } from '../src/sentry.js';

describe('GET /v1/admin/boom', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let logged: string[];

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    logged = [];
    // Логер у потік: стек ловимо там, де його побачить прод — у рядку, який
    // пише onError-хук через incident().
    app = buildApp(repo, new InMemoryStore(), mailer, {
      logger: { level: 'error', stream: { write: (line: string) => { logged.push(line); } } },
    });
    await app.ready();
    process.env.ADMIN_EMAILS = 'owner@example.com';
  });
  afterEach(() => { delete process.env.ADMIN_EMAILS; });

  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

  it('стороннього не пускає — 404, і текст винятку не протікає', async () => {
    const stranger = await signIn(app, mailer, 'stranger@example.com');
    const r = await get('/v1/admin/boom', stranger.cookie);
    // 403 сказав би «сторінка є, тобі не можна». 404 не каже нічого.
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'not_found' });
    expect(r.body).not.toContain('символікації');
  });

  it('стороннього не пускає і на перевірку доступу (?dry=1)', async () => {
    const stranger = await signIn(app, mailer, 'stranger@example.com');
    const r = await get('/v1/admin/boom?dry=1', stranger.cookie);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'not_found' });
  });

  it('без ADMIN_EMAILS адмінки не існує ні для кого', async () => {
    delete process.env.ADMIN_EMAILS;
    const owner = await signIn(app, mailer, 'owner@example.com');
    expect((await get('/v1/admin/boom', owner.cookie)).statusCode).toBe(404);
  });

  it('без сесії до обробника не доходить', async () => {
    const r = await get('/v1/admin/boom');
    expect(r.statusCode).toBe(401);
    expect(r.body).not.toContain('символікації');
  });

  it('власнику з ?dry=1 не вибухає — це лише перепустка для сторінки', async () => {
    const owner = await signIn(app, mailer, 'owner@example.com');
    const r = await get('/v1/admin/boom?dry=1', owner.cookie);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    // Нічого не зламалось — у логах порожньо.
    expect(logged.join('')).not.toContain('unhandled-route-error');
  });

  it('власнику без прапорця — справжній виняток, що долетів нагору', async () => {
    const owner = await signIn(app, mailer, 'owner@example.com');
    const r = await get('/v1/admin/boom', owner.cookie);
    // 500 від fastify, а не наш reply.code(): обробник помилку не ловить.
    expect(r.statusCode).toBe(500);
    expect(r.json().message).toContain('димовий тест символікації');
  });

  it('дійшов саме до глобального хука — тим шляхом, яким піде справжня аварія', async () => {
    const owner = await signIn(app, mailer, 'owner@example.com');
    await get('/v1/admin/boom', owner.cookie);
    const line = logged.find((l) => l.includes('unhandled-route-error'));
    expect(line).toBeTruthy();
    const rec = JSON.parse(line!) as { kind: string; route: string; user_id: string; err: { stack: string } };
    expect(rec.kind).toBe('broke');
    expect(rec.route).toBe('GET /v1/admin/boom');
    // Людина в інциденті є — без неї подію не звести зі стрічкою дня.
    expect(rec.user_id).toBe(owner.user_id);
  });

  it('у стеку три наші кадри — інакше символікувати нічого', async () => {
    const owner = await signIn(app, mailer, 'owner@example.com');
    await get('/v1/admin/boom', owner.cookie);
    const rec = JSON.parse(logged.find((l) => l.includes('unhandled-route-error'))!) as { err: { stack: string } };
    const stack = rec.err.stack;
    // Саме ці три імені мають бути читабельні в Sentry після символікації.
    expect(stack).toContain('readShelfDepth');
    expect(stack).toContain('pickCentrepiece');
    expect(stack).toContain('planNightMeal');
    // І кадр із самим маршрутом — щоб було видно, звідки почалось.
    expect(stack).toContain('boom.ts');
  });

  it('інцидент лягає у стрічку дня власника — поруч із рештою подій', async () => {
    const owner = await signIn(app, mailer, 'owner@example.com');
    await get('/v1/admin/boom', owner.cookie);
    await new Promise((r) => setTimeout(r, 10));   // запис не блокує відповідь
    const rows = await repo.listAppEvents(owner.user_id, {
      from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50,
    });
    expect(rows.map((r) => r.name)).toContain('incident:unhandled-route-error');
  });

  it('помилка з власним статусом 4xx у Sentry не летить — це відмова, не аварія', async () => {
    // Інакше кожна валідація втопила б справжні падіння. Перевіряємо тим же
    // хуком: беремо маршрут, який кидає помилку з statusCode 400.
    const probe = buildApp(repo, new InMemoryStore(), mailer, {
      logger: { level: 'error', stream: { write: (l: string) => { logged.push(l); } } },
    });
    probe.get('/v1/__refusal', async () => {
      const e = new Error('так не можна') as Error & { statusCode: number };
      e.statusCode = 400;
      throw e;
    });
    await probe.ready();
    const r = await probe.inject({ method: 'GET', url: '/v1/__refusal' });
    expect(r.statusCode).toBe(400);
    expect(logged.join('')).not.toContain('unhandled-route-error');
  });
});

describe('GET /v1/admin/boom · код інциденту у відповіді', () => {
  let server: Server;
  let received: Record<string, unknown>[] = [];
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    received = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const lines = body.split('\n').filter(Boolean);
        received.push(JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    // force=true — під vitest модуль інакше свідомо мовчить.
    initSentry(`http://publickey@127.0.0.1:${port}/1`, true);

    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, { logger: false });
    await app.ready();
    process.env.ADMIN_EMAILS = 'owner@example.com';
  });

  afterEach(async () => {
    delete process.env.ADMIN_EMAILS;
    await __resetSentry();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('заголовок x-incident-code — це початок event_id тієї самої події', async () => {
    const owner = await signIn(app, mailer, 'owner@example.com');
    const r = await app.inject({ method: 'GET', url: '/v1/admin/boom', headers: { cookie: owner.cookie } });
    // Хук onResponse уже викликав flush сам — конверт міг лише не встигнути
    // доїхати до нашого приймача. Чекаємо саме на прибуття, а не на таймер.
    await flushSentry(3000);
    for (let i = 0; i < 60 && received.length === 0; i++) {
      await new Promise((res) => setTimeout(res, 50));
    }

    const code = r.headers['x-incident-code'] as string;
    // Вісім знаків — рівно стільки, скільки людина продиктує голосом.
    expect(code).toMatch(/^[0-9a-f]{8}$/);
    expect(received).toHaveLength(1);
    // Саме за цим кодом власник і знайде подію пошуком у Sentry.
    expect(String(received[0]!.event_id).startsWith(code)).toBe(true);
    expect((received[0]!.tags as Record<string, string>).incident).toBe('unhandled-route-error');
    expect(received[0]!.level).toBe('error');
    // І стек у події — з нашими кадрами, а не з одного рядка обробника.
    const ex = (received[0]!.exception as { values: { stacktrace?: { frames: { function?: string }[] } }[] }).values[0]!;
    const fns = (ex.stacktrace?.frames ?? []).map((f) => f.function);
    expect(fns).toContain('readShelfDepth');
    expect(fns).toContain('planNightMeal');
  });
});
