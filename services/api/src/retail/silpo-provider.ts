// Живий MCP «Сільпо» (SILPO-MCP-RECON.md). Streamable HTTP: кожен виклик —
// POST із JSON-RPC; сервер відповідає JSON або SSE на свій розсуд, тому
// парсимо обидва. Чеки вимагають контексту кошика (branchId+deliveryType+
// timeslot) — провайдер добуває його сам через ланцюжок shopping cart.
// fetch інʼєктується заради тестів; у проді — глобальний.

export class RetailAuthError extends Error {
  constructor(message = 'retail token rejected') { super(message); this.name = 'RetailAuthError'; }
}

export interface RetailReceiptLine {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  image: string | null;
}

export interface RetailReceipt {
  shop: string;
  city: string;
  at: string;
  total: number;
  lines: RetailReceiptLine[];
}

// Товар із e-commerce пошуку — рівно ті поля, що віддає живий сервер.
// Трійка productId(id)+companyId+branchId — те, що приймає кошик.
export interface RetailProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  oldPrice: number | null;
  stock: boolean;
  available: boolean;
  weighted: boolean;
  step: number;
  companyId: string;
  branchId: string;
  externalProductId?: string;
}

export interface RetailFoundRow {
  query: string;
  product: RetailProduct | null;
  candidates: RetailProduct[];
}

interface SilpoOpts {
  accessToken: string;
  fetchFn?: typeof fetch;
  endpoint?: string;
}

const ENDPOINT = 'https://mcp.silpo.ua/mcp';
const PROTOCOL = '2025-06-18';

interface CartCtx {
  branchId: string;
  deliveryType: string;
  timeslotStart: string;
  timeslotEnd: string;
}

export class SilpoProvider {
  private fetchFn: typeof fetch;
  private endpoint: string;
  private accessToken: string;
  private nextId = 1;
  private initialized = false;

  constructor(opts: SilpoOpts) {
    this.accessToken = opts.accessToken;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.endpoint = opts.endpoint ?? ENDPOINT;
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const body: Record<string, unknown> = { jsonrpc: '2.0', id: this.nextId++, method };
    if (params !== undefined) body.params = params;
    const res = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${this.accessToken}`,
        'mcp-protocol-version': PROTOCOL,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new RetailAuthError();
    const text = await res.text();
    if (!res.ok) throw new Error(`silpo mcp ${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    const ct = res.headers.get('content-type') ?? '';
    let msg: { id?: unknown; result?: unknown; error?: unknown };
    if (ct.includes('text/event-stream')) {
      const frames = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
      const mine = frames.find((f) => f.id === body.id);
      if (!mine) throw new Error(`silpo mcp ${method}: no response in SSE stream`);
      msg = mine;
    } else {
      msg = JSON.parse(text);
    }
    if (msg.error) throw new Error(`silpo mcp ${method}: ${JSON.stringify(msg.error)}`);
    return msg.result;
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'kitchen-os', version: '1.0.0' },
    });
    this.initialized = true;
  }

  // Кожен tool віддає structuredContent поруч із текстовим дублем — беремо
  // машинну форму, текст лишається людям (і логам).
  private async tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureInit();
    const r = (await this.rpc('tools/call', { name, arguments: args })) as {
      structuredContent?: T;
      content?: Array<{ text?: string }>;
      isError?: boolean;
    };
    if (r.isError) throw new Error(`silpo tool ${name}: ${r.content?.[0]?.text?.slice(0, 300)}`);
    if (r.structuredContent !== undefined) return r.structuredContent;
    return JSON.parse(r.content?.[0]?.text ?? '{}') as T;
  }

  // Кошик один на акаунт — id кешуємо на життя провайдера (один запит).
  private cartId: string | null = null;

  private async myCartId(): Promise<string> {
    if (this.cartId) return this.cartId;
    const { shoppingCartId } = await this.tool<{ shoppingCartId: string }>(
      'silpo_get_my_shopping_cart', {},
    );
    this.cartId = shoppingCartId;
    return shoppingCartId;
  }

  private async cartCtx(): Promise<CartCtx> {
    const shoppingCartId = await this.myCartId();
    const { cart } = await this.tool<{
      cart: {
        deliveryType: string;
        timeslot?: { start: string; end: string };
        shipments?: Array<{ branchId: string }>;
        calculation?: { delivery?: { deliveryExpressByPromise?: { branchId?: string } } };
      };
    }>('silpo_get_shopping_cart_by_id', { shoppingCartId });
    const branchId = cart.shipments?.[0]?.branchId
      ?? cart.calculation?.delivery?.deliveryExpressByPromise?.branchId;
    if (!branchId || !cart.timeslot) {
      throw new Error('silpo cart has no branch/timeslot context');
    }
    return {
      branchId,
      deliveryType: cart.deliveryType,
      timeslotStart: cart.timeslot.start,
      timeslotEnd: cart.timeslot.end,
    };
  }

  // Свіжий таймслот для пошуку. Слот із кошика буває протухлим, а протухлий
  // слот = мовчазні нулі по всіх запитах (пастка №3 розвідки) — тому перед
  // find завжди беремо перший доступний слот із get_time_slots.
  private async freshSlot(branchId: string, deliveryType: string): Promise<{ start: string; end: string }> {
    // Жива форма віддає масив у полі `slots` (перевірено на проді 01.09);
    // `timeslots` лишається фолбеком на випадок зміни контракту.
    const res = await this.tool<{
      slots?: Array<{ start: string; end: string; available: boolean; deliveryType?: string }>;
      timeslots?: Array<{ start: string; end: string; available: boolean; deliveryType?: string }>;
    }>('silpo_get_time_slots', { branchId, deliveryType });
    const slots = res.slots ?? res.timeslots ?? [];
    const slot = slots.find((s) => s.available && (!s.deliveryType || s.deliveryType === deliveryType))
      ?? slots.find((s) => s.available)
      ?? slots[0];
    if (!slot) throw new Error('silpo: no time slots for branch');
    return { start: slot.start, end: slot.end };
  }

  async findBatch(queries: string[]): Promise<RetailFoundRow[]> {
    const { branchId, deliveryType } = await this.cartCtx();
    const slot = await this.freshSlot(branchId, deliveryType);
    const res = await this.tool<{
      queries: Array<{ query: string; totalFound: number; products: RetailProduct[] }>;
    }>('silpo_find_products_batch', {
      branchId, deliveryType,
      timeslotStart: slot.start, timeslotEnd: slot.end,
      products: queries,
    });
    return (res.queries ?? []).map((q) => ({
      query: q.query,
      product: q.products?.[0] ?? null,
      candidates: q.products ?? [],
    }));
  }

  async addToCart(items: Array<{ productId: string; companyId: string; branchId: string; quantity: number }>): Promise<void> {
    // Жива вимога: без shoppingCartId інструмент відбиває zod-помилкою.
    const shoppingCartId = await this.myCartId();
    await this.tool('silpo_add_or_update_cart_products', { shoppingCartId, products: items });
  }

  async receipts(limit = 10): Promise<RetailReceipt[]> {
    const ctx = await this.cartCtx();
    const { orders } = await this.tool<{
      orders: Array<{
        filialName: string;
        cityName: string;
        createdAt: string;
        sumReg: number;
        products: Array<{ name: string; unit: string; quantity: number; price: number; image?: string | null }>;
      }>;
    }>('silpo_get_my_offline_orders', { ...ctx, limit });
    return (orders ?? []).map((o) => ({
      shop: o.filialName,
      city: o.cityName,
      at: o.createdAt,
      total: o.sumReg,
      lines: (o.products ?? []).map((p) => ({
        name: p.name,
        quantity: p.quantity,
        unit: p.unit,
        price: p.price,
        image: p.image ?? null,
      })),
    }));
  }
}
