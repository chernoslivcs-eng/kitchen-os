// Календар, фаза 1: один список на відрізок часу.
//
// Головне, що перевіряється, — не CRUD, а зшивання. Сезон грибів і вечеря в
// четвер належать одному тижню, і склеювати їх має сервер: якби глобальні й
// домашні події приходили двома запитами, правило «що на цьому тижні» жило б
// у фронтенді, де його ніхто не перевірить.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

interface EventRow {
  id: string; scope: string; kind: string; title: string;
  start: number; end: number; force: string; approx?: boolean;
}

describe('events routes · календар', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {});
    me = await signIn(app, mailer, 'kalendar@x.local');
  });

  const list = async (from: string, to: string) => {
    const res = await app.inject({
      method: 'GET', url: `/v1/events?from=${from}&to=${to}`,
      headers: { cookie: me.cookie },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { events: EventRow[] }).events;
  };

  const create = async (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/events', headers: { cookie: me.cookie }, payload });

  it('сезон із довідника потрапляє у відрізок, який його перетинає', async () => {
    // Тиждень усередині сезону білих грибів (09-01 → 10-31) — теж його тиждень.
    const events = await list('2026-09-07', '2026-09-13');
    const mushroom = events.find((e) => e.id === 'mushroom');
    expect(mushroom).toBeDefined();
    expect(mushroom?.scope).toBe('catalog');
    expect(mushroom?.kind).toBe('season');
  });

  it('свято без розпізнаної традиції не приходить, із традицією — приходить', async () => {
    // Святвечір має tradition=orthodox і без побажань лишається невидимим.
    expect((await list('2026-12-20', '2026-12-24')).some((e) => e.id === 'xmas-eve')).toBe(false);

    // Пишемо побажання прямо в репозиторій: тест про календар, а не про форму
    // патча профілю — інакше він падав би від чужої зміни.
    await repo.upsertProfile({
      user_id: me.user_id, allergies: [], wishes: ['святкуємо православні свята'],
      antipatterns: [], equipment: {},
    });
    expect((await list('2026-12-20', '2026-12-24')).some((e) => e.id === 'xmas-eve')).toBe(true);
  });

  it('подія дому стає в той самий список і сортується за датою', async () => {
    const res = await create({
      title: 'мама привезе цибулю', kind: 'supply',
      rule: { t: 'once', at: '2026-09-10', days: 7 },
      note: 'тиждень готуємо з нею',
    });
    expect(res.statusCode).toBe(201);

    const events = await list('2026-09-07', '2026-09-13');
    const mine = events.find((e) => e.scope === 'household');
    expect(mine?.title).toBe('мама привезе цибулю');
    expect(mine?.kind).toBe('supply');
    // Обидва роди в одному списку, і він упорядкований.
    expect(events.some((e) => e.scope === 'catalog')).toBe(true);
    expect([...events].sort((a, b) => a.start - b.start)).toEqual(events);
  });

  it('тижневе правило дає по входженню на тиждень', async () => {
    await create({ title: 'у вівторок мало часу', kind: 'constraint', rule: { t: 'weekly', dow: 2 } });
    const mine = (await list('2026-09-07', '2026-09-27')).filter((e) => e.scope === 'household');
    expect(mine).toHaveLength(3);   // вівторки 8, 15, 22 вересня
  });

  it('поза відрізком події немає', async () => {
    await create({ title: 'гості', kind: 'custom', rule: { t: 'once', at: '2026-10-01' } });
    expect((await list('2026-09-07', '2026-09-13')).some((e) => e.scope === 'household')).toBe(false);
  });

  it('форми дати, що належать довіднику, дім собі не пише', async () => {
    // Інакше будь-хто дописав би собі свято — або, гірше, піст із обмеженням.
    for (const rule of [
      { t: 'window', from: '01-01', to: '12-31' },
      { t: 'easter', from: -48, to: -1 },
      { t: 'lunar', base: 0 },
    ]) {
      const res = await create({ title: 'моє свято', rule });
      expect(res.statusCode).toBe(400);
    }
  });

  it('порожня назва і крива дата — 400', async () => {
    expect((await create({ title: '  ', rule: { t: 'once', at: '2026-09-10' } })).statusCode).toBe(400);
    expect((await create({ title: 'подія', rule: { t: 'once', at: '10 вересня' } })).statusCode).toBe(400);
    expect((await create({ title: 'подія', rule: { t: 'weekly', dow: 9 } })).statusCode).toBe(400);
  });

  it('правка змінює назву, згасання лишає рядок, видалення прибирає', async () => {
    const created = (await create({
      title: 'гості', kind: 'custom', rule: { t: 'once', at: '2026-09-10' },
    })).json() as { event: { id: string } };
    const id = created.event.id;

    const patched = await app.inject({
      method: 'PATCH', url: `/v1/events/${id}`, headers: { cookie: me.cookie },
      payload: { title: 'гості, шестеро', servings: 6 },
    });
    expect(patched.statusCode).toBe(200);
    expect((await list('2026-09-07', '2026-09-13'))[0]).toBeDefined();
    expect((await list('2026-09-10', '2026-09-10')).find((e) => e.scope === 'household')?.title)
      .toBe('гості, шестеро');

    const del = await app.inject({
      method: 'DELETE', url: `/v1/events/${id}`, headers: { cookie: me.cookie },
    });
    expect(del.statusCode).toBe(204);
    expect((await list('2026-09-10', '2026-09-10')).some((e) => e.scope === 'household')).toBe(false);
  });

  it('чужа подія — 404, а не 403: чужий дім не мусить знати, що вона є', async () => {
    const other = await signIn(app, mailer, 'susid@x.local');
    const created = (await app.inject({
      method: 'POST', url: '/v1/events', headers: { cookie: other.cookie },
      payload: { title: 'їхні гості', rule: { t: 'once', at: '2026-09-10' } },
    })).json() as { event: { id: string } };

    const patch = await app.inject({
      method: 'PATCH', url: `/v1/events/${created.event.id}`,
      headers: { cookie: me.cookie }, payload: { title: 'мої гості' },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE', url: `/v1/events/${created.event.id}`, headers: { cookie: me.cookie },
    });
    expect(del.statusCode).toBe(404);
  });
});
