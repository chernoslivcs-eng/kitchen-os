// Пул-9 №2: вкладення видно в надісланій репліці — і після перезавантаження.
//
// Було: /v1/chat писав user-message із текстом «[вкладення]», а сам файл
// лишався з message_id: null. Стрічка після F5 показувала підпис замість
// файлів, і відкрити те, що людина закинула, було неможливо в принципі.
//
// Тест на МЕЖУ: що віддає GET сесії (з нього стрічка гідратується) і що
// бачить модель в історії розмови.

import { describe, it, expect, beforeEach } from 'vitest';
import FormData from 'form-data';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { buildChatHistory } from '../src/chat-history.js';
import { signIn, type Signed } from './helpers.js';

async function upload(app: ReturnType<typeof buildApp>, me: Signed, body = 'молоко 2 шт') {
  const form = new FormData();
  form.append('file', Buffer.from(body), { filename: 'chek.txt', contentType: 'text/plain' });
  const res = await app.inject({
    method: 'POST', url: '/v1/attachments', payload: form,
    headers: { ...form.getHeaders(), cookie: me.cookie },
  });
  return res.json().id as string;
}

describe('вкладення живе в ході розмови', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;
  let mailer: ConsoleMailer;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('чат прив’язує файл до user-ходу, і GET сесії його віддає', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const id = await upload(app, me);

    const chat = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: '', attachments: [{ id }] },
    });
    expect(chat.statusCode).toBe(200);

    // Прив’язка: message_id більше не null.
    const stored = await repo.getAttachment(id);
    expect(stored?.message_id).toBeTruthy();

    // Гідратація стрічки: у ході є вкладення з mime — саме з нього клієнт
    // рахує, малювати мініатюру чи «TXT».
    const today = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    const messages = today.json().messages as {
      role: string; text: string | null; attachments?: { id: string; mime: string | null }[];
    }[];
    const userTurn = messages.find((m) => m.role === 'user');
    expect(userTurn?.attachments).toEqual([{ id, mime: 'text/plain' }]);
    // І жодного підпису за людину: вона не писала «[вкладення]».
    expect(userTurn?.text).toBeNull();
  });

  it('текст людини лишається текстом, а файл — окремо', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const id = await upload(app, me);
    await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'ось учорашній чек', attachments: [{ id }] },
    });

    const today = await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie: me.cookie } });
    const userTurn = (today.json().messages as { role: string; text: string | null }[]).find((m) => m.role === 'user');
    expect(userTurn?.text).toBe('ось учорашній чек');
  });

  it('модель у історії й далі бачить факт вкладення', () => {
    // Мітка більше не зберігається як репліка людини — вона збирається з
    // прив’язаних файлів. Для моделі результат той самий.
    const history = buildChatHistory([
      {
        id: 'm1', session_id: 's1', role: 'user', text: null, card: null, applied: 0,
        created_at: '2026-09-06T09:07:00.000Z',
        attachments: [{ id: 'a1', mime: 'image/jpeg' }, { id: 'a2', mime: 'image/jpeg' }],
      },
    ]);
    expect(history).toHaveLength(1);
    expect(history[0]!.content).toContain('[вкладення: 2]');
  });
});
