// Чи спіймали вікно.
//
// Гейміфікація тут — марки в паспорті, а не крокомір. Одиниця не «день
// поспіль», а спіймане вікно: сезон білих грибів триває шість тижнів на рік,
// це потяг за розкладом — сів або ні. Продукт свідомо позбувся лічильників у
// щоденному потоці, і вони сюди не повертаються.
//
// Нових даних не збирається. «Спіймав» виводиться з того, що вже є: готування
// сталось, поки подія тривала, і в страві було щось із того, заради чого ця
// подія існує.

import { root, meaningfulWords } from '@kitchen/catalog';
import { activeOccasions, type Occasion } from './occasions.js';
import { BUILTIN_OCCASIONS, isWindowRow, type OccasionRow } from './occasion-data.js';
import { ruleWindow, type Tradition } from './occasion-rules.js';
import type { OccasionCatchRow, Recipe } from './types.js';

/**
 * Той самий збіг за коренем, що в мітці алергену й у recipe-match: `.includes`
 * не бачить відмінка — «різото з білими» не містить «білі гриби».
 */
function touches(text: string[], targets: string[]): string | null {
  const words = new Set(text.flatMap(meaningfulWords).map(root));
  for (const t of targets) {
    const parts = meaningfulWords(t).map(root).filter((w) => w.length >= 3);
    if (parts.length && parts.every((w) => words.has(w))) return t;
  }
  return null;
}

export interface Catch {
  occasion_id: string;
  /** Що саме спіймало — щоб підсумок міг сказати «грибами», а не «спіймано». */
  by: string;
}

export interface YearStrip {
  occasion_id: string;
  title: string;
  /** 1–12: місяць, у якому вікно цього року починається. */
  month: number;
  caught: boolean;
  /** Чим спіймано — лише коли caught. */
  by: string | null;
}

/**
 * «Рік на кухні»: дванадцять смуг, спіймані залиті, пропущені порожні.
 *
 * Кандидати — ті самі рядки, що бере activeOccasions/catchesFor: вікна без
 * обмеження. Обмеження виключене тим самим рухом, що й у catchesFor — піст не
 * досягнення, відмітка за нього перетворила б дотримання на змагання.
 * Якорі (лунар/солар — Рамадан, Песах) без вікна не мають місяця, куди їх
 * покласти, і в рік не входять; вони живуть лише в «Ключових датах».
 */
export function yearInKitchen(
  year: number,
  catches: OccasionCatchRow[],
  trads: Tradition[] = [],
  rows: OccasionRow[] = BUILTIN_OCCASIONS,
): YearStrip[] {
  const caught = new Map(
    catches.filter((c) => c.year === year).map((c) => [c.occasion_id, c] as const),
  );
  const out: YearStrip[] = [];
  for (const r of rows) {
    if (!isWindowRow(r) || r.restricts) continue;
    if (r.tradition && !trads.includes(r.tradition)) continue;
    const w = ruleWindow(r.rule, year, trads);
    if (!w) continue;
    const c = caught.get(r.id);
    out.push({
      occasion_id: r.id, title: r.title,
      month: new Date(w.start).getMonth() + 1,
      caught: !!c, by: c?.by ?? null,
    });
  }
  return out.sort((a, b) => a.month - b.month);
}

/**
 * Які з подій, що тривали в момент готування, ця страва спіймала.
 *
 * Спіймати можна лише те, що подія сама назвала: `buy` — що варто докупити,
 * `seeds` — що з цього варити. Випадковий збіг зі словом із назви страви
 * вікна не ловить: інакше «печені овочі» ловили б будь-який овочевий сезон
 * цілий рік.
 */
export function catchesFor(
  recipe: Pick<Recipe, 't' | 'ing'>,
  now: Date,
  trads: Tradition[] = [],
  rows?: OccasionRow[],
): Catch[] {
  const text = [recipe.t, ...(recipe.ing ?? []).map((i) => i.n ?? '')].filter(Boolean);
  const active: Occasion[] = rows
    ? activeOccasions(now, trads, rows)
    : activeOccasions(now, trads);

  const out: Catch[] = [];
  for (const o of active) {
    // Обмеження не ловиться: піст не досягнення, а рамка. Відмітка за нього
    // перетворила б дотримання на змагання.
    if (o.restricts) continue;
    const by = touches(text, [...(o.buy ?? []), ...(o.seeds ?? [])]);
    if (by) out.push({ occasion_id: o.id, by });
  }
  return out;
}
