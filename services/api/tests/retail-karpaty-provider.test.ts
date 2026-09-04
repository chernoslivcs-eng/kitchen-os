// Стейки Карпат: відкритий MCP без авторизації. Провайдер має пережити
// жоден-кілька-багато товарів у відповіді, текстові блоки без JSON і SSE-транспорт.

import { describe, it, expect } from 'vitest';
import { KarpatyProvider } from '../src/retail/karpaty-provider.js';

function sse(frames: unknown[]): string {
  return frames.map((f) => `event: message\ndata: ${JSON.stringify(f)}\n`).join('\n');
}

function fakeFetch(products: Array<Record<string, unknown>>, extraBlocks: string[] = []) {
  const calls: { method: string; args?: unknown }[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ method: body.method, args: body.params?.arguments });
    const result = body.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'karpatysteaks-orders' } }
      : { content: [
          ...extraBlocks.map((text) => ({ type: 'text', text })),
          ...products.map((p) => ({ type: 'text', text: JSON.stringify(p) })),
        ] };
    return new Response(sse([{ jsonrpc: '2.0', id: body.id, result }]), {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('KarpatyProvider.search', () => {
  it('ініціалізується раз, шукає без Bearer, парсить кожен товар з окремого блока', async () => {
    const { fetchFn, calls } = fakeFetch([
      { name: 'Рібай Прайм King', article: '007252', price_uah: '794.00', url: 'https://karpatysteaks.com/ribeye', in_stock: true },
      { name: 'Рібай Dry-Aged', article: '007628', price_uah: '1095.00', url: 'https://karpatysteaks.com/dry', in_stock: false },
    ]);
    const p = new KarpatyProvider({ fetchFn, endpoint: 'https://mcp.test/mcp' });
    const rows = await p.search('рібай');
    await p.search('рібай');
    expect(calls.filter((c) => c.method === 'initialize')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'tools/call')?.args).toEqual({ query: 'рібай' });
    expect(rows).toEqual([
      { name: 'Рібай Прайм King', article: '007252', price: 794, url: 'https://karpatysteaks.com/ribeye', inStock: true },
      { name: 'Рібай Dry-Aged', article: '007628', price: 1095, url: 'https://karpatysteaks.com/dry', inStock: false },
    ]);
  });

  it('текст без JSON («нічого не знайдено») — порожній список, не помилка', async () => {
    const { fetchFn } = fakeFetch([], ['За запитом «кавун» нічого не знайдено.']);
    const p = new KarpatyProvider({ fetchFn, endpoint: 'https://mcp.test/mcp' });
    expect(await p.search('кавун')).toEqual([]);
  });

  it('HTTP-помилка сервера — кидає, щоб пошук по джерелах позначив «не відповідає»', async () => {
    const fetchFn = (async () => new Response('Forbidden', { status: 403 })) as unknown as typeof fetch;
    const p = new KarpatyProvider({ fetchFn, endpoint: 'https://mcp.test/mcp' });
    await expect(p.search('рібай')).rejects.toThrow(/HTTP 403/);
  });
});
