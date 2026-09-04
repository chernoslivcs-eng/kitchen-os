import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type MessageRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';
import { detectRepeat, repeatReply, REPEAT_WINDOW_MS } from '../src/repeat-guard.js';

// Аудит 04.09, раунд 2, крок 3.1 (AUDIT-ROUND-2.md §4.1): прод s41 — повтор
// «Оці чеки візьми» через хвилину після застосованого інтейку дав +58
// партій-дублів. Гард стоїть ДО моделі: та сама репліка вдруге після
// застосованої картки — детермінована відповідь, нуль токенів, нуль ops.

const T0 = Date.parse('2026-09-02T21:11:00.000Z');
function m(over: Partial<MessageRow>): MessageRow {
  return { id: randomUUID(), session_id: 's', role: 'user', text: null, card: null, applied: 0, created_at: new Date(T0).toISOString(), ...over };
}
const intakeApplied = (ops = 3) => m({
  role: 'assistant', text: 'Записав.',
  card: { type: 'intake_diff', ops: Array.from({ length: ops }, (_, i) => ({ op: 'add', label: `позиція ${i}` })) } as never,
  applied: ops,
});

describe('detectRepeat (юніти)', () => {
  it('той самий текст після застосованого intake — повтор', () => {
    const hit = detectRepeat('Оці чеки візьми', [m({ text: 'Оці чеки візьми' }), intakeApplied(79)], T0 + 60_000);
    expect(hit).toEqual({ card_type: 'intake_diff', ops: 79 });
  });

  it('нормалізація: регістр, пробіли, крапка в кінці — не роблять репліку іншою', () => {
    const hit = detectRepeat('оці  чеки візьми.', [m({ text: 'Оці чеки візьми' }), intakeApplied()], T0 + 1000);
    expect(hit?.card_type).toBe('intake_diff');
  });

  it('інший текст — не повтор', () => {
    expect(detectRepeat('Оці чеки візьми ще раз', [m({ text: 'Оці чеки візьми' }), intakeApplied()], T0 + 1000)).toBeNull();
  });

  it('за вікном — не повтор (людина могла справді купити те саме ще раз)', () => {
    expect(detectRepeat('Оці чеки візьми', [m({ text: 'Оці чеки візьми' }), intakeApplied()], T0 + REPEAT_WINDOW_MS + 1)).toBeNull();
  });

  it('картка нічого не застосувала — не повтор, хай модель спробує', () => {
    const notApplied = m({ role: 'assistant', text: 'Запишу.', card: { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] } as never, applied: 0 });
    expect(detectRepeat('Оці чеки візьми', [m({ text: 'Оці чеки візьми' }), notApplied], T0 + 1000)).toBeNull();
  });

  it('відповідь без картки (proposal-хід, null) — не повтор', () => {
    const plain = m({ role: 'assistant', text: 'Що готуємо?' });
    expect(detectRepeat('що на вечерю', [m({ text: 'що на вечерю' }), plain], T0 + 1000)).toBeNull();
  });

  it('s40: «Не їм помідори і субпродукти» двічі за 12 с після застосованого profile', () => {
    const prof = m({ role: 'assistant', text: 'Записав.', card: { type: 'profile', ops: [{ kind: 'anti', label: 'помідори' }, { kind: 'anti', label: 'субпродукти' }] } as never, applied: 2 });
    const hit = detectRepeat('Не їм помідори і субпродукти', [m({ text: 'Не їм помідори і субпродукти' }), prof], T0 + 12_000);
    expect(hit).toEqual({ card_type: 'profile', ops: 2 });
    expect(repeatReply(hit!)).toBe('Побачив. Другий раз не записую — воно вже є.');
  });

  // Крок 6в: текст більше не називає, де саме лежить (у коморі/у списку) —
  // однаковий для intake_diff/shopping, рахує лише кількість.
  it('repeatReply: рахує позиції, множина', () => {
    expect(repeatReply({ card_type: 'intake_diff', ops: 79 }))
      .toBe('Побачив. Другий раз не записую. Усіх 79 нам поки вистачить. Якщо це справді друга покупка — скажи, скільки.');
  });

  it('repeatReply: n === 1 — «Одного», не «Усіх 1»', () => {
    expect(repeatReply({ card_type: 'intake_diff', ops: 1 }))
      .toBe('Побачив. Другий раз не записую. Одного нам поки вистачить. Якщо це справді друга покупка — скажи, скільки.');
  });

  // Наступна правка: «скажи, скільки» лише там, де повтор МІГ БИ бути
  // другою покупкою/дією з кількістю (intake_diff, shopping). event/profile —
  // без хвоста і без числа: друга «не їм кінзу» не означає «два рази не їж».
  it('repeatReply: event — без хвоста «скажи, скільки»', () => {
    expect(repeatReply({ card_type: 'event', ops: 1 }))
      .toBe('Побачив. Другий раз не записую — воно вже є.');
  });

  it('repeatReply: profile — без хвоста «скажи, скільки»', () => {
    expect(repeatReply({ card_type: 'profile', ops: 3 }))
      .toBe('Побачив. Другий раз не записую — воно вже є.');
  });
});

describe('POST /v1/chat: повтор після застосованої картки — без моделі', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('друге «Оці чеки візьми» → детермінована репліка, card null, у сесії +2 повідомлення, у коморі 0 нових', async () => {
    const me = await signIn(app, mailer, 'rg1@example.com');
    const session = await repo.createFreshSession(me.user_id, '2026-09-02');
    const now = new Date().toISOString();
    await repo.saveMessage({ id: randomUUID(), session_id: session.id, role: 'user', text: 'Оці чеки візьми', card: null, applied: 0, created_at: now });
    await repo.saveMessage({
      id: randomUUID(), session_id: session.id, role: 'assistant', text: 'Два чеки з Metro — 51 позиція. Розкласти?',
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'лосось' }, { op: 'add', label: 'пармезан' }] } as never,
      applied: 2, created_at: now,
    });
    const before = (await repo.listBatches(me.household_id)).length;

    const res = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { session_id: session.id, text: 'Оці чеки візьми' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/Другий раз не записую/);
    expect(body.reply).toMatch(/Усіх 2 нам поки вистачить/);
    expect(body.meta.promptVersion).toBe('repeat-guard');
    expect(body.usage).toEqual({ input: 0, output: 0 });

    const msgs = await repo.listMessages(session.id);
    expect(msgs).toHaveLength(4);
    expect(msgs[3]!.text).toBe(body.reply);
    expect((await repo.listBatches(me.household_id)).length).toBe(before);
  });

  it('той самий текст, але попередня картка не застосована — йде в модель як завжди', async () => {
    const me = await signIn(app, mailer, 'rg2@example.com');
    const session = await repo.createFreshSession(me.user_id, '2026-09-02');
    const now = new Date().toISOString();
    await repo.saveMessage({ id: randomUUID(), session_id: session.id, role: 'user', text: 'Не люблю кінзу', card: null, applied: 0, created_at: now });
    await repo.saveMessage({
      id: randomUUID(), session_id: session.id, role: 'assistant', text: 'Запишу.',
      card: { type: 'profile', ops: [{ kind: 'anti', label: 'кінза' }] } as never, applied: 0, created_at: now,
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { session_id: session.id, text: 'Не люблю кінзу' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.promptVersion).not.toBe('repeat-guard');
  });
});
