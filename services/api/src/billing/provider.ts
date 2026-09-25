// Провайдер оплат за інтерфейсом (спек 2026-09-25, план §Task 8).
//
// Справжній LiqPay-адаптер і його вебхук — окремий план біллінгу. Тут лише
// контракт, щоб маршрути й тести не знали про провайдера нічого зайвого.
export interface CheckoutInput {
  order_id: string;
  household_id: string;
  plan: 'self' | 'home';
  amount: number;
  /** Пробний період — один раз на дім; вирішує маршрут по `trial_used_at`. */
  trial: boolean;
  result_url: string;
}

export interface BillingProvider {
  checkoutUrl(input: CheckoutInput): Promise<string>;
  unsubscribe(order_id: string): Promise<void>;
  updateAmount(order_id: string, amount: number): Promise<void>;
}
