import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';

describe('POST /v1/shopping/unpack', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('перекладає checked-позиції в комору й видаляє їх зі списку', async () => {
    const A = await signIn(app, mailer, 'a@example.com');

    // Створюємо три позиції: 2 checked, 1 unchecked
    for (const spec of [
      { label: 'моцарела', value: 250, unit: 'g', zone: 'fridge', checked: true },
      { label: 'песто', value: 100, unit: 'g', zone: 'fridge', checked: true },
      { label: 'помідор', value: null, unit: null, zone: null, checked: false },
    ]) {
      await repo.insertShoppingItem({
        id: randomUUID(),
        household_id: A.household_id,
        label: spec.label,
        reason: null,
        value: spec.value,
        unit: spec.unit,
        zone: spec.zone,
        checked: spec.checked,
        added_by: A.user_id,
        source: 'user',
        created_at: new Date().toISOString(),
      });
    }

    const res = await app.inject({
      method: 'POST', url: '/v1/shopping/unpack',
      headers: { cookie: A.cookie }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(2);

    const shopping = await repo.listShoppingItems(A.household_id);
    expect(shopping).toHaveLength(1);
    expect(shopping[0]!.label).toBe('помідор');

    const pantry = await repo.listBatches(A.household_id);
    expect(pantry).toHaveLength(2);
    const labels = pantry.map((b) => b.label).sort();
    expect(labels).toEqual(['моцарела', 'песто']);
    expect(pantry.every((b) => b.last_action === 'unpack')).toBe(true);
    expect(pantry.every((b) => b.state === 'sealed')).toBe(true);
    // UX9-01: catalog_key МУСИТЬ бути null. Кодовий каталог знає ключі, яких
    // немає в таблиці catalog_ingredient (вона не сідиться до задачі «каталог
    // 2341») — БД валила unpack по FK, «→ В КОМОРУ» мовчки не робив нічого.
    // In-memory FK не відтворює, тому фіксуємо контракт значенням.
    expect(pantry.every((b) => b.catalog_key === null)).toBe(true);
  });

  it('порожній checked → 200 з created:0', async () => {
    const A = await signIn(app, mailer, 'a@example.com');
    const res = await app.inject({
      method: 'POST', url: '/v1/shopping/unpack',
      headers: { cookie: A.cookie }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(0);
  });
});

// DA2-31: бейдж «Список» показував різні числа на різних екранах — сервер
// рахував УСІ позиції, екран списку — тільки некуплені. Канон: бейдж = скільки
// ще треба купити (некуплені); total віддаємо окремо для мета-рядка «2 / 3».
describe('GET /v1/shopping · канон лічильника', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('count = некуплені; total = всі', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    for (const [label, checked] of [['молоко', false], ['хліб', false], ['яйця', true]] as const) {
      await repo.insertShoppingItem({
        id: randomUUID(), household_id: me.household_id, label, reason: null,
        value: null, unit: null, zone: null, checked,
        added_by: me.user_id, source: 'user', created_at: new Date().toISOString(),
      });
    }
    const r = await app.inject({ method: 'GET', url: '/v1/shopping', headers: { cookie: me.cookie } });
    const body = r.json();
    expect(body.count).toBe(2);      // бейдж: ще треба купити
    expect(body.total).toBe(3);      // мета-рядок «2 / 3»
  });
});

// Бриф-3 п.8: «+ у список» інлайн на бракуючому інгредієнті рецепта.
// Досі позицію руками було не додати взагалі (QA7-01: «POST /v1/shopping не
// існує») — список наповнювався тільки картками моделі.
describe('POST /v1/shopping · ручне додавання', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('додає позицію з кількістю і причиною', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const r = await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'Фетучіні', v: 200, u: 'g', reason: 'для: Вершкова фетучіні' },
    });
    expect(r.statusCode).toBe(201);
    const items = await repo.listShoppingItems(me.household_id);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('Фетучіні');
    expect(items[0]!.value).toBe(200);
    expect(items[0]!.reason).toBe('для: Вершкова фетучіні');
    expect(items[0]!.source).toBe('user');
  });

  it('дубль за назвою не плодиться — повертає наявну позицію', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'Фетучіні' },
    });
    const second = await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'фетучіні' },
    });
    expect(second.statusCode).toBe(200);
    expect(await repo.listShoppingItems(me.household_id)).toHaveLength(1);
  });

  it('порожня назва — 400', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    expect((await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: '  ' },
    })).statusCode).toBe(400);
  });
});
