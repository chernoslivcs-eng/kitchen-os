// 17.09: точна ціна від OpenRouter (usd_actual) — лінивий бекфіл із мок-fetch.
import { describe, it, expect, vi } from 'vitest';
import { InMemoryRepo, type TokenUsageRow } from '@kitchen/domain';
import { randomUUID } from 'node:crypto';
import { fetchGenerationCost, backfillActualCosts, type FetchLike } from '../src/openrouter-cost.js';

const row = (over: Partial<TokenUsageRow>): TokenUsageRow => ({
  id: randomUUID(), user_id: 'u', household_id: 'h', call: 'chat', profile: 'smart', model: 'google/gemini-3.8-flash',
  prompt_version: 'v', mode: 'live', input_tokens: 0, output_tokens: 106, cached_tokens: 23_440, latency_ms: 3000,
  prompt_hash: null, prompt_chars: null, message_id: null, session_id: null, cache_write_tokens: 23_440,
  created_at: new Date().toISOString(), generation_id: 'gen-1', usd_actual: null, ...over,
});
const fetchOk = (cost: Record<string, number | string | null>): FetchLike => vi.fn(async (url: string) => {
  const id = new URL(url).searchParams.get('id')!;
  const c = cost[id];
  return c === undefined
    ? { ok: false, status: 404, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ data: { id, total_cost: c } }) };
});

describe('fetchGenerationCost', () => {
  it('total_cost числом або рядком → число; 404/помилка/таймаут → null', async () => {
    expect(await fetchGenerationCost('a', 'k', { fetch: fetchOk({ a: 0.0032 }) })).toBe(0.0032);
    expect(await fetchGenerationCost('b', 'k', { fetch: fetchOk({ b: '0.0051' }) })).toBe(0.0051);
    expect(await fetchGenerationCost('c', 'k', { fetch: fetchOk({}) })).toBeNull();
    expect(await fetchGenerationCost('d', 'k', { fetch: async () => { throw new Error('boom'); } })).toBeNull();
    const slow: FetchLike = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    expect(await fetchGenerationCost('e', 'k', { fetch: slow, timeoutMs: 20 })).toBeNull();
  });
  it('шле Authorization Bearer і id у query', async () => {
    const f = fetchOk({ 'gen-x': 0.001 });
    await fetchGenerationCost('gen-x', 'sk-test', { fetch: f });
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://openrouter.ai/api/v1/generation?id=gen-x');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
  });
});

describe('backfillActualCosts', () => {
  it('заповнює лише рядки з generation_id без usd_actual; невдалі лишаються на наступний раз; без ключа — нічого', async () => {
    const repo = new InMemoryRepo();
    const a = row({ generation_id: 'gen-a' }); const b = row({ generation_id: 'gen-b' });
    const done = row({ generation_id: 'gen-c', usd_actual: 0.01 }); const noGen = row({ generation_id: null });
    for (const r of [a, b, done, noGen]) await repo.logTokenUsage(r);
    const f = fetchOk({ 'gen-a': 0.0032 });
    expect(await backfillActualCosts(repo, { apiKey: null, fetch: f })).toEqual({ checked: 0, filled: 0 });
    expect(await backfillActualCosts(repo, { apiKey: 'k', fetch: f })).toEqual({ checked: 2, filled: 1 });
    const rows = await repo.listTokenUsage('u', 100);
    expect(rows.find((r) => r.id === a.id)!.usd_actual).toBe(0.0032);
    expect(rows.find((r) => r.id === b.id)!.usd_actual).toBeNull();
    expect(rows.find((r) => r.id === done.id)!.usd_actual).toBe(0.01);
    // Другий прохід: лише b лишився в черзі.
    expect(await backfillActualCosts(repo, { apiKey: 'k', fetch: fetchOk({ 'gen-b': 0.0051 }) })).toEqual({ checked: 1, filled: 1 });
  });
  it('ліміт за запит', async () => {
    const repo = new InMemoryRepo();
    for (let i = 0; i < 7; i++) await repo.logTokenUsage(row({ generation_id: `gen-${i}` }));
    const f = fetchOk(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`gen-${i}`, 0.001])));
    expect(await backfillActualCosts(repo, { apiKey: 'k', fetch: f, limit: 5 })).toEqual({ checked: 5, filled: 5 });
  });
});
