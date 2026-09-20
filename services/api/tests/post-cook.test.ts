// Правка №6: пост-готування живе в чаті. «Приготували» закриває Cook Mode,
// далі — детерміновані ходи без моделі: «Списати продукти?» → «так» дає
// готову intake_diff-картку списання → apply/«Ні» → «Як вийшло?» → відповідь
// іде звичайним чатом, а сервер сам пише її у verdict останнього готування.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type PantryBatch } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { randomUUID } from 'node:crypto';
import {
  isYes, isNo, extractRating,
  WRITEOFF_PROMPT, FEEDBACK_PROMPT, WRITEOFF_CARD_REPLY, splitLeadingAnswer,
} from '../src/post-cook.js';

describe('post-cook детермінатика (юніти)', () => {
  it('isYes ловить згоду, не ловить «так собі»', () => {
    for (const t of ['так', 'Так!', 'ага', 'спиши', 'списуй все', 'давай', 'ок', 'так, спиши']) {
      expect(isYes(t), t).toBe(true);
    }
    for (const t of ['так собі', 'ні', 'не треба', 'а що лишилось у коморі?', 'потім']) {
      expect(isYes(t), t).toBe(false);
    }
  });

  // 19.09: «Так. І що до цього з напоїв? Вино?» — рішення з першого сегмента, решта моделі.
  it('splitLeadingAnswer: рішення з першого сегмента, решта — окремо; без розділювача — як isYes/isNo', () => {
    expect(splitLeadingAnswer('Так. І що до цього з напоїв? Вино?')).toEqual({ decision: 'yes', rest: 'І що до цього з напоїв? Вино?' });
    expect(splitLeadingAnswer('Ні, потім. А що на завтра?')).toEqual({ decision: 'no', rest: 'А що на завтра?' });
    expect(splitLeadingAnswer('Так')).toEqual({ decision: 'yes', rest: '' });
    expect(splitLeadingAnswer('так собі')).toEqual({ decision: null, rest: '' });
    expect(splitLeadingAnswer('Давай!\nА вино?')).toEqual({ decision: 'yes', rest: 'А вино?' });
    expect(splitLeadingAnswer('спиши тільки спагеті. решту ні')).toEqual({ decision: null, rest: '' });
  });

  it('isNo ловить відмову', () => {
    for (const t of ['ні', 'Ні.', 'не треба', 'нічого не списуй', 'потім', 'пізніше']) {
      expect(isNo(t), t).toBe(true);
    }
    for (const t of ['так', 'спиши', 'вийшло ніби непогано']) {
      expect(isNo(t), t).toBe(false);
    }
  });

  it('extractRating: словоформи і цифри 1-5', () => {
    expect(extractRating('на четвірку')).toBe(4);
    expect(extractRating('пʼятірка, всім зайшло')).toBe(5);
    expect(extractRating('десь на трійку')).toBe(3);
    expect(extractRating('4 з 5')).toBe(4);
    expect(extractRating('5/5')).toBe(5);
    expect(extractRating('смачно було, але пересолив')).toBe(null);
    expect(extractRating('варив 10 хвилин, вийшло добре')).toBe(null);
  });
});

describe('post-cook флоу в чаті', () => {
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

  async function addBatch(household_id: string, patch: Partial<PantryBatch>): Promise<string> {
    const id = randomUUID();
    await repo.insertBatch({
      id, household_id, catalog_key: null, label: 'спагеті', zone: 'dry',
      value: 500, unit: 'g', state: 'sealed', opened_at: null, expires_at: null,
      best_before_opened_days: null, added_at: new Date().toISOString(),
      depleted_at: null, confidence: 1, provenance: 'user_statement',
      staple: false, last_by: null, last_action: null, ...patch,
    });
    return id;
  }

  // Спільний сетап: сесія + готування з ask_writeoff → «Списати продукти?» в сесії.
  async function cookInSession(me: Awaited<ReturnType<typeof signIn>>, ing: unknown[]) {
    const session = await repo.createFreshSession(me.user_id, '2026-08-30');
    const cook = await app.inject({
      method: 'POST', url: '/v1/cook-runs',
      headers: { cookie: me.cookie },
      payload: {
        recipe: { t: 'Паста', tm: 20, sv: 2, ing, st: [{ t: 'Вари', c: 'Вари {0}' }] },
        skip_pantry: true,
        session_id: session.id,
        ask_writeoff: true,
      },
    });
    expect(cook.statusCode).toBe(201);
    return { session, run_id: cook.json().id as string };
  }

  it('ask_writeoff: комора не чіпається, у сесії зʼявляється «Списати продукти?»', async () => {
    const me = await signIn(app, mailer, 'pc1@example.com');
    const batchId = await addBatch(me.household_id, {});
    const { session } = await cookInSession(me, [{ p: batchId, n: 'спагеті', v: 320, u: 'g' }]);

    expect((await repo.getBatch(batchId))?.state).toBe('sealed');   // skip_pantry
    const msgs = await repo.listMessages(session.id);
    const last = msgs[msgs.length - 1]!;
    expect(last.role).toBe('assistant');
    expect(last.text).toBe(WRITEOFF_PROMPT);
  });

  it('«так» → детермінована intake_diff-картка (correct для часткового, deplete для повного)', async () => {
    const me = await signIn(app, mailer, 'pc2@example.com');
    const partialId = await addBatch(me.household_id, { label: 'спагеті', value: 500 });
    const fullId = await addBatch(me.household_id, { label: 'вершки 33%', value: 200, unit: 'ml', zone: 'fridge' });
    const { session } = await cookInSession(me, [
      { p: partialId, n: 'спагеті', v: 320, u: 'g' },
      { p: fullId, n: 'вершки 33%', v: 200, u: 'ml' },
    ]);

    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: session.id, text: 'так' },
    });
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    // Детермінований шорткат: без моделі (у stub-режимі reply починався б із [STUB…]).
    expect(body.reply).not.toContain('[STUB');
    expect(body.card?.type).toBe('intake_diff');
    expect(body.card_id).toBeTruthy();
    const ops = body.card.ops as { op: string; label: string; value?: number }[];
    expect(ops).toHaveLength(2);
    expect(ops.find((o) => o.label === 'спагеті')).toMatchObject({ op: 'correct', value: 180 });
    expect(ops.find((o) => o.label === 'вершки 33%')).toMatchObject({ op: 'deplete' });
    expect(body.usage.input).toBe(0);   // 0 токенів

    // Пул-8 №2: картка списання застосована ОДРАЗУ — комора змінилась без
    // «Застосувати», відповідь несе undo_token і followup «Як вийшло?».
    expect(body.auto_applied).toBe(true);
    expect(body.undo_token).toBeTruthy();
    expect(body.followup).toBe(FEEDBACK_PROMPT);
    expect((await repo.getBatch(partialId))?.value).toBe(180);
    expect((await repo.getBatch(fullId))?.state).toBe('depleted');
    const msgs = await repo.listMessages(session.id);
    expect(msgs[msgs.length - 1]!.text).toBe(FEEDBACK_PROMPT);

    // Ручний apply тепер ідемпотентний повтор — без другого followup-ходу.
    const apply = await app.inject({
      method: 'POST', url: `/v1/cards/${body.card_id}/apply`,
      headers: { cookie: me.cookie },
      payload: {},
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().already).toBe(true);
    expect((await repo.listMessages(session.id)).filter((m) => m.text === FEEDBACK_PROMPT)).toHaveLength(1);
  });

  it('«ні» → детерміноване «Як вийшло?», комора недоторкана, без картки', async () => {
    const me = await signIn(app, mailer, 'pc3@example.com');
    const batchId = await addBatch(me.household_id, {});
    const { session } = await cookInSession(me, [{ p: batchId, n: 'спагеті', v: 320, u: 'g' }]);

    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: session.id, text: 'не треба' },
    });
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.card).toBe(null);
    expect(body.reply.endsWith(FEEDBACK_PROMPT)).toBe(true);
    expect((await repo.getBatch(batchId))?.state).toBe('sealed');
  });

  it('відповідь на «Як вийшло?» → verdict і rating в останній run цієї сесії', async () => {
    const me = await signIn(app, mailer, 'pc4@example.com');
    const batchId = await addBatch(me.household_id, {});
    const { session, run_id } = await cookInSession(me, [{ p: batchId, n: 'спагеті', v: 320, u: 'g' }]);

    // «ні» ставить маркер «Як вийшло?»
    await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: session.id, text: 'ні' },
    });
    // відповідь іде звичайним чатом, але сервер пише verdict/rating детерміновано
    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: session.id, text: 'на четвірку, трохи пересолив' },
    });
    expect(chat.statusCode).toBe(200);
    const run = await repo.getCookRun(run_id);
    expect(run?.rating).toBe(4);
    expect(run?.verdict).toContain('пересолив');
  });

  it('складна відповідь на «Списати продукти?» йде звичайним чатом', async () => {
    const me = await signIn(app, mailer, 'pc5@example.com');
    const batchId = await addBatch(me.household_id, {});
    const { session } = await cookInSession(me, [{ p: batchId, n: 'спагеті', v: 320, u: 'g' }]);

    const chat = await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: session.id, text: 'спиши тільки спагеті, вершки я не використав' },
    });
    expect(chat.statusCode).toBe(200);
    // stub-режим: модель відповіла своїм текстом — шорткат НЕ спрацював.
    expect(chat.json().reply).toContain('[STUB');
  });

  // Живий прохід 19.09: згода + паралельне питання в одному повідомленні —
  // списання ПРОПАДАЛО (усе йшло моделі як чат). Тепер: списано + картка, а
  // решта — моделі в тому самому повідомленні; «Як вийшло?» — останнім.
  it('«Так. І що до цього з напоїв? Вино?» → списання застосовано, картка з undo, решта пішла моделі, «Як вийшло?» стоїть останнім', async () => {
    const me = await signIn(app, mailer, 'pc6@example.com');
    const batchId = await addBatch(me.household_id, { label: 'спагеті', value: 500 });
    const { session } = await cookInSession(me, [{ p: batchId, n: 'спагеті', v: 320, u: 'g' }]);
    const chat = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: session.id, text: 'Так. І що до цього з напоїв? Вино?' } });
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.reply.startsWith(WRITEOFF_CARD_REPLY)).toBe(true);
    expect(body.reply).toContain('[STUB');                         // модель відповіла на решту
    expect(body.card?.type).toBe('intake_diff');
    expect(body.auto_applied).toBe(true);
    expect(body.undo_token).toBeTruthy();
    expect(body.followup).toBe(FEEDBACK_PROMPT);
    const b = (await repo.listBatches(me.household_id)).find((x) => x.id === batchId)!;
    expect(b.value).toBe(180);                                      // 500 − 320 — списано
    const msgs = await repo.listMessages(session.id);
    expect(msgs.filter((m) => m.role === 'user').map((m) => m.text)).toContain('Так. І що до цього з напоїв? Вино?');
    expect(msgs.filter((m) => m.role === 'user').length).toBe(1);   // репліка людини — раз, повністю
    expect(msgs[msgs.length - 1]!.text).toBe(FEEDBACK_PROMPT);       // «Як вийшло?» не губиться
    // Модель отримала лише решту (стаб луною повертає вхід).
    expect(body.reply).toContain('І що до цього з напоїв? Вино?');
    expect(body.reply.split('[STUB')[1]).not.toContain('Так. І що');
  });

  it('«Ні, потім. А що на завтра?» → комора недоторкана, решта пішла моделі, «Як вийшло?» останнім', async () => {
    const me = await signIn(app, mailer, 'pc7@example.com');
    const batchId = await addBatch(me.household_id, { label: 'спагеті', value: 500 });
    const { session } = await cookInSession(me, [{ p: batchId, n: 'спагеті', v: 320, u: 'g' }]);
    const chat = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: session.id, text: 'Ні, потім. А що на завтра?' } });
    const body = chat.json();
    expect(body.reply.startsWith('Гаразд, комору не чіпаю.')).toBe(true);
    expect(body.reply).toContain('[STUB');
    expect(body.card).toBeNull();
    expect((await repo.listBatches(me.household_id)).find((x) => x.id === batchId)!.value).toBe(500);
    const msgs = await repo.listMessages(session.id);
    expect(msgs[msgs.length - 1]!.text).toBe(FEEDBACK_PROMPT);
  });

  it('«так собі» — не згода: звичайний чат, комора недоторкана', async () => {
    const me = await signIn(app, mailer, 'pc8@example.com');
    const batchId = await addBatch(me.household_id, { label: 'спагеті', value: 500 });
    const { session } = await cookInSession(me, [{ p: batchId, n: 'спагеті', v: 320, u: 'g' }]);
    const chat = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: session.id, text: 'так собі' } });
    expect(chat.json().reply).toContain('[STUB');
    expect(chat.json().card).toBeNull();
    expect((await repo.listBatches(me.household_id)).find((x) => x.id === batchId)!.value).toBe(500);
  });
});
