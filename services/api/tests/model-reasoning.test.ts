// 16.09: рівень міркування smart-моделі через OpenRouter (MODEL_REASONING).
// Чат на google/gemini-3.8-flash давав 46–49 с і 5455 вихідних токенів на ~600
// видимих. Живий вимір: через Anthropic-сумісний /v1/messages OpenRouter лише
// `thinking: {type:'enabled', budget_tokens}` реально ріже роздуми (≤512 → 0);
// `reasoning.effort` там не діє, `thinking.disabled` → 400. Тому рівні — бюджети.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { reasoningLevel, reasoningFor, callChat } = await import('../src/model.js');

describe('reasoningLevel: env MODEL_REASONING', () => {
  it.each([
    ['minimal', 'minimal'], ['LOW', 'low'], [' medium ', 'medium'], ['high', 'high'],
    ['', null], ['none', null], ['off', null], [undefined, null],
  ])('%s → %s', (raw, want) => {
    expect(reasoningLevel({ MODEL_REASONING: raw } as NodeJS.ProcessEnv)).toBe(want);
  });
});

describe('reasoningFor: бюджет лише для не-Claude', () => {
  it('gemini через OpenRouter: рівень → thinking.enabled з бюджетом; порожній рівень — нічого', () => {
    expect(reasoningFor('google/gemini-3.8-flash', 'minimal')).toEqual({ thinking: { type: 'enabled', budget_tokens: 256 } });
    expect(reasoningFor('google/gemini-3.8-flash', 'high')).toEqual({ thinking: { type: 'enabled', budget_tokens: 16384 } });
    expect(reasoningFor('google/gemini-3.8-flash', null)).toEqual({});
  });
  it('Claude (sonnet/haiku, з префіксом OpenRouter чи без) — env ігнорується', () => {
    for (const m of ['claude-sonnet-5', 'anthropic/claude-sonnet-5', 'claude-haiku-4-5-20251001', 'anthropic/claude-haiku-4.5']) {
      expect(reasoningFor(m, 'minimal')).toEqual({});
    }
  });
});

describe('callChat: параметр їде у виклик і в meta', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"reply":"Ок.","card":null}' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      stop_reason: 'end_turn',
    });
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MODEL_SMART = 'google/gemini-3.8-flash';
  });
  afterEach(() => { process.env = { ...OLD_ENV }; });
  const args = { user_id: 'u1', session_id: 's1', text: 'привіт', pantry: [], profile: null } as never;

  it('MODEL_REASONING=minimal → thinking.budget_tokens=256 у create, meta.reasoning="minimal"', async () => {
    process.env.MODEL_REASONING = 'minimal';
    const out = await callChat(args);
    expect(createMock.mock.calls[0]![0]).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 256 } });
    expect(out.meta).toMatchObject({ reasoning: 'minimal', mode: 'live' });
  });
  it('без env → thinking не шлемо, meta без reasoning (відкат без коду)', async () => {
    delete process.env.MODEL_REASONING;
    const out = await callChat(args);
    expect(createMock.mock.calls[0]![0]).not.toHaveProperty('thinking');
    expect(out.meta).not.toHaveProperty('reasoning');
  });
  it('sonnet-5 напряму: env є, але шлеться лише thinking.disabled, meta без reasoning', async () => {
    process.env.MODEL_REASONING = 'minimal';
    process.env.MODEL_SMART = 'claude-sonnet-5';
    const out = await callChat(args);
    expect(createMock.mock.calls[0]![0]).toMatchObject({ thinking: { type: 'disabled' } });
    expect(out.meta).not.toHaveProperty('reasoning');
  });
});
