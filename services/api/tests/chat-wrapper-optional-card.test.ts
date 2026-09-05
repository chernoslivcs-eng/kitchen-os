import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Крок 9: повний прогін показав відповідь {"reply","note"} без ключа card.
// parseChatText впізнавав обгортку лише за парою reply+card — усе падало в
// residual, і людині йшла порожня репліка, а нотатка губилась. Обгортка —
// будь-який обʼєкт із reply; card і note за відсутності — null.

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { callChat } = await import('../src/model.js');

function resp(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: 'end_turn',
  };
}

describe('callChat: обгортка без card', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.OPENROUTER_API_KEY;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  const args = {
    user_id: 'u1', session_id: 's1', text: 'Пересолив путанеску',
    pantry: [], profile: null,
  } as Parameters<typeof callChat>[0];

  it('{reply, note} — reply і note доходять, card null', async () => {
    createMock.mockResolvedValueOnce(resp(JSON.stringify({
      reply: 'Анчоуси й каперси — обидва солоні, склались.',
      note: 'Путанеска — воду не солити',
    })));
    const call = await callChat(args);
    expect(call.reply).toBe('Анчоуси й каперси — обидва солоні, склались.');
    expect(call.card).toBeNull();
    expect(call.note).toBe('Путанеска — воду не солити');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('{reply} сам — reply доходить, card і note null', async () => {
    createMock.mockResolvedValueOnce(resp(JSON.stringify({ reply: 'Сто грамів.' })));
    const call = await callChat(args);
    expect(call.reply).toBe('Сто грамів.');
    expect(call.card).toBeNull();
    expect(call.note ?? null).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
