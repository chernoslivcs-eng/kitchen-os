// Вибір провайдера оплат (знахідка живого тесту 26.09).
//
// Причина цього файлу: у Preview лежав MONO_TOKEN із порожнім значенням, і
// pickBillingProvider тихо віддавав фейк. У Preview це безневинно, у проді
// означало б, що люди отримують фейкові посилання на оплату, підписки
// оформлюються, а грошей не списує ніхто — і жодного сигналу.
import { describe, it, expect, afterEach } from 'vitest';
import { pickBillingProvider } from '../src/billing/pick-provider.js';
import { FakeBillingProvider } from '../src/billing/fake-provider.js';
import { MonoProvider } from '../src/billing/mono.js';

const APP = 'https://kitchen-os.app';

describe('pickBillingProvider', () => {
  afterEach(() => { delete process.env.MONO_TOKEN; delete process.env.VERCEL_ENV; });

  it('поза продом без токена — фейк: так живуть стенд і тести', () => {
    expect(pickBillingProvider(APP)).toBeInstanceOf(FakeBillingProvider);
  });

  it('у проді без токена — падаємо, і в тексті сказано, що робити', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => pickBillingProvider(APP)).toThrow(/MONO_TOKEN/);
  });

  it('у проді порожній токен — те саме падіння, не фейк', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.MONO_TOKEN = '   ';
    expect(() => pickBillingProvider(APP)).toThrow(/MONO_TOKEN/);
  });

  it('порожній рядок і пробіли = відсутній і поза продом теж', () => {
    process.env.MONO_TOKEN = '  \n ';
    expect(pickBillingProvider(APP)).toBeInstanceOf(FakeBillingProvider);
  });

  it('Preview із токеном працює як раніше', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.MONO_TOKEN = 'u-test-token';
    expect(pickBillingProvider(APP)).toBeInstanceOf(MonoProvider);
  });

  it('токен обрізається: зайвий перенос рядка з вставляння не поїде в X-Token', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.MONO_TOKEN = ' u-real-token\n';
    const calls: Array<Record<string, string>> = [];
    const p = pickBillingProvider(APP) as MonoProvider;
    // Дістаємо токен єдиним доступним способом — дивимось, що пішло в заголовок.
    (p as unknown as { fetchImpl: unknown }).fetchImpl = async (_u: string, init: { headers: Record<string, string> }) => {
      calls.push(init.headers);
      return { ok: true, status: 200, text: async () => JSON.stringify({ invoiceId: 'i', pageUrl: 'u' }) } as never;
    };
    await p.checkoutUrl({ order_id: 'o', household_id: null, plan: 'self', amount: 210, wallet_id: 'o', result_url: APP });
    expect(calls[0]!['X-Token']).toBe('u-real-token');
  });
});
