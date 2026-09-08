// П4-Т3. Гілка ops-картки профілю вміє лише kind: 'member'. Будь-який інший
// (або відсутній) kind не робив нічого — а applied_ops записував УСІ індекси.
// Слід застосування стверджував більше, ніж сталось, і слідів того, ЧОМУ
// нічого не сталось, не лишалось узагалі.
//
// Живий випадок 07.09: модель прислала {"type":"profile","ops":[{op, field,
// text} ×3]} — змішала форму картки ПОЛЯ з формою ops-картки. Три наслідки
// одночасно: рендер намалював три прочерки, застосування дало нуль, а
// chat-history переказав це моделі як «add undefined: undefined».
//
// Після Т2 сама брехня («застосовано» на нулі) вже не проходить. Тут
// лишається сліпота: ми не бачили ні промахів, ні причини. Картку НЕ
// лагодимо — форму задає промпт, і мовчазна латка сховала б причину.

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending } from '@kitchen/domain';
import type { Card } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

let repo: InMemoryRepo;
let app: Awaited<ReturnType<typeof buildApp>>;
let me: Awaited<ReturnType<typeof signIn>>;

beforeEach(async () => {
  repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  app = buildApp(repo, new InMemoryStore(), mailer);
  await app.ready();
  me = await signIn(app, mailer, 'me@example.com');
});

async function pend(card: Card) {
  const card_id = randomUUID();
  const session = await repo.createFreshSession(me.user_id, '2026-09-08');
  await repo.saveMessage({
    id: card_id, session_id: session.id, role: 'assistant',
    text: null, card, applied: 0, created_at: new Date().toISOString(),
  });
  await createPending(repo, { message_id: card_id, household_id: me.household_id, user_id: me.user_id, card });
  return card_id;
}

const apply = (card_id: string) => app.inject({
  method: 'POST', url: `/v1/cards/${card_id}/apply`,
  headers: { cookie: me.cookie }, payload: {},
});

const incidents = async () => (await repo.listAppEvents(me.user_id, {
  from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50,
})).map((x) => x.name).filter((n) => n.startsWith('incident:'));

describe('ops-картка профілю у формі картки поля', () => {
  it('та сама форма з 07.09: нуль, порожній applied_ops, три промахи, рівно один інцидент', async () => {
    const card = {
      type: 'profile',
      ops: [
        { op: 'add', field: 'when', text: 'вечорами' },
        { op: 'add', field: 'no', text: 'кінза' },
        { op: 'add', field: 'like', text: 'гостре' },
      ],
    } as unknown as Card;
    const card_id = await pend(card);

    const r = await apply(card_id);
    // 200: сервер відпрацював правильно, просто застосувати не було чого.
    expect(r.statusCode).toBe(200);
    expect(r.json().applied).toBe(0);
    expect(r.json().missed).toHaveLength(3);

    // Слід застосування не стверджує нічого: після Т2 його взагалі не пишуть,
    // бо не лягло нічого. Раніше тут лежало [0,1,2].
    const pc = await repo.getPending(card_id);
    expect(pc?.applied_ops).toBeNull();
    expect(pc?.applied_at).toBeNull();

    // Рівно один: діагноз один, і роздвоєння коштувало б точності лічильника.
    expect(await incidents()).toEqual(['incident:profile-card-malformed']);
  });

  it('правильна форма, але невідомий kind — промах без діагнозу форми', async () => {
    const card = {
      type: 'profile',
      ops: [{ kind: 'preference', op: 'add', label: 'люблю гостре' }],
    } as unknown as Card;
    const card_id = await pend(card);

    const r = await apply(card_id);
    expect(r.json().applied).toBe(0);
    expect(r.json().missed).toEqual(['add «люблю гостре» (kind: preference)']);
    // Форма ціла — отже це не malformed, і рахуватись має окремо від нього.
    expect(await incidents()).toEqual(['incident:profile-op-missed']);
  });

  it('часткове застосування: applied_ops несе лише той індекс, що ліг', async () => {
    const card = {
      type: 'profile',
      ops: [
        { kind: 'preference', op: 'add', label: 'люблю гостре' },
        { kind: 'member', op: 'add', label: 'Оксана', diet: 'веганка' },
        { op: 'add', field: 'no', text: 'кінза' },
      ],
    } as unknown as Card;
    const card_id = await pend(card);

    const r = await apply(card_id);
    expect(r.json().applied).toBe(1);
    expect(r.json().missed).toHaveLength(2);

    const pc = await repo.getPending(card_id);
    // Раніше тут було [0,1,2] — картка стверджувала три застосування з одного.
    expect(pc?.applied_ops).toEqual([1]);
    expect(pc?.applied_at).toBeTruthy();

    // Змішана форма серед операцій — діагноз лишається діагнозом навіть тоді,
    // коли сусідня операція лягла.
    expect(await incidents()).toEqual(['incident:profile-card-malformed']);
  });

  it('чиста member-картка: жодного інциденту, applied_ops повний', async () => {
    const card = {
      type: 'profile',
      ops: [{ kind: 'member', op: 'add', label: 'Оксана', diet: 'веганка' }],
    } as unknown as Card;
    const card_id = await pend(card);

    expect((await apply(card_id)).json().applied).toBe(1);
    expect((await repo.getPending(card_id))?.applied_ops).toEqual([0]);
    expect(await incidents()).toEqual([]);
  });
});
