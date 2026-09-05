import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard, undoCard, type PantryBatch, type Card } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Раунд 5, крок Ф1: GET /v1/pantry віддає поля для фільтра — cat, БЖВ, days,
// receipt (лише останній чек), no (як ⚠ у промпті), added; нічого не пише.

async function stand() {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer);
  await app.ready();
  const me = await signIn(app, mailer, 'filter@example.com');
  return { repo, app, me };
}
const batch = (household_id: string, label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: randomUUID(), household_id, catalog_key: null, label, zone: 'fridge', value: 500, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null, ...over,
} as PantryBatch);
type Row = PantryBatch & { cat: string | null; kcal: number | null; est: boolean | null; days: number | null; receipt: boolean; no: string | null; added: number };

describe('GET /v1/pantry — поля фільтра', () => {
  it('cat, days, no, added серіалізуються; без каталогу — null', async () => {
    const { repo, app, me } = await stand();
    await repo.patchProfileField(me.user_id, 'no', { text: 'мʼяса' });
    await repo.setVetoIndex(me.user_id, 'no', (await import('@kitchen/domain')).buildVetoIndex(me.user_id, 'no', 'мʼяса'));
    await repo.insertBatch(batch(me.household_id, 'Куряче філе', { catalog_key: 'chicken_fillet', expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }));
    await repo.insertBatch(batch(me.household_id, 'Пармезан', { catalog_key: 'parmesan', zone: 'fridge' }));
    await repo.insertBatch(batch(me.household_id, 'Невідоме xyz', { zone: 'dry' }));
    const res = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { batches: Row[]; last_receipt_at: string | null };
    const by = (l: string) => body.batches.find((b) => b.label === l)!;
    expect(by('Куряче філе')).toMatchObject({ cat: 'мʼясо', days: 2, no: 'не їм', receipt: false, added: 3, est: false });
    expect(by('Пармезан')).toMatchObject({ cat: 'сири', days: null, no: null, receipt: false });
    expect(by('Невідоме xyz')).toMatchObject({ cat: null, kcal: null, est: null, days: null, no: null });
    expect(body.last_receipt_at).toBeNull();
  });

  it('receipt — лише партії з ОСТАННЬОГО застосованого чека; скасований чек не рахується', async () => {
    const { repo, app, me } = await stand();
    const receiptCard = (label: string, at: string): Card => ({
      type: 'intake_diff', ops: [{ op: 'add', label, value: 1, unit: 'pcs', zone: 'fridge' }],
      source: { kind: 'chat_receipt', at },
    } as Card);
    const apply = async (card: Card) => {
      const id = randomUUID();
      await createPending(repo, { message_id: id, household_id: me.household_id, user_id: me.user_id, card });
      return { id, r: await applyCard(repo, id, [], me.user_id) };
    };
    // звичайна картка без чека
    await apply({ type: 'intake_diff', ops: [{ op: 'add', label: 'Молоко', value: 1, unit: 'pcs', zone: 'fridge' }] } as Card);
    // перший чек
    await apply(receiptCard('Хліб', '2026-09-01T10:00:00.000Z'));
    // другий чек — останній
    const second = await apply(receiptCard('Сир', '2026-09-03T10:00:00.000Z'));
    // третій чек застосовано й скасовано — не рахується
    const third = await apply(receiptCard('Йогурт', '2026-09-05T10:00:00.000Z'));
    await undoCard(repo, third.id, third.r.undo_token, me.user_id);

    const body = (await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } })).json() as { batches: Row[]; last_receipt_at: string | null };
    const receipts = body.batches.filter((b) => b.receipt).map((b) => b.label);
    expect(receipts).toEqual(['Сир']);
    expect(body.last_receipt_at).toBe('2026-09-03T10:00:00.000Z');
    void second;
  });
});
