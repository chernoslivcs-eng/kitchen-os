// Раунд 4, крок 4 (AUDIT-ROUND-4.md §5): вето по індексу. Кандидат
// відхиляється, якщо будь-який його інгредієнт належить до категорії з
// індексу (через ієрархію каталогу) або збігається з продуктом з індексу.
// free-рядки вето не читає. Живе в домені, бо цим користуються прод (chat,
// recipes) і eval — той самий закон, що context.ts і model-response.ts.
//
// Тон (§5): рядки з allergy=true — поточна поведінка allergen-veto (зачистка
// згадки з репліки на непрямий запит, пряме попередження лишає модель);
// рядки без прапорця — просто не пропонувати, без попереджень і згадок.

import { normalize, resolveLabel } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import type { VetoRow } from './profile-text.js';
import type { Card, Recipe } from './types.js';
import { categoryOfWord, withAncestors, stemUk } from './veto-index.js';

const words = (text: string) => normalize(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/** Категорії (з предками) і ключ продукту, які «несе» текст: назва інгредієнта чи фраза. */
function footprint(text: string): { categories: Set<string>; keys: Set<string> } {
  const categories = new Set<string>();
  const keys = new Set<string>();
  const ws = words(text);
  // Коротка мітка («рибний соус», «курячі стегна») — резолвимо як позицію
  // каталогу: категорії позиції несуть ієрархію, і «рибний соус» → риба.
  if (ws.length && ws.length <= 4) {
    const hit = resolveLabel(text, 'generic');
    const item = hit ? BY_KEY.get(hit.key) : undefined;
    // Список категорій позиції вже несе її власну ієрархію — предків не
    // розширюємо (див. перетин у veto-index.ts).
    if (item) {
      keys.add(item.key);
      for (const c of item.categories) categories.add(normalize(c));
    }
  }
  // Пословно: «яловичина на грилі» → яловичина → мʼясо → тваринне.
  for (const w of ws) {
    const c = categoryOfWord(w);
    if (c) for (const a of withAncestors(c)) categories.add(a);
  }
  return { categories, keys };
}

/** Рядки індексу, які спрацьовують на цьому тексті. free — ніколи. */
export function matchVeto(text: string, index: VetoRow[]): VetoRow[] {
  const live = index.filter((r) => r.kind !== 'free' && r.ref);
  if (!live.length || !text.trim()) return [];
  const fp = footprint(text);
  return live.filter((r) => (r.kind === 'category' ? fp.categories.has(normalize(r.ref!)) : fp.keys.has(r.ref!)));
}

export interface VetoRejection { title: string; ingredient: string; rows: VetoRow[] }
export interface VetoCardResult { rejected: VetoRejection[]; emptied: boolean }

export const VETO_EMPTY_REPLY = 'Те, що придумав, тобі не підходить — там є те, чого ти не їси. Скажи, від чого відштовхуватись, і знайду інше.';
export const ALLERGY_EMPTY_REPLY = 'Зняв пропозицію: у ній був продукт, який тобі не можна. Скажи, від чого відштовхуватись — запропоную без нього.';

/**
 * Крок 4в (1): прямий запит. Рядок «Я не їм» (allergy=false), який людина сама
 * назвала в репліці («зроби мені стейк»), на цей хід не діє — страву дають,
 * модель попереджає одним реченням. Ознака та сама, що в алергійному шляху
 * (matchVeto по тексту людини). Allergy-рядки поводяться як і були.
 */
export function activeVetoRows(index: VetoRow[], userText?: string): VetoRow[] {
  if (!userText) return index;
  const named = new Set(matchVeto(userText, index.filter((r) => !r.allergy)).map((r) => `${r.kind}:${r.ref}`));
  return index.filter((r) => r.allergy || !named.has(`${r.kind}:${r.ref}`));
}

// Кандидат, якого людина назвала сама: стем слова з її репліки збігається зі
// стемом слова в назві/інгредієнті («стейк» у «Стейк рібай»). Дієтні рядки
// (allergy=false) на такий кандидат не діють; allergy — діють як і були.
const STEM_STOP = new Set(['зроби', 'зробити', 'мені', 'дай', 'давай', 'хочу', 'рецепт', 'приготуй', 'приготувати', 'щось', 'будь', 'ласка', 'сьогодні', 'вечерю', 'вечеря', 'обід', 'сніданок']);
function userStems(userText: string): Set<string> {
  return new Set(words(userText).filter((w) => !STEM_STOP.has(w)).map(stemUk).filter((w) => w.length >= 4));
}
export function candidateNamedByUser(candidate: string, userText?: string): boolean {
  if (!userText) return false;
  const us = userStems(userText);
  if (!us.size) return false;
  return words(candidate).map(stemUk).some((w) => w.length >= 4 && us.has(w));
}
const dietRowsOnly = (rows: VetoRow[], named: boolean) => (named ? rows.filter((r) => r.allergy) : rows);

/** Мутує картку proposal: прибирає страви, що зачепили індекс. Reply не чіпає, поки лишилась хоч одна. */
export function vetoCard(call: { card: Card | null; reply?: string | null }, fullIndex: VetoRow[], userText?: string): VetoCardResult {
  const none: VetoCardResult = { rejected: [], emptied: false };
  if (call.card?.type !== 'proposal' || !Array.isArray(call.card.items)) return none;
  const index = activeVetoRows(fullIndex, userText);
  if (!index.some((r) => r.kind !== 'free')) return none;

  const rejected: VetoRejection[] = [];
  const keep = call.card.items.filter((it) => {
    const named = candidateNamedByUser(it.title, userText);
    const parts = [it.title, it.desc, it.why, ...(it.rescues ?? []), ...(it.needs ?? [])].filter((p): p is string => !!p);
    for (const p of parts) {
      const rows = dietRowsOnly(matchVeto(p, index), named || candidateNamedByUser(p, userText));
      if (rows.length) { rejected.push({ title: it.title, ingredient: p, rows }); return false; }
    }
    return true;
  });
  if (!rejected.length) return none;
  if (keep.length) { call.card.items = keep; return { rejected, emptied: false }; }
  call.card = null;
  call.reply = rejected.some((r) => r.rows.some((x) => x.allergy)) ? ALLERGY_EMPTY_REPLY : VETO_EMPTY_REPLY;
  return { rejected, emptied: true };
}

export interface RecipeVetoHit { ingredient: string; row: VetoRow }

/** Згенерований рецепт: перевірка по ВСІХ інгредієнтах, не по назві страви. */
export function vetoRecipe(recipe: Recipe, fullIndex: VetoRow[], userText?: string): RecipeVetoHit[] {
  const index = activeVetoRows(fullIndex, userText);
  const out: RecipeVetoHit[] = [];
  for (const ing of recipe.ing ?? []) {
    const name = (ing as { n?: string }).n;
    if (!name) continue;
    const named = candidateNamedByUser(name, userText);
    for (const row of dietRowsOnly(matchVeto(name, index), named)) out.push({ ingredient: name, row });
  }
  return out;
}

// ----- Тон: зачистка згадок (лише allergy-рядки) ---------------------------

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

export const VETO_REPLY_FALLBACK = 'Тримай варіанти.';

/** Мутує call.reply: вирізає речення з алергеном (allergy-рядок індексу), якого людина сама не називала. */
export function stripVetoMentions(
  call: { card: Card | null; reply?: string | null },
  index: VetoRow[],
  userText: string,
): { stripped: string[] } {
  const allergy = index.filter((r) => r.allergy && r.kind !== 'free');
  const reply = call.reply;
  if (!reply || !allergy.length) return { stripped: [] };
  const named = new Set(matchVeto(userText, allergy).map((r) => `${r.kind}:${r.ref}`));
  const stripped: string[] = [];
  const kept = splitSentences(reply).filter((s) => {
    const hits = matchVeto(s, allergy).filter((r) => !named.has(`${r.kind}:${r.ref}`));
    if (hits.length) { stripped.push(s.trim()); return false; }
    return true;
  });
  if (!stripped.length) return { stripped };
  let next = kept.join(' ').trim();
  if (!next && call.card) next = VETO_REPLY_FALLBACK;
  call.reply = next;
  return { stripped };
}
