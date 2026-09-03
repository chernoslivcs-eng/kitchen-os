// Картка event з чату мусить ДІЙТИ до календаря.
//
// Живий репро 03.09: «у суботу гості, шестеро» → відповідь «Записав гостей»,
// auto_applied: true, undo_token є — а в календарі порожньо, applied: 0.
// Причина була в порядку: pending-картка писалась ДО того, як `when` ставав
// `rule`, а applyCard читає картку з репо, не з памʼяті маршруту.
// Тест іде повним маршрутом /v1/chat (стаб віддає event без rule, як жива
// модель) і перевіряє те, що бачить людина: подію в /v1/events і applied у
// збереженому повідомленні. Перевірка лише відповіді чату цей баг не ловила.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

describe('POST /v1/chat · картка event доходить до календаря', () => {
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  let mailer: ConsoleMailer;

  beforeEach(async () => {
    const repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {});
    me = await signIn(app, mailer, 'podii@x.local');
  });

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('«у суботу гості, шестеро» → подія є в календарі, applied = 1', async () => {
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} }))
      .json() as { session: { id: string } };

    const res = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { session_id: s.session.id, text: 'у суботу гості, шестеро' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { card?: { type: string; ops: { rule?: unknown }[] }; auto_applied?: boolean; card_id?: string };
    expect(body.card?.type).toBe('event');
    // Дату порахував сервер — у картці відповіді rule уже є.
    expect(body.card?.ops[0]?.rule).toBeDefined();
    expect(body.auto_applied).toBe(true);

    // Те, що бачить людина: подія в календарі …
    const from = new Date(); const to = new Date(from.getTime() + 14 * 86_400_000);
    const ev = (await app.inject({
      method: 'GET', url: `/v1/events?from=${iso(from)}&to=${iso(to)}`, headers: { cookie: me.cookie },
    })).json() as { events: { scope: string; title: string; servings?: number | null }[] };
    const mine = ev.events.filter((e) => e.scope === 'household');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toContain('гості');
    expect(mine[0]?.servings).toBe(6);

    // … і чесний applied у збереженому повідомленні, а не лише «auto_applied» у відповіді.
    const full = (await app.inject({ method: 'GET', url: `/v1/sessions/${s.session.id}`, headers: { cookie: me.cookie } }))
      .json() as { messages: { card?: { type: string } | null; applied?: number }[] };
    const msg = full.messages.find((m) => m.card?.type === 'event');
    expect(msg?.applied).toBe(1);
  });

  it('картка у відповіді й в історії несе id створеної події; GET /v1/events/:id віддає її', async () => {
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} }))
      .json() as { session: { id: string } };
    const body = (await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { session_id: s.session.id, text: 'у суботу гості, шестеро' },
    })).json() as { card?: { ops: { id?: string }[] } };
    const id = body.card?.ops[0]?.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // Історія несе ту саму картку з тим самим id — не лише відповідь.
    const full = (await app.inject({ method: 'GET', url: `/v1/sessions/${s.session.id}`, headers: { cookie: me.cookie } }))
      .json() as { messages: { card?: { type: string; ops?: { id?: string }[] } | null }[] };
    const saved = full.messages.find((m) => m.card?.type === 'event');
    expect(saved?.card?.ops?.[0]?.id).toBe(id);

    const one = await app.inject({ method: 'GET', url: `/v1/events/${id}`, headers: { cookie: me.cookie } });
    expect(one.statusCode).toBe(200);
    const ev = (one.json() as { event: { id: string; title: string; servings?: number | null; rule?: { t: string } } }).event;
    expect(ev.id).toBe(id);
    expect(ev.title).toContain('гості');
    expect(ev.servings).toBe(6);
    expect(ev.rule?.t).toBe('once');

    // Чужому — 404, не 403: та сама межа, що в PATCH/DELETE.
    const other = await signIn(app, mailer, 'susid-podii@x.local');
    const alien = await app.inject({ method: 'GET', url: `/v1/events/${id}`, headers: { cookie: other.cookie } });
    expect(alien.statusCode).toBe(404);
  });

  it('правка «на тиждень» без нової дати подовжує подію від її ж дати, а картка несе її назву', async () => {
    // Живий репро 03.09: модель повернула {op:'edit', id, days:7} — і нічого не
    // сталось (rule правиться лише з when), а слід у стрічці казав «подія».
    const created = (await app.inject({
      method: 'POST', url: '/v1/events', headers: { cookie: me.cookie },
      payload: { title: 'Олена в гостях', rule: { t: 'once', at: '2026-09-10' } },
    })).json() as { event: { id: string } };
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} }))
      .json() as { session: { id: string } };
    const body = (await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { session_id: s.session.id, text: 'продовж Олену на тиждень' },
    })).json() as { card?: { ops: { op: string; id?: string; title?: string; rule?: { days?: number } }[] } };
    const op = body.card?.ops[0];
    expect(op?.op).toBe('edit');
    expect(op?.id).toBe(created.event.id);          // короткий id розгорнуто
    expect(op?.title).toBe('Олена в гостях');       // назва дописана сервером
    expect(op?.rule?.days).toBe(7);                 // days ліг у rule від дати події

    const one = (await app.inject({ method: 'GET', url: `/v1/events/${created.event.id}`, headers: { cookie: me.cookie } }))
      .json() as { event: { start: number; end: number } };
    expect(Math.round((one.event.end - one.event.start) / 86_400_000)).toBe(7);  // кінець входження = start + days
  });
});
