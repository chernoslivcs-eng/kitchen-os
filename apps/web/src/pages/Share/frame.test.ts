// Шерінг v3: чиста логіка кадрів (spec §4 — вимога тестів окремо від canvas).
import { describe, it, expect } from 'vitest';
import {
  frameDate, frameDateWithWeekday, wrapLines, fitTitle, fitIngredients, fitDescription,
  verticalFontSize, classifyBrightness, pickCookRun, frameDataOf, clampCrop, resetCrop, applyCropDrag,
  type MeasureFn,
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

describe('verticalFontSize: 96 ≤ 1100 → 96; інакше 72 ≤ 1100 → 72; інакше нема', () => {
  it('коротка назва — 96', () => {
    expect(verticalFontSize('Сауер', fakeMeasure)).toBe(96);
  });
  it('середня назва — падає на 72', () => {
    // довжина підібрана так, щоб на 96 (55%×96×len) перевищувала 1100, а на 72 — ні
    const title = 'Смородиновий джин-сауер'; // 23 символи
    const at96 = fakeMeasure(title, '700 96px Onest');
    const at72 = fakeMeasure(title, '700 72px Onest');
    expect(at96).toBeGreaterThan(1100);
    expect(at72).toBeLessThanOrEqual(1100);
    expect(verticalFontSize(title, fakeMeasure)).toBe(72);
  });
  it('дуже довга назва — кадру нема (null)', () => {
    const title = 'Дуже-предуже-довга-назва-страви-яка-нізащо-не-влізе-навіть-дрібним-шрифтом-у-відведену-ширину';
    expect(verticalFontSize(title, fakeMeasure)).toBeNull();
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

describe('resetCrop: скидання до 1× по центру (подвійний тап/клік)', () => {
  it('завжди {scale:1, x:0.5, y:0.5} незалежно від попереднього стану', () => {
    expect(resetCrop()).toEqual({ scale: 1, x: 0.5, y: 0.5 });
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
