import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHeaders, isSessionExpired, api, ApiError, registerIncidentSink } from './api.js';

// Регресія на FIX-02 з qa-report.md: Fastify з app/json-парсером відкидає
// запит із Content-Type: application/json і порожнім тілом
// (FST_ERR_CTP_EMPTY_JSON_BODY). Всі DELETE'и клієнта на цьому мовчки
// падали. buildHeaders() ставить Content-Type тільки за наявності body.

describe('buildHeaders', () => {
  it('без тіла не ставить Content-Type', () => {
    expect(buildHeaders({ method: 'DELETE' })).toEqual({});
  });

  it('з тілом ставить application/json', () => {
    expect(buildHeaders({ method: 'POST', body: '{}' })).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('явні заголовки перекривають дефолт', () => {
    expect(buildHeaders({
      method: 'POST',
      body: 'raw',
      headers: { 'Content-Type': 'text/plain' },
    })).toEqual({ 'Content-Type': 'text/plain' });
  });

  it('порожнє тіло як пустий рядок не тригерить Content-Type', () => {
    // body: '' — це null-ish за нашою логікою (init.body != null → false)
    // Fastify так само не любить, коли Content-Type є, а тіла нема.
    // Але fetch вважає '' і null одним, тому цей тест підтверджує паритет.
    expect(buildHeaders({ method: 'POST' })).toEqual({});
  });
});

// fix/retail-401-strip: смуга «Вхід — уже ні» при живій сесії на проді.
// Будь-який 401 вважався протухлою сесією, а POST /v1/retail/silpo/sync-receipts
// відповідає 401 {error:'retail_auth'}, коли протух токен Сільпо. Тепер 401 —
// наша сесія лише з {error:'unauthorized'} (middleware/session.ts) або без тіла.
describe('класифікація 401', () => {
  const res = (status: number, body: string | null) => new Response(body, { status, headers: body ? { 'content-type': 'application/json' } : {} });
  const sink = () => {
    const calls: unknown[] = [];
    registerIncidentSink({ setAuthExpired: (v: boolean) => calls.push(['auth', v]), setOffline: () => {}, setThrottled: () => {} } as never);
    return calls;
  };
  afterEach(() => { registerIncidentSink(null); vi.unstubAllGlobals(); });

  it('isSessionExpired: unauthorized і порожнє тіло — так; retail_auth та інші — ні', () => {
    expect(isSessionExpired({ error: 'unauthorized' })).toBe(true);
    expect(isSessionExpired(null)).toBe(true);
    expect(isSessionExpired({ error: 'retail_auth' })).toBe(false);
    expect(isSessionExpired({ error: 'not_connected' })).toBe(false);
  });

  it('401 unauthorized → authExpired; 401 retail_auth → ні, лише ApiError; 409 → ні', async () => {
    let calls = sink();
    vi.stubGlobal('fetch', vi.fn(async () => res(401, '{"error":"unauthorized"}')));
    await expect(api.pantry()).rejects.toBeInstanceOf(ApiError);
    expect(calls).toContainEqual(['auth', true]);

    calls = sink();
    vi.stubGlobal('fetch', vi.fn(async () => res(401, '{"error":"retail_auth"}')));
    const err = await api.retail.syncReceipts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(((err as ApiError).payload as { error: string }).error).toBe('retail_auth');
    expect(calls.some((c) => (c as unknown[])[0] === 'auth')).toBe(false);

    calls = sink();
    vi.stubGlobal('fetch', vi.fn(async () => res(409, '{"error":"not_connected"}')));
    await expect(api.retail.syncReceipts()).rejects.toBeInstanceOf(ApiError);
    expect(calls.some((c) => (c as unknown[])[0] === 'auth')).toBe(false);
  });
});

// Шерінг v3 (пастка від потоку API/бот, 22.09): @fastify/multipart читає
// recipe_id/frame з file.fields ПІД ЧАС req.file() — у стрімінговому
// multipart поля, що йдуть ПІСЛЯ файла в тілі, ще не розібрані на той
// момент (400 recipe_id required). Порядок append() у FormData — це і є
// порядок частин у тілі.
describe('api.share.telegram — порядок полів multipart', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('recipe_id і frame йдуть ДО png у тілі запиту', async () => {
    let sentBody: FormData | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = init?.body as FormData;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await api.share.telegram(new Blob(['png']), 'recipe-1', 'poster');
    const keys = [...sentBody!.keys()];
    expect(keys).toEqual(['recipe_id', 'frame', 'png']);
  });
});
