// Один вибір провайдера на весь процес: сервер і крон мусять користуватись
// тим самим, інакше крон списуватиме у фейку з людей, які платять насправді.
import { FakeBillingProvider } from './fake-provider.js';
import { MonoProvider } from './mono.js';
import type { BillingProvider } from './provider.js';

/** Шлях, на який mono шле статуси інвойсів. Знає лише цей модуль і маршрут. */
export const MONO_WEBHOOK_PATH = '/v1/billing/mono';

/**
 * Без `MONO_TOKEN` — фейк: стенд, тести й Preview працюють без кабінету mono.
 * Токен один і той самий і для бойового, і для тестового середовища — тестовий
 * видає api.monobank.ua будь-якому клієнту банку, без ФОП і терміналу.
 */
export function pickBillingProvider(appUrl: string): BillingProvider {
  const token = process.env.MONO_TOKEN;
  if (!token) return new FakeBillingProvider();
  return new MonoProvider(token, `${appUrl}${MONO_WEBHOOK_PATH}`);
}
