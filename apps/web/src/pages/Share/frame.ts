// Шерінг v3 (spec 2026-09-22-share-v3-design.md): чиста логіка кадрів —
// обрізання тексту, правило яскравості фото, умова «Вертикалі», вибір
// запису журналу. Винесено з render.ts, щоб тестувати без реального canvas
// (вимірювач тексту — параметр, не ctx.measureText напряму).

import type { CookRunWithRecipe, Recipe, RecipeIng } from '../../api';
import { formatQty } from '../../lib/units';

export type MeasureFn = (text: string, font: string) => number;

const FONT = 'Onest, system-ui, sans-serif';

// ── Дата: «21 вересня» / «Субота · 21 вересня» — без року, родовий відмінок ──
const MONTHS_GENITIVE = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const WEEKDAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота'];

export function frameDate(iso?: string | null, now: Date = new Date()): string {
  const d = iso ? new Date(iso) : now;
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`;
}

export function frameDateWithWeekday(iso?: string | null, now: Date = new Date()): string {
  const d = iso ? new Date(iso) : now;
  return `${WEEKDAYS[d.getDay()]} · ${frameDate(iso, now)}`;
}

// ── Дані кадру з Recipe: лише t/tm/ing[]/d йдуть у кадр (spec §1) ──
export interface FrameIngredient { name: string; qty: string }
export interface FrameData {
  title: string;
  minutes: number;
  ingredients: FrameIngredient[];
  description: string;
  date: string;
}

// Той самий форматер, що картка рецепта в стрічці (cards.tsx/Recipe.tsx):
// «600 г», «4 шт», «45 мл» — не сирий label з payload моделі («g»/«pcs»/«ml»).
function ingredientQty(i: RecipeIng): string {
  if (i.v == null) return '—';
  return i.u ? formatQty(i.v, i.u) : String(i.v);
}

export function frameDataOf(recipe: Recipe, finishedAt: string | null | undefined): FrameData {
  return {
    title: recipe.t,
    minutes: recipe.tm,
    ingredients: recipe.ing.map((i) => ({ name: i.n ?? i.p ?? '', qty: ingredientQty(i) })),
    description: recipe.d,
    date: frameDate(finishedAt),
  };
}

// ── Перенос рядків: жадібний word-wrap, без обмеження кількості рядків ──
export function wrapLines(text: string, measure: MeasureFn, font: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && measure(test, font) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  lines.push(line);
  return lines;
}

export function ellipsize(text: string, measure: MeasureFn, font: string, maxWidth: number): string {
  if (measure(text, font) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

// ── Назва: 68/700 до 3 рядків; не влізла → 56; далі «…» на 3-му рядку ──
export interface TitleFit { lines: string[]; size: number }
function linesFit(lines: string[], measure: MeasureFn, font: string, maxWidth: number, maxLines: number): boolean {
  return lines.length <= maxLines && lines.every((l) => measure(l, font) <= maxWidth);
}
export function fitTitle(title: string, measure: MeasureFn, maxWidth: number, weight = 700): TitleFit {
  for (const size of [68, 56]) {
    const font = `${weight} ${size}px ${FONT}`;
    const lines = wrapLines(title, measure, font, maxWidth);
    if (linesFit(lines, measure, font, maxWidth, 3)) return { lines, size };
  }
  const size = 56;
  const font = `${weight} ${size}px ${FONT}`;
  const lines = wrapLines(title, measure, font, maxWidth);
  const shown = lines.slice(0, 3);
  const last = shown.length - 1;
  if (last < 0) return { lines: shown, size };
  if (lines.length > 3) {
    // Текст триває за межами 3-го рядка — «…» несе весь залишок, не лише сам рядок.
    shown[last] = ellipsize([shown[last], ...lines.slice(3)].join(' '), measure, font, maxWidth);
  } else if (measure(shown[last]!, font) > maxWidth) {
    // Рядок сам по собі задовгий (нерозривне слово без пробілів).
    shown[last] = ellipsize(shown[last]!, measure, font, maxWidth);
  }
  return { lines: shown, size };
}

// ── Інгредієнти: ≤8 усі (2×4); більше → 7 + «ще N» останньою клітинкою ──
export interface IngredientsFit { shown: FrameIngredient[]; more: number | null }
export function fitIngredients(ingredients: FrameIngredient[]): IngredientsFit {
  if (ingredients.length <= 8) return { shown: ingredients, more: null };
  return { shown: ingredients.slice(0, 7), more: ingredients.length - 7 };
}

// ── Опис: ≤3 рядки 28/1.4; довший — обрізати по останньому повному реченню ──
const SENTENCE_SPLIT = /(?<=[.!?…])\s+/;
export function fitDescription(description: string, measure: MeasureFn, maxWidth: number, size = 28, weight = 400, maxLines = 3): string[] {
  const font = `${weight} ${size}px ${FONT}`;
  const full = wrapLines(description, measure, font, maxWidth);
  if (linesFit(full, measure, font, maxWidth, maxLines)) return full;

  const sentences = description.split(SENTENCE_SPLIT).filter(Boolean);
  let acc = '';
  let best: string[] = [];
  for (const s of sentences) {
    const candidate = acc ? `${acc} ${s}` : s;
    const lines = wrapLines(candidate, measure, font, maxWidth);
    if (!linesFit(lines, measure, font, maxWidth, maxLines)) break;
    acc = candidate;
    best = lines;
  }
  if (best.length) return best;

  // Жодне речення цілком не влазить (рідкість без розділових знаків) —
  // тверде обрізання перших maxLines рядків повного вейрапу, «…» на залишку.
  const hardLines = wrapLines(description, measure, font, maxWidth);
  const shown = hardLines.slice(0, maxLines);
  const last = shown.length - 1;
  if (last < 0) return shown;
  if (hardLines.length > maxLines) {
    shown[last] = ellipsize([shown[last], ...hardLines.slice(maxLines)].join(' '), measure, font, maxWidth);
  } else if (measure(shown[last]!, font) > maxWidth) {
    shown[last] = ellipsize(shown[last]!, measure, font, maxWidth);
  }
  return shown;
}

// ── «Вертикаль»: 96/700 ≤ 1100 → 96; інакше 72 ≤ 1100 → 72; інакше нема кадру ──
export function verticalFontSize(title: string, measure: MeasureFn, maxWidth = 1100, weight = 700): number | null {
  for (const size of [96, 72]) {
    if (measure(title, `${weight} ${size}px ${FONT}`) <= maxWidth) return size;
  }
  return null;
}

// ── Яскравість фото: середня відносна яскравість верхніх 45% + нижніх 18% ──
// пікселів (після кропу, зменшена копія) — > 0.6 → світла, інакше темна.
export type Brightness = 'light' | 'dark';
export function classifyBrightness(pixels: Uint8ClampedArray | number[], width: number, height: number): Brightness {
  const topEnd = Math.round(height * 0.45);
  const bottomStart = Math.round(height * (1 - 0.18));
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    if (y >= topEnd && y < bottomStart) continue; // середина не рахується
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = pixels[i]! / 255, g = pixels[i + 1]! / 255, b = pixels[i + 2]! / 255;
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count++;
    }
  }
  const avg = count ? sum / count : 0;
  return avg > 0.6 ? 'light' : 'dark';
}

// ── Кроп фото: масштаб 1..3× + зсув по обох осях (0..1 кожна, 0.5 — центр) ──
// x/y — частка пандомого діапазону при ПОТОЧНОМУ scale (не абсолютні пікселі
// зображення) — coverRect (render.ts) перераховує сам діапазон з натуральних
// розмірів фото на кожному кадрі; тут лише межі, з яких і випливає «фото
// ніколи не відкриває тло» — sx/sy завжди в [0, imgW-sw]/[0, imgH-sh].
export interface CropState { scale: number; x: number; y: number }
export const CROP_MIN_SCALE = 1;
export const CROP_MAX_SCALE = 3;
export const CROP_DEFAULT: CropState = { scale: 1, x: 0.5, y: 0.5 };

export function clampCrop(state: CropState): CropState {
  return {
    scale: Math.min(CROP_MAX_SCALE, Math.max(CROP_MIN_SCALE, state.scale)),
    x: Math.min(1, Math.max(0, state.x)),
    y: Math.min(1, Math.max(0, state.y)),
  };
}

export function resetCrop(): CropState {
  return { ...CROP_DEFAULT };
}

// Правка 22.09 (п.10): перетягування було інвертоване — тягнеш униз, фото
// їде вгору (бо зсув sx/sy у coverRect росте зі зростанням x/y, а зростання
// sy = вибір НИЖЧОЇ ділянки джерела = видиме зображення їде ВГОРУ). Пряма
// маніпуляція: фото йде ЗА пальцем/курсором — drag вниз (dy>0) відкриває
// верх знімка, тобто y МЕНШАЄ. Знак — мінус, по обох осях, на будь-якому
// масштабі (масштаб лише міняє maxOff у coverRect, не напрямок).
export function applyCropDrag(start: CropState, dx: number, dy: number, boxW: number, boxH: number): CropState {
  return clampCrop({
    scale: start.scale,
    x: start.x - dx / Math.max(1, boxW),
    y: start.y - dy / Math.max(1, boxH),
  });
}

// ── «Розкладка» (4-й кадр, автоматизована версія D2 «розріджений рядок»):
// назва — дві збалансовані групи в один рядок; слова, що не влізли — «хвіст»,
// іде в сітку разом з назвами інгредієнтів. ──
export interface LayoutTitle {
  size: number;       // 64 або 56
  left: string[];     // ліва група (верхній регістр — на малюванні)
  right: string[];    // права група; порожньо при centered
  centered: boolean;  // єдине слово, що влізло, — по центру
  tail: string[];     // слова понад те, що влізло в рядок — у сітку
}
function sumLen(words: string[]): number {
  return words.reduce((s, w) => s + w.length, 0);
}
// Межа k (1..n-1), що мінімізує різницю сум довжин лівої/правої групи —
// порядок слів не міняємо, лише вибираємо, де розрізати.
function bestSplit(words: string[]): { left: string[]; right: string[] } {
  let bestK = 1, bestDiff = Infinity;
  for (let k = 1; k < words.length; k++) {
    const diff = Math.abs(sumLen(words.slice(0, k)) - sumLen(words.slice(k)));
    if (diff < bestDiff) { bestDiff = diff; bestK = k; }
  }
  return { left: words.slice(0, bestK), right: words.slice(bestK) };
}
export function splitLayoutTitle(title: string, measure: MeasureFn, maxWidth = 840, weight = 700): LayoutTitle {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: 64, left: [], right: [], centered: true, tail: [] };
  for (const size of [64, 56]) {
    const font = `${weight} ${size}px ${FONT}`;
    for (let n = words.length; n >= 1; n--) {
      const candidate = words.slice(0, n);
      if (n === 1) {
        if (measure(candidate[0]!.toUpperCase(), font) <= maxWidth) {
          return { size, left: candidate, right: [], centered: true, tail: words.slice(1) };
        }
        continue;
      }
      const { left, right } = bestSplit(candidate);
      const w = measure(left.join(' ').toUpperCase(), font) + measure(right.join(' ').toUpperCase(), font);
      if (w <= maxWidth) return { size, left, right, centered: false, tail: words.slice(n) };
    }
  }
  // Навіть одне слово на 56 не влазить (рідкість) — усе одно центруємо.
  return { size: 56, left: [words[0]!], right: [], centered: true, tail: words.slice(1) };
}

// Сітка 3×≤3: центр 1-го рядка — фіксовано чіп (не в цьому масиві); решта
// 8 клітинок — спершу шматки «хвоста» назви (≤2 слова), потім назви
// інгредієнтів без кількостей (теж ≤2 слова), у порядку рецепта, ліміт 8.
function chunk(words: string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(' '));
  return out;
}
export function layoutGridItems(tail: string[], ingredients: FrameIngredient[]): string[] {
  const tailChunks = chunk(tail, 2);
  const ingChunks = ingredients.flatMap((i) => chunk(i.name.trim().split(/\s+/).filter(Boolean), 2));
  return [...tailChunks, ...ingChunks].slice(0, 8);
}
export function layoutChipLabel(minutes: number): string {
  return `${minutes} ХВИЛИН`;
}

// ── Вибір запису журналу: `run` із query, інакше останній не-undone з фото ──
export function pickCookRun(runs: CookRunWithRecipe[], recipeId: string, runParam?: string | null): CookRunWithRecipe | null {
  const forRecipe = runs.filter((r) => r.recipe_id === recipeId && !r.undone_at);
  if (runParam) return forRecipe.find((r) => r.id === runParam) ?? null;
  const withPhoto = forRecipe.filter((r) => r.photo_url);
  const sorted = [...withPhoto].sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at));
  return sorted[0] ?? null;
}
