// Крок О1а: приймач подій, інциденти й пульс.
//
// Три речі ламаються тихо і дорого: чужий user_id у тілі (людина пише в чужу
// стрічку), інцидент, що впав на записі (guard перетворюється на broke), і
// адмінка, яка каже стороннім, що вона існує.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { incident } from '../src/incident.js';
import { priceOf, priceFor } from '../src/pricing.js';
import { KNOWN_EVENTS, MAX_BATCH } from '../src/routes/track.js';
import { signIn, type Signed } from './helpers.js';

const silentObj = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
const silent = silentObj as never;

describe('POST /v1/events/track', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    me = await signIn(app, mailer, 'o1@example.com');
  });

  const post = (payload: unknown, cookie = me.cookie) =>
    app.inject({ method: 'POST', url: '/v1/events/track', headers: { cookie }, payload: payload as object });

  it('приймає пачку і кладе її під ВЛАСНИКА сесії', async () => {
    const r = await post({ events: [
      { name: 'pantry_opened' },
      { name: 'cook_step_reached', props: { step: 3, of: 7 } },
    ] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ accepted: 2 });

    const day = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 };
    const saved = await repo.listAppEvents(me.user_id, day);
    expect(saved.map((e) => e.name).sort()).toEqual(['cook_step_reached', 'pantry_opened']);
    expect(saved.every((e) => e.user_id === me.user_id)).toBe(true);
  });

  it('чужий user_id у тілі не має жодної сили — беремо з сесії', async () => {
    const other = await signIn(app, mailer, 'other@example.com');
    await post({ events: [{ name: 'pantry_opened', props: { user_id: other.user_id } }] });
    const day = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 };
    // У чужій стрічці порожньо; подія лягла тому, хто її надіслав.
    expect(await repo.listAppEvents(other.user_id, day)).toEqual([]);
    expect(await repo.listAppEvents(me.user_id, day)).toHaveLength(1);
  });

  it('без сесії — 401, а не тиха згода', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/events/track', payload: { events: [{ name: 'pantry_opened' }] } });
    expect(r.statusCode).toBe(401);
  });

  it('пачка більша за стелю — 400', async () => {
    const events = Array.from({ length: MAX_BATCH + 1 }, () => ({ name: 'pantry_opened' }));
    const r = await post({ events });
    expect(r.statusCode).toBe(400);
  });

  it('невідоме імʼя тихо відкидається — стрічка дня не засмічується', async () => {
    const r = await post({ events: [{ name: 'pantry_opened' }, { name: 'клік_по_кнопці_42' }] });
    expect(r.json()).toEqual({ accepted: 1 });
  });

  it('ліміт тримається і називає час', async () => {
    // Стеля рахує ЗАПИТИ, не події: 200 звернень за пʼять хвилин. Клієнт шле
    // раз на 10 с, тож підійти до неї він не може — це запобіжник від циклу.
    for (let i = 0; i < 200; i++) await post({ events: [{ name: 'pantry_opened' }] });
    const over = await post({ events: [{ name: 'pantry_opened' }] });
    expect(over.statusCode).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('час події клієнтський, але в межах розумного', async () => {
    const long_ago = new Date(Date.now() - 10 * 3600_000).toISOString();
    await post({ events: [{ name: 'pantry_opened', at: long_ago }] });
    const day = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50 };
    // Збитий годинник не розмазує стрічку дня: подію поставлено «зараз».
    expect(await repo.listAppEvents(me.user_id, day)).toHaveLength(1);
  });
});

describe('хелпер incident()', () => {
  it('пише обидва роди в app_event під імʼям incident:*', async () => {
    const repo = new InMemoryRepo();
    const { user_id } = await repo.createUserWithHousehold('i@example.com', 'X');
    incident({ repo, req: { log: silent } }, 'broke', 'chat-model-call-failed', { user_id, err: 'boom' });
    incident({ repo, req: { log: silent } }, 'guard', 'example-copy', { user_id, model: 'haiku' });
    await new Promise((r) => setTimeout(r, 10));   // запис не блокує обробник

    const rows = await repo.listAppEvents(user_id, {
      from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50,
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['incident:chat-model-call-failed', 'incident:example-copy']);
    expect(rows.find((r) => r.name.endsWith('example-copy'))!.props.kind).toBe('guard');
    expect(rows.find((r) => r.name.endsWith('call-failed'))!.props.kind).toBe('broke');
  });

  it('падіння запису не валить обробник — інцидент не стає аварією', async () => {
    const repo = new InMemoryRepo();
    vi.spyOn(repo, 'saveAppEvents').mockRejectedValue(new Error('база лягла'));
    const log = { ...silentObj, error: vi.fn() };
    expect(() => incident({ repo, req: { log: log as never } }, 'guard', 'intake-op-missed', { user_id: 'u1' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    // Відмова саме ПІЙМАНА, а не залишена необробленою обіцянкою: інакше
    // процес у ноді падає цілком, і guard таки стає аварією.
    expect(log.error.mock.calls.some(([, name]) => name === 'incident-save-failed')).toBe(true);
  });

  it('без user_id у базу не пише: подія без людини нікому не потрібна', async () => {
    const repo = new InMemoryRepo();
    const spy = vi.spyOn(repo, 'saveAppEvents');
    incident({ repo, req: { log: silent } }, 'broke', 'invite-mail-failed', {});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ціна виклику', () => {
  it('модель упізнається за підрядком — і у прямій назві, і в OpenRouter', () => {
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual(priceFor('anthropic/claude-haiku-4.5'));
    expect(priceFor('claude-sonnet-5')!.output).toBeGreaterThan(priceFor('claude-haiku-4-5')!.output);
  });

  it('кешовані рахуються за зниженою ставкою', () => {
    const base = { model: 'claude-haiku-4-5', input_tokens: 1_000_000, output_tokens: 0, cached_tokens: 0 };
    const cached = { ...base, cached_tokens: 1_000_000 };
    expect(priceOf(base)).toBeCloseTo(1.0, 5);
    expect(priceOf(cached)).toBeCloseTo(0.1, 5);
  });

  it('невідома модель — null, а не нуль', () => {
    // «Нуль доларів» читається як «безкоштовно» — це інша новина, ніж «не знаю».
    expect(priceOf({ model: 'llama-3', input_tokens: 100, output_tokens: 100, cached_tokens: 0 })).toBeNull();
  });
});

describe('GET /v1/admin/pulse', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('стороннього не пускає — і не каже, що сторінка існує', async () => {
    process.env.ADMIN_EMAILS = 'owner@example.com';
    const stranger = await signIn(app, mailer, 'stranger@example.com');
    const r = await app.inject({ method: 'GET', url: '/v1/admin/pulse', headers: { cookie: stranger.cookie } });
    // 404, а не 403: те саме рішення, що в адмінці приводів.
    expect(r.statusCode).toBe(404);
    delete process.env.ADMIN_EMAILS;
  });

  it('власнику віддає три блоки за день', async () => {
    process.env.ADMIN_EMAILS = 'owner@example.com';
    const owner = await signIn(app, mailer, 'owner@example.com');
    await app.inject({
      method: 'POST', url: '/v1/events/track', headers: { cookie: owner.cookie },
      payload: { events: [{ name: 'pantry_opened' }] },
    });
    // Місцева дата, не UTC — див. dayBounds у pulse.ts.
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const r = await app.inject({ method: 'GET', url: `/v1/admin/pulse?day=${day}`, headers: { cookie: owner.cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty('turns');
    expect(body).toHaveProperty('money.day');
    expect(body).toHaveProperty('money.week');
    expect(body.events.map((e: { name: string }) => e.name)).toContain('pantry_opened');
    delete process.env.ADMIN_EMAILS;
  });
});

describe('набір подій', () => {
  it('закритий список — двадцять одна точка, не кліки підряд', () => {
    // Крок А1: тринадцять було до знайомства й картки «Про тебе»; вісім нових
    // закривають рівно ті два місця, де людина могла мовчки застрягти.
    expect(KNOWN_EVENTS.size).toBe(21);
    expect(KNOWN_EVENTS.has('chat_input_abandoned')).toBe(true);
    expect(KNOWN_EVENTS.has('error_shown')).toBe(true);
  });

  it('імена подій — через ПІДКРЕСЛЕННЯ; дефіс лишається за інцидентами', () => {
    // Два різні набори, які легко змішати: подія продукту пишеться
    // 'pantry_opened', інцидент — 'incident:intake-op-missed'. Ім'я з дефісом
    // у цьому списку означало б, що межу вже перейшли.
    for (const name of KNOWN_EVENTS) expect(name).not.toContain('-');
  });
});
