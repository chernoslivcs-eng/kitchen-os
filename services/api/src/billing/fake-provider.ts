// Фейк провайдера: стенд, пари й тести. Нічого нікуди не шле, лише запамʼятовує
// виклики — щоб тест міг спитати «а справді відписались?».
import type { BillingProvider, CheckoutInput } from './provider.js';

export class FakeBillingProvider implements BillingProvider {
  calls: Array<{ op: 'checkout' | 'unsubscribe' | 'update'; args: unknown }> = [];

  async checkoutUrl(i: CheckoutInput): Promise<string> {
    this.calls.push({ op: 'checkout', args: i });
    return `http://localhost:5190/fake-checkout?order=${encodeURIComponent(i.order_id)}`;
  }
  async unsubscribe(order_id: string): Promise<void> {
    this.calls.push({ op: 'unsubscribe', args: order_id });
  }
  async updateAmount(order_id: string, amount: number): Promise<void> {
    this.calls.push({ op: 'update', args: { order_id, amount } });
  }
}
