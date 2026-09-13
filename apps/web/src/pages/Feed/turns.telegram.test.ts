// Р147: хід із Telegram (message.channel = 'telegram') несе мітку fromTelegram; web — ні.
import { describe, it, expect } from 'vitest';
import { messageToTurn } from './turns';

describe('Р147 · хід із Telegram', () => {
  const base = { id: 'm1', session_id: 's1', role: 'user' as const, text: 'привіт', card: null, applied: 0, created_at: '2026-09-13T10:00:00Z' };
  it('channel telegram → fromTelegram', () => {
    expect(messageToTurn({ ...base, channel: 'telegram' }).fromTelegram).toBe(true);
  });
  it('без channel або web — без мітки', () => {
    expect(messageToTurn(base).fromTelegram).toBeUndefined();
    expect(messageToTurn({ ...base, channel: 'web' }).fromTelegram).toBeUndefined();
  });
});
