// Правило `--rekey` на справжніх рядках проду (виміряні 09.09.2026).
//
// Без бази й без моделі: `decideKey` — чиста функція над каталогом. Саме тому
// вона й винесена зі скрипта: скрипт перевірити в CI не можна, а рішення,
// яке він приймає над живими даними, — можна й треба.
//
// Кожен випадок нижче — реальний продукт із `household_product`, не вигаданий.

import { describe, it, expect } from 'vitest';
import { decideKey } from '../scripts/rekey.js';

const decide = (stored: string | null, product: string, dn = product) => decideKey(stored, product, dn);

describe('decideKey: сувора планка дала інший ключ — перекласти', () => {
  it('вершки 33% під ключем 20% — калорії занижені на 43%', () => {
    const d = decide('cream_20', 'вершки', 'вершки 33%');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('cream_33');
  });

  it('пиво Kronenbourg під «Кропивою» — пиво лежить у зелені', () => {
    const d = decide('herb_nettle', 'пиво', 'пиво Kronenbourg Blanc');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('alc_beer_wheat');
  });

  it('рис арборіо під «рисовим папером» — на картці немає калорій', () => {
    const d = decide('rice_paper', 'рис', 'рис арборіо');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('grain_rice_arborio');
  });

  it('тонік Schweppes під «шоколадним молоком» — і молочний, і скоромний', () => {
    const d = decide('milk_chocolate_drink', 'напій', 'напій Schweppes Pink Tonic');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('drink_schweppes');
  });

  it('сир плавлений Viola під ключем «Янтаря» — чужий бренд', () => {
    // Аліас «сир плавлений viola» заведено на РОДОВУ позицію (ванночка), а не
    // на інший бренд: Viola — плавлений сир у ванночці, а не Янтар.
    const d = decide('cheese_processed_yantar', 'сир плавлений', 'сир плавлений Viola');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('cheese_processed_tub');
  });
});

describe('decideKey: сувора мовчить, друга планка відповідає', () => {
  it('сметана під ключем «Тан» — 21 ккал замість ~200', () => {
    const d = decide('dairy_tan', 'сметана');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('dairy_sour_cream_10');
    expect(d.why).toContain('generic');
  });

  it('рис під «рисовим папером»', () => {
    const d = decide('rice_paper', 'рис');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('grain_rice_long');
  });

  it('мийний засіб: ключ правильний, сувора планка його просто не бачить', () => {
    const d = decide('hh_dish_gel', 'мийний засіб');
    expect(d.action).toBe('keep');
    expect(d.key).toBe('hh_dish_gel');
  });

  it('серветки: те саме — підтвердження, а не скамʼянілість', () => {
    const d = decide('hh_napkins_table', 'серветки');
    expect(d.action).toBe('keep');
    expect(d.key).toBe('hh_napkins_table');
  });

  it('помідори: друга планка повертає той самий ключ — не чіпаємо', () => {
    const d = decide('pomodori_pelati', 'помідори');
    expect(d.action).toBe('keep');
    expect(d.key).toBe('pomodori_pelati');
  });
});

describe('decideKey: друга планка теж мовчить — стерти', () => {
  const dead: [string, string, string][] = [
    ['alc_beer_porter', 'яловичина стейк', 'яловичина стейк Портер'],
    ['alc_beer_ale', 'розпал гель', 'розпал гель Jarrkof'],
  ];
  for (const [stored, product, dn] of dead) {
    it(`«${dn}» під ${stored}`, () => {
      const d = decide(stored, product, dn);
      expect(d.action).toBe('erase');
      expect(d.key).toBeNull();
    });
  }
});

describe('decideKey: друга планка рятує те, що виглядало мертвим', () => {
  it('шоколад Korona: «шоколад» → молочний шоколад, а не кола', () => {
    const d = decide('drink_cola', 'шоколад', 'шоколад Korona мигдаль-кокос');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('milk_chocolate_bar');
  });

  it('пакети біорозкладні: → пакети для сміття, а не кета', () => {
    const d = decide('fish_keta', 'пакети біорозкладні', 'пакети біорозкладні 3кг');
    expect(d.action).toBe('rekey');
    expect(d.key).toBe('r2hh_trash_bags_biodegradable');
  });
});

// ВІДОМА ХИБА, зафіксована навмисно.
//
// `generic` — планка з частковим збігом слів, і на голому родовому слові вона
// вміє збрехати: «чіпси» ловить «бананові чіпси» (`dried_banana`). Оскільки
// збережений ключ той самий, правило читає це як ПІДТВЕРДЖЕННЯ і лишає
// картопляні чіпси з калоріями сушеного банана.
//
// Автоматично відрізнити цей випадок від «мийний засіб → Гель для миття
// посуду» (де така сама розбіжність слів, але ключ правильний) не виходить:
// в обох друга планка каже те саме, що вже стоїть у базі.
//
// Тест тримає поточну поведінку, щоб вона не змінилась мовчки. Коли каталог
// або планку полагодять, він впаде — і це буде правильний сигнал, а не
// регресія.
describe('decideKey: відома хиба другої планки', () => {
  it("«чіпси Lay's сир» лишається під ключем сушеного банана", () => {
    const d = decide('dried_banana', 'чіпси', "чіпси Lay's сир");
    expect(d.action).toBe('keep');
    expect(d.key).toBe('dried_banana');
  });
});

describe('decideKey: порожній ключ — стара гілка, поведінка не змінилась', () => {
  it('впізнаване доливається суворою планкою', () => {
    const d = decide(null, 'помідори чері');
    expect(d.action).toBe('fill');
    expect(d.key).toBe('veg_tomato_cherry');
  });

  it('невпізнаване лишається порожнім — generic на дірку НЕ кличемо', () => {
    // Це і є межа: на порожньому місці родовий здогад — рівно те, від чого
    // сувора планка боронить (logic.ts:249, алергени в дірках тегів).
    const d = decide(null, 'сметана');
    expect(d.action).toBe('keep');
    expect(d.key).toBeNull();
  });
});

describe('decideKey ідемпотентний', () => {
  it('другий прогін по вже перекладеному нічого не міняє', () => {
    const first = decide('cream_20', 'вершки', 'вершки 33%');
    expect(first.action).toBe('rekey');
    const second = decide(first.key, 'вершки', 'вершки 33%');
    expect(second.action).toBe('keep');
    expect(second.key).toBe('cream_33');
  });

  it('стертий ключ на другому прогоні лишається стертим', () => {
    const first = decide('alc_beer_porter', 'яловичина стейк', 'яловичина стейк Портер');
    expect(first.action).toBe('erase');
    const second = decide(first.key, 'яловичина стейк', 'яловичина стейк Портер');
    expect(second.action).toBe('keep');
    expect(second.key).toBeNull();
  });
});
