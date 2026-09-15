// «Нехарчове не в комору» (Р161, PR 3). Живий чек власника 15.09: дрова,
// розпалювач, одноразовий гриль, пакети й насадки Oral-B досі проходили в
// «Додати до комори» — каталог їх не знав, а вето має право лише на те, що
// впізнав. Стоп-слова живуть у каталозі (категорія «нехарчове» + аліаси),
// не в маршруті: обидва шляхи — чек мережі й чек-фото в чаті — беруть один
// словник.
import { describe, expect, it } from 'vitest';
import type { IntakeCard } from '@kitchen/domain';
import { receiptLinesToIntake } from '../src/retail/receipt-intake.js';
import { vetoNonfood, nonfoodReplyLine } from '../src/nonfood-veto.js';

const OWNER_RECEIPT = [
  "Дрова Pen'ok Початок вогню №2",
  'Розпалювач-гель Jarrkof 500мл',
  'Гриль одноразовий Weekend',
  'Пакет Сільпо Пакет з Пакетів 18кг',
  'Пакет біорозкладний',
  'Пакети Mpro для сміття 35л',
  'Насадки для зубної щітки Oral-B Precision Clean 2шт',
];
const FOOD = ['Томат Біоранж жовтий', 'Молоко Яготинське 2,5%', 'Порошок пекарський Dr. Oetker'];

const line = (name: string) => ({ name, quantity: 1, unit: 'шт', price: 100, image: null });
const intake = (labels: string[]): IntakeCard => ({
  type: 'intake_diff',
  ops: labels.map((label) => ({ op: 'add', label, value: 1, unit: 'pcs' })),
} as IntakeCard);

describe('стоп-слова нехарчового', () => {
  it('чек мережі: усі рядки чека власника — у nonfood, їжа — в ops', () => {
    const r = receiptLinesToIntake([...OWNER_RECEIPT, ...FOOD].map(line));
    expect(r.nonfood.map((l) => l.name)).toEqual(OWNER_RECEIPT);
    expect(r.unmatched).toHaveLength(0);
    expect(r.ops.map((o) => o.label)).toEqual(FOOD);
  });

  it('чек-фото в чаті: те саме вето на тій самій картці', () => {
    const card = intake([...OWNER_RECEIPT, ...FOOD]);
    expect(vetoNonfood(card)).toBe(OWNER_RECEIPT.length);
    expect(card.ops.map((o) => o.label)).toEqual(FOOD);
    expect(card.nonfood?.map((n) => n.label)).toEqual(OWNER_RECEIPT);
  });

  it('стоп-слова голови: пакет/пакети, дрова, розпалювач, гриль одноразовий, серветки, щітка, насадки, батарейки, засіб, порошок, шампунь, мило, папір туалетний, фольга, плівка, мішки', () => {
    const lines = [
      'Пакет', 'Пакети', 'Дрова березові', 'Розпалювач для вугілля', 'Гриль одноразовий',
      'Серветки Ruta', 'Щітка для посуду', 'Насадки Oral-B', 'Батарейки AA', 'Засіб Fairy',
      'Порошок Persil', 'Шампунь Dove', 'Мило Safeguard', 'Папір туалетний Zewa', 'Фольга 10м', 'Плівка харчова', 'Мішки 60л',
    ];
    const r = receiptLinesToIntake(lines.map(line));
    expect(r.nonfood.map((l) => l.name)).toEqual(lines);
  });

  it('їжа з тими самими словами не потрапляє під стоп-слово', () => {
    const r = receiptLinesToIntake(['Гриль курячий', 'Порошок пекарський', 'Сіль морська', 'Хліб пакет'].map(line));
    expect(r.nonfood).toHaveLength(0);
  });

  it('тихий рядок відповіді: «Не в комору: N (…)», до трьох назв головами', () => {
    expect(nonfoodReplyLine([])).toBeNull();
    expect(nonfoodReplyLine(['Пакет Сільпо'])).toBe('Не в комору: 1 (пакет)');
    expect(nonfoodReplyLine(OWNER_RECEIPT)).toBe('Не в комору: 7 (дрова, розпалювач-гель, гриль…)');
  });
});
