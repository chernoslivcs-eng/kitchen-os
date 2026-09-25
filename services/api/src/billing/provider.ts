// Провайдер оплат за інтерфейсом (спек 2026-09-25, план §Task 8).
//
// Справжній LiqPay-адаптер і його вебхук — окремий план біллінгу. Тут лише
// контракт, щоб маршрути й тести не знали про провайдера нічого зайвого.
export interface CheckoutInput {
  order_id: string;
  /** null — оформлення з лендінга, дому ще немає (намір привʼяжеться після входу). */
  household_id: string | null;
  plan: 'self' | 'home';
  amount: number;
  /**
   * Коли провайдер спише вперше, ISO. Це кінець пробного або «зараз», якщо
   * пробний уже використано. Рахується один раз тим, хто створює checkout, і
   * зберігається в нас — щоб дата в листі збігалася зі списанням.
   */
  date_start: string;
  result_url: string;
}

export interface BillingProvider {
  checkoutUrl(input: CheckoutInput): Promise<string>;
  unsubscribe(order_id: string): Promise<void>;
  updateAmount(order_id: string, amount: number): Promise<void>;
}
