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

  beforeEach(async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
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
});
