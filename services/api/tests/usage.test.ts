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
      [{ input: 100, output: 10, cached: 90 }],
      Date.now(),
    );
    const rows = await repo.listTokenUsage('u1');
    expect(rows[0]!.prompt_hash).toBe('abc123def456');
    expect(rows[0]!.prompt_chars).toBe(42_000);
  });

  it('крок А5: cache_write доїжджає до бази, а не гине по дорозі', async () => {
    // model.ts діставав `cache_creation_input_tokens` і вів його аж сюди, а
    // recordUsage не мав такого поля в сигнатурі — найдорожчий рід вхідних
    // токенів не потрапляв у базу взагалі.
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    await recordUsage(
      repo,
      { user_id: 'u1', household_id: 'h1' } as Parameters<typeof recordUsage>[1],
      'chat',
      { promptVersion: '2026-08-28', model: 'stub', mode: 'live' },
      [{ input: 1_420, output: 220, cached: 0, cache_write: 22_700 }],
      Date.now(),
    );
    expect((await repo.listTokenUsage('u1'))[0]!.cache_write_tokens).toBe(22_700);
  });

  it('крок А5: провайдер не сказав про запис — це null, а НЕ нуль', async () => {
    // Різниця вирішальна для чесності старих періодів. Нуль означав би «записів
    // не було» і робив би період повним; null означає «ми не знаємо», і саме
    // за ним екран каже, що підсумок занижений.
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    await recordUsage(
      repo,
      { user_id: 'u1', household_id: 'h1' } as Parameters<typeof recordUsage>[1],
      'chat',
      { promptVersion: '2026-08-28', model: 'stub', mode: 'live' },
      [{ input: 10, output: 5 }],     // поля cache_write немає взагалі
      Date.now(),
    );
    expect((await repo.listTokenUsage('u1'))[0]!.cache_write_tokens).toBeNull();
  });

  it('без hash у meta — null, не падає (stub-режим)', async () => {
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    await recordUsage(
      repo,
      { user_id: 'u1', household_id: 'h1' } as Parameters<typeof recordUsage>[1],
      'chat',
      { promptVersion: '2026-08-28', model: 'stub', mode: 'stub' },
      [{ input: 0, output: 0 }],
      Date.now(),
    );
    const rows = await repo.listTokenUsage('u1');
    expect(rows[0]!.prompt_hash).toBeNull();
    expect(rows[0]!.prompt_chars).toBeNull();
  });
});

// Крок А4б: РЯДОК ОБЛІКУ = ОДИН ВИКЛИК МОДЕЛІ.
//
// Звірка Зведення за 8 вересня з рядками OpenRouter: гроші зійшлись ($0,5866
// проти $0,5874 — уся різниця в округленні самих рядків рахунку), а кількість
// ні: там 11 викликів, у нас 8. Недостача йшла ПАРАМИ — рівно там, де один
// крок робив два звернення до моделі, а ми складали їх в один рядок.
//
// Гроші від цього не страждали. Страждав знаменник: «ціна одного виклику» —
// та колонка, заради якої блок грошей і зроблено — була завищена вдвічі.
describe('А4б: один виклик моделі — один рядок обліку', () => {
  const ctx = { user_id: 'u1', household_id: 'h1' } as Parameters<typeof import('../src/usage.js').recordUsage>[1];
  const meta = { promptVersion: '2026-08-28', model: 'anthropic/claude-sonnet-4.5', mode: 'live' as const };

  it('крок із двох викликів дає два рядки під одним message_id', async () => {
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    await recordUsage(repo, ctx, 'chat', meta, [
      { input: 12_841, output: 1_000, cached: 0, cache_write: 22_372 },
      { input: 1_452, output: 323, cached: 22_372, cache_write: 0 },
    ], Date.now(), { message_id: 'm1', session_id: 's1' });

    const rows = await repo.listTokenUsage('u1');
    expect(rows).toHaveLength(2);
    // Зшивання хода не змінилось: обидва рядки належать тому самому ходу.
    expect(rows.every((r) => r.message_id === 'm1')).toBe(true);
    // І кожен несе СВОЇ токени, а не половину суми.
    expect(rows.map((r) => r.input_tokens).sort((a, b) => a - b)).toEqual([1_452, 12_841]);
  });

  it('ціна хода лишається сумою його рядків — вона й раніше була права', async () => {
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    const { priceOf } = await import('../src/pricing.js');
    await recordUsage(repo, ctx, 'chat', meta, [
      { input: 12_841, output: 1_000, cached: 0, cache_write: 22_372 },
      { input: 1_452, output: 323, cached: 22_372, cache_write: 0 },
    ], Date.now(), { message_id: 'm1', session_id: 's1' });

    const rows = await repo.listTokenUsage('u1');
    const turn = rows.reduce((n, r) => n + (priceOf(r) ?? 0), 0);
    // Та сама сума, що вийшла б з одного злитого рядка: ціна лінійна.
    const merged = priceOf({
      model: meta.model, input_tokens: 14_293, output_tokens: 1_323,
      cached_tokens: 22_372, cache_write_tokens: 22_372,
    })!;
    expect(turn).toBeCloseTo(merged, 9);
  });

  it('розбір двох вкладень дає два рядки, не один', async () => {
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    const { mergeAttachmentCalls } = await import('../src/attachment-merge.js');
    const one = (input: number) => ({
      reply: 'Розібрав.', raw_kind: 'receipt' as const,
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'сир' }] } as never,
      calls: [{ input, output: 3_000, cached: 0, cache_write: 4_025 }],
      meta,
    });
    const merged = mergeAttachmentCalls([one(1_500), one(1_536)]);
    await recordUsage(repo, ctx, 'attachment_parse', merged.meta, merged.calls, Date.now(), {
      message_id: 'm1', session_id: 's1',
    });
    expect(await repo.listTokenUsage('u1')).toHaveLength(2);
  });

  it('латентність — на кроці, а не на виклику: другий рядок її не дублює', async () => {
    // І пульс, і середні складають латентність рядків одного ходу. Продублювати
    // виміряний час на кожен рядок означало б подвоїти час, який людина чекала.
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    await recordUsage(repo, ctx, 'chat', meta, [
      { input: 10, output: 5 },
      { input: 20, output: 8 },
    ], Date.now() - 4_000, { message_id: 'm1', session_id: 's1' });

    const rows = await repo.listTokenUsage('u1');
    const measured = rows.filter((r) => r.latency_ms !== null);
    expect(measured).toHaveLength(1);
    expect(measured[0]!.latency_ms).toBeGreaterThanOrEqual(4_000);
  });

  it('стабовий виклик лишається одним рядком — він БУВ, просто нічого не коштував', async () => {
    const repo = new InMemoryRepo();
    const { recordUsage } = await import('../src/usage.js');
    const { ZERO_USAGE } = await import('../src/model.js');
    await recordUsage(repo, ctx, 'chat', { ...meta, mode: 'stub' }, [ZERO_USAGE], Date.now());
    expect(await repo.listTokenUsage('u1')).toHaveLength(1);
  });
});
