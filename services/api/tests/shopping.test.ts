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
