import { describe, it, expect } from 'vitest';
import { mergeAttachmentCalls } from '../src/attachment-merge.js';
import type { AttachmentCall } from '../src/model.js';

// Аудит 04.09, крок 3.1: два чеки — два виклики паралельно, одна відповідь.
const meta = { promptVersion: 'v', model: 'm', mode: 'stub' as const };
const intake = (labels: string[], reply = 'Розібрав.'): AttachmentCall => ({
  reply, raw_kind: 'receipt',
  card: { type: 'intake_diff', ops: labels.map((label) => ({ op: 'add', label })) } as never,
  usage: { input: 10, output: 5, cached: 1 }, meta,
});

describe('mergeAttachmentCalls', () => {
  it('один виклик — як є', () => {
    const c = intake(['a']);
    expect(mergeAttachmentCalls([c])).toBe(c);
  });

  it('два чеки → одна intake_diff з усіма ops, сумарний usage, reply з кількістю', () => {
    const m = mergeAttachmentCalls([intake(['лосось', 'рис'], 'Чек Metro.'), intake(['сир'])]);
    expect(m.card?.type).toBe('intake_diff');
    expect((m.card as { ops: unknown[] }).ops).toHaveLength(3);
    expect(m.raw_kind).toBe('receipt');
    expect(m.usage).toMatchObject({ input: 20, output: 10, cached: 2 });
    expect(m.reply).toMatch(/2 вкладення — разом 3/);
    // Репліка моделі про ОДИН чек у злитті не годиться (ручний тест 04.09).
    expect(m.reply).not.toContain('Чек Metro.');
  });

  it('чек + фото страви: інтейк лишається, страва не ламає картку', () => {
    const dish: AttachmentCall = { reply: 'Гарний вигляд.', raw_kind: 'dish', card: null, usage: { input: 1, output: 1 }, meta };
    const m = mergeAttachmentCalls([dish, intake(['сир'])]);
    expect(m.card?.type).toBe('intake_diff');
    expect(m.raw_kind).toBe('receipt');
  });

  it('жодної картки — перша непорожня репліка, картка null', () => {
    const other: AttachmentCall = { reply: 'Не розібрав.', raw_kind: 'other', card: null, usage: { input: 1, output: 1 }, meta };
    const m = mergeAttachmentCalls([other, { ...other, reply: '' }]);
    expect(m.card).toBeNull();
    expect(m.reply).toBe('Не розібрав.');
  });
});
