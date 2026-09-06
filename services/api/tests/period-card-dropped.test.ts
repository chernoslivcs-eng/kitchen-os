// П2a: масова відписка = серія сезонів; картка впала → reply не бреше.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';
import { droppedPeriodReply } from '../src/period-card.js';

describe('droppedPeriodReply', () => {
  it('три випадки запобіжника', () => {
    expect(droppedPeriodReply({ type: 'period', kind: 'tradition', unsubscribe: 'сезонні' }))
      .toBe('Не знайшов «сезонні» серед сезонів і свят. Скажи точніше або зніми внизу календаря.');
    expect(droppedPeriodReply({ type: 'period', kind: 'tradition' }))
      .toBe('Такої традиції в довіднику нема — можеш додати свої свята карткою.');
    expect(droppedPeriodReply({ type: 'period', kind: 'diet' }))
      .toBe('Не зрозумів, що записати — назви період одним словом.');
  });
});

describe('POST /v1/chat · П2a', () => {
  let app: ReturnType<typeof buildApp>;
  let repo: InMemoryRepo;
  let me: Signed;
  const warns: unknown[] = [];

  beforeEach(async () => {
    repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    warns.length = 0;
    // Логер у потік: warn-маркер маршруту видно там, де його побачить прод.
    app = buildApp(repo, new InMemoryStore(), mailer, { logger: { level: 'warn', stream: { write: (line: string) => { warns.push(line); } } } });
    me = await signIn(app, mailer, 'p2a@x.local');
  });

  const chat = async (text: string) => {
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
    const res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: s.session.id, text } });
    expect(res.statusCode).toBe(200);
    return res.json() as { reply: string; card: Record<string, unknown> | null; card_id: string | null };
  };

  it('«прибери сезонні з календаря» → серія всіх сезонів, усе зняте; apply none → усі сезони off', async () => {
    const body = await chat('прибери сезонні з календаря');
    expect(body.card).toMatchObject({ type: 'period', kind: 'tradition', set: 'seasons', all: false });
    const items = body.card!.items as { occasion_id: string; enabled: boolean }[];
    expect(items.length).toBe(32);
    expect(items.every((i) => i.enabled === false)).toBe(true);
    expect(body.reply).not.toMatch(/прибрав/i);
    const r = await app.inject({ method: 'POST', url: `/v1/cards/${body.card_id}/apply`, headers: { cookie: me.cookie }, payload: { none: true } });
    expect(r.statusCode).toBe(200);
    const subs = await repo.listOccasionSubscriptions(me.household_id);
    expect(subs.length).toBe(32);
    expect(subs.every((s) => s.enabled === false)).toBe(true);
    // Календар без жодного сезону.
    const ev = (await app.inject({ method: 'GET', url: '/v1/events?from=2026-09-01&to=2026-09-30', headers: { cookie: me.cookie } })).json() as { events: { scope: string }[] };
    expect(ev.events.filter((e) => e.scope === 'catalog')).toEqual([]);
  });

  it('«поверни сезони» → та сама серія з усіма галочками; apply з вибором повертає лише позначені', async () => {
    await repo.setOccasionSubscription(me.household_id, 'melon', false);
    await repo.setOccasionSubscription(me.household_id, 'mushroom', false);
    const body = await chat('поверни сезони');
    expect(body.card).toMatchObject({ set: 'seasons', all: true });
    const items = body.card!.items as { occasion_id: string; enabled: boolean }[];
    expect(items.every((i) => i.enabled)).toBe(true);
    const idx = items.findIndex((i) => i.occasion_id === 'melon');
    await app.inject({ method: 'POST', url: `/v1/cards/${body.card_id}/apply`, headers: { cookie: me.cookie }, payload: { selected: [idx] } });
    const subs = await repo.listOccasionSubscriptions(me.household_id);
    // Кавуни повернуто (рядок зник — дефолт), решта сезонів позначена off.
    expect(subs.find((s) => s.occasion_id === 'melon')).toBeUndefined();
    expect(subs.find((s) => s.occasion_id === 'mushroom')?.enabled).toBe(false);
  });

  it('«не показуй мені сезонні» → картки нема, reply із запобіжника, warn у лозі', async () => {
    const body = await chat('не показуй мені сезонні');
    expect(body.card).toBeNull();
    expect(body.reply).toBe('Не знайшов «сезонні» серед сезонів і свят. Скажи точніше або зніми внизу календаря.');
    expect(warns.some((w) => String(w).includes('period-card-dropped') && String(w).includes('"unsubscribe":"сезонні"'))).toBe(true);
  });
});
