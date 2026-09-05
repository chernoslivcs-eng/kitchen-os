import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Крок 4в (2а): ручний тест 05.09 19:44 — на «я веган» модель не дала картки,
// а в reply переказала рядок історії «[картка: профіль] записав у …
// [НЕ ЗАСТОСОВАНО — …]». Guard як example-guard: один повторний виклик із
// «Перепиши репліку без службових позначок», далі — вирізати, що лишилось.

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { callChat, hasServiceMarkers, stripServiceMarkers, SERVICE_MARKER_GUARD_LINE } = await import('../src/model.js');

function resp(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: 'end_turn',
  };
}

describe('hasServiceMarkers / stripServiceMarkers', () => {
  it('ловить позначки історії й назви блоків', () => {
    expect(hasServiceMarkers('Запишу. [картка: профіль] записав у „Я не їм": мʼяса [НЕ ЗАСТОСОВАНО — …]')).toBe(true);
    expect(hasServiceMarkers('Дивлюсь у [КОМОРА] — там порожньо')).toBe(true);
    expect(hasServiceMarkers('Зробив би нутовий карі — хвилин сорок.')).toBe(false);
  });
  it('вирізає позначки, лишає людський текст', () => {
    expect(stripServiceMarkers('Запишу веганство.\n[картка: профіль] записав у „Я не їм": мʼяса [НЕ ЗАСТОСОВАНО — у профілі цього ще НЕМАЄ]')).toBe('Запишу веганство.');
    expect(stripServiceMarkers('Дивлюсь у [КОМОРА] — там порожньо')).toBe('Дивлюсь у — там порожньо');
  });
});

describe('callChat: guard службових позначок', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => { createMock.mockReset(); process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => { process.env = { ...OLD_ENV }; });
  const args = { user_id: 'u1', session_id: 's1', text: 'я веган', pantry: [], profile: null };

  it('позначка в reply → один повторний виклик із guard-рядком; чиста відповідь іде як є', async () => {
    createMock
      .mockResolvedValueOnce(resp('{"reply":"Запишу веганство.\\n[картка: профіль] записав у „Я не їм": мʼяса [НЕ ЗАСТОСОВАНО — …]","card":null}'))
      .mockResolvedValueOnce(resp('{"reply":"Запишу: без мʼяса, риби, яєць і молочного.","card":{"type":"profile","field":"no","mode":"append","text":"мʼяса, птиці, риби, яєць, молочного"}}'));
    const r = await callChat(args);
    expect(createMock).toHaveBeenCalledTimes(2);
    const second = createMock.mock.calls[1]![0] as { messages: { content: string }[] };
    expect(second.messages.at(-1)!.content).toContain(SERVICE_MARKER_GUARD_LINE);
    expect(r.reply).toBe('Запишу: без мʼяса, риби, яєць і молочного.');
    expect(r.card).toMatchObject({ type: 'profile', field: 'no' });
    expect(r.meta.service_markers).toBe(true);
  });

  it('позначка і після повтору → вирізається', async () => {
    createMock
      .mockResolvedValueOnce(resp('{"reply":"Так. [ЗАСТОСОВАНО]","card":null}'))
      .mockResolvedValueOnce(resp('{"reply":"Так, записав. [ЗАСТОСОВАНО]","card":null}'));
    const r = await callChat(args);
    expect(r.reply).toBe('Так, записав.');
  });

  it('чиста відповідь — один виклик', async () => {
    createMock.mockResolvedValueOnce(resp('{"reply":"Зробив би карі.","card":null}'));
    const r = await callChat(args);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.reply).toBe('Зробив би карі.');
  });
});
