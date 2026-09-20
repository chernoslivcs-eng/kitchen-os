// 20.09: recipe_gen повернув нерозбірний JSON (факт 19:10 у Telegram власника) —
// запасний шлях показує людині сирий текст, як і раніше (поведінку не міняємо),
// але ПЕРЕД цим пише інцидент recipe-json-failed із сирим текстом і app_event
// recipe_json_failed — щоб міряти частоту в /admin/pulse.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('recipe_gen без рецепта → інцидент і app_event', () => {
  let repo: InMemoryRepo; let app: ReturnType<typeof buildApp>; let mailer: ConsoleMailer;
  beforeEach(async () => { repo = new InMemoryRepo(); mailer = new ConsoleMailer(); app = buildApp(repo, new InMemoryStore(), mailer); await app.ready(); });

  it('cook_go → стаб віддає «json {"t":…» без рецепта: людині — проза як було; інцидент із raw/stop/out/looksJson; app_event recipe_json_failed', async () => {
    const me = await signIn(app, mailer, 'json@example.com');
    const res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { text: 'готуємо «Лосось (проза)»' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.card).toBeNull();
    expect(body.reply).toContain('json {"t":');                       // поведінка не змінена
    const ev = await repo.listAppEvents(me.user_id, { from: new Date(0), to: new Date(Date.now() + 60_000), limit: 50 });
    const inc = ev.find((e) => e.name === 'incident:recipe-json-failed');
    expect(inc?.props).toMatchObject({ kind: 'guard', title: 'Лосось (проза)', stop: 'end_turn', out: 666, looksJson: true });
    expect(String((inc?.props as { raw?: string }).raw)).toContain('json {"t":"Лосось (проза)"');
    const plain = ev.find((e) => e.name === 'recipe_json_failed');
    expect(plain?.props).toMatchObject({ looksJson: true, out: 666 });
    expect(plain?.device_class).toBeNull();                            // писав сервер
  });

  it('звичайний cook_go — рецепт є, подій нема', async () => {
    const me = await signIn(app, mailer, 'ok@example.com');
    const res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { text: 'готуємо «Лосось на сковороді»' } });
    expect(res.json().card?.type).toBe('recipe_link');
    const ev = await repo.listAppEvents(me.user_id, { from: new Date(0), to: new Date(Date.now() + 60_000), limit: 50 });
    expect(ev.some((e) => e.name === 'recipe_json_failed' || e.name === 'incident:recipe-json-failed')).toBe(false);
  });
});
