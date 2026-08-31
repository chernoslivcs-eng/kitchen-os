// П.7 pre-deploy: краї падінь. Модель лежить → 502 model_unavailable
// (UI показує «НЕ НАДІСЛАЛОСЬ · ↻»); завеликий файл → multipart-ліміт.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('модель лежить → 502, не сирий 500', () => {
  beforeEach(() => {
    // Ключ є → шлях live; base URL веде в нікуди → SDK падає мережею.
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test-dead');
    vi.stubEnv('OPENROUTER_BASE_URL', 'http://127.0.0.1:1');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('POST /v1/chat при мертвому провайдері → 502 model_unavailable', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'fm1@example.com');
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'що приготувати?' },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toBe('model_unavailable');
  }, 30_000);
});

describe('завеликий upload ріжеться лімітом', () => {
  it('файл понад 20MB → 413', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'fm2@example.com');
    const big = Buffer.alloc(21 * 1024 * 1024, 65);
    const boundary = '----e2eboundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      big,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({
      method: 'POST', url: '/v1/attachments',
      headers: { cookie: me.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect([413, 400]).toContain(r.statusCode);
    expect(r.statusCode).not.toBe(500);
  });
});
