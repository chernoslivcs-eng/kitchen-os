// SilpoProvider проти фейкового fetch, який відтворює живі форми з розвідки
// (SILPO-MCP-RECON.md): structuredContent-обгортки, обовʼязковий контекст
// кошика для чеків, SSE-транспорт, 401 без токена.
import { describe, it, expect } from 'vitest';
import { SilpoProvider, RetailAuthError } from '../src/retail/silpo-provider.js';

type Rpc = { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };

const CART_ID = 'efe9f1a0-0000-0000-0000-000000000001';
const CTX = {
  branchId: '1edddb40-e664-609c-a1a7-f9004aa8afa6',
  deliveryType: 'DeliveryHome',
  timeslotStart: '2026-08-27T18:00:00+00:00',
  timeslotEnd: '2026-08-27T19:30:00+00:00',
};

function tool(result: unknown) {
  return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
}

const FRESH_SLOT = { start: '2026-09-01T09:00:00+00:00', end: '2026-09-01T09:30:00+00:00' };

// Фейковий MCP: відповідає як живий сервер, і записує, з якими аргументами
// його викликали — щоб тест перевіряв ланцюжок, а не тільки фінальну форму.
function makeFakeSilpo({ sse = false }: { sse?: boolean } = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
    if (auth !== 'Bearer good-token') {
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
    }
    const body = JSON.parse(String(init?.body)) as Rpc;
    let result: unknown;
    if (body.method === 'initialize') {
      result = { serverInfo: { name: 'silpo-mcp-service', version: 'test' } };
    } else if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    } else if (body.method === 'tools/call') {
      const name = body.params?.name ?? '';
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      calls.push({ tool: name, args });
      if (name === 'silpo_get_my_shopping_cart') {
        result = tool({ success: true, shoppingCartId: CART_ID });
      } else if (name === 'silpo_get_shopping_cart_by_id') {
        result = tool({
          success: true,
          cart: {
            id: CART_ID,
            deliveryType: CTX.deliveryType,
            timeslot: { start: CTX.timeslotStart, end: CTX.timeslotEnd },
            shipments: [{ companyId: 'c1', branchId: CTX.branchId, products: [] }],
          },
          loyalty: { bonusTotal: 25.02 },
        });
      } else if (name === 'silpo_get_time_slots') {
        // Жива форма: поле зветься `slots` (пастка, з'їла перший прогін кошика).
        result = tool({ success: true, slots: [
          { ...FRESH_SLOT, available: true, deliveryType: 'DeliveryHome' },
        ] });
      } else if (name === 'silpo_find_products_batch') {
        // Пастка з розвідки: із протухлим слотом (з кошика, 27.08) — мовчазні
        // нулі; зі свіжим — результат. Фейк відтворює це буквально.
        const fresh = args.timeslotStart === FRESH_SLOT.start;
        const products = (args.products as string[]) ?? [];
        result = tool({
          success: true,
          queries: products.map((q) => ({
            query: q,
            totalFound: fresh && q !== 'кунжут' ? 1 : 0,
            products: fresh && q !== 'кунжут' ? [{
              id: `id-${q}`, name: `Товар ${q}`, slug: q, price: 100, oldPrice: null,
              stock: true, available: true, weighted: false, step: 1,
              companyId: 'c1', branchId: args.branchId, externalProductId: `ext-${q}`,
            }] : [],
          })),
        });
      } else if (name === 'silpo_add_or_update_cart_products') {
        // Жива вимога: без shoppingCartId — zod-помилка (прод, 01.09).
        if (typeof args.shoppingCartId !== 'string') {
          result = tool({ success: false });
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {
            isError: true, content: [{ type: 'text', text: 'MCP error -32602: shoppingCartId required' }],
          } }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        result = tool({ success: true });
      } else if (name === 'silpo_get_my_offline_orders') {
        result = tool({
          success: true,
          orders: [{
            filId: 2635,
            filialName: 'вул. Київська, буд. 10',
            cityName: 'Стоянка',
            createdAt: '2026-08-23T10:54:48',
            sumReg: 2644,
            products: [
              { lagerId: 1, name: 'Філе куряче охолоджене', unit: 'кг', quantity: 0.64, price: 200, image: null },
              { lagerId: 2, name: "Дрова Pen'ok Початок вогню №2", unit: 'шт', quantity: 1, price: 259, image: null },
            ],
          }],
        });
      } else {
        throw new Error('unexpected tool ' + name);
      }
    } else {
      throw new Error('unexpected method ' + body.method);
    }
    const payload = { jsonrpc: '2.0', id: body.id, result };
    if (sse) {
      return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchFn, calls };
}

describe('SilpoProvider.receipts', () => {
  it('проходить ланцюжок кошика і віддає чеки у формі домену', async () => {
    const fake = makeFakeSilpo();
    const p = new SilpoProvider({ accessToken: 'good-token', fetchFn: fake.fetchFn });
    const receipts = await p.receipts();

    // Чеки вимагають контексту кошика — перевіряємо, що він реально переданий.
    const rec = fake.calls.find((c) => c.tool === 'silpo_get_my_offline_orders');
    expect(rec?.args).toMatchObject(CTX);

    expect(receipts).toHaveLength(1);
    expect(receipts[0]!).toMatchObject({
      shop: 'вул. Київська, буд. 10', city: 'Стоянка', total: 2644,
    });
    expect(receipts[0]!.lines).toHaveLength(2);
    expect(receipts[0]!.lines[0]).toMatchObject({ name: 'Філе куряче охолоджене', quantity: 0.64, unit: 'кг' });
  });

  it('розуміє SSE-транспорт (сервер сам обирає content-type)', async () => {
    const fake = makeFakeSilpo({ sse: true });
    const p = new SilpoProvider({ accessToken: 'good-token', fetchFn: fake.fetchFn });
    expect((await p.receipts())[0]!.city).toBe('Стоянка');
  });

  it('findBatch бере СВІЖИЙ слот (не протухлий з кошика) і мапить результати', async () => {
    const fake = makeFakeSilpo();
    const p = new SilpoProvider({ accessToken: 'good-token', fetchFn: fake.fetchFn });
    const rows = await p.findBatch(['молоко', 'кунжут']);

    // Пошук пішов зі слотом із get_time_slots, а не з кошика (27.08 → нулі).
    const search = fake.calls.find((c) => c.tool === 'silpo_find_products_batch');
    expect(search?.args.timeslotStart).toBe(FRESH_SLOT.start);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      query: 'молоко',
      product: { name: 'Товар молоко', price: 100, companyId: 'c1' },
    });
    expect(rows[1]).toMatchObject({ query: 'кунжут', product: null });
  });

  it('addToCart кладе знайдене у кошик мережі трійкою productId+companyId+branchId', async () => {
    const fake = makeFakeSilpo();
    const p = new SilpoProvider({ accessToken: 'good-token', fetchFn: fake.fetchFn });
    await p.addToCart([{ productId: 'id-молоко', companyId: 'c1', branchId: 'b1', quantity: 2 }]);
    const call = fake.calls.find((c) => c.tool === 'silpo_add_or_update_cart_products');
    expect(call?.args.shoppingCartId).toBe(CART_ID);
    expect(call?.args.products).toEqual([
      { productId: 'id-молоко', companyId: 'c1', branchId: 'b1', quantity: 2 },
    ]);
  });

  it('401 → RetailAuthError, щоб роут показав «Увійти знову», а не 500', async () => {
    const fake = makeFakeSilpo();
    const p = new SilpoProvider({ accessToken: 'expired', fetchFn: fake.fetchFn });
    await expect(p.receipts()).rejects.toThrow(RetailAuthError);
  });
});
