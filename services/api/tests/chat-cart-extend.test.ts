// №4, друга частина. Живий репро M13 п.3: кошик зібрано, людина каже «хочу
// колу додати» — і система веде це через список покупок плюс нудж «зібрати
// кошик заново», замість розширити відкритий кошик.
//
// Тепер модель знає ситуацію (блок [РЕЖИМ]), а сервер уміє дописати рядок у
// вже відкриту картку — тим самим механізмом, що кнопка «додати
// альтернативу» (cart-add-alt): addToCart на один товар, push рядка,
// updateMessageCard. Нової сутності не заводимо: картка кошика лишається
// повідомленням, панель/стрічка — два подання одного запису.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';
import { localDay } from '../src/local-day.js';

function product(id: string, name: string, price: number) {
  return {
    id, name, slug: id, price, oldPrice: null,
    stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1',
  };
}

describe('чат: «додай X» при відкритому кошику розширює його', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  let added: Array<{ productId: string }>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    added = [];
    const byQuery: Record<string, ReturnType<typeof product>> = {
      кунжут: product('p-sesame', 'Кунжут білий', 40),
      кола: product('p-cola', 'Напій Кока-Кола 0,5 л', 28),
      колу: product('p-cola', 'Напій Кока-Кола 0,5 л', 28),
    };
    app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => {
              const hit = byQuery[q.trim().toLowerCase()];
              return { query: q, product: hit ?? null, candidates: hit ? [hit] : [] };
            }),
            addToCart: async (items: Array<{ productId: string }>) => { added.push(...items); },
          }),
        },
      },
    });
    await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    await app.inject({
      method: 'POST', url: '/v1/shopping', headers: { cookie: me.cookie },
      payload: { label: 'кунжут' },
    });
  });

  async function buildCart() {
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'збери кошик у сільпо' },
    });
    const b = r.json();
    expect(b.card?.type).toBe('cart');
    return b as { card_id: string; card: { rows: unknown[]; found: number } };
  }

  it('дописує рядок у ТУ САМУ картку, не створює другу', async () => {
    const first = await buildCart();
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'додай колу' },
    });
    const body = r.json();

    expect(body.card?.type).toBe('cart');
    expect(body.card_id).toBe(first.card_id);
    expect(body.card.rows).toHaveLength(2);
    expect(JSON.stringify(body.card.rows)).toMatch(/Кока-Кола/);

    // У сесії ОДНА cart-картка, не дві суперечливі.
    const { id } = await repo.getOrCreateSessionForDay(me.user_id, localDay());
    const carts = (await repo.listMessages(id)).filter((m) => (m.card as { type?: string } | null)?.type === 'cart');
    expect(carts).toHaveLength(1);
  });

  it('кола летить у кошик мережі, але НЕ в список покупок', async () => {
    await buildCart();
    added.length = 0;
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'додай колу' },
    });
    expect(added.map((i) => i.productId)).toEqual(['p-cola']);
    const list = await repo.listShoppingItems(me.household_id);
    expect(list.map((i) => i.label)).toEqual(['кунжут']);
  });

  it('без відкритого кошика «додай колу» кошика не чіпає — це список покупок', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'додай колу' },
    });
    expect(r.json().card?.type).not.toBe('cart');
    expect(added).toHaveLength(0);
  });
});
