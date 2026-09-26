// Адаптер monobank (план біллінгу mono, задача 2).
//
// Різниця з LiqPay, з якої випливає все інше: у mono немає підписки, яка вміє
// «картку сьогодні, перше списання через 14 днів». Тому картку токенізуємо
// інвойсом, а списує НАШ крон викликом wallet/payment. Підписка живе в нас.
//
// ВАЖЛИВО про `paymentType: 'verification'`. Його немає в публічній OpenAPI
// (`api.monobank.ua/docs/acquiring`, звірено 25.09: enum там рівно debit|hold),
// але він ЄСТЬ у їхньому бекенді — підтверджено підтримкою mono 26.09:
// «можна використовувати paymentType verification, і тоді можна amount: 0;
// якщо hold чи debit — треба мінімальну суму». Тобто документація відстає;
// правда — відповідь підтримки, і типово ми шлемо verification з нулем.
//
// `hold` лишається запасним шляхом (VerificationMode) на випадок, якщо
// verification колись відмовить. УВАГА: перемикання на 'hold' — це не лише
// тіло інвойсу. Холд блокує гроші на 9 днів, тож його треба ще й відпустити
// через `releaseHold()`; сам виклик у вебхук НЕ вплетений, бо шлях запасний.
// Хто перемкне режим, мусить вплести.
//
// Ще дві речі, які легко проґавити:
//   • суми скрізь у копійках — і в invoice/create, і в wallet/payment;
//   • порядок вебхуків не гарантований (success може випередити processing);
//     ідемпотентність тримає ingest, по invoiceId і по токену.
import { createVerify } from 'node:crypto';
import { PLAN_NAME } from '@kitchen/domain/plans';
import type { BillingProvider, CheckoutInput, ChargeInput, ChargeResult } from './provider.js';
import type { InboundProviderEvent } from './ingest.js';

const BASE = 'https://api.monobank.ua';
const CCY_UAH = 980;
/** Скільки живе посилання на оплату картки, секунд. */
const INVOICE_VALIDITY_SEC = 3600;
/** Запасний режим: мінімальна сума холду, гривні. */
const HOLD_UAH_DEFAULT = 1;

type FetchLike = typeof fetch;

/**
 * Чим токенізуємо картку. `verification` — нуль і жодних грошей (типово).
 * `hold` — запас: блокує мінімальну суму, і її треба відпустити releaseHold().
 */
export type VerificationMode = 'verification' | 'hold';

export interface MonoOpts {
  fetchImpl?: FetchLike;
  base?: string;
  verification?: VerificationMode;
  /** Лише для режиму 'hold'. */
  holdUah?: number;
}

/** Статус інвойсу — і відповідь `invoice/status`, і тіло вебхука. */
export interface MonoInvoiceStatus {
  invoiceId: string;
  status: 'created' | 'processing' | 'hold' | 'success' | 'failure' | 'reversed' | 'expired';
  amount: number;
  ccy: number;
  reference?: string;
  failureReason?: string;
  errCode?: string;
  modifiedDate?: string;
  walletData?: { walletId: string; cardToken: string; status: 'new' | 'created' | 'failed' };
  paymentInfo?: { maskedPan?: string };
}

export class MonoProvider implements BillingProvider {
  private fetchImpl: FetchLike;
  private base: string;
  private mode: VerificationMode;
  private holdUah: number;

  // Адресу вебхука тримає сам провайдер, а не той, хто його кличе: інакше
  // крон і маршрути мусили б знати шлях /v1/billing/mono, тобто знати
  // провайдера — рівно те, від чого рятує pick-provider.
  constructor(private token: string, private webhookUrl: string, opts: MonoOpts = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.base = opts.base ?? BASE;
    this.mode = opts.verification ?? 'verification';
    this.holdUah = opts.holdUah ?? HOLD_UAH_DEFAULT;
  }

  async checkoutUrl(i: CheckoutInput): Promise<string> {
    const r = await this.req<{ invoiceId: string; pageUrl: string }>('POST', '/api/merchant/invoice/create', this.verificationInvoice(i));
    return r.pageUrl;
  }

  /** Єдине місце, де вирішено, яким саме інвойсом токенізується картка. */
  private verificationInvoice(i: CheckoutInput) {
    const hold = this.mode === 'hold';
    return {
      // verification дозволяє нуль; hold і debit вимагають мінімальної суми.
      amount: hold ? Math.round(this.holdUah * 100) : 0,
      ccy: CCY_UAH,
      paymentType: hold ? 'hold' : 'verification',
      saveCardData: { saveCard: true, walletId: i.wallet_id },
      redirectUrl: i.result_url,
      webHookUrl: this.webhookUrl,
      validity: INVOICE_VALIDITY_SEC,
      merchantPaymInfo: { reference: i.order_id, destination: `Kitchen OS · ${PLAN_NAME[i.plan]}` },
    };
  }

  async chargeByToken(i: ChargeInput): Promise<ChargeResult> {
    const r = await this.req<{ invoiceId: string; status: ChargeResult['status'] }>('POST', '/api/merchant/wallet/payment', {
      cardToken: i.card_token,
      // Копійки. Гривні сюди привели б до списання в сто разів меншого —
      // і воно б навіть «вдалося».
      amount: Math.round(i.amount * 100),
      ccy: CCY_UAH,
      initiationKind: 'merchant',
      webHookUrl: this.webhookUrl,
      merchantPaymInfo: { reference: i.reference, destination: 'Kitchen OS · підписка' },
    });
    return { provider_payment_id: r.invoiceId, status: r.status };
  }

  /**
   * Відпустити холд запасного режиму. У режимі verification не потрібен —
   * там нічого й не блокувалось.
   */
  async releaseHold(invoiceId: string): Promise<void> {
    await this.req('POST', '/api/merchant/invoice/cancel', { invoiceId });
  }

  async deleteToken(card_token: string): Promise<void> {
    await this.req('DELETE', `/api/merchant/wallet/card?cardToken=${encodeURIComponent(card_token)}`);
  }

  private async req<T>(method: 'POST' | 'DELETE' | 'GET', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { 'X-Token': this.token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`mono ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

// Ключ міняється рідко, а вебхуки йдуть пачками — тягнути його на кожен було б
// походом у мережу всередині перевірки підпису.
const PUBKEY_TTL_MS = 60 * 60_000;
let pubKeyCache: { pem: string; at: number } | null = null;
export function __resetPubKeyCache(): void { pubKeyCache = null; }

export async function monoPubKey(token: string, fetchImpl: FetchLike = fetch, base = BASE): Promise<string> {
  if (pubKeyCache && Date.now() - pubKeyCache.at < PUBKEY_TTL_MS) return pubKeyCache.pem;
  const res = await fetchImpl(`${base}/api/merchant/pubkey`, { headers: { 'X-Token': token } });
  if (!res.ok) throw new Error(`mono pubkey → ${res.status}`);
  const { key } = (await res.json()) as { key: string };
  // У відповіді base64 від PEM (не від DER) — так у прикладах mono.
  const pem = Buffer.from(key, 'base64').toString('utf8');
  pubKeyCache = { pem, at: Date.now() };
  return pem;
}

/**
 * ECDSA P-256 над СИРИМ тілом запиту. Саме сирим: пропущене через JSON.parse і
 * назад тіло дасть інші байти й підпис не зійдеться.
 */
export function monoVerify(pem: string, rawBody: Buffer, xSignBase64: string): boolean {
  if (!xSignBase64) return false;
  try {
    return createVerify('SHA256').update(rawBody).verify(pem, Buffer.from(xSignBase64, 'base64'));
  } catch {
    // Зіпсований підпис чи ключ — це «не пройшов», а не падіння маршруту.
    return false;
  }
}

/** Останні чотири цифри з маски виду `444403******1902`. */
const last4 = (masked: string | undefined): string | null => {
  const d = (masked ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
};

export function monoToEvent(body: MonoInvoiceStatus): InboundProviderEvent | null {
  const order_id = body.reference;
  // Без reference подія нічия: ні дім, ні намір за нею не знайти.
  if (!order_id) return null;

  // Ознака верифікації — walletData: його несе лише інвойс, створений зі
  // saveCardData. Нуль теж підходить, але лише в режимі verification; у
  // запасному hold сума більша за нуль, і без walletData ми прочитали б
  // верифікацію як звичайне списання.
  const verification = body.walletData != null || body.amount === 0;

  if (body.status === 'success') {
    if (verification) {
      const w = body.walletData;
      if (!w || w.status !== 'created') return null;
      return { kind: 'subscribed', order_id, card_mask: last4(body.paymentInfo?.maskedPan), card_token: w.cardToken };
    }
    return { kind: 'success', order_id, amount: body.amount / 100, provider_payment_id: body.invoiceId };
  }

  if (body.status === 'failure') {
    // Не пройшла верифікація — підписки так і не з'явилось; для наміру це
    // те саме, що відмова від нього.
    return verification ? { kind: 'unsubscribed', order_id } : { kind: 'failure', order_id };
  }

  // created | processing | hold | reversed | expired — нічого не міняють.
  // `reversed` (повернення після успіху) руками розбирає власник: автоматично
  // відбирати доступ за поверненням ми не беремось.
  return null;
}
