// Вето на пропозиції — після моделі, до збереження. Раунд 4, крок 4:
// загальне вето по індексу (packages/domain/veto.ts): кожне відхилення —
// окремий запис {event:'veto', candidate, ingredient, row}. Крок 11 прибрав
// стару гілку за profile.allergies разом із профілем v1.
//
// Еval 04.09 після 1.2: shared-meal-allergen — модель поклала «арахісову
// пасту» в rescues французьких тостів на спільний сніданок, при тому що
// рядок партії в [КОМОРА] ніс «⚠АЛЕРГЕН (арахіс в Оксана) — сам не пропонуй
// і НЕ ЗГАДУЙ». Мітка була, модель її переступила. Тверда межа продукту не
// має залежати від того, куди модель подивилась: сервер має право ЗАБОРОНИТИ
// те, що впізнав, і не має права вигадувати.
//
// Страву з рядком індексу прибираємо з картки. Лишилась хоч одна — картка
// живе; не лишилось жодної — картка null і чесна репліка (VETO_EMPTY_REPLY).
// Речення з продуктом із індексу, якого людина сама не називала, ріжуться з
// reply (stripVetoMentions): згадка «але там алерген — не беру» — теж
// пропозиція. Відсічене логується: частота — сигнал про промпт.

import type { Card, VetoRow } from '@kitchen/domain';
import { vetoCard, vetoRecipe, stripVetoMentions, type Recipe } from '@kitchen/domain';

// ----- Обгортка з логом -----------------------------------------------------

export interface VetoLogEntry {
  event: 'veto' | 'veto-reply' | 'veto-recipe';
  candidate: string;
  ingredient?: string;
  row?: VetoRow;
  stripped?: string;
}

export interface ApplyVetoArgs {
  index: VetoRow[];
  userText: string;
  log: (e: VetoLogEntry) => void;
}

export interface ApplyVetoResult {
  rejected: { title: string; hits: string[] }[];
  emptied: boolean;
  stripped: string[];
}

/** Мутує call (card/reply): індекс вето по картці й репліці. Кожне відхилення йде в log. */
export function applyVeto(call: { card: Card | null; reply?: string | null }, a: ApplyVetoArgs): ApplyVetoResult {
  const r = vetoCard(call, a.index, a.userText);
  for (const x of r.rejected) for (const row of x.rows) a.log({ event: 'veto', candidate: x.title, ingredient: x.ingredient, row });
  const s = stripVetoMentions(call, a.index, a.userText);
  for (const st of s.stripped) a.log({ event: 'veto-reply', candidate: st, stripped: st });
  return {
    rejected: r.rejected.map((x) => ({ title: x.title, hits: x.rows.map((w) => `${w.field}:${w.kind}:${w.ref}`) })),
    emptied: r.emptied,
    stripped: s.stripped,
  };
}

/**
 * Згенерований рецепт (прямий запит): усі інгредієнти проти індексу. Рядки
 * з allergy=true рецепт не знімають — на прямий запит модель попереджає сама
 * (recipe-generator.md); рядки без прапорця повертаються як список того, без
 * чого треба перегенерувати. Кожен збіг — у лог.
 */
export function recipeVetoHits(recipe: Recipe, index: VetoRow[], log: (e: VetoLogEntry) => void, userText?: string): { avoid: string[] } {
  const hits = vetoRecipe(recipe, index, userText);
  for (const h of hits) log({ event: 'veto-recipe', candidate: recipe.t, ingredient: h.ingredient, row: h.row });
  const avoid = [...new Set(hits.filter((h) => !h.row.allergy).map((h) => h.ingredient))];
  return { avoid };
}
