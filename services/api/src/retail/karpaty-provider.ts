// «Стейки Карпат» — відкритий MCP крафтової мʼясної крамниці (розвідка
// 2026-09-04): каталог і ціни віддаються без авторизації, OAuth потрібен лише
// для place_order. Тут — тільки пошук: це джерело «звідки реально можна
// замовити», не мережа з кошиком і чеками, як Сільпо. Заявка — окремий крок,
// коли буде форма в чаті.
//
// Транспорт той самий streamable HTTP, що в Сільпо, але без Bearer.

export interface KarpatyProduct {
  name: string;
  article: string;
  price: number;
  url: string;
  inStock: boolean;
}

interface KarpatyOpts {
  fetchFn?: typeof fetch;
  endpoint?: string;
}

const ENDPOINT = 'https://mcp.karpatysteaks.com/mcp';
const PROTOCOL = '2025-06-18';

export class KarpatyProvider {
  private fetchFn: typeof fetch;
  private endpoint: string;
  private nextId = 1;
  private initialized = false;

  constructor(opts: KarpatyOpts = {}) {
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
        'mcp-protocol-version': PROTOCOL,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`karpaty mcp ${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    const ct = res.headers.get('content-type') ?? '';
    let msg: { id?: unknown; result?: unknown; error?: unknown };
    if (ct.includes('text/event-stream')) {
      const frames = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
      const mine = frames.find((f) => f.id === body.id);
      if (!mine) throw new Error(`karpaty mcp ${method}: no response in SSE stream`);
      msg = mine;
    } else {
      msg = JSON.parse(text);
    }
    if (msg.error) throw new Error(`karpaty mcp ${method}: ${JSON.stringify(msg.error)}`);
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

  /**
   * Пошук по живому каталогу. Сервер віддає кожен товар окремим текстовим
   * блоком із JSON усередині; блоки без JSON («нічого не знайдено») просто
   * пропускаємо — порожній список і є відповіддю.
   */
  async search(query: string): Promise<KarpatyProduct[]> {
    await this.ensureInit();
    const r = (await this.rpc('tools/call', { name: 'search_products', arguments: { query } })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    if (r.isError) throw new Error(`karpaty search: ${r.content?.[0]?.text?.slice(0, 200)}`);
    const out: KarpatyProduct[] = [];
    for (const block of r.content ?? []) {
      if (!block.text) continue;
      let raw: Record<string, unknown>;
      try { raw = JSON.parse(block.text); } catch { continue; }
      if (typeof raw.name !== 'string') continue;
      out.push({
        name: raw.name,
        article: String(raw.article ?? ''),
        price: Number(raw.price_uah ?? raw.price ?? 0),
        url: typeof raw.url === 'string' ? raw.url : '',
        inStock: raw.in_stock !== false,
      });
    }
    return out;
  }
}
