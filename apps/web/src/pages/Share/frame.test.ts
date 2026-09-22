// Шерінг v3: чиста логіка кадрів (spec §4 — вимога тестів окремо від canvas).
import { describe, it, expect } from 'vitest';
import {
  frameDate, frameDateWithWeekday, wrapLines, fitTitle, fitIngredients, fitIngredientName, fitDescription,
  fitVerticalColumn, fitVerticalIngLine, ingLineOf, classifyBrightness, pickCookRun, frameDataOf, clampCrop, resetCrop, applyCropDrag, isCropDefault,
  splitLayoutTitle, layoutGridItems, layoutChipLabel,
  fitVerticalLayout, verticalTitleThickness, verticalLayoutRects, rectsIntersect,
  type MeasureFn, type FrameData,
} from './frame';
import type { CookRunWithRecipe, Recipe } from '../../api';

// Фейковий вимірювач — ширина символу залежить від розміру шрифту (px у
// рядку font), щоб fitTitle/verticalFontSize справді реагували на розмір.
const fakeMeasure: MeasureFn = (text, font) => {
  const m = /(\d+)px/.exec(font);
  const px = m ? Number(m[1]) : 16;
  return text.length * px * 0.55;
};

describe('frameDate / frameDateWithWeekday', () => {
  it('«21 вересня» без року, родовий відмінок', () => {
    expect(frameDate('2026-09-21T12:00:00.000Z')).toBe('21 вересня');
    expect(frameDate('2026-01-05T00:00:00.000Z')).toBe('5 січня');
  });
  it('без дати — сьогодні (now переданий явно)', () => {
    expect(frameDate(null, new Date('2026-12-25T00:00:00.000Z'))).toBe('25 грудня');
  });
  it('із днем тижня — «Субота · 21 вересня»', () => {
    // 2026-09-19 — субота
    expect(frameDateWithWeekday('2026-09-19T10:00:00.000Z')).toBe('Субота · 19 вересня');
  });
});

describe('wrapLines', () => {
  it('жадібний перенос по словах', () => {
    const lines = wrapLines('один два три чотири', fakeMeasure, '700 10px Onest', 90);
    expect(lines.join('|')).not.toBe('один два три чотири');
    expect(lines.length).toBeGreaterThan(1);
  });
  it('короткий текст — один рядок', () => {
    expect(wrapLines('коротко', fakeMeasure, '700 10px Onest', 1000)).toEqual(['коротко']);
  });
});

describe('fitTitle: 68 → 3 рядки; не влізла → 56; далі «…»', () => {
  it('коротка назва лишається на 68px, в одному-двох рядках', () => {
    const r = fitTitle('Паста', fakeMeasure, 900);
    expect(r.size).toBe(68);
    expect(r.lines.length).toBeLessThanOrEqual(3);
  });
  it('назва, що не влазить у 3 рядки на 68px, падає на 56px', () => {
    // На 68px кожен символ ширший — довгий текст переповнює 3 рядки; на 56 влазить.
    const long = 'Спагеттіні з мідіями в томатному винному соусі та часником';
    const r = fitTitle(long, fakeMeasure, 700);
    expect(r.size).toBe(56);
    expect(r.lines.length).toBeLessThanOrEqual(3);
  });
  it('навіть на 56 не влазить у 3 рядки — 3-й рядок з «…»', () => {
    const veryLong = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ');
    const r = fitTitle(veryLong, fakeMeasure, 300);
    expect(r.size).toBe(56);
    expect(r.lines.length).toBe(3);
    expect(r.lines[2]!.endsWith('…')).toBe(true);
  });
});

describe('fitIngredients: ≤8 усі, >8 → 7 + «ще N»', () => {
  const ing = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Інгредієнт ${i}`, qty: '10 г' }));
  it('8 — усі показано, more null', () => {
    const r = fitIngredients(ing(8));
    expect(r.shown.length).toBe(8);
    expect(r.more).toBeNull();
  });
  it('9 — 7 показано, «ще 2»', () => {
    const r = fitIngredients(ing(9));
    expect(r.shown.length).toBe(7);
    expect(r.more).toBe(2);
  });
  it('менше 8 — усі показано', () => {
    const r = fitIngredients(ing(3));
    expect(r.shown.length).toBe(3);
    expect(r.more).toBeNull();
  });
});

// Хотфікс (прод, 22.09): назва в сітці Постера/Чистого тла малювалась без
// обмеження ширини й налазила на сусідню колонку. Реальні найдовші назви
// з NUTRI-PANTRY-0922.json.
describe('fitIngredientName: ≤2 рядки в межах колонки, довша — «…» на 2-му', () => {
  it('коротка назва — один рядок', () => {
    expect(fitIngredientName('Сіль', fakeMeasure, '400 10px Onest', 900)).toEqual(['Сіль']);
  });
  it('«анчоуси Rizzoli кантабрійські в оливковій олії» — не більше 2 рядків, жоден не ширший за колонку', () => {
    const name = 'анчоуси Rizzoli кантабрійські в оливковій олії';
    const font = '400 28px Onest';
    const colW = 460; // (maxWidth-56)/2 при реальному maxWidth постера
    const lines = fitIngredientName(name, fakeMeasure, font, colW);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(fakeMeasure(l, font)).toBeLessThanOrEqual(colW);
  });
  it('«вʼялені томати з сиром Helcom Antipasti Pomidory suszone nadziewane masą serową» — довша за 2 рядки, 2-й з «…»', () => {
    const name = 'вʼялені томати з сиром Helcom Antipasti Pomidory suszone nadziewane masą serową';
    const font = '400 28px Onest';
    const colW = 460;
    const lines = fitIngredientName(name, fakeMeasure, font, colW);
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    for (const l of lines) expect(fakeMeasure(l, font)).toBeLessThanOrEqual(colW);
  });
  it('«сушені курячі слайси Наша Ряба РябChick з перцем та паприкою» — не ширша за колонку жодним рядком', () => {
    const name = 'сушені курячі слайси Наша Ряба РябChick з перцем та паприкою';
    const font = '400 28px Onest';
    const colW = 460;
    const lines = fitIngredientName(name, fakeMeasure, font, colW);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(fakeMeasure(l, font)).toBeLessThanOrEqual(colW);
  });
  it('нерозривне (без пробілів) задовге слово на 1 рядку — «…» без падіння', () => {
    const font = '400 28px Onest';
    const lines = fitIngredientName('а'.repeat(80), fakeMeasure, font, 100, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[lines.length - 1]!.endsWith('…')).toBe(true);
  });
});

describe('fitDescription: ≤3 рядки, довший — по останньому повному реченню', () => {
  it('короткий опис влазить цілком', () => {
    const lines = fitDescription('Коротка страва.', fakeMeasure, 1000);
    expect(lines).toEqual(['Коротка страва.']);
  });
  it('довгий опис обрізається по останньому реченню, що влазить у 3 рядки', () => {
    const desc = 'Перше речення тут. Друге речення трохи довше за перше. Третє речення ще довше за обидва попередні разом узяті. Четверте вже зайве.';
    const lines = fitDescription(desc, fakeMeasure, 260);
    const joined = lines.join(' ');
    expect(joined).not.toContain('Четверте вже зайве');
    expect(lines.length).toBeLessThanOrEqual(3);
    // Останній показаний рядок закінчується повним реченням (крапкою), не «…».
    expect(lines[lines.length - 1]!.trim().endsWith('…')).toBe(false);
  });
  it('жодне речення цілком не влазить — тверде обрізання з «…»', () => {
    const desc = 'дуже-довге-єдине-слово-без-крапок-і-пробілів-що-нізащо-не-влізе-у-жоден-рядок-навіть-один';
    const lines = fitDescription(desc, fakeMeasure, 40);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[lines.length - 1]!.endsWith('…')).toBe(true);
  });
});

// Хотфікс (прод, 22.09): «Вертикаль» раніше зникала цілком, коли назва не
// влазила в 1 рядок на 96/72px («Спагеттіні з мідіями, анчоусами та
// просеко» — 42 símb. — кадру не було, «3 / 3» замість «4 / 4»). Тепер
// fitVerticalLayout ЗАВЖДИ повертає валідний розклад (перенос до 2 рядків,
// кегль 96→72→56, у крайньому разі «…»), а verticalLayoutRects дає
// прямокутники для перевірки, що ніщо не накладається.
const frame = (over: Partial<FrameData> = {}): FrameData => ({
  title: 'Борщ', minutes: 40, description: 'Класичний борщ на яловичині.', date: '22 вересня', character: 'Затишний',
  ingredients: [{ name: 'буряк', qty: '2 шт' }, { name: 'капуста', qty: '300 г' }, { name: 'яловичина', qty: '500 г' }],
  ...over,
});

describe('rectsIntersect: суміжні (дотичні впритул) прямокутники — не перетин; реальний — так', () => {
  it('впритул по x (той самий рядок абзацу, суміжна колонка) — не перетин', () => {
    // Значення як у справжньому VCOL_LINE_PX (22×1.4=30.799999999999997) —
    // накопичена похибка плаваючої коми якраз і ловила цей кейс хибно.
    const a = { x: 218.8, y: 0, w: 30.799999999999997, h: 100 };
    const b = { x: 249.6, y: 0, w: 30.8, h: 100 };
    expect(rectsIntersect(a, b)).toBe(false);
  });
  it('впритул по y — не перетин', () => {
    const a = { x: 0, y: 100, w: 50, h: 50 };
    const b = { x: 0, y: 150, w: 50, h: 50 };
    expect(rectsIntersect(a, b)).toBe(false);
  });
  it('справжній перетин (заходить на кілька пікселів) — так', () => {
    const a = { x: 0, y: 0, w: 50, h: 50 };
    const b = { x: 40, y: 40, w: 50, h: 50 };
    expect(rectsIntersect(a, b)).toBe(true);
  });
  it('явно окремі — не перетин', () => {
    const a = { x: 0, y: 0, w: 50, h: 50 };
    const b = { x: 200, y: 200, w: 50, h: 50 };
    expect(rectsIntersect(a, b)).toBe(false);
  });
});

describe('verticalTitleThickness: 1 рядок = size; 2 рядки = size + крок 1.02×size (той самий, що fitTitle)', () => {
  it('1 рядок — просто size', () => {
    expect(verticalTitleThickness(1, 96)).toBe(96);
  });
  it('2 рядки — size + 1.02×size', () => {
    expect(verticalTitleThickness(2, 96)).toBeCloseTo(96 + 96 * 1.02, 5);
  });
});

describe('fitVerticalLayout: кадр завжди валідний — коротка назва лишається як була', () => {
  it('«Борщ» — 96px, 1 рядок (не зіпсували звичний вигляд)', () => {
    const r = fitVerticalLayout(frame(), fakeMeasure);
    expect(r.size).toBe(96);
    expect(r.titleLines).toEqual(['Борщ']);
  });
});

describe('fitVerticalLayout: довгі реальні назви — кадр присутній, ≤2 рядки, ніколи null', () => {
  const longTitles = [
    'Спагеттіні з мідіями, анчоусами та просеко',
    'Спагеттіні з мідіями в томатному винному соусі',
    'Паста з печеними помідорами й часником',
  ];
  for (const title of longTitles) {
    it(`«${title}» — влазить у ≤2 рядки на якомусь із 96/72/56`, () => {
      const r = fitVerticalLayout(frame({ title }), fakeMeasure);
      expect([96, 72, 56]).toContain(r.size);
      expect(r.titleLines.length).toBeLessThanOrEqual(2);
      expect(r.titleLines.length).toBeGreaterThan(0);
    });
  }
  it('навіть неможливо довга назва — 2 рядки з «…» на другому, не null і не падає', () => {
    const title = Array.from({ length: 30 }, (_, i) => `слово${i}`).join(' ');
    const r = fitVerticalLayout(frame({ title }), fakeMeasure);
    expect(r.size).toBe(56);
    expect(r.titleLines.length).toBe(2);
    expect(r.titleLines[1]!.endsWith('…')).toBe(true);
  });
});

describe('verticalLayoutRects: жодних накладань — назва (1–2 рядки) і обидві колонки', () => {
  const cases: [string, Partial<FrameData>][] = [
    ['контроль — коротка назва', {}],
    ['«Спагеттіні з мідіями, анчоусами та просеко»', { title: 'Спагеттіні з мідіями, анчоусами та просеко' }],
    ['«Спагеттіні з мідіями в томатному винному соусі»', { title: 'Спагеттіні з мідіями в томатному винному соусі' }],
    ['«Паста з печеними помідорами й часником»', { title: 'Паста з печеними помідорами й часником' }],
  ];
  for (const [label, over] of cases) {
    it(`${label} — жодна пара прямокутників не перетинається`, () => {
      const data = frame(over);
      const layout = fitVerticalLayout(data, fakeMeasure);
      const rects = verticalLayoutRects(layout, fakeMeasure);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(rectsIntersect(rects[i]!, rects[j]!)).toBe(false);
        }
      }
    });
  }

  it('патологічний випадок — довга назва + довгий опис + багато довгих інгредієнтів: колонки урізаються, але не накладаються', () => {
    const data = frame({
      title: 'Дуже-предуже-довга-назва-страви-яка-нізащо-не-влізе-навіть-дрібним-шрифтом-у-відведену-ширину',
      character: 'Дуже врочистий і надзвичайно деталізований',
      description: Array.from({ length: 40 }, (_, i) => `речення номер ${i} про смак і текстуру.`).join(' '),
      ingredients: Array.from({ length: 20 }, (_, i) => ({ name: `дуже довга назва інгредієнта номер ${i} з деталями`, qty: '100 г' })),
    });
    const layout = fitVerticalLayout(data, fakeMeasure);
    expect(layout.size).toBe(56); // найгірший випадок — і за розміром, і за урізаними колонками
    const rects = verticalLayoutRects(layout, fakeMeasure);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsIntersect(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });
});

describe('ingLineOf: назва+кількість через nbsp, розрив лише на « · » (той самий алгоритм, що макет D1)', () => {
  it('nbsp усередині елемента; «—» — без кількості; розрив-роздільник — звичайні пробіли', () => {
    const line = ingLineOf([{ name: 'Джин Haister', qty: '50 мл' }, { name: 'Лід', qty: '—' }]);
    expect(line).toBe('Джин Haister 50 мл · Лід');
  });
  it('порожньо — порожній рядок', () => {
    expect(ingLineOf([])).toBe('');
  });
});

describe('fitVerticalColumn: колонка 1 («<характер>. <опис>») — word-wrap, обрізання за maxHeight (п.13, заміна)', () => {
  it('порожньо — []', () => {
    expect(fitVerticalColumn('', fakeMeasure)).toEqual([]);
  });
  it('короткий текст — один рядок, колонка присутня', () => {
    expect(fitVerticalColumn('Просто.', fakeMeasure)).toEqual(['Просто.']);
  });
  it('не влазить у maxLines — останній показаний рядок обрізається «…» з рештою (hand-verified)', () => {
    // 6 слів по 4 символи, maxHeight=100/22px/1.4 → maxLines=3 (100/30.8=3.24);
    // кожен рядок — 1 слово (2 слова разом 108.9 > 100). Рядки 4–6 йдуть у «…».
    const words = ['аааа', 'бббб', 'вввв', 'гггг', 'дддд', 'ееее'];
    const r = fitVerticalColumn(words.join(' '), fakeMeasure, 100, 22, 600, 1.4);
    expect(r).toEqual(['аааа', 'бббб', 'вввв гг…']);
    expect(r.length).toBeLessThanOrEqual(3);
  });
});

describe('fitVerticalIngLine: колонка 2 (інгредієнти) — wrap по токенах ingLine, обрізання за maxHeight (п.13, заміна)', () => {
  it('порожньо — []', () => {
    expect(fitVerticalIngLine([], fakeMeasure)).toEqual([]);
  });
  it('короткий список — один рядок, колонка присутня, порядок з рецепта', () => {
    const r = fitVerticalIngLine([{ name: 'Джин', qty: '50 мл' }, { name: 'Лід', qty: '—' }], fakeMeasure);
    expect(r).toEqual(['Джин 50 мл · Лід']);
  });
  it('не влазить у maxLines — останній показаний рядок обрізається «…» з рештою (hand-verified)', () => {
    // Та сама геометрія, що в fitVerticalColumn, лише роздільник « · » (3 símb.) — теж 1 токен на рядок.
    const ing = (...names: string[]) => names.map((name) => ({ name, qty: '—' }));
    const r = fitVerticalIngLine(ing('аааа', 'бббб', 'вввв', 'гггг', 'дддд', 'ееее'), fakeMeasure, 100, 22, 400, 1.4);
    expect(r).toEqual(['аааа', 'бббб', 'вввв · …']);
    expect(r.length).toBeLessThanOrEqual(3);
  });
  // Хотфікс (прод, 22.09): «назва кількість» — ОДИН nbsp-токен (ingLineOf),
  // без внутрішньої точки розриву. Довга реальна назва сама на власному
  // рядку виходила за maxWidth — перевірено реальним canvas Onest (871px
  // токен у 700px бюджеті). Кожен рядок тепер має вкладатись у maxWidth
  // незалежно від довжини окремого інгредієнта.
  it('один інгредієнт довший за maxWidth сам по собі — рядок все одно не ширший за maxWidth', () => {
    const font = '400 22px Onest';
    const maxWidth = 700;
    const r = fitVerticalIngLine(
      [{ name: 'вʼялені томати з сиром Helcom Antipasti Pomidory suszone nadziewane masą serową', qty: '90 г' }],
      fakeMeasure, maxWidth, 22, 400, 1.4,
    );
    for (const line of r) expect(fakeMeasure(line, font)).toBeLessThanOrEqual(maxWidth);
  });
  it('той самий задовгий інгредієнт серед коротших — жоден рядок не ширший за maxWidth', () => {
    const font = '400 22px Onest';
    const maxWidth = 700;
    const r = fitVerticalIngLine(
      [
        { name: 'сіль', qty: '—' },
        { name: 'вʼялені томати з сиром Helcom Antipasti Pomidory suszone nadziewane masą serową', qty: '90 г' },
        { name: 'часник', qty: '3 зубчики' },
      ],
      fakeMeasure, maxWidth, 22, 400, 1.4,
    );
    for (const line of r) expect(fakeMeasure(line, font)).toBeLessThanOrEqual(maxWidth);
  });
});

describe('classifyBrightness: >0.6 середньої яскравості верху+низу — світла', () => {
  const solid = (r: number, g: number, b: number, w: number, h: number) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255; }
    return px;
  };
  it('темне зображення (усі пікселі чорні) → dark', () => {
    expect(classifyBrightness(solid(0, 0, 0, 10, 10), 10, 10)).toBe('dark');
  });
  it('світле зображення (усі пікселі білі) → light', () => {
    expect(classifyBrightness(solid(255, 255, 255, 10, 10), 10, 10)).toBe('light');
  });
  it('змішане (яскрава середина, темні верх і низ) → dark — середина не рахується', () => {
    // 10×20: верх (0-9, 45%~9) і низ (16-19, 18%~4) чорні; середина (10-15) біла —
    // якби середина впливала, середнє було б світлим; правило її виключає.
    const w = 10, h = 20;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const bright = y >= 9 && y < 16; // середина
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = bright ? 255 : 0;
        px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
      }
    }
    expect(classifyBrightness(px, w, h)).toBe('dark');
  });
});

describe('pickCookRun: run із query, інакше останній не-undone з фото', () => {
  const run = (over: Partial<CookRunWithRecipe> & Pick<CookRunWithRecipe, 'id'>): CookRunWithRecipe => ({
    household_id: 'h', user_id: 'u', recipe_id: 'r1', servings: 2,
    started_at: '2026-09-01T00:00:00.000Z', finished_at: '2026-09-01T01:00:00.000Z',
    rating: null, verdict: null, photo_url: null, changes: null, undone_at: null,
    recipe: { id: 'r1', title: 'Т', time_total: 10, payload: {} as never, created_at: '' },
    ...over,
  });

  it('run param — точний запис за id', () => {
    const runs = [run({ id: 'a' }), run({ id: 'b', photo_url: 'x' })];
    expect(pickCookRun(runs, 'r1', 'b')?.id).toBe('b');
  });
  it('run param на чужий рецепт — null', () => {
    const runs = [run({ id: 'a', recipe_id: 'other' })];
    expect(pickCookRun(runs, 'r1', 'a')).toBeNull();
  });
  it('без run — останній не-undone запис із фото', () => {
    const runs = [
      run({ id: 'old', photo_url: 'x', finished_at: '2026-09-01T00:00:00.000Z' }),
      run({ id: 'new', photo_url: 'y', finished_at: '2026-09-05T00:00:00.000Z' }),
      run({ id: 'nophoto', photo_url: null, finished_at: '2026-09-10T00:00:00.000Z' }),
    ];
    expect(pickCookRun(runs, 'r1')?.id).toBe('new');
  });
  it('без run і без жодного фото — null (чисте тло без кропу)', () => {
    const runs = [run({ id: 'a', photo_url: null })];
    expect(pickCookRun(runs, 'r1')).toBeNull();
  });
  it('undone запис ігнорується', () => {
    const runs = [run({ id: 'a', photo_url: 'x', undone_at: '2026-09-02T00:00:00.000Z' })];
    expect(pickCookRun(runs, 'r1')).toBeNull();
  });
});

// Баг з проду (перегляд на стенді, 22.09): кадр показував сирі одиниці з
// payload моделі («600 g», «4 pcs») замість української форми, як у картці
// рецепта в стрічці/на сторінці (formatQty з lib/units).
describe('frameDataOf: одиниці інгредієнтів — той самий формат, що картка рецепта', () => {
  const RECIPE: Recipe = {
    t: 'Паста', sv: 2, tm: 20, ch: '', d: '', rk: '',
    ing: [
      { n: 'Спагеті', v: 600, u: 'g' },
      { n: 'Яйця', v: 4, u: 'pcs' },
      { n: 'Олія', v: 45, u: 'ml' },
      { n: 'Сіль' },
    ],
    st: [],
  };
  it('«600 г», «4 шт», «45 мл» — не сирі g/pcs/ml', () => {
    const data = frameDataOf(RECIPE, null);
    expect(data.ingredients.map((i) => i.qty)).toEqual(['600 г', '4 шт', '45 мл', '—']);
  });
});

// Правка 22.09 (п.6): кроп фото — масштаб 1–3× + зсув по обох осях. Межі
// clampCrop — те, що гарантує «фото ніколи не відкриває тло» (coverRect у
// render.ts довіряє x/y вже в [0,1] і сам ніколи не читає поза картинкою).
describe('clampCrop: межі масштабу 1..3 і зсуву 0..1 по обох осях', () => {
  it('у межах — не змінює', () => {
    expect(clampCrop({ scale: 2, x: 0.3, y: 0.7 })).toEqual({ scale: 2, x: 0.3, y: 0.7 });
  });
  it('масштаб нижче 1 — підтягує до 1 (не можна менше «cover»)', () => {
    expect(clampCrop({ scale: 0.4, x: 0.5, y: 0.5 }).scale).toBe(1);
  });
  it('масштаб вище 3 — стелю 3', () => {
    expect(clampCrop({ scale: 7, x: 0.5, y: 0.5 }).scale).toBe(3);
  });
  it('x/y нижче 0 або вище 1 — притискає до країв, не відкриває тло', () => {
    expect(clampCrop({ scale: 1.5, x: -0.2, y: 1.9 })).toEqual({ scale: 1.5, x: 0, y: 1 });
  });
  it('x/y рівно на межі 0 і 1 — лишає як є', () => {
    expect(clampCrop({ scale: 2, x: 0, y: 1 })).toEqual({ scale: 2, x: 0, y: 1 });
  });
});

describe('resetCrop: скидання до 1× по центру (кнопка «Скинути кадр», п.14)', () => {
  it('завжди {scale:1, x:0.5, y:0.5} незалежно від попереднього стану', () => {
    expect(resetCrop()).toEqual({ scale: 1, x: 0.5, y: 0.5 });
  });
});

describe('isCropDefault: чи кроп відхилився від {scale:1, x:0.5, y:0.5} (п.14)', () => {
  it('дефолт — true', () => {
    expect(isCropDefault({ scale: 1, x: 0.5, y: 0.5 })).toBe(true);
  });
  it('змінено масштаб — false', () => {
    expect(isCropDefault({ scale: 1.5, x: 0.5, y: 0.5 })).toBe(false);
  });
  it('змінено зсув по x — false', () => {
    expect(isCropDefault({ scale: 1, x: 0.6, y: 0.5 })).toBe(false);
  });
  it('змінено зсув по y — false', () => {
    expect(isCropDefault({ scale: 1, x: 0.5, y: 0.4 })).toBe(false);
  });
});

// Правка 22.09 (п.10): фото йде ЗА пальцем/курсором — drag вниз відкриває
// верх знімка (y МЕНШАЄ), drag управо відкриває лівий край (x МЕНШАЄ).
// Раніше знак був «+», і фото їхало навпаки, проти напрямку жесту.
describe('applyCropDrag: фото йде за пальцем/курсором (знак зсуву)', () => {
  const start = { scale: 1, x: 0.5, y: 0.5 };
  it('drag вниз (dy>0) — y меншає, відкриває верх знімка', () => {
    expect(applyCropDrag(start, 0, 40, 200, 400).y).toBeCloseTo(0.4);
  });
  it('drag угору (dy<0) — y більшає, відкриває низ знімка', () => {
    expect(applyCropDrag(start, 0, -40, 200, 400).y).toBeCloseTo(0.6);
  });
  it('drag управо (dx>0) — x меншає, відкриває лівий край', () => {
    expect(applyCropDrag(start, 40, 0, 200, 400).x).toBeCloseTo(0.3);
  });
  it('drag уліво (dx<0) — x більшає, відкриває правий край', () => {
    expect(applyCropDrag(start, -40, 0, 200, 400).x).toBeCloseTo(0.7);
  });
  it('той самий знак і на масштабі >1 — масштаб лише передається без змін', () => {
    const zoomed = { scale: 2.5, x: 0.5, y: 0.5 };
    const next = applyCropDrag(zoomed, 0, 40, 200, 400);
    expect(next.scale).toBe(2.5);
    expect(next.y).toBeCloseTo(0.4);
  });
  it('межі — clampCrop не пускає за 0..1', () => {
    expect(applyCropDrag(start, 0, 4000, 200, 400).y).toBe(0);
    expect(applyCropDrag(start, 0, -4000, 200, 400).y).toBe(1);
  });
});

// «Розкладка» (4-й кадр, автоматизована версія D2): назва — дві збалансовані
// групи в один рядок; слова, що не влізли, — «хвіст» у сітку. maxWidth у цих
// тестах — контрольований параметр (не 840 за замовчуванням), щоб ізолювати
// саму логіку розбиття від конкретних пікселів шрифту.
describe('splitLayoutTitle: назва — дві збалансовані групи; хвіст — що не влізло', () => {
  it('1 слово — по центру, без хвоста', () => {
    const r = splitLayoutTitle('Сауер', fakeMeasure, 100000);
    expect(r).toEqual({ size: 64, left: ['Сауер'], right: [], centered: true, tail: [] });
  });
  it('2 слова — ліва/права група (єдина можлива межа), без хвоста', () => {
    const r = splitLayoutTitle('Смородиновий джин', fakeMeasure, 100000);
    expect(r).toEqual({ size: 64, left: ['Смородиновий'], right: ['джин'], centered: false, tail: [] });
  });
  it('5 слів, усе влазить — межа мінімізує різницю сум довжин слів', () => {
    const r = splitLayoutTitle('ой два чотр пятьь я', fakeMeasure, 100000);
    expect(r).toEqual({ size: 64, left: ['ой', 'два', 'чотр'], right: ['пятьь', 'я'], centered: false, tail: [] });
  });
  it('5 слів, вузько — зайві слова йдуть у хвіст (не в другий рядок)', () => {
    const r = splitLayoutTitle('ой два чотр пятьь я', fakeMeasure, 500);
    expect(r).toEqual({ size: 64, left: ['ой', 'два'], right: ['чотр'], centered: false, tail: ['пятьь', 'я'] });
  });
  it('7 слів, усе влазить — та сама межа-балансир на довшому списку', () => {
    const r = splitLayoutTitle('ой два чотр пятьь я сім вісім', fakeMeasure, 100000);
    expect(r).toEqual({ size: 64, left: ['ой', 'два', 'чотр'], right: ['пятьь', 'я', 'сім', 'вісім'], centered: false, tail: [] });
  });
});

// Правка 22.09 (п.12): жодна група не закінчується службовим словом (з,
// із, зі, й, і, та, в, у, на, до, під, за, по, при, без, для, а) — воно
// переходить на початок хвоста (права група межує з хвостом напряму, тож
// перенести звідти завжди безпечно для ширини рядка). maxWidth дібраний
// вручну під кожен приклад — контрольований параметр, не 840 за
// замовчуванням (та сама методика, що й вище).
describe('splitLayoutTitle: службове слово не в кінці групи (п.12)', () => {
  it('«Паста з печеними помідорами й часником» — не «ПАСТА | З ПЕЧЕНИМИ» ламає «ПОМІДОРАМИ Й»', () => {
    const r = splitLayoutTitle('Паста з печеними помідорами й часником', fakeMeasure, 800);
    expect(r).toEqual({ size: 64, left: ['Паста'], right: ['з', 'печеними'], centered: false, tail: ['помідорами', 'й', 'часником'] });
  });
  it('«Спагеттіні з мідіями в томатному винному соусі» — «в» не в кінці групи, йде в хвіст', () => {
    const r = splitLayoutTitle('Спагеттіні з мідіями в томатному винному соусі', fakeMeasure, 750);
    expect(r).toEqual({ size: 64, left: ['Спагеттіні'], right: ['з', 'мідіями'], centered: false, tail: ['в', 'томатному', 'винному', 'соусі'] });
  });
  it('«Борщ» — одне слово, службових немає, як і раніше по центру', () => {
    const r = splitLayoutTitle('Борщ', fakeMeasure, 100000);
    expect(r).toEqual({ size: 64, left: ['Борщ'], right: [], centered: true, tail: [] });
  });
  it('«Рис із креветками та лимоном» — «РИС | ІЗ КРЕВЕТКАМИ», хвіст «ТА ЛИМОНОМ»', () => {
    const r = splitLayoutTitle('Рис із креветками та лимоном', fakeMeasure, 700);
    expect(r).toEqual({ size: 64, left: ['Рис'], right: ['із', 'креветками'], centered: false, tail: ['та', 'лимоном'] });
  });
});

describe('layoutGridItems: службове слово не в кінці клітинки (п.12)', () => {
  it('«помідорами й часником» — не «ПОМІДОРАМИ Й» + «ЧАСНИКОМ», а «ПОМІДОРАМИ» + «Й ЧАСНИКОМ»', () => {
    expect(layoutGridItems(['помідорами', 'й', 'часником'], [])).toEqual(['помідорами', 'й часником']);
  });
  it('«в томатному винному соусі» — межі природно не на службовому слові, шматки по 2 як завжди', () => {
    expect(layoutGridItems(['в', 'томатному', 'винному', 'соусі'], [])).toEqual(['в томатному', 'винному соусі']);
  });
  it('«та лимоном» — не розбивається, «лимоном» не службове', () => {
    expect(layoutGridItems(['та', 'лимоном'], [])).toEqual(['та лимоном']);
  });
});

describe('layoutGridItems: хвіст назви перед інгредієнтами, шматки ≤2 слова, ліміт 8', () => {
  it('хвіст, потім назви інгредієнтів (без кількостей), кожне шматками ≤2 слова', () => {
    const tail = ['а', 'б', 'в'];
    const ing = [
      { name: 'Молоко', qty: '1 л' },
      { name: 'Яйця курячі свіжі', qty: '4 шт' },
    ];
    expect(layoutGridItems(tail, ing)).toEqual(['а б', 'в', 'Молоко', 'Яйця курячі', 'свіжі']);
  });
  it('ліміт 8 — хвіст влазить повністю, інгредієнти обрізаються на межі', () => {
    const tail = Array.from({ length: 12 }, (_, i) => `с${i}`); // 12 слів → 6 шматків по 2
    const ing = [
      { name: 'один два', qty: '' }, { name: 'три чотири', qty: '' }, { name: 'пʼять шість', qty: '' },
    ]; // 3×2 слова — ще 3 шматки; разом 9, ліміт 8
    const items = layoutGridItems(tail, ing);
    expect(items).toHaveLength(8);
    expect(items.slice(0, 6)).toEqual(['с0 с1', 'с2 с3', 'с4 с5', 'с6 с7', 'с8 с9', 'с10 с11']);
    expect(items.slice(6)).toEqual(['один два', 'три чотири']); // третій інгредієнт не влазить
  });
  it('без хвоста — самі інгредієнти', () => {
    expect(layoutGridItems([], [{ name: 'Сіль', qty: '' }])).toEqual(['Сіль']);
  });
});

describe('layoutChipLabel: чіп — центр 1-го рядка сітки, поза layoutGridItems', () => {
  it('«N ХВИЛИН»', () => {
    expect(layoutChipLabel(35)).toBe('35 ХВИЛИН');
  });
});
