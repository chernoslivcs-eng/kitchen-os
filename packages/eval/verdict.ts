// Чи вважати прогін фікстури успішним.
//
// Було одним рядком у runner.ts: `Object.values(verdicts).every(v => v.pass)`.
// Коли фікстура падала з помилкою (402 від OpenRouter, обрив мережі), verdicts
// лишався ПОРОЖНІМ обʼєктом — а `[].every()` повертає true. Тобто кожна
// помилка зараховувалась як успіх, снапшот писався зеленим, код виходу 0.
//
// Живий випадок 02.09: 35 із 41 фікстури впали з 402, звіт показав
// «провалено: 0», і за цим снапшотом гілку мало не змерджили.
//
// Порожня істина — найтихіший спосіб збрехати. Тому: нічого не виконалось —
// це НЕ успіх.

export type RunKind = 'pass' | 'fail' | 'error' | 'skipped';

export interface RunOutcome {
  kind: RunKind;
  /** Чи зараховувати як успіх (для коду виходу). Скіп — не провал. */
  ok: boolean;
}

export function runOutcome(
  verdicts: Record<string, { pass: boolean }>,
  error?: string,
): RunOutcome {
  if (error?.startsWith('SKIPPED')) return { kind: 'skipped', ok: true };
  if (error) return { kind: 'error', ok: false };
  const values = Object.values(verdicts);
  // Жодного інваріанта не виконалось — сказати «pass» тут означало б те саме,
  // що казати «в коморі нічого немає», не подивившись у комору.
  if (!values.length) return { kind: 'error', ok: false };
  return values.every((v) => v.pass) ? { kind: 'pass', ok: true } : { kind: 'fail', ok: false };
}
