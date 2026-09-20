// D (20.09): [СПИСАНО В ЦІЙ СЕСІЇ] — блок на кожному ході сесії з застосованим
// списанням після готування; undo прибирає; до двох готувань; наступна сесія — без блока.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, undoCard, renderSessionWriteoffs, type PantryBatch } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { sessionWriteoffs } from '../src/post-cook.js';
import { buildDynamicContext } from '../src/model.js';

describe('sessionWriteoffs', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>; let mailer: ConsoleMailer;
  beforeEach(async () => { repo = new InMemoryRepo(); mailer = new ConsoleMailer(); app = buildApp(repo, new InMemoryStore(), mailer); await app.ready(); });
  async function batch(household_id: string, label: string, value: number, unit: PantryBatch['unit']): Promise<string> {
    const id = randomUUID();
    await repo.insertBatch({ id, household_id, catalog_key: null, label, zone: 'fridge', value, unit, state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null });
    return id;
  }
  /** Готування з ask_writeoff → «так» → застосоване списання в сесії. */
  let yesN = 0;
  async function cookAndWriteoff(me: { cookie: string; user_id: string }, session_id: string, title: string, ing: unknown[]) {
    const yes = ['так', 'ага', 'давай', 'спиши'][yesN++ % 4]!;   // repeat-guard ловить ту саму репліку двічі поспіль
    const cook = await app.inject({ method: 'POST', url: '/v1/cook-runs', headers: { cookie: me.cookie }, payload: { recipe: { t: title, tm: 20, sv: 2, ing, st: [{ t: 'Вари', c: 'Вари {0}' }] }, skip_pantry: true, session_id, ask_writeoff: true } });
    expect(cook.statusCode).toBe(201);
    const chat = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id, text: yes } });
    expect(chat.json().card?.type).toBe('intake_diff');
    return chat.json() as { card_id: string; undo_token: string };
  }

  it('після «так» блок є на наступних ходах сесії: партія · скільки · од., плюс «не знайшлось у коморі»', async () => {
    const me = await signIn(app, mailer, 'w1@example.com');
    const tomatoes = await batch(me.household_id, 'вʼялені томати', 200, 'g');
    const juice = await batch(me.household_id, 'лимонний сік', 100, 'ml');
    const session = await repo.createFreshSession(me.user_id, '2026-09-19');
    await cookAndWriteoff(me, session.id, 'Паста з вʼяленими томатами', [
      { p: tomatoes, n: 'вʼялені томати', v: 80, u: 'g' }, { p: juice, n: 'лимонний сік', v: 15, u: 'ml' }, { n: 'каперси', v: 20, u: 'g' },
    ]);
    const msgs = await repo.listMessages(session.id);
    const w = await sessionWriteoffs(repo, me.user_id, session.id, msgs);
    expect(w).toHaveLength(1);
    expect(w[0]!.title).toBe('Паста з вʼяленими томатами');
    expect(w[0]!.lines).toEqual([{ label: 'вʼялені томати', amount: '80 g' }, { label: 'лимонний сік', amount: '15 ml' }]);
    expect(w[0]!.notFound).toEqual(['каперси']);
    const block = renderSessionWriteoffs(w, new Date());
    expect(block).toContain('[СПИСАНО В ЦІЙ СЕСІЇ]');
    expect(block).toContain('• вʼялені томати · 80 g');
    expect(block).toContain('не знайшлось у коморі (не списано): каперси');
    // …і доїжджає в динамічний контекст ходу.
    const dyn = buildDynamicContext({ user_id: me.user_id, session_id: session.id, text: 'до речі, томати брав Helcom', pantry: [], profile: null, sessionWriteoffs: w } as never);
    expect(dyn).toContain('[СПИСАНО В ЦІЙ СЕСІЇ]');
  });

  it('скасоване undo списання не показується; до двох останніх готувань; нова сесія — без блока', async () => {
    const me = await signIn(app, mailer, 'w2@example.com');
    const session = await repo.createFreshSession(me.user_id, '2026-09-19');
    const ids: string[] = [];
    for (const t of ['Перше', 'Друге', 'Третє']) {
      const b = await batch(me.household_id, `інгредієнт ${t}`, 300, 'g');
      ids.push(b);
      await cookAndWriteoff(me, session.id, t, [{ p: b, n: `інгредієнт ${t}`, v: 100, u: 'g' }]);
    }
    let w = await sessionWriteoffs(repo, me.user_id, session.id, await repo.listMessages(session.id));
    expect(w.map((x) => x.title)).toEqual(['Друге', 'Третє']);           // лише два останні
    // undo третього → лишаються Перше й Друге
    const last = (await repo.listMessages(session.id)).filter((m) => m.card?.type === 'intake_diff').at(-1)!;
    const pc = await repo.getPending(last.id);
    await undoCard(repo, last.id, pc!.undo_token!, me.user_id);
    w = await sessionWriteoffs(repo, me.user_id, session.id, await repo.listMessages(session.id));
    expect(w.map((x) => x.title)).toEqual(['Перше', 'Друге']);
    // наступний день — інша сесія, блока нема
    const next = await repo.createFreshSession(me.user_id, '2026-09-20');
    expect(await sessionWriteoffs(repo, me.user_id, next.id, await repo.listMessages(next.id))).toEqual([]);
  });
});
