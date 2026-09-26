// ingestProviderEvent — «подія → дім або намір» (спек §9.2). Довіра вже
// встановлена вище; тут перевіряється лише маршрутизація й запис.
import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '@kitchen/domain';
import { ingestProviderEvent } from '../src/billing/ingest.js';

const NOW = new Date('2026-10-05T10:00:00.000Z');
const log = { warn: vi.fn() };

const sub = (household_id: string, order_id: string, over: Record<string, unknown> = {}) => ({
  household_id, state: 'trial', plan: 'self', trial_used_at: '2026-10-01T00:00:00.000Z',
  trial_ends_at: '2026-10-15T00:00:00.000Z', next_charge_at: '2026-10-15T00:00:00.000Z',
  access_until: null, provider_order_id: order_id, card_mask: '4242', card_token: null, paid_by_user_id: null,
  deletion_warned_at: null, trial_mail_sent_at: null, updated_at: NOW.toISOString(), ...over,
}) as never;

const intent = (order_id: string, over: Record<string, unknown> = {}) => ({
  order_id, plan: 'home' as const, state: 'pending' as const, trial_ends_at: '2026-10-19T00:00:00.000Z',
  card_mask: null, card_token: null, provider_invoice_id: null, household_id: null, ip: null, created_at: '2026-10-05T00:00:00.000Z',
  expires_at: '2026-10-12T00:00:00.000Z', bound_at: null, ...over,
});

describe('ingestProviderEvent', () => {
  it('дім + success → active і записаний платіж', async () => {
    const repo = new InMemoryRepo();
    const { household_id } = await repo.createUserWithHousehold('h@x.test', 'H');
    await repo.saveSubscription(sub(household_id, 'ord-1'));
    const r = await ingestProviderEvent(repo, { kind: 'success', order_id: 'ord-1', amount: 210, fee: null, provider_payment_id: 'p1' }, NOW, log);
    expect(r).toEqual({ target: 'household', state: 'active' });
    expect(await repo.listPayments(household_id)).toHaveLength(1);
  });

  // Вебхук не знає дати пробного — вона вже лежить у підписці з checkout.
  it('дім + subscribed без дати в події → дата береться з підписки', async () => {
    const repo = new InMemoryRepo();
    const { household_id } = await repo.createUserWithHousehold('h2@x.test', 'H');
    await repo.saveSubscription(sub(household_id, 'ord-2', { state: 'lapsed' }));
    const r = await ingestProviderEvent(repo, { kind: 'subscribed', order_id: 'ord-2', card_mask: '1111' , card_token: null}, NOW, log);
    expect(r).toEqual({ target: 'household', state: 'trial' });
    const after = await repo.getSubscription(household_id);
    expect(after?.trial_ends_at).toBe('2026-10-15T00:00:00.000Z');
    expect(after?.card_mask).toBe('1111');
  });

  it('намір + subscribed → намір позначено, маска збережена', async () => {
    const repo = new InMemoryRepo();
    const order_id = randomUUID();
    await repo.insertIntent(intent(order_id));
    const r = await ingestProviderEvent(repo, { kind: 'subscribed', order_id, card_mask: '9999', card_token: null }, NOW, log);
    expect(r).toEqual({ target: 'intent', state: 'subscribed' });
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed', card_mask: '9999' });
  });

  it('намір + unsubscribed → expired', async () => {
    const repo = new InMemoryRepo();
    const order_id = randomUUID();
    await repo.insertIntent(intent(order_id, { state: 'subscribed' }));
    expect(await ingestProviderEvent(repo, { kind: 'unsubscribed', order_id }, NOW, log)).toEqual({ target: 'intent', state: 'expired' });
  });

  it('намір + success — «не може бути»: нічого не пишемо, лишаємо слід у лозі', async () => {
    const repo = new InMemoryRepo();
    const order_id = randomUUID();
    await repo.insertIntent(intent(order_id, { state: 'subscribed' }));
    log.warn.mockClear();
    const r = await ingestProviderEvent(repo, { kind: 'success', order_id, amount: 210, fee: null, provider_payment_id: 'p9' }, NOW, log);
    expect(r).toEqual({ target: 'none', reason: 'no_household_for_money' });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed' });
  });

  it('невідомий order — нічого', async () => {
    const repo = new InMemoryRepo();
    expect(await ingestProviderEvent(repo, { kind: 'failure', order_id: 'нема' }, NOW, log)).toEqual({ target: 'none', reason: 'unknown_order' });
  });
});

// mono: токен приходить тією самою подією, що й маска. Для наміру він мусить
// лягти в намір (звідти його візьме bind), для дому — в підписку.
describe('ingestProviderEvent · card_token', () => {
  it('намір отримує токен разом із маскою', async () => {
    const repo = new InMemoryRepo();
    const order_id = randomUUID();
    await repo.insertIntent({
      order_id, plan: 'home', state: 'pending', trial_ends_at: '2026-10-19T00:00:00.000Z',
      card_mask: null, card_token: null, provider_invoice_id: null, household_id: null, ip: null,
      created_at: '2026-10-01T00:00:00.000Z', expires_at: '2026-10-08T00:00:00.000Z', bound_at: null,
    });
    await ingestProviderEvent(repo, { kind: 'subscribed', order_id, card_mask: '4242', card_token: 'tok-7' }, NOW, log);
    expect(await repo.getIntent(order_id)).toMatchObject({ state: 'subscribed', card_token: 'tok-7' });
  });

  it('дім отримує токен; подія без токена старий не затирає', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('tok@x.test', 'T');
    await repo.saveSubscription({
      household_id, state: 'lapsed', plan: 'home', trial_used_at: null, trial_ends_at: null,
      next_charge_at: null, access_until: null, provider_order_id: 'ord-tok', card_mask: null,
      card_token: null, paid_by_user_id: user_id, deletion_warned_at: null, trial_mail_sent_at: null,
      updated_at: NOW.toISOString(),
    });
    await ingestProviderEvent(repo, { kind: 'subscribed', order_id: 'ord-tok', card_mask: '4242', card_token: 'tok-8' }, NOW, log);
    expect((await repo.getSubscription(household_id))?.card_token).toBe('tok-8');

    await ingestProviderEvent(repo, { kind: 'subscribed', order_id: 'ord-tok', card_mask: null, card_token: null }, NOW, log);
    expect((await repo.getSubscription(household_id))?.card_token).toBe('tok-8');
  });
});

// Повторна доставка вебхука. Не гіпотеза: mono бʼє до 3 спроб, поки не
// побачить 200, а порядок доставки в них не гарантований — це написано в їхній
// же документації. Обидва випадки нижче були справжніми й коштували грошей.
describe('ingestProviderEvent · повтори й запізнілі події', () => {
  const paid = async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold(`${randomUUID()}@x.test`, 'R');
    await repo.saveSubscription({
      household_id, state: 'trial', plan: 'home', trial_used_at: '2026-10-01T00:00:00.000Z',
      trial_ends_at: '2026-10-15T00:00:00.000Z', next_charge_at: '2026-10-15T00:00:00.000Z',
      access_until: null, provider_order_id: 'ord-r', card_mask: '1902', card_token: 'tok-r',
      paid_by_user_id: user_id, deletion_warned_at: null, trial_mail_sent_at: null,
      updated_at: '2026-10-01T00:00:00.000Z',
    });
    return { repo, household_id };
  };
  const success = (provider_payment_id: string) =>
    ({ kind: 'success' as const, order_id: 'ord-r', amount: 290, fee: null, provider_payment_id });

  it('той самий invoiceId удруге не зсуває дату списання', async () => {
    const { repo, household_id } = await paid();
    await ingestProviderEvent(repo, success('inv-1'), NOW, log);
    const first = (await repo.getSubscription(household_id))!.next_charge_at;
    const again = await ingestProviderEvent(repo, success('inv-1'), NOW, log);

    // Інакше загублена відповідь на вебхук дарувала б місяць: платіж один,
    // а місяців два.
    expect((await repo.getSubscription(household_id))!.next_charge_at).toBe(first);
    expect(await repo.listPayments(household_id)).toHaveLength(1);
    expect(again).toEqual({ target: 'household', state: 'active' });
  });

  it('наступне списання (інший invoiceId) дату таки зсуває', async () => {
    const { repo, household_id } = await paid();
    await ingestProviderEvent(repo, success('inv-1'), NOW, log);
    const first = (await repo.getSubscription(household_id))!.next_charge_at;
    await ingestProviderEvent(repo, success('inv-2'), NOW, log);
    expect((await repo.getSubscription(household_id))!.next_charge_at).not.toBe(first);
    expect(await repo.listPayments(household_id)).toHaveLength(2);
  });

  it('запізнілий subscribed із тим самим токеном не скидає оплачену підписку в пробну', async () => {
    const { repo, household_id } = await paid();
    await ingestProviderEvent(repo, success('inv-1'), NOW, log);
    const active = (await repo.getSubscription(household_id))!;

    await ingestProviderEvent(repo, { kind: 'subscribed', order_id: 'ord-r', card_mask: '1902', card_token: 'tok-r' }, NOW, log);

    const after = (await repo.getSubscription(household_id))!;
    expect(after.state).toBe(active.state);
    expect(after.next_charge_at).toBe(active.next_charge_at);
    // Заразом не стирається слід листа — інакше він пішов би вдруге.
    expect(after.trial_mail_sent_at).toBe(active.trial_mail_sent_at);
  });

  it('але НОВА картка на тому самому замовленні застосовується', async () => {
    const { repo, household_id } = await paid();
    await ingestProviderEvent(repo, { kind: 'subscribed', order_id: 'ord-r', card_mask: '7777', card_token: 'tok-новий' }, NOW, log);
    expect(await repo.getSubscription(household_id)).toMatchObject({ card_token: 'tok-новий', card_mask: '7777' });
  });
});

// Комісія приходить пізніше за сам платіж: крон пише рядок одразу після
// синхронного списання, а fee mono називає лише у вебхуку — і той вебхук за
// ідемпотентністю нового рядка вже не створить.
describe('ingestProviderEvent · комісія доживає до бази', () => {
  it('вебхук дописує fee рядку, який поклав крон', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('fee-late@x.test', 'F');
    await repo.saveSubscription({
      household_id, state: 'trial', plan: 'home', trial_used_at: null,
      trial_ends_at: '2026-10-15T00:00:00.000Z', next_charge_at: '2026-10-15T00:00:00.000Z',
      access_until: null, provider_order_id: 'ord-f', card_mask: '42', card_token: 'tok-f',
      paid_by_user_id: user_id, deletion_warned_at: null, trial_mail_sent_at: null,
      updated_at: NOW.toISOString(),
    });

    // 1. Крон: списав, комісії ще не знає.
    await ingestProviderEvent(repo, { kind: 'success', order_id: 'ord-f', amount: 290, fee: null, provider_payment_id: 'inv-f' }, NOW, log);
    expect((await repo.listPayments(household_id))[0]).toMatchObject({ amount: 290, fee: null });

    // 2. Вебхук про те саме списання: новий рядок не створює, але fee приносить.
    await ingestProviderEvent(repo, { kind: 'success', order_id: 'ord-f', amount: 290, fee: 3.77, provider_payment_id: 'inv-f' }, NOW, log);
    const rows = await repo.listPayments(household_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fee: 3.77 });
  });

  it('повтор без комісії вже відому не стирає', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('fee-keep@x.test', 'F');
    await repo.saveSubscription({
      household_id, state: 'trial', plan: 'home', trial_used_at: null,
      trial_ends_at: '2026-10-15T00:00:00.000Z', next_charge_at: '2026-10-15T00:00:00.000Z',
      access_until: null, provider_order_id: 'ord-k', card_mask: '42', card_token: 'tok-k',
      paid_by_user_id: user_id, deletion_warned_at: null, trial_mail_sent_at: null,
      updated_at: NOW.toISOString(),
    });
    await ingestProviderEvent(repo, { kind: 'success', order_id: 'ord-k', amount: 290, fee: 3.77, provider_payment_id: 'inv-k' }, NOW, log);
    await ingestProviderEvent(repo, { kind: 'success', order_id: 'ord-k', amount: 290, fee: null, provider_payment_id: 'inv-k' }, NOW, log);
    expect((await repo.listPayments(household_id))[0]).toMatchObject({ fee: 3.77 });
  });
});

