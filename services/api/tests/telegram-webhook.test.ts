// Хотфікс 13.09: вебхук на Vercel висів — рантайм уже прочитав тіло в req.body, потік
// завершено, `end` не настає. Тіло: req.body → потік (живий) → порожньо (завершений).
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readWebhookBody, BODY_TIMEOUT_MS } from '../src/telegram-handler.js';

type Req = IncomingMessage & { body?: unknown };
const stream = (opts: { ended?: boolean; body?: unknown; chunks?: string[] } = {}): Req => {
  const s = new PassThrough() as unknown as Req;
  if (opts.body !== undefined) s.body = opts.body;
  if (opts.chunks) { for (const c of opts.chunks) (s as unknown as PassThrough).write(c); (s as unknown as PassThrough).end(); }
  if (opts.ended) { (s as unknown as PassThrough).end(); Object.defineProperty(s, 'complete', { value: true }); }
  return s;
};

describe('вебхук Telegram · тіло запиту', () => {
  it('req.body від рантайму (обʼєкт або рядок) — беремо його, потік не читаємо', async () => {
    expect(await readWebhookBody(stream({ body: { update_id: 1 } }))).toEqual({ raw: '{"update_id":1}', source: 'req.body' });
    expect(await readWebhookBody(stream({ body: '{"update_id":2}' }))).toEqual({ raw: '{"update_id":2}', source: 'req.body' });
  });
  it('живий потік — читаємо як завжди', async () => {
    expect(await readWebhookBody(stream({ chunks: ['{"update_', 'id":3}'] }))).toEqual({ raw: '{"update_id":3}', source: 'stream' });
  });
  it('потік уже завершено без req.body — порожньо одразу, не висимо', async () => {
    const t0 = Date.now();
    const r = await readWebhookBody(stream({ ended: true }));
    expect(r).toEqual({ raw: '', source: 'ended' });
    expect(Date.now() - t0).toBeLessThan(BODY_TIMEOUT_MS);
  });
});
