// Провайдер оплат за інтерфейсом (спек 2026-09-25; план mono 25.09).
//
// Контракт написаний так, щоб маршрути й крон не знали про провайдера нічого
// зайвого. Під mono він розрісся на дві дії: у mono підписки як сутності
// немає, тому списання ініціюємо ми самі за збереженим токеном.
export interface CheckoutInput {
  order_id: string;
  /** null — оформлення з лендінга, дому ще немає (намір привʼяжеться після входу). */
  household_id: string | null;
  plan: 'self' | 'home';
  amount: number;
  /**
   * Гаманець, у якому провайдер збереже картку: дім, а для наміру з лендінга
   * (дому ще немає) — сам order_id.
   */
  wallet_id: string;
  result_url: string;
}

export interface ChargeInput {
  card_token: string;
  /** У гривнях; у копійки переводить адаптер. */
  amount: number;
  /** Наш order_id — по ньому вебхук знайде дім. */
  reference: string;
}

export interface ChargeResult {
  provider_payment_id: string;
  /** `processing` — відповіді ще немає, рішення принесе вебхук. */
  status: 'success' | 'failure' | 'processing';
}

export interface BillingProvider {
  /** Посилання, де людина дає картку. Грошей не списує. */
  checkoutUrl(input: CheckoutInput): Promise<string>;
  /** Списання за збереженим токеном; ініціює лише крон. */
  chargeByToken(input: ChargeInput): Promise<ChargeResult>;
  /** Прибрати картку у провайдера. Після цього списати нею не можна. */
  deleteToken(card_token: string): Promise<void>;
  unsubscribe(order_id: string): Promise<void>;
  updateAmount(order_id: string, amount: number): Promise<void>;
}
