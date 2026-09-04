import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadPrompt } from '@kitchen/prompts';

// Крок 6е: reply, що дослівно повторює зразок voice.md, має піти на один
// повторний виклик замість того, щоб дійти до людини як «завчена» фраза.
// Зразки не хардкодимо в тесті: беремо їх тим самим парсером, що й model.ts,
// із живого voice.md — тест не має розійтись із текстом промпту.

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { wordOverlapRatio, matchesVoiceExample, callChat } = await import('../src/model.js');

function resp(text: string, over: Partial<{ stop_reason: string }> = {}) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: over.stop_reason ?? 'end_turn',
  };
}

describe('wordOverlapRatio / matchesVoiceExample', () => {
  it('1.0 на дослівний збіг', () => {
    expect(wordOverlapRatio('Записав молоко й хліб.', 'Записав молоко й хліб.')).toBe(1);
  });
  it('0 без спільних слів', () => {
    expect(wordOverlapRatio('Зробив би пасту.', 'Зовсім інша тема сьогодні.')).toBe(0);
  });
  it('нечутливий до регістру й пунктуації', () => {
    expect(wordOverlapRatio('ЗАПИСАВ молоко, й хліб!', 'записав молоко й хліб')).toBe(1);
  });
  it('matchesVoiceExample: true на порозі ≥0.6, false нижче', () => {
    const examples = ['Записав молоко, яйця й фету. Фети — десь пачка.'];
    expect(matchesVoiceExample('Записав молоко, яйця й фету.', examples)).toBe(true);
    expect(matchesVoiceExample('Зробив би щось геть інше сьогодні.', examples)).toBe(false);
  });
  it('порожні reply/examples — завжди false', () => {
    expect(matchesVoiceExample('', ['щось'])).toBe(false);
    expect(matchesVoiceExample('щось', [])).toBe(false);
  });
});

describe('callChat: example-guard ретраїть дослівний повтор зразка voice.md', () => {
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
    user_id: 'u1', session_id: 's1', text: 'Слухай, дощ цілий день, настрою нема',
    pantry: [], profile: null,
  } as Parameters<typeof callChat>[0];

  it('reply = зразок voice.md дослівно → один повторний виклик, meta.example_copy=true', async () => {
    const prompt = loadPrompt();
    const example = (prompt.blocks['voice'] ?? '').match(/^Ситуація:.*\n(.+)$/m)?.[1];
    expect(example, 'у voice.md має лишитись хоч один зразок «Ситуація: … / репліка»').toBeTruthy();

    createMock
      .mockResolvedValueOnce(resp(JSON.stringify({ reply: example, card: null })))
      .mockResolvedValueOnce(resp(JSON.stringify({ reply: 'Зовсім інша, своя репліка про цей день.', card: null })));

    const call = await callChat(args);

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(call.meta.example_copy).toBe(true);
    expect(call.reply).toBe('Зовсім інша, своя репліка про цей день.');

    const retryCallArg = createMock.mock.calls[1]![0] as { messages: { role: string; content: string }[] };
    const lastMsg = retryCallArg.messages[retryCallArg.messages.length - 1]!;
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Перепиши репліку своїми словами, не повторюючи зразків.');
  });

  it('звичайна, несхожа на зразок репліка → один виклик, без ретраю', async () => {
    createMock.mockResolvedValueOnce(resp(JSON.stringify({
      reply: 'Такий день годиться хіба для чогось швидкого й теплого.',
      card: null,
    })));

    const call = await callChat(args);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(call.meta.example_copy).toBe(false);
  });

  it('сумує usage обох викликів, коли ретрай стався', async () => {
    const prompt = loadPrompt();
    const example = (prompt.blocks['voice'] ?? '').match(/^Ситуація:.*\n(.+)$/m)?.[1];
    createMock
      .mockResolvedValueOnce(resp(JSON.stringify({ reply: example, card: null })))
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ reply: 'Своя репліка.', card: null }) }],
        usage: { input_tokens: 20, output_tokens: 8, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
        stop_reason: 'end_turn',
      });

    const call = await callChat(args);
    expect(call.usage.input).toBe(30);
    expect(call.usage.output).toBe(13);
    expect(call.usage.cached).toBe(3);
  });
});
