import { plural } from './plural';
import type { RecipeNutritionInfo } from '../api';

// Раунд 5, крок Н1 (§4): «≈ 620 ккал · Б 32 · Ж 28 · В 55 на порцію».
// «≈» — коли хоч один інгредієнт з оцінкою або пропущений; «без N інгредієнтів»
// — скільки не увійшло (нема в каталозі або штука без ваги одиниці).
export function formatNutritionLine(c: RecipeNutritionInfo): string {
  const n = c.per_serving;
  const head = `${c.approx ? '≈ ' : ''}${n.kcal} ккал · Б ${Math.round(n.protein)} · Ж ${Math.round(n.fat)} · В ${Math.round(n.carbs)} на порцію`;
  return c.skipped ? `${head} · без ${c.skipped} ${plural(c.skipped, ['інгредієнта', 'інгредієнтів', 'інгредієнтів'])}` : head;
}
