import { describe, it, expect } from 'vitest';
import { renderRecentActions } from '../context.js';
import type { PendingCard, IntakeCard, ProfileCard } from '../types.js';

// Аудит раунд 3, крок 5: [ОСТАННІ ДІЇ] — те, що сталось із даними дому поза
// цією розмовою. Без блока модель судить про стан лише з власних минулих
// реплік цієї сесії й не бачить рішень з інших вкладок/сесій.

function pending(over: Partial<PendingCard> & Pick<PendingCard, 'card'>): PendingCard {
  return {
    id: 'p1',
    message_id: 'p1',
    household_id: 'h1',
    user_id: 'u1',
    applied_at: null,
    applied_ops: null,
    undo_token: null,
    undo_snapshot: null,
    undone_at: null,
    dismissed_at: null,
    ...over,
  };
}

describe('renderRecentActions', () => {
  const now = new Date('2026-09-10T18:00:00');

  it('порожній список → порожній рядок', () => {
    expect(renderRecentActions([], now)).toBe('');
  });

  it('три картки, три результати: застосовано / скасовано / відхилено', () => {
    const applied = pending({
      id: 'p-applied',
      applied_at: '2026-09-10T17:20:00',
      card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко' }, { op: 'add', label: 'батон' }] } as IntakeCard,
    });
    const undone = pending({
      id: 'p-undone',
      applied_at: '2026-09-10T10:00:00',
      undone_at: '2026-09-10T16:05:00',
      card: { type: 'shopping', items: [{ op: 'add', label: 'олія' }] } as never,
    });
    const dismissed = pending({
      id: 'p-dismissed',
      dismissed_at: '2026-09-09T09:00:00',
      card: { type: 'profile', ops: [{ op: 'add', kind: 'anti', label: 'кінза' }] } as ProfileCard,
    });

    const out = renderRecentActions([applied, undone, dismissed], now);
    // Крок 5 (закриття): заголовок скорочено — перевіряємо точний рядок,
    // не лише наявність назви блоку.
    expect(out).toContain(
      '[ОСТАННІ ДІЇ] (поза цією розмовою, 2 дні. Застосоване — вже в даних вище, не записуй знову; '
      + 'відхилене — людина сказала «ні», не повертайся сама; скасоване — у даних нема)',
    );
    // Найновіше рішення — застосована картка (17:20) — першим рядком.
    const lines = out.split('\n').filter((l) => l.startsWith('•'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('40 хв тому');
    expect(lines[0]).toContain('комора');
    expect(lines[0]).toContain('молоко, батон');
    expect(lines[0]).toContain('застосовано');
    expect(lines[1]).toContain('скасовано');
    expect(lines[2]).toContain('вчора');
    expect(lines[2]).toContain('відхилено');
  });

  it('нотатка розпізнається окремо від профілю (усі ops kind:note)', () => {
    const note = pending({
      applied_at: '2026-09-10T17:59:00',
      card: { type: 'profile', ops: [{ op: 'add', kind: 'note', label: 'менше перцю' }] } as ProfileCard,
    });
    expect(renderRecentActions([note], now)).toContain('нотатка');
  });

  it('понад 3 назви — «…ще N»', () => {
    const many = pending({
      applied_at: '2026-09-10T17:59:00',
      card: {
        type: 'intake_diff',
        ops: [
          { op: 'add', label: 'молоко' }, { op: 'add', label: 'батон' },
          { op: 'add', label: 'сир' }, { op: 'add', label: 'яйця' }, { op: 'add', label: 'масло' },
        ],
      } as IntakeCard,
    });
    const out = renderRecentActions([many], now);
    expect(out).toContain('молоко, батон, сир');
    expect(out).toContain('… ще 2');
  });

  it('ліміт 5 рядків навіть якщо передано більше', () => {
    const cards = Array.from({ length: 7 }, (_, i) => pending({
      id: `p${i}`,
      applied_at: `2026-09-10T1${i}:00:00`,
      card: { type: 'intake_diff', ops: [{ op: 'add', label: `x${i}` }] } as IntakeCard,
    }));
    const out = renderRecentActions(cards, now);
    expect(out.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(5);
  });
});
