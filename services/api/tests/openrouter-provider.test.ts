// 16.09: маршрут провайдера OpenRouter, таймаути на виклик, provider/generation
// у meta. Живий вимір: /v1/messages приймає provider.order (виклик пішов на
// «Google AI Studio»), у відповіді є поле provider, id = x-generation-id.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@anthropic-ai/sdk')>();
  return { default: class {
    static APIConnectionError = actual.APIConnectionError;
    opts: unknown;
    constructor(opts: unknown) { this.opts = opts; (globalThis as { __lastClientOpts?: unknown }).__lastClientOpts = opts; }
    messages = { create: createMock };
  } };
});
const { providerRouting, callChat, CALL_TIMEOUT_MS } = await import('../src/model.js');

const okResp = (extra: Record<string, unknown> = {}) => ({
  id: 'gen-123', provider: 'Google AI Studio',
  content: [{ type: 'text', text: '{"reply":"Ок.","card":null}' }],
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  stop_reason: 'end_turn', ...extra,
});
/** Мок create повертає обʼєкт із withResponse(), як SDK. */
const withResp = (data: unknown, headers: Record<string, string> = {}) => {
  const p = Promise.resolve(data) as Promise<unknown> & { withResponse: () => Promise<{ data: unknown; response: { headers: Headers } }> };
  p.withResponse = async () => ({ data, response: { headers: new Headers(headers) } });
  return p;
};

describe('providerRouting: env OPENROUTER_PROVIDER_ORDER', () => {
  it('кома-список → provider.order з allow_fallbacks; порожній або не OpenRouter — нічого', () => {
    expect(providerRouting({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDER_ORDER: 'Google AI Studio, Google' } as NodeJS.ProcessEnv))
      .toEqual({ provider: { order: ['Google AI Studio', 'Google'], allow_fallbacks: true } });
    expect(providerRouting({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDER_ORDER: '' } as NodeJS.ProcessEnv)).toEqual({});
    expect(providerRouting({ ANTHROPIC_API_KEY: 'k', OPENROUTER_PROVIDER_ORDER: 'Google AI Studio' } as NodeJS.ProcessEnv)).toEqual({});
  });
});

describe('callChat: маршрут, таймаут, provider у meta', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MODEL_SMART = 'google/gemini-3.8-flash';
  });
  afterEach(() => { process.env = { ...OLD_ENV }; });
  const args = { user_id: 'u1', session_id: 's1', text: 'привіт', pantry: [], profile: null } as never;

  it('з env: provider їде в body override, таймаут chat=25 с, клієнт із maxRetries 0; meta несе provider і generation_id', async () => {
    process.env.OPENROUTER_PROVIDER_ORDER = 'Google AI Studio';
    createMock.mockImplementation(() => withResp(okResp(), { 'x-generation-id': 'gen-123' }));
    const out = await callChat(args);
    const [params, opts] = createMock.mock.calls[0]! as [Record<string, unknown>, { timeout: number; body?: Record<string, unknown> }];
    expect(opts.timeout).toBe(CALL_TIMEOUT_MS.chat);
    expect(opts.body).toMatchObject({ model: params.model, provider: { order: ['Google AI Studio'], allow_fallbacks: true } });
    expect((globalThis as { __lastClientOpts?: { maxRetries?: number } }).__lastClientOpts?.maxRetries).toBe(0);
    expect(out.meta).toMatchObject({ provider: 'Google AI Studio', generation_id: 'gen-123' });
  });
  it('без env: body override не шлемо, таймаут є, provider із відповіді все одно в meta', async () => {
    delete process.env.OPENROUTER_PROVIDER_ORDER;
    createMock.mockImplementation(() => withResp(okResp({ provider: 'Google' })));
    const out = await callChat(args);
    const opts = createMock.mock.calls[0]![1] as { timeout: number; body?: unknown };
    expect(opts.body).toBeUndefined();
    expect(opts.timeout).toBe(CALL_TIMEOUT_MS.chat);
    expect(out.meta).toMatchObject({ provider: 'Google', generation_id: 'gen-123' });
  });
  it('таймаут SDK — ретрай нашим withRetry, друга спроба відповідає', async () => {
    // Справжній клас SDK (без name!) — саме на ньому старий isRetryable мовчав.
    const { APIConnectionTimeoutError } = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
    const timeoutErr = new APIConnectionTimeoutError();
    createMock.mockImplementationOnce(() => { const p = Promise.reject(timeoutErr) as Promise<unknown> & { withResponse: () => Promise<never> }; p.withResponse = () => Promise.reject(timeoutErr); p.catch(() => {}); return p; });
    createMock.mockImplementationOnce(() => withResp(okResp()));
    const out = await callChat(args);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(out.reply).toBe('Ок.');
  });
});
