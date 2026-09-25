// LiqPay-адаптер (спек біллінгу §3). Ключів тут немає й не треба: підпис
// самоузгоджений, мережа — стаб.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { liqpayEncode, liqpaySign, liqpayVerify, liqpayToEvent, LiqPayProvider } from '../src/billing/liqpay.js';

const KEY = 'private-key-xyz';
const decode = (data: string) => JSON.parse(Buffer.from(data, 'base64').toString('utf-8')) as Record<string, unknown>;

describe('підпис', () => {
  it('base64(sha1(key + data + key)) — той самий, що рахує crypto напряму', () => {
    const data = liqpayEncode({ a: 1, b: 'два' });
    const want = createHash('sha1').update(KEY + data + KEY).digest('base64');
    expect(liqpaySign(KEY, data)).toBe(want);
    expect(liqpayVerify(KEY, data, want)).toBe(true);
  });
  it('зіпсований підпис і чужий ключ — false, без винятку на різній довжині', () => {
    const data = liqpayEncode({ a: 1 });
    expect(liqpayVerify(KEY, data, liqpaySign('інший', data))).toBe(false);
    expect(liqpayVerify(KEY, data, 'коротко')).toBe(false);
    expect(liqpayVerify(KEY, data, '')).toBe(false);
  });
});

describe('liqpayToEvent — мапінг статусів', () => {
  it('subscribed → подія з маскою картки', () => {
    expect(liqpayToEvent({ status: 'subscribed', order_id: 'o1', sender_card_mask2: '424242****4242' }))
      .toEqual({ kind: 'subscribed', order_id: 'o1', card_mask: '424242****4242' , card_token: null});
  });
  it('success → сума й id платежу рядком/числом', () => {
    expect(liqpayToEvent({ status: 'success', order_id: 'o2', amount: '210.00', payment_id: 98765 }))
      .toEqual({ kind: 'success', order_id: 'o2', amount: 210, provider_payment_id: '98765' });
  });
  it.each(['failure', 'error'])('%s → failure', (status) => {
    expect(liqpayToEvent({ status, order_id: 'o3' })).toEqual({ kind: 'failure', order_id: 'o3' });
  });
  it('unsubscribed → unsubscribed', () => {
    expect(liqpayToEvent({ status: 'unsubscribed', order_id: 'o4' })).toEqual({ kind: 'unsubscribed', order_id: 'o4' });
  });
  it.each(['3ds_verify', 'otp_verify', 'cvv_verify', 'wait_secure', 'wait_accept', 'reversed', 'хтозна-що'])(
    '%s → нічого (ще не результат)', (status) => {
      expect(liqpayToEvent({ status, order_id: 'o5' })).toBeNull();
    });
  it('без order_id — нічого, навіть якщо статус відомий', () => {
    expect(liqpayToEvent({ status: 'success', amount: 1, payment_id: 1 })).toBeNull();
  });
});

describe('LiqPayProvider', () => {
  const provider = (fetchImpl = vi.fn(async () => new Response('{"result":"ok"}'))) =>
    ({ p: new LiqPayProvider({ publicKey: 'pub', privateKey: KEY }, 'https://app.test/v1/billing/liqpay', fetchImpl as never), fetchImpl });

  it('checkoutUrl: data + signature, action subscribe, дата в форматі LiqPay', async () => {
    const { p } = provider();
    const url = new URL(await p.checkoutUrl({
      order_id: 'ord-1', household_id: null, plan: 'home', amount: 290,
      date_start: '2026-10-15T12:00:00.000Z', result_url: 'https://app.test/?intent=ord-1',
    }));
    expect(url.origin + url.pathname).toBe('https://www.liqpay.ua/api/3/checkout');
    const data = url.searchParams.get('data')!;
    expect(liqpayVerify(KEY, data, url.searchParams.get('signature')!)).toBe(true);
    expect(decode(data)).toMatchObject({
      version: 3, public_key: 'pub', action: 'subscribe', amount: 290, currency: 'UAH',
      order_id: 'ord-1', subscribe_date_start: '2026-10-15 12:00:00', subscribe_periodicity: 'month',
      server_url: 'https://app.test/v1/billing/liqpay', language: 'uk',
    });
    expect(String(decode(data).description)).toContain('Для дому');
  });

  it('unsubscribe і subscribe_update — POST на api/request із підписаним тілом', async () => {
    const { p, fetchImpl } = provider();
    await p.unsubscribe('ord-2');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; body: URLSearchParams }];
    expect(url).toBe('https://www.liqpay.ua/api/request');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(decode(body.get('data')!)).toMatchObject({ action: 'unsubscribe', order_id: 'ord-2' });
    expect(liqpayVerify(KEY, body.get('data')!, body.get('signature')!)).toBe(true);

    await p.updateAmount('ord-3', 210);
    const [, init2] = fetchImpl.mock.calls[1] as unknown as [string, { body: URLSearchParams }];
    expect(decode(new URLSearchParams(String(init2.body)).get('data')!)).toMatchObject({ action: 'subscribe_update', order_id: 'ord-3', amount: 210 });
  });

  it('провайдер відповів помилкою — кидаємо, а не мовчимо', async () => {
    const { p } = provider(vi.fn(async () => new Response('{"result":"error","err_code":"payment_err"}', { status: 200 })));
    await expect(p.unsubscribe('ord-4')).rejects.toThrow(/payment_err/);
  });
});
