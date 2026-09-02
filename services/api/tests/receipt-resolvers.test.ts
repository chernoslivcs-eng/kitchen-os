import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import { resolveReceiptKey } from '../src/retail/receipt-intake.js';

// Два резолвери на одному корпусі справжніх чеків (02.09.2026).
//
// Досі вони жили порізно: поблажливий `resolveLabelToKey` у каталозі,
// суворий `resolveReceiptKey` у чековому шляху — написаний після живого
// чека 23.08, де перший зробив із «Портерхауса» пиво портер, а з «Сільпо»
// сіль. Порівняти їх на одних даних ніхто не пробував, і тому вибір «який
// із них кличе цей код» досі був випадковим: алергени в apply.ts бере
// ПОБЛАЖЛИВИЙ, вето нехарчового — СУВОРИЙ. Тобто суворість стоїть там, де
// помилка дешева, а вгадування — там, де вона небезпечна.
//
// Цей файл фіксує вимірювання, на якому тримається рішення поміняти їх
// місцями. Головна властивість, яку треба стерегти: суворий може мовчати,
// але не має права збрехати.

interface Corpus {
  pairs: { raw: string; expanded: string; expect: string }[];
  traps: { src: string; line: string; expect: string | null; never: string; why: string }[];
  must_resolve: { src: string; line: string; expect: string; strict_silent: boolean }[];
  corpus: Record<string, string[]>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const c: Corpus = JSON.parse(
  readFileSync(join(HERE, '../../../packages/catalog/tests/fixtures/receipt-corpus.json'), 'utf-8'),
);

describe('суворий резолвер: мовчить, але не бреше', () => {
  it('на жодній пастці не повертає хибний ключ', () => {
    // Ключова властивість. Суворий має право віддати null — це чесно; не
    // має права віддати те, чим товар не є.
    for (const t of c.traps) {
      const key = resolveReceiptKey(t.line);
      expect(key, `${t.line} → ${key} (${t.why})`).not.toBe(t.never);
    }
  });

  it('на розгорнутих назвах із застосунку впізнає правильно', () => {
    const app = c.must_resolve.filter((m) => m.src === 'silpo-app');
    expect(app.length).toBeGreaterThan(0);
    for (const m of app) expect(resolveReceiptKey(m.line), m.line).toBe(m.expect);
  });

  it('на еталонних назвах із пар А↔Б теж влучає', () => {
    // Пари зіставлені за ціною — expanded тут не здогад, а те, що мережа
    // сама надрукувала про той самий товар.
    for (const p of c.pairs) {
      expect(resolveReceiptKey(p.expanded), p.expanded).toBe(p.expect);
    }
  });
});

describe('порівняння на корпусі: скільки відповідей і скільки браку', () => {
  it('поблажливий дає більше відповідей, і частина з них хибна', () => {
    const lines = [...c.corpus['silpo-till']!, ...c.corpus['metro-pdf']!];
    const loose = lines.filter((l) => resolveLabelToKey(l) !== null).length;
    const strict = lines.filter((l) => resolveReceiptKey(l) !== null).length;
    // Поблажливий «покриває» більше — саме тому його колись і поставили.
    expect(loose).toBeGreaterThan(strict);
    // Але серед пасток кожна його відповідь — підміна продукту.
    const wrong = c.traps.filter((t) => resolveLabelToKey(t.line) === t.never).length;
    expect(wrong).toBe(c.traps.length);
  });
});

describe('суворий недобирає: голова береться першим словом', () => {
  // METRO ставить бренд ПЕРШИМ словом, а правило вимагає, щоб аліас містив
  // саме перше слово назви (або мав латинський токен ≥4). «MC ПАРМІДЖАНО
  // РЕДЖАНО» → голова «mc», аліас «пармеджано реджано» її не містить →
  // відкинуто, хоча всі слова аліаса в назві стоять.
  //
  // Бренд-префікс сам по собі вироку не виносить: «MC САЛАТ БЕБІ МІКС»
  // проходить, бо там аліас коротший і збігається інакше. Тому мовчазні
  // рядки перелічені у фікстурі прапорцем strict_silent, а не вгадуються
  // тут за першою літерою — інакше тест ловив би не те, що описує.
  for (const m of c.must_resolve.filter((x) => x.strict_silent)) {
    // ОЧІКУВАННЯ НАВМИСНЕ ХИБНЕ — знімок поточної поведінки. Коли голову
    // навчать пропускати бренд-префікс, тест впаде: тоді strict_silent
    // знімають, і рядок їде у блок «влучає».
    it(`«${m.line}» поки мовчить, хоча ${m.expect} у каталозі є`, () => {
      expect(BY_KEY.get(m.expect), m.expect).toBeDefined();
      expect(resolveReceiptKey(m.line)).toBeNull();
    });
  }

  it('решта METRO-рядків із бренд-префіксом уже влучає — це не регресія', () => {
    for (const m of c.must_resolve.filter((x) => x.src === 'metro-pdf' && !x.strict_silent)) {
      expect(resolveReceiptKey(m.line), m.line).toBe(m.expect);
    }
  });
});
