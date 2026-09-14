import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, HELP_TOPICS } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { renderTurnMessages } from '../src/telegram.js';

// UI-NOTES-0914 п. 6–7: шість довідок без моделі. Тап по чіпу →
// POST /v1/chat/scripted {topic}: у розмову лягають репліка людини (підпис
// чіпа) і репліка Кухні з текстом-каноном — переживають F5. Коротке питання
// з однією темою у /v1/chat → та сама довідка, модель не викликається.

describe('довідки без моделі', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo(); mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });
  // Сесія дня додає картку онбордингу профілю (session.ts) — вона не про довідки, прибираємо.
  const today = async (cookie: string) => {
    const j = (await app.inject({ method: 'GET', url: '/v1/session/today', headers: { cookie } })).json();
    return { ...j, messages: j.messages.filter((m: { card: { type?: string } | null }) => m.card?.type !== 'onboarding') };
  };

  it('POST /v1/chat/scripted {topic} кладе дві репліки дослівно й повертає довідку', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const topic = HELP_TOPICS.find((t) => t.id === 'pantry')!;
    const res = await app.inject({ method: 'POST', url: '/v1/chat/scripted', headers: { cookie: me.cookie }, payload: { topic: 'pantry' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toBe(topic.text);
    expect(body.reply).toContain('\n\n'); // абзаци канону — і в Telegram-тексті
    expect(body.card).toBeNull();
    expect(body.meta.scripted).toBe('pantry');
    expect(body.meta.model).toBe('deterministic');
    const { messages } = await today(me.cookie);
    expect(messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([['user', topic.chip], ['assistant', topic.text]]);
  });

  it('невідома тема → 400', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const res = await app.inject({ method: 'POST', url: '/v1/chat/scripted', headers: { cookie: me.cookie }, payload: { topic: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('/v1/chat: «як підключити телеграм?» → довідка telegram, без моделі', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { text: 'як підключити телеграм?' } });
    const body = res.json();
    expect(body.meta.scripted).toBe('telegram');
    expect(body.reply).toBe(HELP_TOPICS.find((t) => t.id === 'telegram')!.text);
    const { messages } = await today(me.cookie);
    expect(messages.map((m: { role: string; text: string }) => m.text)).toEqual(['як підключити телеграм?', body.reply]);
  });

  it('/v1/chat: «що на вечерю?» — не довідка', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { text: 'що на вечерю?' } });
    expect(res.json().meta.scripted).toBeUndefined();
  });
});

describe('довідка в Telegram', () => {
  it('**…** → <b>…</b>, решта екранована; звичайна репліка зірочки лишає', () => {
    const [m] = renderTurnMessages({ reply: 'Відкрий **Профіль → Акаунт** & далі', card: null, scripted: true }, 'https://x');
    expect(m).toContain('Відкрий <b>Профіль → Акаунт</b> &amp; далі');
    const [n] = renderTurnMessages({ reply: 'Ось **так**', card: null }, 'https://x');
    expect(n).toContain('Ось **так**');
  });
});
