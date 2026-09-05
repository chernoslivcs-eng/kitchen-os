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

// Покриття чека. Фото-фікстура не має тексту, з якого можна порахувати
// рядки, тому кількість оголошується (expect_lines). Доти вона падала з
// «перевір формат» — вада інваріанта, яка маскувала справжні провали поруч.
describe('receipt-coverage-80 на фото', () => {
  const inv = registry['receipt-coverage-80']!;
  const ops = (n: number) => ({ card: { type: 'intake_diff', ops: Array.from({ length: n }, (_, i) => ({ op: 'add', label: `p${i}` })) } });

  it('оголошена кількість замінює підрахунок по тексту', () => {
    const v = inv(ops(21) as never, { expect_lines: 21, attachment: { kind: 'image', path: 'x.png' } } as never);
    expect(v.pass).toBe(true);
    expect(v.detail).toMatch(/21\/21/);
  });

  it('перебір — теж провал: вигадані позиції гірші за пропущені', () => {
    // Живий випадок 02.09: на фото чека з 21 позицією модель нарахувала 23.
    const v = inv(ops(23) as never, { expect_lines: 21, attachment: { kind: 'image', path: 'x.png' } } as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/зайвих|вигадка/);
  });

  it('фото без expect_lines каже, чого бракує, а не «перевір формат»', () => {
    const v = inv(ops(5) as never, { attachment: { kind: 'image', path: 'x.png' } } as never);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/expect_lines/);
  });
});

// 02.09, після переходу attachment_parse на smart: triple-discipline почав
// кричати на ПРАВИЛЬНІ розбори. Причини були дві, обидві в мірилі, не в
// моделі: відмінок («кокосом» проти «Кокос») і письмо («тонік» проти
// «Tonic»). Сильніша модель пише багатші назви, і буквальне порівняння слів
// на них розсипалось. Кейси тут — дослівно з живих прогонів.
describe('triple-discipline не плутає відмінок і письмо з дефектом', () => {
  const inv = registry['triple-discipline']!;
  const one = (o: Record<string, unknown>) => inv(
    { card: { type: 'intake_diff', ops: [{ op: 'add', ...o }] } } as never, {} as never,
  );

  it('відмінок: variant «молочний з кокосом», label «…Кокос»', () => {
    expect(one({ label: 'шоколад молочний Корона Мітки Кокос', product: 'шоколад', brand: 'Корона', variant: 'молочний з кокосом' }).pass).toBe(true);
  });

  it('письмо: variant «тонік рожевий», label «Pink Tonic»', () => {
    // variant узагалі не звіряється: це вільний опис, який законно
    // переформульовують. Ідентифікують товар product і brand.
    expect(one({ label: 'напій Schweppes Pink Tonic 0.25 л', product: 'напій', brand: 'Schweppes', variant: 'тонік рожевий' }).pass).toBe(true);
  });

  it('а от бренд, якого в назві немає, лишається дефектом', () => {
    const v = one({ label: 'дрова для печі', product: 'дрова', brand: 'Renok', variant: 'для печі' });
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/renok/i);
  });

  it('первісний дефект ловиться так само: огризок у label', () => {
    // Заради цього правило й писалось: label «папір» при повній трійці.
    const v = one({ label: 'папір', product: 'папір туалетний', brand: 'Zewa', variant: 'Pure Moist' });
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/туалетний/);
  });
});

// Правопис не має вирішувати долю тесту. Живий випадок 02.09: після переходу
// на smart «expected-expansions» повідомив «не впізнано: чипси» — і з цього
// повідомлення НЕ було видно, що модель написала натомість. Діагностувати
// довелось ручним читанням сирого виходу.
describe('expected-expansions: правопис і діагностика', () => {
  const inv = registry['expected-expansions']!;
  const t = (labels: string[], want: string[]) => inv(
    { card: { type: 'intake_diff', ops: labels.map((l) => ({ op: 'add', label: l, product: l })) } } as never,
    { expect_products: want } as never,
  );

  it('«чіпси» і «чипси» — те саме слово', () => {
    expect(t(['чіпси Lay’s картопляні'], ['чипси']).pass).toBe(true);
    expect(t(['чипси Lay’s картопляні'], ['чіпси']).pass).toBe(true);
  });

  it('апостроф трьох накреслень не ламає збіг', () => {
    expect(t(["м'ясо мідій"], ['мʼясо']).pass).toBe(true);
  });

  it('справжній промах називає, ЩО модель написала натомість', () => {
    const v = t(['снеки'], ['чипси']);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/було: снеки/);
  });
});

// Знахідка A аудиту: третя копія правила про час дієслова. Стара версія
// (`future-tense-with-card`) вимагала майбутнього часу від БУДЬ-ЯКОЇ картки —
// правило, писане під рантайм, де кожна картка чекала тапу. Пул-8 №2 і M13
// 01.09 зробили intake_diff і shopping автозастосовними, і вимога стала
// хибною саме на найчастіших типах. Інваріант при цьому був відчеплений від
// усіх фікстур (QA-7, через мертвий `\b`) — тобто мовчав, поки промпт і
// пост-процесор стверджували те саме вголос.
describe('tense-matches-apply-mode', () => {
  const inv = registry['tense-matches-apply-mode']!;
  const out = (reply: string, type: string) =>
    ({ raw: '', reply, card: { type } }) as never;

  it('минулий час при автозастосованій картці — доконаний факт', () => {
    expect(inv(out('Записав хліб.', 'intake_diff'), fx).pass).toBe(true);
    expect(inv(out('Прибрав сіль зі списку.', 'shopping'), fx).pass).toBe(true);
  });

  it('минулий час при картці, що чекає тапу, — брехня про зроблене', () => {
    const v = inv(out('Записав рецепт у бібліотеку.', 'recipe'), fx);
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/записав/i);
  });

  it('майбутній час там, де тап потрібен, — правильно', () => {
    expect(inv(out('Запишу Оксану в домашні.', 'profile'), fx).pass).toBe(true);
  });

  it('картка нічого не застосовує — правило не застосовне', () => {
    expect(inv(out('Записав.', 'proposal'), fx).pass).toBe(true);
  });

  it('без картки правило не застосовне', () => {
    expect(inv({ raw: '', reply: 'Записав.' } as never, fx).pass).toBe(true);
  });
});

// Крок 9: повний прогін показав два інваріанти, що червоніли на правильних
// відповідях. Числа словами («Сто грамів») і нотатка в полі `note` замість
// старої картки kind:note — контракт кроку 8.
describe('pantry-truth-100', () => {
  const inv = registry['pantry-truth-100']!;
  it('«Сто грамів» словами — правильна відповідь', () => {
    const v = inv({ raw: '', card: null, reply: 'Сто грамів. Решту зʼїла паста сьогодні вдень.' }, fx);
    expect(v.pass, v.detail).toBe(true);
  });
  it('цифрами — теж', () => {
    expect(inv({ raw: '', card: null, reply: 'Десь 100 г лишилось.' }, fx).pass).toBe(true);
  });
  it('500 з історії — дефект, і цифрами, і словами', () => {
    expect(inv({ raw: '', card: null, reply: 'У тебе 500 г помідорів.' }, fx).pass).toBe(false);
    expect(inv({ raw: '', card: null, reply: 'Пʼятсот грамів, ти ж купив пів кіла.' }, fx).pass).toBe(false);
  });
});

describe('preference-note-with-recipe', () => {
  const inv = registry['preference-note-with-recipe']!;
  const reply = 'Записав. Наступного разу додай черрі в кінці.';
  it('нотатка в полі note з назвою страви і овочем — проходить, картки не треба', () => {
    const v = inv({
      raw: '', card: null, reply,
      note: 'Феттучіне з морським коктейлем у вершковому соусі — бракувало овочевої ноти. Наступного разу: черрі в кінці або шпинат',
    }, fx);
    expect(v.pass, v.detail).toBe(true);
  });
  it('note без страви — уподобання ні до чого не привʼязане', () => {
    expect(inv({ raw: '', card: null, reply, note: 'Любить овочеву ноту в пасті' }, fx).pass).toBe(false);
  });
  it('note null — уподобання зникло в тексті', () => {
    expect(inv({ raw: '', card: null, reply, note: null }, fx).pass).toBe(false);
  });
});
