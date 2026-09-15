import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// GENERIC-0915: бекфіл ключів з адмінки — dry-run без ?apply=1, лог як у скрипта.
describe('POST /v1/admin/backfill-generic-keys', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
  const prev = process.env.ADMIN_EMAILS;
  beforeEach(async () => { repo = new InMemoryRepo(); mailer = new ConsoleMailer(); process.env.ADMIN_EMAILS = 'owner@kitchen.local'; app = buildApp(repo, new InMemoryStore(), mailer); await app.ready(); });
  afterEach(() => { process.env.ADMIN_EMAILS = prev; });

  it('dry-run рахує, ?apply=1 пише; не-адмін — 404', async () => {
    const admin = await signIn(app, mailer, 'owner@kitchen.local');
    const user = await signIn(app, mailer, 'u@x.local');
    await repo.insertProduct({ id: randomUUID(), household_id: user.household_id, product: 'сметана', brand: null, variant: null, unit: null, pack_size: null, tags: {}, catalog_key: null, created_at: new Date().toISOString() } as never);
    const dry = await app.inject({ method: 'POST', url: '/v1/admin/backfill-generic-keys', headers: { cookie: admin.cookie } });
    expect(dry.statusCode).toBe(200);
    expect(dry.json()).toMatchObject({ applied: false, without_key: 1, left: 0 });
    expect(dry.json().summary).toContain('сметана→gen_sour_cream');
    expect((await repo.listProducts(user.household_id))[0]!.catalog_key).toBeNull();
    const wet = await app.inject({ method: 'POST', url: '/v1/admin/backfill-generic-keys?apply=1', headers: { cookie: admin.cookie } });
    expect(wet.json().applied).toBe(true);
    expect((await repo.listProducts(user.household_id))[0]!.catalog_key).toBe('gen_sour_cream');
    expect((await app.inject({ method: 'POST', url: '/v1/admin/backfill-generic-keys?apply=1', headers: { cookie: user.cookie } })).statusCode).toBe(404);
  });
});
