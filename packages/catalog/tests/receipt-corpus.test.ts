import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLabelToKey } from '../logic.js';
import { BY_KEY } from '../seed.js';

// Справжні рядки чеків, зібрані 02.09.2026 з трьох форматів (див. note у
// фікстурі). До цього дня резолвер тестувався на прикладах, придуманих під
// нього; тут — те, що людина реально приносить.
//
// Головне, що дала вибірка: помилки поблажливого резолвера НЕ випадкові, їх
// рівно два роди, і обидва відтворюються на кожному чеку.
//
//   1. ПІДРЯДОК БЕЗ МЕЖ СЛОВА. Аліас шукається всередині тексту, тому назва
//      мережі «Сільпо» містить «сіль», «портерхаус» містить «портер», а
//      «гель» містить «ель» — назву пива. Score 60+довжина, і цього досить,
//      щоб перемогти мовчання.
//   2. МОДИФІКАТОР ПЕРЕМАГАЄ ГОЛОВУ. «Булочка з корицею» стає корицею,
//      «тонік огірок» — огірками, «олія часник» — часником, «чипси
//      картопляні» — картоплею. Продукт підміняється своєю ознакою.
//
// Той самий корінь уже ловили двічі: cosmetic-tonic.test.ts (тонік для
// обличчя → drink_tonic) і коментар над resolveReceiptKey у
// services/api/src/retail/receipt-intake.ts («Портерхаус» → пиво портер,
// «Сільпо» → сіль — живий чек 23.08). Обидва рази лагодили НАВКОЛО дефекту:
// перший — додаванням позицій у каталог, другий — окремим суворим
// резолвером на місці виклику. Сам резолвер лишався як є.
//
// Блок «знімок дефекту» нижче фіксує ПОТОЧНУ (хибну) поведінку навмисно.
// Він має впасти, коли резолвер полагодять, — тоді очікування перевертають
// на `expect`, і падіння стає підтвердженням, що правка спрацювала.

interface Trap { src: string; line: string; expect: string | null; never: string; why: string }
interface Must { src: string; line: string; expect: string }
interface Pair { raw: string; expanded: string; price: string; expect: string }
interface Corpus {
  note: string;
  sources: Record<string, string>;
  pairs: Pair[];
  traps: Trap[];
  must_resolve: Must[];
  corpus: Record<string, string[]>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const c: Corpus = JSON.parse(readFileSync(join(HERE, 'fixtures/receipt-corpus.json'), 'utf-8'));

describe('фікстура чеків — цілісність', () => {
  it('кожен очікуваний і заборонений ключ існує в каталозі', () => {
    const keys = [
      ...c.pairs.map((p) => p.expect),
      ...c.traps.flatMap((t) => [t.expect, t.never]),
      ...c.must_resolve.map((m) => m.expect),
    ].filter((k): k is string => !!k);
    for (const k of keys) expect(BY_KEY.get(k), k).toBeDefined();
  });

  it('пари А↔Б несуть і сирий рядок, і еталонну назву', () => {
    // Пари зіставлені за ЦІНОЮ рядка — це та сама покупка на касі й у
    // застосунку. Тому expanded тут не здогад, а перевірюваний еталон.
    expect(c.pairs.length).toBeGreaterThanOrEqual(7);
    for (const p of c.pairs) {
      expect(p.raw, p.raw).not.toContain(' ');      // касовий друк — без пробілів
      expect(p.expanded, p.expanded).toContain(' '); // застосунок — людська назва
    }
  });
});

describe('паперовий чек Сільпо: каталог тут безсилий за побудовою', () => {
  // Рядок каси не має меж слів («Кр135БрусPontЧорОлив»), тому зіставляти
  // нема чого. Це не дефект каталогу — це межа його застосовності, і вона
  // має бути записана, щоб ніхто не «лагодив» каталог під касовий друк.
  // Розгортання скорочень — робота моделі (attachment-parser.md), і лише
  // ПІСЛЯ неї починається каталог.
  it('поблажливий резолвер на касовому рядку частіше бреше, ніж влучає', () => {
    const till = c.corpus['silpo-till']!;
    const answers = till.map((l) => resolveLabelToKey(l)).filter(Boolean);
    // Виміряно 02.09: відповідей менше, ніж рядків, і серед них є завідомо
    // хибні (див. traps). Поріг тримає факт: більшість рядків лишається без
    // відповіді, і це ЧЕСНІШЕ, ніж вгадування.
    expect(answers.length).toBeLessThan(till.length / 2);
  });
});

describe('знімок ДЕФЕКТУ: поблажливий резолвер підміняє продукт', () => {
  // ЦІ ОЧІКУВАННЯ НАВМИСНЕ ХИБНІ. Вони описують те, що код робить зараз.
  // Коли резолвер полагодять — блок впаде, і кожен рядок треба перевести
  // на trap.expect (правильний ключ) або на null.
  for (const t of c.traps) {
    it(`«${t.line}» → ${t.never} (${t.why})`, () => {
      expect(resolveLabelToKey(t.line)).toBe(t.never);
    });
  }

  it('правильна відповідь для більшості пасток У КАТАЛОЗІ Є', () => {
    // Це знімає єдине виправдання дефекту — мовляв, каталог усе одно не має
    // потрібної позиції. Має: булочка з корицею, стейк портерхаус, тонік
    // огірок, розпалювач, чипси зі смаком сиру.
    const withAnswer = c.traps.filter((t) => t.expect);
    expect(withAnswer.length).toBeGreaterThanOrEqual(5);
    for (const t of withAnswer) expect(BY_KEY.get(t.expect!), t.expect!).toBeDefined();
  });
});
