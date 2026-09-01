import { describe, it, expect } from 'vitest';
import { runOutcome } from '../verdict.js';

// Живий випадок 02.09: 35 із 41 фікстури впали з 402 (OpenRouter, вичерпаний
// in-flight бюджет), а звіт сказав «провалено: 0» і вийшов з кодом 0.
describe('прогін із помилкою — не успіх', () => {
  it('помилка провайдера при порожніх інваріантах', () => {
    expect(runOutcome({}, '402 billing_error')).toEqual({ kind: 'error', ok: false });
  });

  it('порожні інваріанти без помилки — теж не успіх', () => {
    expect(runOutcome({})).toEqual({ kind: 'error', ok: false });
  });

  it('свідомий скіп — не провал', () => {
    expect(runOutcome({}, 'SKIPPED: no image')).toEqual({ kind: 'skipped', ok: true });
  });

  it('усі інваріанти зелені', () => {
    expect(runOutcome({ a: { pass: true }, b: { pass: true } })).toEqual({ kind: 'pass', ok: true });
  });

  it('один червоний валить увесь прогін', () => {
    expect(runOutcome({ a: { pass: true }, b: { pass: false } })).toEqual({ kind: 'fail', ok: false });
  });
});
