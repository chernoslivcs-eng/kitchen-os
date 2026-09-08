// Раунд 4, крок 4 (AUDIT-ROUND-4.md §5): вето по індексу. Кандидат
// відхиляється, якщо будь-який його інгредієнт належить до категорії з
// індексу (через ієрархію каталогу) або збігається з продуктом з індексу.
// free-рядки вето не читає. Живе в домені, бо цим користуються прод (chat,
// recipes) і eval — той самий закон, що context.ts і model-response.ts.
//
// П5-В6: вето діє на те, що асистент пропонує САМ. Страва чи продукт, які
// назвала людина, до нього не потрапляють узагалі (activeVetoRows,
// rowsUnlessNamed) — ні дієтні рядки, ні алергійні. Речення з репліки більше
// не вирізаються: «є лосось, але сам не пропоную» — чесне попередження, а не
// прихована пропозиція. Попереджає словами модель, сервер лише не пропонує.

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
  // Мітку («рибний соус», «курячі стегна») резолвимо як позицію каталогу:
  // категорії позиції несуть ієрархію, і «рибний соус» → риба.
  //
  // П5-В6 (2): межі «до чотирьох слів» більше немає. Вона стояла тут як
  // здогад про «коротку мітку», а платила за неї фраза людини: «Може стейк з
  // лосося?» проходила ледве, «а може зробимо стейк з лосося на вечерю» вже
  // ні — і виняток на прямий запит мовчки не спрацьовував саме на довгих
  // формулюваннях, тобто на живій мові. resolveLabel на довгій фразі просто
  // не знаходить нічого; ціна — один зайвий виклик, не хибне вето.
  if (ws.length) {
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

/**
 * Крок Ш3, мемо на запит. footprint() кличе resolveLabel, а той — найдорожча
 * річ у коморі: 113 партій дають два виклики кожна, і серед них десятки
 * повторів («молоко», «сир», однакові мітки різних партій).
 *
 * Кеш живе не в модулі, а в об'єкті, який передає той, хто робить прохід
 * (VetoScope). Модульний кеш тут був би витоком між домами й між запитами
 * лямбди: текст той самий, а індекс вето в кожного свій — і кешувати треба
 * саме footprint (він від індексу не залежить), а не результат matchVeto.
 */
export type VetoScope = Map<string, ReturnType<typeof footprint>>;
export const newVetoScope = (): VetoScope => new Map();

/** Рядки індексу, які спрацьовують на цьому тексті. free — ніколи. */
export function matchVeto(text: string, index: VetoRow[], scope?: VetoScope): VetoRow[] {
  const live = index.filter((r) => r.kind !== 'free' && r.ref);
  if (!live.length || !text.trim()) return [];
  const cacheKey = normalize(text);
  let fp = scope?.get(cacheKey);
  if (!fp) {
    fp = footprint(text);
    scope?.set(cacheKey, fp);
  }
  return live.filter((r) => (r.kind === 'category' ? fp!.categories.has(normalize(r.ref!)) : fp!.keys.has(r.ref!)));
}

export interface VetoRejection { title: string; ingredient: string; rows: VetoRow[] }
export interface VetoCardResult { rejected: VetoRejection[]; emptied: boolean }

/**
 * Прямий запит. Рядок індексу, який людина сама назвала в репліці («зроби
 * мені стейк», «може стейк з лосося?»), на цей хід не діє: страву дають,
 * попереджає модель одним реченням.
 *
 * П5-В6 (1): раніше виняток обходив алергію — allergy-рядки викидались із
 * входу до зіставлення (`index.filter((r) => !r.allergy)`), а потім лишались
 * активними безумовно. Каталог у них ніхто не питав. Живий випадок 07.09: у
 * вето категорія «риба» з allergy=true, людина сказала «Може стейк з
 * лосося?» — сервер зняв страву й людині довелось виправдовуватись («я не
 * для себе»). Обмеження діє на те, що асистент пропонує САМ; на прохання
 * людини воно не діє незалежно від того, алергія це чи дієта.
 */
export function activeVetoRows(index: VetoRow[], userText?: string): VetoRow[] {
  if (!userText) return index;
  const named = new Set(matchVeto(userText, index).map((r) => `${r.kind}:${r.ref}`));
  return index.filter((r) => !named.has(`${r.kind}:${r.ref}`));
}

// Кандидат, якого людина назвала сама: стем слова з її репліки збігається зі
// стемом слова в назві/інгредієнті («стейк» у «Стейк рібай»). На такий
// кандидат не діє ЖОДЕН рядок індексу — ні дієтний, ні алергійний (П5-В6).
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
// Сіра зона, названа свідомо. Межа «інгредієнт від асистента» проти «страва,
// яку назвала людина» не завжди різка: анчоуси в путанесці — не ініціатива
// асистента, а сама страва. Правило: інгредієнт, без якого названа страва не
// є собою, вважається названим людиною (тому named кандидата поширюється на
// всі його частини у vetoCard). Точність тут неповна, і це прийнятно —
// помилка в цей бік дає людині те, що вона просила.
const rowsUnlessNamed = (rows: VetoRow[], named: boolean) => (named ? [] : rows);

/** Мутує картку proposal: прибирає страви, що зачепили індекс. Reply не чіпає, поки лишилась хоч одна. */
export function vetoCard(call: { card: Card | null; reply?: string | null }, fullIndex: VetoRow[], userText?: string): VetoCardResult {
  const none: VetoCardResult = { rejected: [], emptied: false };
  if (call.card?.type !== 'proposal' || !Array.isArray(call.card.items)) return none;
  const index = activeVetoRows(fullIndex, userText);
  if (!index.some((r) => r.kind !== 'free')) return none;

  const rejected: VetoRejection[] = [];
  const keep = call.card.items.filter((it) => {
    const named = candidateNamedByUser(it.title, userText);
    // П1а: лише список інгредієнтів (rescues + needs). title/desc/why — мова
    // страви, і «пісний плов без мʼяса» під суворим постом різався саме за
    // слово «мʼяса» в описі: згадка відсутнього — не інгредієнт.
    const parts = [...(it.rescues ?? []), ...(it.needs ?? [])].filter((p): p is string => !!p);
    for (const p of parts) {
      const rows = rowsUnlessNamed(matchVeto(p, index), named || candidateNamedByUser(p, userText));
      if (rows.length) { rejected.push({ title: it.title, ingredient: p, rows }); return false; }
    }
    return true;
  });
  if (!rejected.length) return none;
  if (keep.length) { call.card.items = keep; return { rejected, emptied: false }; }
  // П5-В6: фільтр виїв картку до нуля. Репліку НЕ чіпаємо — раніше тут стояв
  // VETO_EMPTY_REPLY / ALLERGY_EMPTY_REPLY, і саме він 07.09 сказав людині
  // «Зняв пропозицію: у ній був продукт, який тобі не можна» на її ж прохання.
  // Порожню картку не показуємо, репліку лишаємо як є: краще текст без картки,
  // ніж службова відмова замість відповіді.
  call.card = null;
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
    for (const row of rowsUnlessNamed(matchVeto(name, index), named)) out.push({ ingredient: name, row });
  }
  return out;
}
