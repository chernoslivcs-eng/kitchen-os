import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Власник 15.09: ручна форма «Додати» в коморі — через той самий резолвер, що
// чат і чек: продукт дому (без дублів), ключ — суворий рівень, зона й строк
// з довідника, коли людина зону не чіпала.

describe('POST /v1/pantry через резолвер', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
  beforeEach(async () => { repo = new InMemoryRepo(); mailer = new ConsoleMailer(); app = buildApp(repo, new InMemoryStore(), mailer); await app.ready(); });
  const add = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/pantry', headers: { cookie }, payload });

  it('«молоко» → продукт дому з ключем, партія з product_id і без ключа на партії; зона з довідника, строк порахований', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const res = await add(me.cookie, { label: 'молоко', value: 1000, unit: 'ml' });
    expect(res.statusCode).toBe(201);
    const { batch } = res.json();
    const products = await repo.listProducts(me.household_id);
    expect(products).toHaveLength(1);
    expect(products[0]!.catalog_key).toBe('milk_cow_25');
    expect(batch.product_id).toBe(products[0]!.id);
    expect(batch.catalog_key).toBeNull();
    expect(batch.zone).toBe('fridge');
    // у відповіді /v1/pantry — ключ продукту й строк, як у партій з чека
    const view = (await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } })).json();
    const row = view.batches.find((b: { id: string }) => b.id === batch.id);
    expect(row.catalog_key).toBe('milk_cow_25');
    expect(row.expires_at ?? row.effective_expires_at ?? row.days).toBeTruthy();
  });

  it('друге «молоко» → той самий продукт, друга партія', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await add(me.cookie, { label: 'молоко' });
    await add(me.cookie, { label: 'Молоко', value: 2000, unit: 'ml' });
    expect(await repo.listProducts(me.household_id)).toHaveLength(1);
    expect((await repo.listBatches(me.household_id)).filter((b) => b.state !== 'depleted')).toHaveLength(2);
  });

  it('людина обрала зону сама — її вибір сильніший за довідник', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { batch } = (await add(me.cookie, { label: 'молоко', zone: 'freezer' })).json();
    expect(batch.zone).toBe('freezer');
  });

  it('«кефір» → як у чаті: продукт без ключа, зона з generic-рівня — холодильник', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { batch } = (await add(me.cookie, { label: 'кефір' })).json();
    expect((await repo.listProducts(me.household_id))[0]!.catalog_key).toBeNull();
    expect(batch.zone).toBe('fridge');
  });

  it('«щось xyz» → продукт без ключа, зона dry за замовчуванням', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { batch } = (await add(me.cookie, { label: 'щось xyz' })).json();
    const products = await repo.listProducts(me.household_id);
    expect(products[0]!.catalog_key).toBeNull();
    expect(batch.product_id).toBe(products[0]!.id);
    expect(batch.zone).toBe('dry');
  });

  it('GET /v1/pantry/resolve — підказка без моделі: ключ, назва, категорія, зона, дні; невідоме → key null', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const ok = (await app.inject({ method: 'GET', url: '/v1/pantry/resolve?label=' + encodeURIComponent('молоко'), headers: { cookie: me.cookie } })).json();
    expect(ok).toMatchObject({ key: 'milk_cow_25', name: 'Молоко коровʼяче 2.5%', zone: 'fridge' });
    expect(typeof ok.cat).toBe('string');
    expect(ok.days).toBeGreaterThan(0);
    const no = (await app.inject({ method: 'GET', url: '/v1/pantry/resolve?label=' + encodeURIComponent('щось xyz'), headers: { cookie: me.cookie } })).json();
    expect(no).toEqual({ key: null, zone: null });
    // «кефір»: рівень той самий, що в чаті — ключа нема (у довіднику лише варіанти), зона — холодильник (generic, як apply)
    const kefir = (await app.inject({ method: 'GET', url: '/v1/pantry/resolve?label=' + encodeURIComponent('кефір'), headers: { cookie: me.cookie } })).json();
    expect(kefir).toEqual({ key: null, zone: 'fridge' });
  });
});
