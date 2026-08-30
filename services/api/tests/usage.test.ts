import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Кожен виклик моделі має писати рядок у token_usage — навіть коли це стаб.
// У прод-режимі фільтруємо по mode='live'; у дев/CI видно, що виклик відбувся.

describe('token_usage: логування виклику моделі', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('/v1/chat пише рядок у token_usage з правильним контекстом', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's', text: 'привіт' },
    });
    const rows = await repo.listTokenUsage(me.user_id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.user_id).toBe(me.user_id);
    expect(row.household_id).toBe(me.household_id);
    expect(row.call).toBe('chat');
    expect(row.mode).toBe('stub');           // без ANTHROPIC_API_KEY
    expect(row.profile).toBe('stub');
    expect(row.model).toBe('stub');
    expect(row.prompt_version).toBe('2026-08-28');
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('два виклики — два рядки, у зворотному порядку часу', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's', text: 'куп молоко' },
    });
    await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: me.cookie },
      payload: { session_id: 's', text: 'привіт' },
    });
    const rows = await repo.listTokenUsage(me.user_id);
    expect(rows).toHaveLength(2);
    // listTokenUsage повертає найновішим першим
    expect(rows[0]!.created_at >= rows[1]!.created_at).toBe(true);
  });

  it('виклик іншого користувача не потрапляє в вибірку', async () => {
    const me = await signIn(app, mailer, 'me@example.com');
    const other = await signIn(app, mailer, 'other@example.com');
    await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: other.cookie },
      payload: { session_id: 's', text: 'привіт' },
    });
    expect(await repo.listTokenUsage(me.user_id)).toHaveLength(0);
    expect(await repo.listTokenUsage(other.user_id)).toHaveLength(1);
  });
});

// A3 (OPTIMIZATION_PLAN): аудит зловив ріст промпту +3,2k ток./виклик під
// незмінним promptVersion — редагування «на місці» невидиме для телеметрії.
// Тепер кожен live-виклик несе хеш і довжину СКОМПОНОВАНОГО стабільного
// префікса: зміна тексту видна в token_usage постфактум, без тертя в DX.
describe('A3: prompt_hash/prompt_chars у token_usage', () => {
  it('recordUsage пише hash і chars, коли meta їх несе', async () => {
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    const ctx = { user_id: 'u1', household_id: 'h1' };
    await recordUsage(
      repo,
      ctx as Parameters<typeof recordUsage>[1],
      'chat',
      { promptVersion: '2026-08-28', model: 'stub', mode: 'live', prompt_hash: 'abc123def456', prompt_chars: 42_000 },
      { input: 100, output: 10, cached: 90 },
      Date.now(),
    );
    const rows = await repo.listTokenUsage('u1');
    expect(rows[0]!.prompt_hash).toBe('abc123def456');
    expect(rows[0]!.prompt_chars).toBe(42_000);
  });

  it('без hash у meta — null, не падає (stub-режим)', async () => {
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    await recordUsage(
      repo,
      { user_id: 'u1', household_id: 'h1' } as Parameters<typeof recordUsage>[1],
      'chat',
      { promptVersion: '2026-08-28', model: 'stub', mode: 'stub' },
      { input: 0, output: 0 },
      Date.now(),
    );
    const rows = await repo.listTokenUsage('u1');
    expect(rows[0]!.prompt_hash).toBeNull();
    expect(rows[0]!.prompt_chars).toBeNull();
  });
});
