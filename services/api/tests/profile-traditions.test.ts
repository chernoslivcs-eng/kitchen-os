// Традиції — явний вибір у профілі, не здогад із побажань.
//
// Найдорожчий баг тут не «чіп не зберігся», а «людина вимкнула свята, а
// календар і промпт далі їх показують, бо в побажаннях лишилось "постуємо"».
// Тому перевіряється саме перевага явного вибору над здогадом.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, buildKitchenContext } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

describe('традиції профілю', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {});
    me = await signIn(app, mailer, 'trad@x.local');
  });

  const hdr = () => ({ cookie: me.cookie });
  const patch = (op: 'add' | 'remove', label: string) =>
    app.inject({ method: 'PATCH', url: '/v1/profile', headers: hdr(), payload: { ops: [{ op, kind: 'tradition', label }] } });
  const eventIds = async (from: string, to: string) => {
    const res = await app.inject({ method: 'GET', url: `/v1/events?from=${from}&to=${to}`, headers: hdr() });
    return (res.json() as { events: { id: string }[] }).events.map((e) => e.id);
  };

  it('поки нічого не обрано — календар іде за здогадом із побажань, і профіль каже, що це здогад', async () => {
    await app.inject({ method: 'PATCH', url: '/v1/profile', headers: hdr(), payload: { ops: [{ op: 'add', kind: 'wish', label: 'постуємо' }] } });
    const p = await app.inject({ method: 'GET', url: '/v1/profile', headers: hdr() });
    const body = p.json() as { profile: { traditions: unknown }; inferred_traditions: string[] };
    expect(body.profile.traditions ?? null).toBeNull();
    expect(body.inferred_traditions).toEqual(['orthodox']);
    expect(await eventIds('2026-03-01', '2026-03-05')).toContain('lent');
  });

  it('католицька: у грудні зʼявляється Різдво 24–26, православного посту в березні немає', async () => {
    await patch('add', 'catholic');
    expect(await eventIds('2026-12-20', '2026-12-31')).toContain('xmas-cath');
    // 2026: католицький Великдень 5 квітня, православний — 12-го.
    const march = await eventIds('2026-03-01', '2026-03-05');
    expect(march).toContain('lent-cath');
    expect(march).not.toContain('lent');
  });

  it('вимкнути все перемагає «постуємо» в побажаннях — і в календарі, і в промпті', async () => {
    await app.inject({ method: 'PATCH', url: '/v1/profile', headers: hdr(), payload: { ops: [{ op: 'add', kind: 'wish', label: 'постуємо' }] } });
    expect(await eventIds('2026-03-01', '2026-03-05')).toContain('lent');
    // Перший дотик матеріалізує здогад: зняти «православні» — і лишається [].
    const res = await patch('remove', 'orthodox');
    expect((res.json() as { applied: number }).applied).toBe(1);
    const p = await app.inject({ method: 'GET', url: '/v1/profile', headers: hdr() });
    expect((p.json() as { profile: { traditions: string[] } }).profile.traditions).toEqual([]);
    expect(await eventIds('2026-03-01', '2026-03-05')).not.toContain('lent');

    const profile = await repo.getProfile(me.user_id);
    const ctx = buildKitchenContext({ profile, pantry: [], now: new Date(2026, 2, 3) } as Parameters<typeof buildKitchenContext>[0]);
    expect(ctx).toContain('ТРАДИЦІЇ: вимкнено');
    expect(ctx).not.toContain('Великий піст:');
  });

  it('ісламська: Рамадан — вікно з позначкою орієнтовності', async () => {
    await patch('add', 'islamic');
    const res = await app.inject({ method: 'GET', url: '/v1/events?from=2027-02-01&to=2027-02-28', headers: hdr() });
    const ev = (res.json() as { events: { id: string; approx?: boolean }[] }).events.find((e) => e.id === 'ramadan');
    expect(ev).toBeDefined();
    expect(ev?.approx).toBe(true);
  });

  it('невідома традиція — не пишеться', async () => {
    const res = await patch('add', 'pastafarian');
    expect((res.json() as { applied: number }).applied).toBe(0);
  });
});

describe('традиція з чату — без картки з кнопками', () => {
  it('картка profile з самими традиціями застосовується сама, undo повертає «не обирала»', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer, {});
    const me = await signIn(app, mailer, 'chat-trad@x.local');
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} }))
      .json() as { session: { id: string } };
    const res = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { session_id: s.session.id, text: 'ми католики' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { auto_applied?: boolean; undo_token?: string; card_id?: string; reply: string };
    expect(body.auto_applied).toBe(true);
    expect(body.undo_token).toBeTruthy();
    // Репліка не переписана в майбутній час: дія вже сталась.
    expect(body.reply).toContain('Записав');
    expect((await repo.getProfile(me.user_id))?.traditions).toEqual(['catholic']);

    const undo = await app.inject({
      method: 'POST', url: `/v1/cards/${body.card_id}/undo`, headers: { cookie: me.cookie },
      payload: { undo_token: body.undo_token },
    });
    expect(undo.statusCode).toBe(200);
    expect((await repo.getProfile(me.user_id))?.traditions ?? null).toBeNull();
  });
});
