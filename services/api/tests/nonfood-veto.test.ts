// Вето каталогу: нехарчове не потрапляє в комору.
//
// Живий репро 02.09: чек, вставлений текстом у чат, поклав у комору дрова,
// розпал, гриль і туалетний папір. Провина не моделі — у схемі intake_diff
// є тільки `add` і п'ять ХАРЧОВИХ зон, сказати «це не для комори» їй нічим.
import { describe, expect, it } from 'vitest';
import type { Card, IntakeCard } from '@kitchen/domain';
import { vetoNonfood } from '../src/nonfood-veto.js';

const intake = (labels: string[]): IntakeCard => ({
  type: 'intake_diff',
  ops: labels.map((label) => ({ op: 'add', label, value: 1, unit: 'pcs' })),
} as IntakeCard);

describe('vetoNonfood', () => {
  it('нехарчове з каталогу не їде в комору, а лягає в nonfood', () => {
    const card = intake(['Папір туалетний Zewa Pure Moist', 'Томат Біоранж жовтий']);
    expect(vetoNonfood(card)).toBe(1);
    expect(card.ops.map((o) => o.label)).toEqual(['Томат Біоранж жовтий']);
    expect(card.nonfood?.map((n) => n.label)).toEqual(['Папір туалетний Zewa Pure Moist']);
  });

  // Вето, а не фільтр: каталог має право лише ЗАБОРОНИТИ те, що впізнав як
  // нехарчове. Зворотне правило («пускати тільки впізнану їжу») зламало б
  // звичайний intake — строгий матчер не знає й половини нормальної їжі.
  it('невідоме каталогу проходить — модель тут компетентніша за словник', () => {
    const card = intake(['Крем-брускетта Ponti з чорних оливок', 'Дрова Penok']);
    expect(vetoNonfood(card)).toBe(0);
    expect(card.ops).toHaveLength(2);
    expect(card.nonfood).toBeUndefined();
  });

  it('їжа не чіпається ніколи', () => {
    const card = intake(['Молоко Яготинське', 'Хліб подовий Альзас']);
    expect(vetoNonfood(card)).toBe(0);
    expect(card.ops).toHaveLength(2);
  });

  // Вето стосується лише появи в коморі. Списати чи перейменувати
  // нехарчове, яке там уже лежить, має лишатись можливим.
  it('deplete, rename і correct проходять навіть для нехарчового', () => {
    const card = {
      type: 'intake_diff',
      ops: [
        { op: 'deplete', label: 'Папір туалетний Zewa Pure Moist' },
        { op: 'rename', label: 'Папір туалетний Zewa Pure Moist', to: 'Папір' },
      ],
    } as unknown as IntakeCard;
    expect(vetoNonfood(card)).toBe(0);
    expect(card.ops).toHaveLength(2);
  });

  it('не-intake і порожнє не валять', () => {
    expect(vetoNonfood(null)).toBe(0);
    expect(vetoNonfood(undefined)).toBe(0);
    expect(vetoNonfood({ type: 'proposal', items: [] } as unknown as Card)).toBe(0);
    expect(vetoNonfood(intake([]))).toBe(0);
  });
});
