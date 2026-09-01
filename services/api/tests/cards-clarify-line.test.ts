// 01.09 картка v2: уніфікація чека — «уточнити» на невпізнаному рядку
// (степер + одиниця, тап «ок») переносить його з source.unmatched у ops,
// тим самим шляхом, що впізнане каталогом. Рахується в те саме
// «Застосувати N», без окремого потоку «додати руками».

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';

describe('POST /v1/cards/:id/clarify-line', () => {
  it('переносить невпізнаний рядок у ops зі значенням/одиницею від людини', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');

    const card_id = randomUUID();
    await createPending(repo, {
      message_id: card_id, household_id: me.household_id, user_id: me.user_id,
      card: {
        type: 'intake_diff',
        ops: [{ op: 'add', label: 'молоко 2,5%', value: 1, unit: 'pcs', confidence: 1, evidence: 'receipt_line' }],
        source: {
          kind: 'retail_receipt', provider: 'silpo', shop: 'вул. Київська, 10', at: '2026-08-23', total: 1284,
          nonfood: [],
          unmatched: [
            { name: 'Розпалювач Jarrkoff гелевий', quantity: 1, unit: 'шт', price: 89, image: null },
          ],
        },
      },
    });

    const r = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/clarify-line`, headers: { cookie: me.cookie },
      payload: { unmatched_index: 0, value: 1, unit: 'pcs' },
    });
    expect(r.statusCode).toBe(200);
    const { card } = r.json();
    expect(card.source.unmatched).toHaveLength(0);
    expect(card.ops).toHaveLength(2);
    expect(card.ops[1]).toMatchObject({
      op: 'add', label: 'Розпалювач Jarrkoff гелевий', value: 1, unit: 'pcs', evidence: 'user_clarified',
    });

    // Нова позиція рахується в «Застосувати N» — ідемо тим самим шляхом apply.
    const applied = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/apply`, headers: { cookie: me.cookie }, payload: {},
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(2);
    const batches = await repo.listBatches(me.household_id);
    expect(batches.map((b) => b.label)).toEqual(expect.arrayContaining(['молоко 2,5%', 'Розпалювач Jarrkoff гелевий']));
  });

  it('чужа картка — 403', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const owner = await signIn(app, mailer, 'owner@example.com');
    const other = await signIn(app, mailer, 'other@example.com');

    const card_id = randomUUID();
    await createPending(repo, {
      message_id: card_id, household_id: owner.household_id, user_id: owner.user_id,
      card: {
        type: 'intake_diff', ops: [],
        source: {
          kind: 'retail_receipt', provider: 'silpo', shop: 'філія', at: '2026-08-23', total: 0,
          nonfood: [], unmatched: [{ name: 'X', quantity: 1, unit: 'шт', price: 1, image: null }],
        },
      },
    });

    const r = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/clarify-line`, headers: { cookie: other.cookie },
      payload: { unmatched_index: 0, value: 1, unit: 'pcs' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('індекс поза межами — 409, нічого не міняється', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');

    const card_id = randomUUID();
    await createPending(repo, {
      message_id: card_id, household_id: me.household_id, user_id: me.user_id,
      card: {
        type: 'intake_diff', ops: [],
        source: {
          kind: 'retail_receipt', provider: 'silpo', shop: 'філія', at: '2026-08-23', total: 0,
          nonfood: [], unmatched: [],
        },
      },
    });

    const r = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/clarify-line`, headers: { cookie: me.cookie },
      payload: { unmatched_index: 0, value: 1, unit: 'pcs' },
    });
    expect(r.statusCode).toBe(409);
  });
});
