// Фейк провайдера: стенд, пари й тести. Нічого нікуди не шле, лише запамʼятовує
// виклики — щоб тест міг спитати «а справді відписались?».
import type { BillingProvider, CheckoutInput, ChargeInput, ChargeResult } from './provider.js';

export class FakeBillingProvider implements BillingProvider {
  calls: Array<{ op: 'checkout' | 'charge' | 'delete-token' | 'unsubscribe' | 'update'; args: unknown }> = [];
  /** Тест може змусити фейкове списання «не пройти». */
  nextCharge: ChargeResult['status'] = 'success';

  async checkoutUrl(i: CheckoutInput): Promise<string> {
    this.calls.push({ op: 'checkout', args: i });
    return `http://localhost:5190/fake-checkout?order=${encodeURIComponent(i.order_id)}`;
  }
  async chargeByToken(i: ChargeInput): Promise<ChargeResult> {
    this.calls.push({ op: 'charge', args: i });
    return { provider_payment_id: `fake-${this.calls.length}`, status: this.nextCharge };
  }
  async deleteToken(card_token: string): Promise<void> {
    this.calls.push({ op: 'delete-token', args: card_token });
  }
  async unsubscribe(order_id: string): Promise<void> {
    this.calls.push({ op: 'unsubscribe', args: order_id });
  }
  async updateAmount(order_id: string, amount: number): Promise<void> {
    this.calls.push({ op: 'update', args: { order_id, amount } });
  }
}
