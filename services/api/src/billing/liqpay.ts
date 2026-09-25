// LiqPay (спек біллінгу §3): підпис, hosted checkout `subscribe`, серверні
// `unsubscribe`/`subscribe_update` і мапінг колбеку в нашу подію.
//
// Ключі беруться лише з env і живуть у виклику — ні логів, ні полів обʼєкта з
// ними. `private_key` бере участь у підписі з обох боків рядка, тому будь-яке
// його протікання = можливість підробити колбек.
import { createHash, timingSafeEqual } from 'node:crypto';
import { PLAN_NAME } from '@kitchen/domain/plans';
import type { BillingProvider, CheckoutInput } from './provider.js';
import type { InboundProviderEvent } from './ingest.js';

const CHECKOUT_URL = 'https://www.liqpay.ua/api/3/checkout';
const REQUEST_URL = 'https://www.liqpay.ua/api/request';

export function liqpayEncode(obj: object): string {
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
}

export function liqpaySign(privateKey: string, data: string): string {
  return createHash('sha1').update(privateKey + data + privateKey).digest('base64');
}

/** Порівняння сталого часу: підпис — секрет, і різниця в часі відповіді теж підказка. */
export function liqpayVerify(privateKey: string, data: string, signature: string): boolean {
  const want = Buffer.from(liqpaySign(privateKey, data), 'utf-8');
  const got = Buffer.from(signature ?? '', 'utf-8');
  // timingSafeEqual кидає на різній довжині — довжина підпису не секрет.
  return want.length === got.length && timingSafeEqual(want, got);
}

/** `2026-10-15T12:00:00.000Z` → `2026-10-15 12:00:00` (LiqPay приймає лише таке, UTC). */
function liqpayDate(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Колбек LiqPay → наша подія. Без `household_id`, `plan` і `trial_ends_at`:
 * їх знає лише наша база (див. `ingestProviderEvent`).
 *
 * Усе, що не є результатом (`3ds_verify`, `wait_secure` та ін.), і `reversed`
 * дають `null` — стану вони не міняють.
 */
export function liqpayToEvent(payload: Record<string, unknown>): InboundProviderEvent | null {
  const order_id = typeof payload.order_id === 'string' ? payload.order_id : null;
  if (!order_id) return null;
  switch (payload.status) {
    case 'subscribed':
      return { kind: 'subscribed', order_id, card_mask: typeof payload.sender_card_mask2 === 'string' ? payload.sender_card_mask2 : null };
    case 'success':
      return { kind: 'success', order_id, amount: Number(payload.amount), provider_payment_id: String(payload.payment_id) };
    case 'failure':
    case 'error':
      return { kind: 'failure', order_id };
    case 'unsubscribed':
      return { kind: 'unsubscribed', order_id };
    default:
      return null;
  }
}

export class LiqPayProvider implements BillingProvider {
  constructor(
    private keys: { publicKey: string; privateKey: string },
    private serverUrl: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private signed(params: object): { data: string; signature: string } {
    const data = liqpayEncode({ version: 3, public_key: this.keys.publicKey, ...params });
    return { data, signature: liqpaySign(this.keys.privateKey, data) };
  }

  async checkoutUrl(i: CheckoutInput): Promise<string> {
    const { data, signature } = this.signed({
      action: 'subscribe',
      amount: i.amount,
      currency: 'UAH',
      description: `Kitchen OS · ${PLAN_NAME[i.plan]} · щомісяця`,
      order_id: i.order_id,
      subscribe_date_start: liqpayDate(i.date_start),
      subscribe_periodicity: 'month',
      result_url: i.result_url,
      server_url: this.serverUrl,
      language: 'uk',
    });
    const q = new URLSearchParams({ data, signature });
    return `${CHECKOUT_URL}?${q.toString()}`;
  }

  async unsubscribe(order_id: string): Promise<void> {
    await this.request({ action: 'unsubscribe', order_id });
  }

  async updateAmount(order_id: string, amount: number): Promise<void> {
    await this.request({ action: 'subscribe_update', order_id, amount, currency: 'UAH' });
  }

  private async request(params: object): Promise<void> {
    const { data, signature } = this.signed(params);
    const res = await this.fetchImpl(REQUEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data, signature }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`liqpay ${res.status}: ${text.slice(0, 200)}`);
    // LiqPay відповідає 200 і на помилку — читаємо result, інакше «успішна»
    // відписка мовчки не відбудеться.
    const body = JSON.parse(text) as { result?: string; err_code?: string; err_description?: string };
    if (body.result && body.result !== 'ok') {
      throw new Error(`liqpay: ${body.err_code ?? body.result} ${body.err_description ?? ''}`.trim());
    }
  }
}
