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

  // Живий чек 23.08 (перший прогін на проді Сільпо): фаззі-підрядки давали
  // впевнену брехню — «Портерхаус» ставав пивом портер, «Сільпо» — сіллю.
  // Канон «не вгадувати»: чесний unmatched кращий за вигадку з confidence 1.
  it('шумні назви мережі не матчаться підрядком/відмінком — ідуть в unmatched', () => {
    const noisy = [
      'Яловичий стейк Портерхаус Dry Aged в/у',   // «портер» ⊄ цілим словом
      'Пакет Сільпо Пакет з Пакетів 18кг',         // «сіль» ⊄ цілим словом
      'Булочка з корицею',                          // аліас-відмінок «корицею» ≠ булочка
    ];
    const r = receiptLinesToIntake(noisy.map((n) => line(n, 1, 'шт')));
    expect(r.ops).toHaveLength(0);
    expect(r.unmatched.map((l) => l.name)).toEqual(noisy);
  });

  it('справжні збіги лишаються живими після посилення матчера', () => {
    const r = receiptLinesToIntake([
      line('Квас Квас Тарас Хлібний з/б', 1, 'шт'),
      line('Вода мінеральна Моршинська н/газ', 1, 'шт'),
      line('Багет подовий гречаний міні', 1, 'шт'),
      line("Чипси Lay's картопляні зі смаком сиру", 1, 'шт'),  // повне імʼя «Чипси зі смаком сиру» ⊆
      line('Напій Schweppes Pink Tonic б/алк сил/газ скло', 1, 'шт'), // латинський бренд без голови
    ]);
    expect(r.unmatched).toHaveLength(0);
    expect(r.ops).toHaveLength(5);
    expect(r.ops.map((o) => 'catalog_key' in o && o.catalog_key)).toContain('chips_cheese');
  });

  it('ковбаса Мілано з живого чека матчиться через аліас із головою', () => {
    const r = receiptLinesToIntake([line('Ковбаса Укрпромпостач для Сільпо Мілано с/в', 0.114, 'кг')]);
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ catalog_key: 'salami_milano_pork', value: 114, unit: 'g' });
  });

  it('нехарчове ловиться і на живих назвах (хустинки)', () => {
    const r = receiptLinesToIntake([line('Хустинки носові Ruta Mini Tissues б/аром 2-шарові', 1, 'шт')]);
    expect(r.ops).toHaveLength(0);
    expect(r.nonfood).toHaveLength(1);
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
