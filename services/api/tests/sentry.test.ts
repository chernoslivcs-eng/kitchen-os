// Крок О1б: Sentry на сервері.
//
// Тут перевіряється не «чи викликали ми бібліотеку», а чи КОНВЕРТ ДОЇХАВ.
// Різниця критична: Sentry мовчки ковтає помилки транспорту, і конфігурація,
// яка не шле нічого, виглядає точно так само, як робоча. Тому тест піднімає
// власний приймач конвертів і читає, що саме до нього прилетіло.
//
// Другий предмет тесту — те, чого в конверті бути НЕ МАЄ: тіло запиту,
// cookie, заголовки. У тілі чату лежить те, що людина написала про свій дім.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { initSentry, captureIncident, flushSentry, sentryOn, scrub, __resetSentry } from '../src/sentry.js';
import { incident } from '../src/incident.js';
import { InMemoryRepo } from '@kitchen/domain';

const silent = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as never;

/** Конверт Sentry — рядки JSON через \n: заголовок, тип, сама подія. */
function parseEnvelope(body: string): Record<string, unknown> {
  const lines = body.split('\n').filter(Boolean);
  // Останній рядок і є подія; попередній — її тип.
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

describe('Sentry на сервері', () => {
  let server: Server;
  let received: Record<string, unknown>[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push(parseEnvelope(body));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    // force=true — інакше під vitest модуль свідомо мовчить, щоб прогін
    // пакета не стукав у справжній Sentry.
    initSentry(`http://publickey@127.0.0.1:${port}/1`, true);
  });

  afterAll(async () => {
    await __resetSentry();
    await new Promise<void>((r) => server.close(() => r()));
  });

  afterEach(() => { received = []; });

  it('увімкнувся', () => {
    expect(sentryOn()).toBe(true);
  });

  it('guard летить попередженням, broke — помилкою', async () => {
    captureIncident('guard', 'example-copy', { user_id: 'u1', model: 'haiku' });
    captureIncident('broke', 'chat-model-call-failed', { user_id: 'u1', err: new Error('провайдер мовчить') });
    await flushSentry(3000);

    expect(received).toHaveLength(2);
    const guard = received.find((e) => (e.tags as Record<string, string>).incident === 'example-copy')!;
    const broke = received.find((e) => (e.tags as Record<string, string>).incident === 'chat-model-call-failed')!;
    expect(guard.level).toBe('warning');
    expect(broke.level).toBe('error');
    expect((guard.tags as Record<string, string>).incident_kind).toBe('guard');
    // Людина в події є — і тільки id: ні пошти, ні імені.
    expect(guard.user).toEqual({ id: 'u1' });
  });

  it('однакові інциденти групуються за назвою, не за текстом винятку', async () => {
    captureIncident('broke', 'chat-model-call-failed', { user_id: 'u1', err: new Error('502 від провайдера') });
    captureIncident('broke', 'chat-model-call-failed', { user_id: 'u1', err: new Error('таймаут 60с') });
    await flushSentry(3000);
    // Інакше один зламаний провайдер розсипався б у Sentry на сотню окремих
    // проблем — і жодна з них не виглядала б важливою.
    expect(received.map((e) => e.fingerprint)).toEqual([['chat-model-call-failed'], ['chat-model-call-failed']]);
  });

  it('виняток їде зі стеком, а не рядком', async () => {
    captureIncident('broke', 'invite-mail-failed', { user_id: 'u1', err: new Error('smtp відмовив') });
    await flushSentry(3000);
    const ex = (received[0]!.exception as { values: { type: string; value: string }[] }).values[0]!;
    expect(ex.value).toBe('smtp відмовив');
  });

  it('хелпер incident() доносить подію до Sentry САМ — без окремого виклику', async () => {
    const repo = new InMemoryRepo();
    incident({ repo, req: { log: silent } }, 'guard', 'response-contains-allergen', { user_id: 'u2', allergen: 'горіхи' });
    await flushSentry(3000);
    expect(received).toHaveLength(1);
    expect((received[0]!.tags as Record<string, string>).incident).toBe('response-contains-allergen');
  });

  it('інцидент без людини все одно летить: у базу він не пише, а в Sentry має', async () => {
    const repo = new InMemoryRepo();
    incident({ repo, req: { log: silent } }, 'broke', 'occasion-catch-failed', {});
    await flushSentry(3000);
    expect(received).toHaveLength(1);
    expect(received[0]!.user).toBeUndefined();
  });
});

describe('що зрізається перед відправкою', () => {
  it('тіло, cookie й заголовки не їдуть у Sentry взагалі', () => {
    const event = {
      request: {
        url: 'https://kitchen/v1/chat',
        method: 'POST',
        data: { text: 'у мене є куряча грудка і півпачки сметани' },
        cookies: { kos: 'секрет-сесії' },
        headers: { cookie: 'kos=секрет-сесії', authorization: 'Bearer x' },
        query_string: 'token=abc',
      },
    } as never;
    const out = scrub(event);
    const req = out.request as unknown as Record<string, unknown>;
    expect(req.data).toBeUndefined();
    expect(req.cookies).toBeUndefined();
    expect(req.headers).toBeUndefined();
    expect(req.query_string).toBeUndefined();
    // Адреса лишається: без неї подія не каже, ЩО саме зламалось.
    expect(req.url).toBe('https://kitchen/v1/chat');
  });

  it('події без request не ламає', () => {
    expect(() => scrub({} as never)).not.toThrow();
  });
});
