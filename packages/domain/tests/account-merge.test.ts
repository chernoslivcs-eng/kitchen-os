// Злиття акаунтів (власник 15.09): Google-акаунт + Telegram-дубль.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '../in-memory-repo.js';
import { signInWithVerifiedEmail, signInWithTelegram } from '../auth.js';
import { mergeAccount, pendingConflict } from '../account-merge.js';
import type { PantryBatch, RecipeRow, ShoppingItemRow } from '../types.js';

const now = () => new Date().toISOString();
const batch = (household_id: string, label: string, product_id: string | null): PantryBatch => ({
  id: randomUUID(), household_id, catalog_key: null, label, zone: 'fridge', value: 1, unit: 'pcs', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: now(), depleted_at: null,
  confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add', product_id,
});
const recipe = (owner_id: string, title: string): RecipeRow => ({
  id: randomUUID(), owner_id, origin: 'generated', title, descr: null, character: null, risk: null,
  base_servings: 2, time_total: null, nutrition: null, payload: { ing: [], st: [] }, created_at: now(), saved_at: now(),
});
const shopping = (household_id: string, label: string): ShoppingItemRow => ({
  id: randomUUID(), household_id, label, reason: null, value: null, unit: null, zone: null, checked: false, added_by: null, source: 'user', created_at: now(),
});

/** Яна: web-акаунт з поштою і окремий Telegram-акаунт із власним домом. */
async function seed() {
  const repo = new InMemoryRepo();
  const web = await signInWithVerifiedEmail(repo, 'yana@example.com', 'Яна');
  const tg = await signInWithTelegram(repo, { telegram_user_id: 777, chat_id: 777, first_name: 'Яна' });
  // Спільний продукт (молоко) — має злитись; окремий (сир) — має додатись.
  const milkWeb = randomUUID(); const milkTg = randomUUID(); const cheeseTg = randomUUID();
  const prod = (id: string, household_id: string, product: string) => repo.insertProduct({ id, household_id, product, brand: null, variant: null, unit: null, pack_size: null, tags: {}, catalog_key: null, created_at: now() } as never);
  await prod(milkWeb, web.household_id, 'молоко'); await prod(milkTg, tg.household_id, 'молоко'); await prod(cheeseTg, tg.household_id, 'сир');
  await repo.insertBatch(batch(web.household_id, 'молоко', milkWeb));
  await repo.insertBatch(batch(tg.household_id, 'молоко', milkTg));
  await repo.insertBatch(batch(tg.household_id, 'сир', cheeseTg));
  await repo.saveRecipe(recipe(tg.user_id, 'Сирники'));
  await repo.insertShoppingItem(shopping(tg.household_id, 'хліб'));
  await repo.getOrCreateSessionForDay(tg.user_id, '2026-09-15');
  return { repo, web, tg, milkWeb, cheeseTg };
}

describe('pendingConflict', () => {
  it('без доведення — null; після конфлікту link-token — опис чужого дому', async () => {
    const { repo, web, tg } = await seed();
    expect(await pendingConflict(repo, web.user_id)).toBeNull();
    await repo.saveTelegramLinkToken({ token: 't1', user_id: web.user_id, expires_at: new Date(Date.now() + 900_000).toISOString(), consumed_at: now() });
    await repo.setTelegramLinkConflict('t1', tg.user_id);
    const c = await pendingConflict(repo, web.user_id);
    expect(c).toMatchObject({ kind: 'telegram', from_user_id: tg.user_id, pantry_count: 2, recipe_count: 1, sole_member: true });
    expect(c!.household_name).toContain('Яна');
  });
  it('доведення старше 15 хв — не рахується', async () => {
    const { repo, web, tg } = await seed();
    await repo.saveTelegramLinkToken({ token: 't2', user_id: web.user_id, expires_at: now(), consumed_at: new Date(Date.now() - 16 * 60_000).toISOString() });
    await repo.setTelegramLinkConflict('t2', tg.user_id);
    expect(await pendingConflict(repo, web.user_id)).toBeNull();
  });
});

describe('mergeAccount', () => {
  async function prove(repo: InMemoryRepo, user_id: string, from: string) {
    const token = randomUUID();
    await repo.saveTelegramLinkToken({ token, user_id, expires_at: new Date(Date.now() + 900_000).toISOString(), consumed_at: now() });
    await repo.setTelegramLinkConflict(token, from);
  }
  it('без доведення — no_proof; доведення на іншого — теж', async () => {
    const { repo, web, tg } = await seed();
    expect(await mergeAccount(repo, web.user_id, tg.user_id)).toMatchObject({ ok: false, reason: 'no_proof' });
    const stranger = await signInWithVerifiedEmail(repo, 'x@example.com', 'X');
    await prove(repo, web.user_id, stranger.user_id);
    expect(await mergeAccount(repo, web.user_id, tg.user_id)).toMatchObject({ ok: false, reason: 'no_proof' });
  });
  it('у домі from ще хтось — not_sole_member з назвою дому', async () => {
    const { repo, web, tg } = await seed();
    const other = await signInWithVerifiedEmail(repo, 'o@example.com', 'O');
    await repo.addMember(tg.household_id, other.user_id, 'member');
    await prove(repo, web.user_id, tg.user_id);
    const r = await mergeAccount(repo, web.user_id, tg.user_id);
    expect(r).toMatchObject({ ok: false, reason: 'not_sole_member' });
    expect((r as { household_name?: string }).household_name).toContain('Яна');
    expect(await repo.getUser(tg.user_id)).not.toBeNull();
  });
  it('успіх: усе переїхало, продукти злились за трійкою, Telegram на web-акаунті, дубль зник, доведення знято', async () => {
    const { repo, web, tg, milkWeb, cheeseTg } = await seed();
    await prove(repo, web.user_id, tg.user_id);
    const r = await mergeAccount(repo, web.user_id, tg.user_id);
    expect(r).toMatchObject({ ok: true, kind: 'telegram', stats: { batches: 2, recipes: 1 } });
    const batches = await repo.listBatches(web.household_id);
    expect(batches).toHaveLength(3);
    // Молоко з дубля перевішено на продукт web-дому, сир — переїхав як продукт.
    expect(batches.filter((b) => b.label === 'молоко').every((b) => b.product_id === milkWeb)).toBe(true);
    expect(batches.find((b) => b.label === 'сир')!.product_id).toBe(cheeseTg);
    const products = await repo.listProducts(web.household_id);
    expect(products.map((p) => p.product).sort()).toEqual(['молоко', 'сир']);
    expect((await repo.listRecipes(web.user_id)).map((x) => x.title)).toContain('Сирники');
    expect((await repo.listShoppingItems(web.household_id)).map((s) => s.label)).toContain('хліб');
    expect((await repo.listSessionsForUser(web.user_id)).length).toBeGreaterThanOrEqual(1);
    expect((await repo.getUserByTelegramId(777))!.id).toBe(web.user_id);
    expect(await repo.getUser(tg.user_id)).toBeNull();
    expect(await repo.getHousehold(tg.household_id)).toBeNull();
    expect(await pendingConflict(repo, web.user_id)).toBeNull();
    // Повторно — нема ні доведення, ні акаунта.
    expect(await mergeAccount(repo, web.user_id, tg.user_id)).toMatchObject({ ok: false });
  });
  // Дефект зі стенду (15.09): пошта дубля зникала після злиття — і магік-лінк
  // на неї народжував НОВИЙ порожній акаунт, той самий дубль, який лікуємо.
  it('пошта: у поточного її нема — переїжджає з дубля (email_moved), магік-лінк на неї веде в поточний акаунт', async () => {
    const repo = new InMemoryRepo();
    const tgOnly = await signInWithTelegram(repo, { telegram_user_id: 900, chat_id: 900, first_name: 'Т' });
    const withMail = await signInWithVerifiedEmail(repo, 'dev@local.test', 'Д');
    const token = randomUUID();
    await repo.saveChallenge({ id: randomUUID(), email: 'dev@local.test', kind: 'email', user_id: tgOnly.user_id, token_hash: token, created_at: now(), expires_at: now(), consumed_at: now(), ip: null, user_agent: null, conflict_user_id: withMail.user_id });
    const r = await mergeAccount(repo, tgOnly.user_id, withMail.user_id);
    expect(r).toMatchObject({ ok: true, kind: 'email', stats: { email_moved: true } });
    expect((await repo.getUser(tgOnly.user_id))!.email).toBe('dev@local.test');
    expect((await repo.findUserByEmail('dev@local.test'))!.id).toBe(tgOnly.user_id);
    const again = await signInWithVerifiedEmail(repo, 'dev@local.test', 'Д');
    expect(again.user_id).toBe(tgOnly.user_id);
  });
  it('пошта: у поточного своя — лишається своя, пошта дубля звільняється (email_moved=false)', async () => {
    const { repo, web } = await seed();
    const dup = await signInWithVerifiedEmail(repo, 'dup@example.com', 'Д');
    await prove(repo, web.user_id, dup.user_id);
    const r = await mergeAccount(repo, web.user_id, dup.user_id);
    expect(r).toMatchObject({ ok: true, stats: { email_moved: false } });
    expect((await repo.getUser(web.user_id))!.email).toBe('yana@example.com');
    expect(await repo.findUserByEmail('dup@example.com')).toBeNull();
  });
  it('сесії дубля відкликано', async () => {
    const { repo, web, tg } = await seed();
    await prove(repo, web.user_id, tg.user_id);
    const cookie = tg.raw_cookie;
    await mergeAccount(repo, web.user_id, tg.user_id);
    const { resolveSession } = await import('../auth.js');
    expect(await resolveSession(repo, cookie)).toBeNull();
  });
});
