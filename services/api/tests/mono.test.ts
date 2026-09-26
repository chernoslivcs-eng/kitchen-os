// Адаптер monobank (план mono, задача 2). Мережі тут немає: fetch підмінений,
// підпис справжній — пара ключів P-256 народжується в самому тесті.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { MonoProvider, monoPubKey, monoVerify, monoToEvent, __resetPubKeyCache } from '../src/billing/mono.js';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = keys.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const sign = (raw: Buffer) => createSign('SHA256').update(raw).sign(keys.privateKey).toString('base64');

// Відповідь mono: 200 з тілом. Помилки mono теж віддає статусом, тому
// адаптер дивиться на ok, а не лише на наявність полів.
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const errJson = (status: number, body: unknown) => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) });

describe('MonoProvider · checkoutUrl', () => {
  it('інвойс на 0 ₴ зі збереженням картки, reference = order_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ invoiceId: 'inv-1', pageUrl: 'https://pay.mbnk.biz/inv-1' }));
    const p = new MonoProvider('tok', 'https://app.test/v1/billing/mono', { fetchImpl: fetchImpl as never });
    const r = await p.checkoutUrl({
      order_id: 'ord-1', household_id: 'h1', plan: 'home', amount: 290,
      wallet_id: 'h1', result_url: 'https://app.test/ok',
    });
    // invoiceId віддаємо разом із адресою: без нього не інвалідувати рахунок,
    // коли людина відкриє оплату заново (див. /renew).
    expect(r).toEqual({ url: 'https://pay.mbnk.biz/inv-1', invoice_id: 'inv-1' });

    const [u, init] = fetchImpl.mock.calls[0]!;
    expect(u).toBe('https://api.monobank.ua/api/merchant/invoice/create');
    expect((init as { headers: Record<string, string> }).headers['X-Token']).toBe('tok');
    const body = JSON.parse((init as { body: string }).body);
    // Нуль — і саме нуль: будь-яка інша сума означала б списання з людини,
    // якої вона не просила.
    expect(body.amount).toBe(0);
    expect(body.ccy).toBe(980);
    expect(body.saveCardData).toEqual({ saveCard: true, walletId: 'h1' });
    expect(body.merchantPaymInfo.reference).toBe('ord-1');
    expect(body.webHookUrl).toBe('https://app.test/v1/billing/mono');
    expect(body.redirectUrl).toBe('https://app.test/ok');
    // verification немає в публічній OpenAPI, але є в бекенді — підтвердила
    // підтримка mono 26.09. Саме він дозволяє нульову суму.
    expect(body.paymentType).toBe('verification');
    // Доба, не година: намір живе 7 днів, і людина, яка повернулась увечері, не
    // мусить натикатись на мертву сторінку (перевірено живцем 26.09).
    expect(body.validity).toBe(86_400);
    // Доба, не година: намір живе 7 днів, і людина, яка повернулась увечері,
    // не мусить натикатись на мертву сторінку (перевірено живцем 26.09).
    expect(body.validity).toBe(86_400);
  });

  it('mono відповів помилкою — кидаємо, а не віддаємо порожнє посилання', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errJson(400, { errCode: 'BAD', errText: 'невірний параметр' }));
    const p = new MonoProvider('tok', 'https://app.test/v1/billing/mono', { fetchImpl: fetchImpl as never });
    await expect(p.checkoutUrl({
      order_id: 'o', household_id: null, plan: 'self', amount: 210,
      wallet_id: 'o', result_url: 'https://app.test/ok',
    })).rejects.toThrow(/BAD|невірний/);
  });
});

// Запасний шлях на випадок, якщо verification колись відмовить. Перевіряємо,
// бо неперевірений запас — не запас, а обіцянка.
describe('MonoProvider · запасний режим hold', () => {
  it('hold шле мінімальну суму й paymentType hold, картку так само зберігає', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ invoiceId: 'inv-h', pageUrl: 'https://pay/h' }));
    const p = new MonoProvider('tok', 'https://app.test/v1/billing/mono', { fetchImpl: fetchImpl as never, verification: 'hold' });
    await p.checkoutUrl({ order_id: 'ord-h', household_id: 'h1', plan: 'self', amount: 210, wallet_id: 'h1', result_url: 'https://app.test/ok' });
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body);
    expect(body).toMatchObject({ paymentType: 'hold', amount: 100, ccy: 980 });
    expect(body.saveCardData).toEqual({ saveCard: true, walletId: 'h1' });
  });

  it('releaseHold скасовує інвойс — інакше гроші висіли б 9 днів', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ status: 'success' }));
    await new MonoProvider('tok', 'https://app.test/v1/billing/mono', { fetchImpl: fetchImpl as never, verification: 'hold' }).releaseHold('inv-h');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.monobank.ua/api/merchant/invoice/cancel');
    expect(JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body)).toEqual({ invoiceId: 'inv-h' });
  });
});

describe('MonoProvider · chargeByToken', () => {
  it('сума в копійках, initiationKind merchant', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ invoiceId: 'inv-9', status: 'success', amount: 21000, ccy: 980 }));
    const p = new MonoProvider('tok', 'https://app.test/v1/billing/mono', { fetchImpl: fetchImpl as never });
    const r = await p.chargeByToken({ card_token: 'tok-c', amount: 210, reference: 'ord-1' });
    expect(r).toEqual({ provider_payment_id: 'inv-9', status: 'success' });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.monobank.ua/api/merchant/wallet/payment');
    expect(body).toMatchObject({ cardToken: 'tok-c', amount: 21000, ccy: 980, initiationKind: 'merchant', webHookUrl: 'https://app.test/v1/billing/mono' });
    expect(body.merchantPaymInfo.reference).toBe('ord-1');
  });

  it('три статуси відповіді проходять як є', async () => {
    for (const status of ['success', 'failure', 'processing'] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(okJson({ invoiceId: 'i', status }));
      const p = new MonoProvider('tok', 'https://app.test/v1/billing/mono', { fetchImpl: fetchImpl as never });
      expect((await p.chargeByToken({ card_token: 'c', amount: 1, reference: 'r' })).status).toBe(status);
    }
  });
});

describe('MonoProvider · deleteToken', () => {
  it('DELETE із токеном у query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({}));
    await new MonoProvider('tok', 'https://app.test/v1/billing/mono', { fetchImpl: fetchImpl as never }).deleteToken('a b/c');
    const [u, init] = fetchImpl.mock.calls[0]!;
    expect(u).toBe('https://api.monobank.ua/api/merchant/wallet/card?cardToken=a%20b%2Fc');
    expect((init as { method: string }).method).toBe('DELETE');
  });
});

describe('monoVerify', () => {
  const raw = Buffer.from('{"invoiceId":"p2_9Zgp","status":"success","amount":0,"ccy":980}');
  it('справжній підпис — true', () => expect(monoVerify(PEM, raw, sign(raw))).toBe(true));
  it('тіло підмінили — false', () => expect(monoVerify(PEM, Buffer.from('{"invoiceId":"інший"}'), sign(raw))).toBe(false));
  it('сміття замість підпису — false, а не виняток', () => expect(monoVerify(PEM, raw, 'не-підпис')).toBe(false));
  it('порожній підпис — false', () => expect(monoVerify(PEM, raw, '')).toBe(false));
});

describe('monoPubKey', () => {
  beforeEach(() => __resetPubKeyCache());
  it('base64 з {key} розгортається в PEM', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ key: Buffer.from(PEM).toString('base64') }));
    expect(await monoPubKey('tok', fetchImpl as never)).toBe(PEM);
  });
  it('другий виклик не йде в мережу — ключ кешується', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ key: Buffer.from(PEM).toString('base64') }));
    await monoPubKey('tok', fetchImpl as never);
    await monoPubKey('tok', fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('monoToEvent', () => {
  const inv = (over: Record<string, unknown>) => ({ invoiceId: 'inv-1', reference: 'ord-1', ccy: 980, ...over } as never);

  it('успішна верифікація (0 ₴ + токен created) → subscribed з токеном і маскою', () => {
    expect(monoToEvent(inv({
      status: 'success', amount: 0,
      walletData: { walletId: 'h1', cardToken: 'tok-c', status: 'created' },
      paymentInfo: { maskedPan: '444403******1902' },
    }))).toEqual({ kind: 'subscribed', order_id: 'ord-1', card_mask: '1902', card_token: 'tok-c' });
  });

  it('успішне списання (сума > 0) → success із сумою в гривнях', () => {
    expect(monoToEvent(inv({ status: 'success', amount: 21000 })))
      .toEqual({ kind: 'success', order_id: 'ord-1', amount: 210, fee: null, provider_payment_id: 'inv-1' });
  });

  it('невдале списання → failure', () => {
    expect(monoToEvent(inv({ status: 'failure', amount: 21000 }))).toEqual({ kind: 'failure', order_id: 'ord-1' });
  });

  it('картка не пройшла верифікацію → unsubscribed: підписки так і не стало', () => {
    expect(monoToEvent(inv({ status: 'failure', amount: 0 }))).toEqual({ kind: 'unsubscribed', order_id: 'ord-1' });
  });

  it('hold-верифікація (сума > 0, але є walletData) → subscribed, не списання', () => {
    expect(monoToEvent(inv({
      status: 'success', amount: 100,
      walletData: { walletId: 'h1', cardToken: 'tok-h', status: 'created' },
      paymentInfo: { maskedPan: '444403******1902' },
    }))).toEqual({ kind: 'subscribed', order_id: 'ord-1', card_mask: '1902', card_token: 'tok-h' });
  });

  it('hold-верифікація не пройшла → unsubscribed, а не failure списання', () => {
    expect(monoToEvent(inv({ status: 'failure', amount: 100, walletData: { walletId: 'h1', cardToken: 'c', status: 'failed' } })))
      .toEqual({ kind: 'unsubscribed', order_id: 'ord-1' });
  });

  it('проміжні статуси — null', () => {
    for (const status of ['created', 'processing', 'hold', 'reversed', 'expired']) {
      expect(monoToEvent(inv({ status, amount: 21000 }))).toBeNull();
    }
  });

  it('успіх на 0 ₴, але токен не створився — не subscribed', () => {
    expect(monoToEvent(inv({ status: 'success', amount: 0, walletData: { walletId: 'h', cardToken: 'c', status: 'failed' } }))).toBeNull();
  });

  it('без reference події немає: нема чого шукати ні дім, ні намір', () => {
    expect(monoToEvent({ invoiceId: 'i', status: 'success', amount: 21000, ccy: 980 } as never)).toBeNull();
  });
});
