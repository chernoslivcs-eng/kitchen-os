// Раунд 5, крок П1: підписки, набори для картки серії, «зараз» одним
// контрактом, записи дому з правилом.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

describe('П1 · періоди з правилом', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {});
    me = await signIn(app, mailer, 'periods@x.local');
  });

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: me.cookie } });
  const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers: { cookie: me.cookie }, payload: payload as never });

  it('GET /v1/occasions?set=jewish — дати з таблиці і галочки за дефолтом', async () => {
    const res = await get('/v1/occasions?set=jewish&year=2026');
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as { items: { occasion_id: string; from: string; to: string; enabled: boolean; what: string }[] };
    expect(items).toHaveLength(7);
    const pesach = items.find((i) => i.occasion_id === 'pesach');
    expect(pesach).toMatchObject({ from: '2026-04-01', to: '2026-04-09', enabled: false });
    // Відсортовано за датою.
    expect(items.map((i) => i.from)).toEqual([...items.map((i) => i.from)].sort());
  });

  it('GET /v1/occasions?set=orthodox — Великдень православний, 12 квітня', async () => {
    const { items } = (await get('/v1/occasions?set=orthodox&year=2026')).json() as { items: { occasion_id: string; from: string }[] };
    expect(items.find((i) => i.occasion_id === 'easter')?.from).toBe('2026-04-12');
    const cath = (await get('/v1/occasions?set=catholic&year=2026')).json() as { items: { occasion_id: string; from: string }[] };
    expect(cath.items.find((i) => i.occasion_id === 'easter')?.from).toBe('2026-04-05');
  });

  it('GET /v1/occasions?set=seasons — усі увімкнені за дефолтом; кривий set — 400', async () => {
    const { items } = (await get('/v1/occasions?set=seasons&year=2026')).json() as { items: { enabled: boolean; type: string }[] };
    expect(items.length).toBe(32);
    expect(items.every((i) => i.enabled)).toBe(true);
    expect((await get('/v1/occasions?set=vikings')).statusCode).toBe(400);
  });

  it('PUT subscriptions: «ми католики» = батч true; відписка від сезону = false; дефолт — рядок геть', async () => {
    const catholic = ((await get('/v1/occasions?set=catholic&year=2026')).json() as { items: { occasion_id: string }[] }).items;
    const res = await put('/v1/occasions/subscriptions', catholic.map((i) => ({ occasion_id: i.occasion_id, enabled: true })));
    expect(res.statusCode).toBe(200);
    const subs = (await get('/v1/occasions/subscriptions')).json() as { subscriptions: { occasion_id: string; enabled: boolean }[] };
    expect(subs.subscriptions.map((s) => s.occasion_id).sort()).toEqual(catholic.map((i) => i.occasion_id).sort());
    // Адвент є в грудні.
    const dec = (await get('/v1/events?from=2026-12-05&to=2026-12-10')).json() as { events: { id: string }[] };
    expect(dec.events.some((e) => e.id === 'advent')).toBe(true);

    await put('/v1/occasions/subscriptions', [{ occasion_id: 'melon', enabled: false }]);
    const aug = (await get('/v1/events?from=2026-08-20&to=2026-08-21')).json() as { events: { id: string }[] };
    expect(aug.events.some((e) => e.id === 'melon')).toBe(false);

    // Повернути до дефолту — рядок зникає.
    await put('/v1/occasions/subscriptions', [{ occasion_id: 'melon', enabled: true }, { occasion_id: 'advent', enabled: false }]);
    const after = (await get('/v1/occasions/subscriptions')).json() as { subscriptions: { occasion_id: string }[] };
    expect(after.subscriptions.map((s) => s.occasion_id)).not.toContain('melon');
    expect(after.subscriptions.map((s) => s.occasion_id)).not.toContain('advent');
    expect((await put('/v1/occasions/subscriptions', [{ occasion_id: 'nope', enabled: true }])).statusCode).toBe(404);
  });

  it('POST /v1/events: дієта з датами, правилом і «суворо»; GET /v1/now віддає її одним контрактом', async () => {
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const to = new Date(today.getTime() + 20 * 86_400_000);
    const res = await app.inject({
      method: 'POST', url: '/v1/events', headers: { cookie: me.cookie },
      payload: { kind: 'diet', title: 'без мʼяса', from: iso(today), to: iso(to), rule_text: 'без мʼяса', strict: true },
    });
    expect(res.statusCode).toBe(201);
    const { event } = res.json() as { event: { id: string; kind: string; strict: boolean; force: string; restricts: string; rule: unknown } };
    expect(event).toMatchObject({ kind: 'diet', strict: true, force: 'restrict', restricts: 'без мʼяса', rule: { t: 'once', at: iso(today), days: 21 } });

    const now = (await get('/v1/now')).json() as { now: { kind: string; title: string; from: string; to: string; rule_text?: string; strict: boolean; source: string; id?: string }[] };
    const diet = now.now.find((n) => n.id === event.id);
    expect(diet).toMatchObject({ kind: 'diet', title: 'без мʼяса', from: iso(today), to: iso(to), rule_text: 'без мʼяса', strict: true, source: 'user' });

    // Суворо без правила — 400.
    const bad = await app.inject({ method: 'POST', url: '/v1/events', headers: { cookie: me.cookie }, payload: { kind: 'diet', title: 'x', from: iso(today), strict: true } });
    expect(bad.statusCode).toBe(400);

    // PATCH: зняти «суворо» — force назад у hint; дати правлять правило.
    const patched = await app.inject({ method: 'PATCH', url: `/v1/events/${event.id}`, headers: { cookie: me.cookie }, payload: { strict: false, to: iso(today) } });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { event: { strict: boolean; force: string; rule: unknown } }).event).toMatchObject({ strict: false, force: 'hint', rule: { t: 'once', at: iso(today) } });
  });
});
