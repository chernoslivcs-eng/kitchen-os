// Чи можна приготувати цей рецепт із того, що є в коморі.
//
// Перенесено з kitchen-prototype.jsx (matchRecipe + suggestAlt, рядки 653-668,
// 920-926). У прототипі це був екран 07 «Рецепти» зі станами
// ready / near / far — прод шість QA-прогонів жив без нього, і рецепт існував
// тільки як побічний ефект cook-run.
//
// Логіка прототипу збережена дослівно, з однією зміною: він резолвив
// інгредієнт по назві, а в нас модель уже «показує пальцем» через `ing.p`
// (uuid партії). Тому спершу дивимось на p, і тільки потім на назву.

import { root, meaningfulWords } from '@kitchen/catalog';
import type { PantryBatch } from './types.js';

export interface RecipeIngredient {
  p?: string;              // id партії — модель показала пальцем
  n?: string;              // назва, коли продукту в коморі немає
  v?: number;
  u?: string;
  role?: 'critical' | 'optional';
}

export type RecipeReadiness = 'ready' | 'near' | 'far';

export interface RecipeMatch {
  status: RecipeReadiness;
  /** Чого бракує — у тому вигляді, як воно записане в рецепті. */
  missing: RecipeIngredient[];
  /** Партії, які цей рецепт рятує: відкриті або з близьким терміном. */
  rescues: PantryBatch[];
  /** Скільки інгредієнтів із скількох є в коморі — для «3 з 5». */
  have: number;
  total: number;
}

// Партія «термінова», якщо відкрита або догоряє за тиждень. Та сама межа, що
// в serializePantry (мітка «!Nдн») і в чіпі «СКОРО ЗГОРИТЬ» на Feed.
function isUrgent(b: PantryBatch, now: number): boolean {
  if (b.state === 'opened') return true;
  if (!b.expires_at) return false;
  const days = Math.round((new Date(b.expires_at).getTime() - now) / 86_400_000);
  return days <= 7;
}

// Той самий збіг за коренем, що в мітці алергену: `.includes()` не бачить
// відмінка («шоколад з мигдалем» не містить «мигдаль»).
function labelMatches(label: string, name: string): boolean {
  const target = root(name);
  if (target.length < 3) return false;
  return meaningfulWords(label)
    .map(root)
    .some((w) => w === target || w.startsWith(target) || target.startsWith(w));
}

function resolveIng(ing: RecipeIngredient, pantry: PantryBatch[]): PantryBatch | null {
  if (ing.p) {
    const byId = pantry.find((b) => b.id === ing.p && b.state !== 'depleted');
    if (byId) return byId;
  }
  if (!ing.n) return null;
  return pantry.find((b) => b.state !== 'depleted' && labelMatches(b.label, ing.n!)) ?? null;
}

export function matchRecipe(
  ing: RecipeIngredient[],
  pantry: PantryBatch[],
  now = Date.now(),
): RecipeMatch {
  const missing: RecipeIngredient[] = [];
  const rescues: PantryBatch[] = [];
  let criticalMissing = false;

  for (const i of ing) {
    const have = resolveIng(i, pantry);
    if (!have) {
      missing.push(i);
      // Прототип: бракує критичного → «far». Модель ролі поки не проставляє,
      // тому за замовчуванням усе критичне: краще чесне «далеко», ніж обіцянка.
      if (i.role !== 'optional') criticalMissing = true;
    } else if (isUrgent(have, now) && !rescues.some((r) => r.id === have.id)) {
      rescues.push(have);
    }
  }

  const status: RecipeReadiness = missing.length === 0
    ? 'ready'
    : criticalMissing ? 'far' : 'near';

  return { status, missing, rescues, have: ing.length - missing.length, total: ing.length };
}

// Заміна з тієї ж групи продуктів — «немає вершків, є молоко».
// Прототип шукав по groupOf(); у нас групи дає каталог через categories,
// але поки резолвер працює на назвах — беремо перші дві партії, чий корінь
// збігається з коренем відсутнього. Слабко, але краще за нічого; коли
// каталог доїде в БД, замінити на categories.
export function suggestAlternatives(
  missing: RecipeIngredient,
  pantry: PantryBatch[],
  limit = 2,
): PantryBatch[] {
  if (!missing.n) return [];
  const words = meaningfulWords(missing.n).map(root);
  if (!words.length) return [];
  return pantry
    .filter((b) => b.state !== 'depleted')
    .filter((b) => meaningfulWords(b.label).map(root).some((w) => words.includes(w)))
    .slice(0, limit);
}
