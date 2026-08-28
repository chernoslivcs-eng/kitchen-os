import { describe, it, expect, beforeEach } from 'vitest';
import FormData from 'form-data';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';

const HH = 'hh-1';
const U = 'user-1';
const RECEIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/eval/fixtures/receipt-abbreviated.txt',
);

async function uploadReceipt(app: ReturnType<typeof buildApp>) {
  const form = new FormData();
  form.append('household_id', HH);
  form.append('user_id', U);
  form.append('file', readFileSync(RECEIPT_PATH), {
    filename: 'receipt.txt',
    contentType: 'text/plain',
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/attachments',
    payload: form,
    headers: form.getHeaders(),
  });
  return res;
}

describe('POST /v1/attachments → /v1/chat with attachment → /apply', () => {
  let repo: InMemoryRepo;
  let store: InMemoryStore;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    store = new InMemoryStore();
    app = buildApp(repo, store);
    await app.ready();
  });

  it('upload → chat з attachment → intake_diff картка → apply створює партію', async () => {
    const up = await uploadReceipt(app);
    expect(up.statusCode).toBe(200);
    const { id, kind, bytes } = up.json();
    expect(id).toBeTruthy();
    expect(kind).toBe('text');
    expect(bytes).toBeGreaterThan(200);

    // Файл дійсно зберігся в store
    const stored = await repo.getAttachment(id);
    expect(stored?.household_id).toBe(HH);
    expect(stored?.url).toMatch(/^mem:\/\//);

    // /v1/chat із attachments — маршрутизація на attachment_parse
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { user_id: U, household_id: HH, session_id: 's', text: '', attachments: [{ id }] },
    });
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.card?.type).toBe('intake_diff');
    expect(body.raw_kind).toBe('receipt');
    expect(body.card_id).toBeTruthy();

    // apply → створює партію
    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/apply`,
      payload: { user_id: U },
    });
    expect(apply.statusCode).toBe(200);
    expect(await repo.listBatches(HH)).toHaveLength(1);
  });

  it('reparse з hint зберігає підказку і повертає нову картку', async () => {
    const { id } = (await uploadReceipt(app)).json();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/attachments/${id}/reparse`,
      payload: { user_id: U, hint: 'це не Президент, це Простоквашино' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.card?.type).toBe('intake_diff');
    expect(body.card_id).toBeTruthy();
    const saved = await repo.getAttachment(id);
    expect(saved?.hint).toBe('це не Президент, це Простоквашино');
  });

  it('чужий актор на attachment у /v1/chat — 403', async () => {
    const { id } = (await uploadReceipt(app)).json();
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { user_id: 'user-2', household_id: HH, session_id: 's', text: '', attachments: [{ id }] },
    });
    expect(chat.statusCode).toBe(403);
  });

  it('невідомий attachment у /v1/chat — 404', async () => {
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: {
        user_id: U, household_id: HH, session_id: 's', text: '',
        attachments: [{ id: '00000000-0000-0000-0000-000000000000' }],
      },
    });
    expect(chat.statusCode).toBe(404);
  });

  it('reparse чужого — 403', async () => {
    const { id } = (await uploadReceipt(app)).json();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/attachments/${id}/reparse`,
      payload: { user_id: 'user-2', hint: 'спробуй ще' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('/v1/chat без text і без attachments — 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { user_id: U, household_id: HH, session_id: 's' },
    });
    expect(r.statusCode).toBe(400);
  });
});
