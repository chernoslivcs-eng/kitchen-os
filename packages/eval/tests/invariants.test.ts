import { describe, it, expect } from 'vitest';
import { registry } from '../invariants.js';
import type { Fixture } from '../fixtures/index.js';

// Інваріанти самі бувають неправі, і тоді вони брешуть дорожче за модель:
// червоний на правильній відповіді відправляє шукати баг там, де його немає.
// calendar-lent флапав чотири рази; учетверте виявилось, що модель відповіла
// бездоганно, а корінь «курк» знайшовся в КУРКУМІ.

const fx = {} as Fixture;
const proposal = (...parts: string[]) => ({
  raw: '',
  card: {
    type: 'proposal',
    items: parts.map((p) => ({ title: p, needs: [], rescues: [] })),
  },
});

describe('lent-no-meat-or-dairy', () => {
  const inv = registry['lent-no-meat-or-dairy']!;

  it('куркума — це спеція, не курка', () => {
    const v = inv(proposal('Нутова юшка з грибами, куркума або паприка'), fx);
    expect(v.pass, v.detail).toBe(true);
  });

  it('справжня птиця ловиться', () => {
    expect(inv(proposal('Куряче філе на пательні'), fx).pass).toBe(false);
    expect(inv(proposal('Індичка з рисом'), fx).pass).toBe(false);
  });

  it('пісна пропозиція проходить', () => {
    const v = inv(proposal('Гриби смажені з нутом', 'Ризото з грибами'), fx);
    expect(v.pass, v.detail).toBe(true);
  });

  // Захисти, які вже стояли в коді — щоб правка їх не збила.
  it('раніші винятки не зламані', () => {
    expect(inv(proposal('Фаршировані гриби'), fx).pass).toBe(true);
    expect(inv(proposal('Гриби дають мʼясистість'), fx).pass).toBe(true);
  });
});

// Дисципліна трійки. Кейси взяті з живого прогону 02.09 — це не вигадані
// приклади, а те, що модель справді повернула на чек Сільпо.
describe('triple-discipline', () => {
  const inv = registry['triple-discipline']!;
  const intake = (...ops: Record<string, unknown>[]) => ({
    raw: '', card: { type: 'intake_diff', ops: ops.map((o) => ({ op: 'add', ...o })) },
  });

  it('повна назва з брендом у своєму полі — проходить', () => {
    const v = inv(intake(
      { label: 'крем-брускетта Ponti з чорних оливок', product: 'крем-брускетта', brand: 'Ponti', variant: 'з чорних оливок' },
      { label: 'вода Моршинська негазована', product: 'вода', brand: 'Моршинська', variant: 'негазована' },
    ) as never, {} as never);
    expect(v.pass, v.detail).toBe(true);
  });

  // Живий репро: у label лишився огризок, усе решта поїхало в variant.
  it('огризок у label ловиться', () => {
    const v = inv(intake(
      { label: 'папір', product: 'папір туалетний', variant: 'Zew Pure Moist' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/бідніший за трійку/);
  });

  it('бренд у variant при порожньому brand ловиться', () => {
    const v = inv(intake(
      { label: 'напій Schweppes Pink Tonic', product: 'напій', variant: 'Schweppes Pink Tonic' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/бренд у variant/);
  });

  it('нуль брендів на весь чек ловиться', () => {
    const v = inv(intake(
      { label: 'булка коричнева', product: 'булка', variant: 'коричнева' },
      { label: 'квас хлібний', product: 'квас', variant: 'хлібний' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/жодного brand/);
  });

  // Межа: відсутній variant — не привід чіплятись, не в кожного товару є
  // сорт. А от бренд, якщо він Є, мусить стояти і в label теж: label — це
  // «людська назва цілком», і саме її людина бачить у картці.
  it('без variant — проходить, якщо label повний', () => {
    const v = inv(intake(
      { label: 'сіль кухонна Артемсіль', product: 'сіль кухонна', brand: 'Артемсіль' },
      { label: 'цукор', product: 'цукор' },
    ) as never, {} as never);
    expect(v.pass, v.detail).toBe(true);
  });

  it('бренд є, але його немає в label — ловиться', () => {
    const v = inv(intake(
      { label: 'пармезан тертий', product: 'пармезан', brand: 'Galbani', variant: 'тертий' },
    ) as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/galbani/i);
  });
});

// Уточнення на родовому слові. Правило додане 02.09 в обидва шляхи —
// attachment-parser (розбір чека) і card-routing (звичайний чат). Інваріант
// перевіряє не «спитала чи ні», а всі три умови разом: картка лишилась,
// питання є, і воно ОДНЕ. Найчастіший провал тут не мовчання, а анкета.
describe('generic-label-asks-once', () => {
  const inv = registry['generic-label-asks-once']!;
  const card = (ops: unknown[]) => ({ type: 'intake_diff', ops });

  it('родове слово без уточнення — провал', () => {
    const v = inv({ reply: 'Запишу мʼясо.', card: card([{ op: 'add', label: 'мʼясо', product: 'мʼясо' }]) } as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/без жодного уточнення/);
  });

  it('родове слово з одним питанням — норма', () => {
    const v = inv({
      reply: 'Запишу. Яке саме мʼясо — щоб потім запропонувати вдале?',
      card: card([{ op: 'add', label: 'мʼясо', product: 'мʼясо' }]),
    } as never, {} as never);
    expect(v.pass).toBe(true);
  });

  it('анкета з кількох питань — провал, навіть якщо всі доречні', () => {
    const v = inv({
      reply: 'Записав. Мʼясо яке саме? А сир? І риба свіжа чи морожена?',
      card: card([
        { op: 'add', label: 'мʼясо', product: 'мʼясо' },
        { op: 'add', label: 'сир', product: 'сир' },
        { op: 'add', label: 'риба', product: 'риба' },
      ]),
    } as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/не анкета/);
  });

  it('конкретні назви питань не потребують', () => {
    const v = inv({
      reply: 'Запишу покупки.',
      card: card([
        { op: 'add', label: 'Крем-брускетта Ponti з чорних оливок', product: 'крем-брускетта' },
        { op: 'add', label: 'Камбоцола 70%', product: 'камбоцола' },
      ]),
    } as never, {} as never);
    expect(v.pass).toBe(true);
  });

  it('уточнення ЗАМІСТЬ картки — провал: позиція мусить записатись', () => {
    // Живий ризик правила: модель починає питати й не робити. Той самий
    // клас, що «зустрічна вилка замість картки» в proposal-flow.
    const v = inv({ reply: 'Яке саме мʼясо?', card: null } as never, {} as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/картка мала лишитись/);
  });
});

// Живий випадок 02.09: фікстура дала PASS, і з термінала не було видно, чи
// правило взагалі спрацювало — інваріант мовчав на успіху, а гілка «родових
// назв не було» виглядає точно так само, як справжня перевірка. Тепер
// звітує завжди, і ці два PASS розрізняються словами.
describe('generic-label-asks-once звітує, що саме перевірив', () => {
  const inv = registry['generic-label-asks-once']!;
  const card = (ops: unknown[]) => ({ type: 'intake_diff', ops });

  it('справжня перевірка називає позицію', () => {
    const v = inv({
      reply: 'Запишу. Яке саме мʼясо?',
      card: card([{ op: 'add', label: 'мʼясо', product: 'мʼясо' }]),
    } as never, {} as never);
    expect(v.pass).toBe(true);
    expect(v.detail).toMatch(/мʼясо/);
    expect(v.detail).toMatch(/одне уточнення/);
  });

  it('тривіальний прохід чесно каже, що не перевірявся', () => {
    const v = inv({
      reply: 'Запишу покупки.',
      card: card([{ op: 'add', label: 'Камбоцола 70%', product: 'камбоцола' }]),
    } as never, {} as never);
    expect(v.pass).toBe(true);
    expect(v.detail).toMatch(/не перевірялось/);
  });
});

// Еталонні розгортання. Живий провал 02.09: чек ФОТОГРАФІЄЮ дав «хусь»
// замість хустинок і «батер» замість багета, тоді як той самий чек текстом
// розібрався добре. Еталон не вигаданий — пари А↔Б із корпусу, зіставлені
// за ціною рядка: мережа сама надрукувала повну назву того, що на касі
// скоротилось.
describe('expected-expansions', () => {
  const inv = registry['expected-expansions']!;
  const card = (labels: string[]) => ({
    type: 'intake_diff',
    ops: labels.map((l) => ({ op: 'add', label: l, product: l.split(' ')[0] })),
  });
  const fx = (expect_products: string[]) => ({ expect_products } as never);

  it('огризки замість назв — провал, і видно яких саме', () => {
    const v = inv({ card: card(['хусь', 'батер', 'папір']) } as never, fx(['хустинки', 'багет', 'туалетн']));
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/не впізнано 3 з 3/);
    expect(v.detail).toMatch(/хустинки/);
  });

  it('повні назви — проходить і звітує скільки', () => {
    const v = inv(
      { card: card(['хустинки Hoc Rut Mini Tissue 150 шт', 'багет подовий гречаний', 'папір туалетний Zewa']) } as never,
      fx(['хустинки', 'багет', 'туалетн']),
    );
    expect(v.pass).toBe(true);
    expect(v.detail).toMatch(/усі 3/);
  });

  it('бренд і варіант теж рахуються — назва може лежати в них', () => {
    // «шоколад молочний Kor з мигдалем» — сорт живе у variant, і еталон
    // «мигдал» має знайтись саме там.
    const v = inv(
      { card: { type: 'intake_diff', ops: [{ op: 'add', label: 'шоколад молочний', product: 'шоколад молочний', brand: 'Kor', variant: 'з мигдалем і кокосом' }] } } as never,
      fx(['мигдал']),
    );
    expect(v.pass).toBe(true);
  });

  it('без еталонів мовчить чесно, а не вдає перевірку', () => {
    const v = inv({ card: card(['будь-що']) } as never, fx([]));
    expect(v.pass).toBe(true);
    expect(v.detail).toMatch(/нема чого звіряти/);
  });
});
