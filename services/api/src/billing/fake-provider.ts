// Фейк провайдера: стенд, пари й тести. Нічого нікуди не шле, лише запамʼятовує
// виклики — щоб тест міг спитати «а справді відписались?».
import type { BillingProvider, CheckoutInput, CheckoutResult, ChargeInput, ChargeResult } from './provider.js';

export class FakeBillingProvider implements BillingProvider {
  calls: Array<{ op: 'checkout' | 'charge' | 'delete-token' | 'remove-invoice'; args: unknown }> = [];
  private invoices = 0;
  /** Тест може змусити фейкове списання «не пройти». */
  nextCharge: ChargeResult['status'] = 'success';

  async checkoutUrl(i: CheckoutInput): Promise<CheckoutResult> {
    this.calls.push({ op: 'checkout', args: i });
    // Кожен виклик — свій рахунок: інакше тест на renew не побачив би різниці.
    this.invoices += 1;
    return {
      url: `http://localhost:5190/fake-checkout?order=${encodeURIComponent(i.order_id)}&inv=${this.invoices}`,
      invoice_id: `fake-inv-${this.invoices}`,
    };
  }
  async removeInvoice(invoice_id: string): Promise<void> {
    this.calls.push({ op: 'remove-invoice', args: invoice_id });
  }
  async chargeByToken(i: ChargeInput): Promise<ChargeResult> {
    this.calls.push({ op: 'charge', args: i });
    return { provider_payment_id: `fake-${this.calls.length}`, status: this.nextCharge };
  }
  async deleteToken(card_token: string): Promise<void> {
    this.calls.push({ op: 'delete-token', args: card_token });
  }
}
