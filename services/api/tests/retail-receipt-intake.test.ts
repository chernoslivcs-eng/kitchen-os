// M13 «чеки → комора»: рядки чека Сільпо → IntakeOp'и + два чесні залишки.
// Три кошики за дизайн-каноном:
//   ops       — збіг із каталогом, їжа → в комору (confidence 1, evidence receipt_line)
//   nonfood   — збіг із каталогом, категорія «нехарчове» → рядок «не для комори»
//   unmatched — каталог не впізнав → сірий рядок «додати руками», НЕ мовчазний викид
import { describe, it, expect } from 'vitest';
import { receiptLinesToIntake } from '../src/retail/receipt-intake.js';

const line = (name: string, quantity: number, unit: string) =>
  ({ name, quantity, unit, price: 100, image: null });

describe('receiptLinesToIntake', () => {
  it('їжа зі збігом → add з каталожним ключем, зоною і повною впевненістю', () => {
    const r = receiptLinesToIntake([line("Молоко ультрапастеризоване «Слов'яночка» 2,5%", 1, 'шт')]);
    expect(r.unmatched).toHaveLength(0);
    expect(r.nonfood).toHaveLength(0);
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0];
    expect(op).toMatchObject({
      op: 'add', catalog_key: 'milk_uht_25', zone: 'dry',
      confidence: 1, evidence: 'receipt_line', value: 1, unit: 'pcs',
    });
  });

  it('вагові конвертуються: 0,64 кг → 640 g', () => {
    const r = receiptLinesToIntake([line('Філе куряче охолоджене', 0.64, 'кг')]);
    expect(r.ops[0]).toMatchObject({ value: 640, unit: 'g', zone: 'fridge' });
  });

  it('нехарчове з каталогу — у nonfood, не в комору', () => {
    const r = receiptLinesToIntake([line('Папір туалетний Zewa 8 рулонів', 8, 'шт')]);
    expect(r.ops).toHaveLength(0);
    expect(r.nonfood.map((l) => l.name)).toEqual(['Папір туалетний Zewa 8 рулонів']);
  });

  it('невпізнане не зникає мовчки — лягає в unmatched із назвою як у чеку', () => {
    const r = receiptLinesToIntake([line("Дрова Pen'ok Початок вогню №2", 1, 'шт')]);
    expect(r.ops).toHaveLength(0);
    expect(r.unmatched.map((l) => l.name)).toEqual(["Дрова Pen'ok Початок вогню №2"]);
  });

  it('змішаний чек розкладається по трьох кошиках за один прохід', () => {
    const r = receiptLinesToIntake([
      line('Філе куряче охолоджене', 0.64, 'кг'),
      line('Папір туалетний Zewa 8 рулонів', 8, 'шт'),
      line('Хліб Салтівський особливий', 1, 'шт'),
    ]);
    expect(r.ops).toHaveLength(1);
    expect(r.nonfood).toHaveLength(1);
    expect(r.unmatched).toHaveLength(1);
  });
});
