import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';

// Інтеграція: /v1/chat повертає картку (не застосовану), /apply мутує стан,
// /undo повертає назад. Плюс ідемпотентність повторного apply.
// Без ANTHROPIC_API_KEY модель у режимі стаба: «купив X» → intake_diff add(X).

const HH = 'hh-1';
const U = 'user-1';

describe('POST /v1/chat → /apply → /undo', () => {
  let repo: InMemoryRepo;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    app = buildApp(repo);
    await app.ready();
  });

  it('картку віддано, комору не змінено; apply створює партію; undo видаляє', async () => {
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { user_id: U, household_id: HH, session_id: 's', text: 'купив моцарелу 250 г' },
    });
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.card?.type).toBe('intake_diff');
    expect(body.card_id).toBeTruthy();

    // До apply — комора порожня.
    expect(await repo.listBatches(HH)).toHaveLength(0);

    // Apply.
    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/apply`,
      payload: { user_id: U, selected: [] },
    });
    expect(apply.statusCode).toBe(200);
    const applyBody = apply.json();
    expect(applyBody.applied).toBe(1);
    expect(applyBody.undo_token).toBeTruthy();

    const batches = await repo.listBatches(HH);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.label.toLowerCase()).toContain('моцарел');

    // Повторний apply — no-op, той самий undo_token.
    const apply2 = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/apply`,
      payload: { user_id: U },
    });
    const apply2Body = apply2.json();
    expect(apply2Body.already).toBe(true);
    expect(apply2Body.undo_token).toBe(applyBody.undo_token);
    expect(await repo.listBatches(HH)).toHaveLength(1);

    // Undo.
    const undo = await app.inject({
      method: 'POST',
      url: `/v1/cards/${body.card_id}/undo`,
      payload: { user_id: U, undo_token: applyBody.undo_token },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().undone).toBe(true);
    expect(await repo.listBatches(HH)).toHaveLength(0);
  });

  it('стаб не породжує картку на нейтральний текст', async () => {
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { user_id: U, household_id: HH, session_id: 's', text: 'привіт' },
    });
    const body = chat.json();
    expect(body.card).toBeNull();
    expect(body.card_id).toBeNull();
  });

  it('чужий актор на apply — 403', async () => {
    const chat = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { user_id: U, household_id: HH, session_id: 's', text: 'купив пармезан' },
    });
    const { card_id } = chat.json();
    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/${card_id}/apply`,
      payload: { user_id: 'user-2' },
    });
    expect(apply.statusCode).toBe(403);
  });

  it('apply з неіснуючим card_id — 404', async () => {
    const apply = await app.inject({
      method: 'POST',
      url: `/v1/cards/00000000-0000-0000-0000-000000000000/apply`,
      payload: { user_id: U },
    });
    expect(apply.statusCode).toBe(404);
  });

  it('/v1/chat без обовʼязкових полів — 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/chat', payload: { text: 'куп молоко' } });
    expect(r.statusCode).toBe(400);
  });
});
