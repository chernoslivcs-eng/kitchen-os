// Один вибір провайдера на весь процес: сервер і крон мусять користуватись
// тим самим, інакше крон відписуватиме наміри у фейку, поки люди платять
// у справжньому LiqPay.
import { FakeBillingProvider } from './fake-provider.js';
import { LiqPayProvider } from './liqpay.js';
import type { BillingProvider } from './provider.js';

/** Без обох ключів — фейк: стенд, тести й Preview працюють без кабінету LiqPay. */
export function pickBillingProvider(appUrl: string): BillingProvider {
  const publicKey = process.env.LIQPAY_PUBLIC_KEY;
  const privateKey = process.env.LIQPAY_PRIVATE_KEY;
  if (!publicKey || !privateKey) return new FakeBillingProvider();
  return new LiqPayProvider({ publicKey, privateKey }, `${appUrl}/v1/billing/liqpay`);
}
