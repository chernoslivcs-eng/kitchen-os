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
  must_resolve: { src: string; line: string; expect: string; strict_silent: boolean; silent_cause?: string }[];
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

describe('два резолвери на одному корпусі', () => {
  it('після правки вони дають ІДЕНТИЧНИЙ результат на всіх 125 рядках', () => {
    // Це і є висновок гілки. До правки вони розходились принципово:
    // поблажливий відповідав частіше й брехав, суворий мовчав і не брехав.
    // Тепер, коли межі слова й голова стоять в обох, різниці немає жодної —
    // отже, дві функції більше не мають підстав існувати окремо.
    //
    // Наступний крок (не тут): звести їх в одну з рівнем збігу, і хай
    // споживач ставить планку. resolveLabel(minTier) для цього вже готовий.
    const lines = [...c.corpus['silpo-till']!, ...c.corpus['metro-pdf']!];
    const diff = lines.filter((l) => resolveLabelToKey(l) !== resolveReceiptKey(l));
    expect(diff, `розійшлись: ${diff.slice(0, 5).join(' | ')}`).toHaveLength(0);
  });

  it('жоден із них не повертає підмінений ключ на пастках', () => {
    for (const t of c.traps) {
      expect(resolveLabelToKey(t.line), `поблажливий: ${t.line}`).not.toBe(t.never);
      expect(resolveReceiptKey(t.line), `суворий: ${t.line}`).not.toBe(t.never);
    }
  });
});

describe('голова тепер пропускає бренд-префікс', () => {
  // METRO ставить бренд ПЕРШИМ словом, і на «буквально перше слово» головою
  // ставало «mc» чи «kaserei» — правильні збіги гинули, хоча всі слова
  // аліаса в назві стояли. Тепер голова — перше КИРИЛИЧНЕ слово.
  it('METRO-рядки з бренд-префіксом резолвляться правильно', () => {
    for (const m of c.must_resolve.filter((x) => x.src === 'metro-pdf' && !x.strict_silent)) {
      expect(resolveReceiptKey(m.line), m.line).toBe(m.expect);
    }
  });

  // Два рядки мовчать і після правки — з РІЗНИХ причин, і жодна з них не
  // «голова не спрацювала». Причини записані у фікстурі полем silent_cause,
  // щоб наступний, хто сюди прийде, не почав послаблювати правило навмання:
  //   · КАМБОЦОЛА — голова «сир» родова, аліас видовий. Потрібне окреме
  //     правило про родові голови, і воно проєктується окремо.
  //   · ПАРМІДЖАНО — METRO пише через «і», каталог через «е». Це дірка в
  //     аліасах, лікується аліасом, а не резолвером.
  for (const m of c.must_resolve.filter((x) => x.strict_silent)) {
    it(`«${m.line}» поки мовчить: ${m.silent_cause?.split('.')[0]}`, () => {
      expect(BY_KEY.get(m.expect), m.expect).toBeDefined();
      expect(m.silent_cause, 'причина мовчання має бути записана').toBeTruthy();
      expect(resolveReceiptKey(m.line)).toBeNull();
    });
  }
});
