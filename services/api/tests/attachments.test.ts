import { describe, it, expect, beforeEach } from 'vitest';
import FormData from 'form-data';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

const RECEIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/eval/fixtures/receipt-abbreviated.txt',
);

async function uploadReceipt(app: ReturnType<typeof buildApp>, me: Signed) {
  const form = new FormData();
  form.append('file', readFileSync(RECEIPT_PATH), {
    filename: 'receipt.txt',
    contentType: 'text/plain',
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/attachments',
    payload: form,
    headers: { ...form.getHeaders(), cookie: me.cookie },
  });
  return res;
}

describe('POST /v1/attachments → /v1/chat with attachment → /apply', () => {
  let repo: InMemoryRepo;
  let store: InMemoryStore;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    store = new InMemoryStore();
    mailer = new ConsoleMailer();
    app = buildApp(repo, store, mailer);
    await app.ready();
  });

  it('upload → chat з attachment → intake_diff → apply', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const up = await uploadReceipt(app, me);
    expect(up.statusCode).toBe(200);
    const { id, kind } = up.json();
    expect(id).toBeTruthy();
    expect(kind).toBe('text');

    const stored = await repo.getAttachment(id);
    expect(stored?.household_id).toBe(me.household_id);
    expect(stored?.user_id).toBe(me.user_id);

    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's', text: '', attachments: [{ id }] },
    });
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.card?.type).toBe('intake_diff');
    expect(body.raw_kind).toBe('receipt');
    expect(body.card_id).toBeTruthy();

    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/apply`,
      headers: { cookie: me.cookie },
      payload: {},
    });
    expect(apply.statusCode).toBe(200);
    expect(await repo.listBatches(me.household_id)).toHaveLength(1);
  });

  it('reparse з hint зберігає підказку і повертає нову картку', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const { id } = (await uploadReceipt(app, me)).json();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/attachments/${id}/reparse`,
      headers: { cookie: me.cookie },
      payload: { hint: 'це не Президент, це Простоквашино' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().card?.type).toBe('intake_diff');
    expect((await repo.getAttachment(id))?.hint).toBe('це не Президент, це Простоквашино');
  });

  it('чужа сесія на attachment у /v1/chat — 403', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const other = await signIn(app, mailer, 'other@example.com');
    const { id } = (await uploadReceipt(app, me)).json();
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: other.cookie },
      payload: { session_id: 's', text: '', attachments: [{ id }] },
    });
    expect(chat.statusCode).toBe(403);
  });

  it('невідомий attachment у /v1/chat — 404', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: {
        session_id: 's', text: '',
        attachments: [{ id: '00000000-0000-0000-0000-000000000000' }],
      },
    });
    expect(chat.statusCode).toBe(404);
  });

  it('без cookie на /v1/attachments — 401', async () => {
    const form = new FormData();
    form.append('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    const r = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      payload: form,
      headers: form.getHeaders(),
    });
    expect(r.statusCode).toBe(401);
  });
});
