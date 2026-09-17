// 17.09: точна ціна виклику від OpenRouter — GET /api/v1/generation?id=<gen>
// (той самий OPENROUTER_API_KEY), поле data.total_cost у USD. Наша формула
// в pricing.ts — оцінка; для Gemini вона завищувала ~2× (Anthropic-сумісний
// ендпойнт віддає cache_creation = cache_read). Тягнемо ЛІНИВО з
// /v1/admin/money (≤ 50 рядків за запит, 5 паралельно, 3 с на кожен), а не в
// хвості ходу людини: на Vercel fire-and-forget після відповіді не доживає
// надійно, а латентність ходу нам дорожча за свіжість адмінки. Рядок, який не
// вдалось підтягнути (генерація ще не готова, 404, таймаут), лишається null і
// піде в наступний прохід.
import type { Repo } from '@kitchen/domain';

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function fetchGenerationCost(
  generation_id: string,
  apiKey: string,
  opts: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<number | null> {
  const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000);
  try {
    const res = await f(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generation_id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { total_cost?: number | string | null } };
    const cost = body.data?.total_cost;
    const n = typeof cost === 'string' ? Number(cost) : cost;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Лінивий бекфіл: до `limit` рядків без usd_actual → OpenRouter → база. Повертає, скільки заповнено. */
export async function backfillActualCosts(
  repo: Repo,
  opts: { apiKey?: string | null; limit?: number; concurrency?: number; fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<{ checked: number; filled: number }> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY ?? null;
  if (!apiKey) return { checked: 0, filled: 0 };
  const rows = await repo.listTokenUsageWithoutActual(opts.limit ?? 50);
  let filled = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const usd = await fetchGenerationCost(r.generation_id, apiKey, { fetch: opts.fetch, timeoutMs: opts.timeoutMs });
      if (usd !== null) { await repo.setTokenUsageActual(r.id, usd); filled++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 5, rows.length) }, worker));
  return { checked: rows.length, filled };
}
