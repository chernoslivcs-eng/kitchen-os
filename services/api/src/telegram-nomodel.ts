// Р152 (TELEGRAM-PLAN-0913, PR 5 «Подивитись без моделі»): чотири команди, що
// читають Repo напряму — без жодного виклику моделі, без нових HTTP-ендпоінтів.
// Логіка тут чиста (як у telegram.ts) — тести й стенд ганяють її напряму.
//
//   /pantry (/комора, «Комора»)   → «Комора · N» по зонах, «Горить» зверху
//   /list   (/список, «Список»)  → «Список · N» рядками з тоглами
//   /recipes(/рецепти, «Рецепти»)→ останні 5 збережених, рядок → повний рецепт
//   /home   (/дім, «Дім зараз»)  → те саме, що чіп/панель «Дім зараз» у шапці
//
// Кожна команда й кожна відповідь на неї несе постійну reply-клавіатуру
// (QUICK_KEYBOARD) — 2×2, щоб не памʼятати команди; той самий набір іде з
// відповіді на привʼязку (/start <token>).
import {
  effectiveExpiry, daysLeft,
  subscribedRows, nowItems, resolveRecipeLabels,
  type Repo, type PantryBatch, type Zone, type NowItem, type Recipe,
} from '@kitchen/domain';
import { hasScale, isSoon, freshness } from '@kitchen/domain/shelf-thresholds';
import { escapeHtml, splitTelegramText, splitByBlocks, renderRecipeBlocks, formatQty, TELEGRAM_MSG_MAX } from './telegram.js';

// ── розпізнавання команди: латиниця з меню, українська команда, слово з клавіатури ──
export type QuickCommand = 'pantry' | 'list' | 'recipes' | 'home';

// Хотфікс (голова 14.09): /дом — русизм, прибрано; лише українська форма й латиниця з меню.
const ALIASES: Record<QuickCommand, string[]> = {
  pantry: ['/pantry', '/комора', 'комора'],
  list: ['/list', '/список', 'список'],
  recipes: ['/recipes', '/рецепти', 'рецепти'],
  home: ['/home', '/дім', 'дім зараз', 'дім'],
};

/** Текст ходу → одна з чотирьох команд, або null (звичайний хід / інша команда). */
export function matchQuickCommand(rawText: string): QuickCommand | null {
  const text = rawText.trim().toLowerCase().replace(/^\//, (m) => m).replace(/@\w+$/, '');
  const bare = text.replace(/^\//, '');
  for (const [cmd, aliases] of Object.entries(ALIASES) as [QuickCommand, string[]][]) {
    for (const a of aliases) {
      const isSlash = a.startsWith('/');
      if (isSlash ? text === a : bare === a) return cmd;
    }
  }
  return null;
}

// ── reply-клавіатура: постійна, 2×2 ──
export const QUICK_KEYBOARD: string[][] = [['Комора', 'Список'], ['Рецепти', 'Дім зараз']];

// Кнопка inline-клавіатури: або callback (`data`), або посилання (`url`) — ніколи обидва.
// Хотфікс (голова 14.09): «Відкрити у вебі» була мертвою кнопкою з data:'noop' — тепер
// справжнє посилання (grammY InlineKeyboard.url), обробки 'noop' у callback більше нема.
export interface QuickKeyboardBtn { text: string; data?: string; url?: string }
const openWebBtn = (url: string): QuickKeyboardBtn => ({ text: 'Відкрити у вебі', url });

// ── /pantry ──────────────────────────────────────────────────────────────
const ZONE_ORDER: Zone[] = ['fresh', 'fridge', 'freezer', 'dry', 'spices', 'drinks'];
const ZONE_LABEL: Record<Zone, string> = { fresh: 'Свіже', fridge: 'Холодильник', freezer: 'Морозилка', dry: 'Суха шафа', spices: 'Спеції', drinks: 'Напої' };

interface PantryRow { label: string; qty: string; days: number | null; tone: 'danger' | 'amber' | null }

function pantryRows(batches: PantryBatch[], nowMs: number): { rows: PantryRow[]; burning: PantryRow[] } {
  const live = batches.filter((b) => b.state !== 'depleted');
  const withDays = live.map((b) => {
    const days = daysLeft(effectiveExpiry(b, b.catalog_key, nowMs), nowMs);
    const soon = hasScale(b.catalog_key) && days != null && isSoon(days);
    const tone: PantryRow['tone'] = soon ? (freshness(days) === 'overdue' ? 'danger' : 'amber') : null;
    return { b, days, tone, row: { label: b.label, qty: formatQty(b.value, b.unit), days, tone } as PantryRow };
  });
  // «Горить» — burningOf (store/homeNow.ts), БЕЗ кепу 3 (постановка 14.09).
  const burning = withDays.filter((x) => x.tone !== null).sort((a, b) => (a.days ?? 0) - (b.days ?? 0)).map((x) => x.row);
  const rows = withDays.map((x) => x.row);
  return { rows, burning };
}

/** «N дн» (постановка: через пробіл, без «!»); прострочене (days < 0) — слово, не число. */
function daysTail(r: PantryRow): string {
  if (r.days == null || !r.tone) return '';
  return r.days < 0 ? ' · прострочено' : ` · ${r.days} дн`;
}

export type WebLink = (next: string) => string;

export function pantryKeyboard(web: WebLink): QuickKeyboardBtn[][] {
  return [[{ text: 'Спливає', data: 'pantry:soon' }, { text: 'Усе', data: 'pantry:all' }], [openWebBtn(web('/pantry'))]];
}

/** «Комора · N» — Горить зверху (якщо є), потім зони за ZONE_ORDER, кожен рядок «назва · кількість · N дн». */
export function renderPantryText(batches: PantryBatch[], nowMs = Date.now(), only: 'soon' | 'all' = 'all'): string {
  const { rows, burning } = pantryRows(batches, nowMs);
  const live = batches.filter((b) => b.state !== 'depleted');
  if (!live.length) return 'Комора порожня. Кинь чек — розберу.';
  const line = (r: PantryRow) => `• ${escapeHtml(r.label)}${r.qty ? ` · ${escapeHtml(r.qty)}` : ''}${daysTail(r)}`;
  if (only === 'soon') {
    if (!burning.length) return 'Нічого не спливає.';
    return [`<b>Горить · ${burning.length}</b>`, ...burning.map(line)].join('\n');
  }
  const out = [`<b>Комора · ${live.length}</b>`];
  if (burning.length) out.push('', `<b>Горить · ${burning.length}</b>`, ...burning.map(line));
  for (const zone of ZONE_ORDER) {
    const zoneRows = rows.filter((_, i) => live[i]?.zone === zone);
    if (!zoneRows.length) continue;
    out.push('', `<b>${ZONE_LABEL[zone]} · ${zoneRows.length}</b>`, ...zoneRows.map(line));
  }
  return out.join('\n');
}

export interface QuickReply { messages: string[]; html: boolean; keyboard?: QuickKeyboardBtn[][]; replyKeyboard?: string[][] }

export async function renderPantry(repo: Repo, household_id: string, web: WebLink, only: 'soon' | 'all' = 'all'): Promise<QuickReply> {
  const batches = await repo.listBatches(household_id);
  const text = renderPantryText(batches, Date.now(), only);
  const hasAny = batches.some((b) => b.state !== 'depleted');
  // «Відкрити у вебі» тепер сама url-кнопка (не мертва data:'noop') — окремий текстовий
  // рядок під нею більше не дублюється (був до цієї правки).
  return { messages: splitTelegramText(text), html: true, ...(hasAny ? { keyboard: pantryKeyboard(web) } : {}) };
}

// ── /list ────────────────────────────────────────────────────────────────
export interface ShoppingLike { id: string; label: string; value: number | null; unit: string | null; checked: boolean }

export function renderShoppingText(items: ShoppingLike[]): string {
  if (!items.length) return 'Список порожній.';
  const line = (i: ShoppingLike) => `${i.checked ? '☑' : '☐'} ${escapeHtml(i.label)}${i.value != null ? ` · ${escapeHtml(formatQty(i.value, i.unit))}` : ''}`;
  return [`<b>Список · ${items.length}</b>`, ...items.map(line)].join('\n');
}

const LIST_KEYBOARD_MAX = 8;
export function listKeyboard(items: ShoppingLike[], web: WebLink): QuickKeyboardBtn[][] {
  const rows: QuickKeyboardBtn[][] = items.slice(0, LIST_KEYBOARD_MAX).map((i) => [{ text: `${i.checked ? '☑' : '☐'} ${i.label}`.slice(0, 64), data: `list-toggle:${i.id}` }]);
  rows.push([openWebBtn(web('/list'))]);
  return rows;
}

export async function renderShopping(repo: Repo, household_id: string, web: WebLink): Promise<QuickReply> {
  const items = await repo.listShoppingItems(household_id);
  const text = renderShoppingText(items);
  // Порожній список — без inline-клавіатури, «Відкрити у вебі» лишається текстом (нема кнопки, яку б чіплять).
  if (!items.length) return { messages: [text, escapeHtml(`Відкрити у вебі: ${web('/list')}`)], html: true };
  return { messages: splitTelegramText(text), html: true, keyboard: listKeyboard(items, web) };
}

// ── /recipes ─────────────────────────────────────────────────────────────
export interface SavedRecipeLike { id: string; title: string; time_total: number | null; base_servings: number }

export function renderRecipesText(recipes: SavedRecipeLike[]): string {
  if (!recipes.length) return 'Збережених рецептів ще нема.';
  const line = (r: SavedRecipeLike) => `• ${escapeHtml(r.title)}${r.time_total ? ` · ${r.time_total} хв` : ''} · ${r.base_servings} порц.`;
  return [`<b>Рецепти · ${recipes.length}</b>`, ...recipes.map(line)].join('\n');
}

export function recipesKeyboard(recipes: SavedRecipeLike[], web: WebLink): QuickKeyboardBtn[][] {
  return [...recipes.map((r) => [{ text: r.title.slice(0, 64), data: `recipe:${r.id}` }]), [openWebBtn(web('/recipes'))]];
}

export async function renderRecipes(repo: Repo, user_id: string, web: WebLink): Promise<QuickReply> {
  const recipes = await repo.listRecipes(user_id, 5);
  const text = renderRecipesText(recipes);
  if (!recipes.length) return { messages: [text], html: true };
  return { messages: [text], html: true, keyboard: recipesKeyboard(recipes, web) };
}

/** Рядок «Рецепти» → повний рецепт текстом (той самий renderRecipeBlocks, що після «1»). */
export async function renderSavedRecipe(repo: Repo, household_id: string, recipe_id: string, web: WebLink): Promise<QuickReply | null> {
  const row = await repo.getRecipe(recipe_id);
  if (!row) return null;
  const recipe = resolveRecipeLabels(row.payload as Recipe, await repo.listBatches(household_id));
  const { head, steps } = renderRecipeBlocks(recipe);
  const open = escapeHtml(`Відкрити у вебі: ${web('/recipes')}`);
  const whole = `${head}\n\n${steps}\n\n${open}`;
  if (whole.length <= TELEGRAM_MSG_MAX) return { messages: [whole], html: true };
  return { messages: [...splitTelegramText(head), ...splitByBlocks(`${steps}\n\n${open}`, /\n(?=\d+\. )/)], html: true };
}

// ── /home ────────────────────────────────────────────────────────────────
function shortDate(iso: string): string {
  const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export interface HomeFacts { overdue: number; burning: PantryRow[]; strict: NowItem | null; shoppingCount: number }

export async function collectHomeFacts(repo: Repo, household_id: string, user_id: string): Promise<HomeFacts> {
  const batches = await repo.listBatches(household_id);
  const { burning } = pantryRows(batches, Date.now());
  const overdue = burning.filter((r) => r.tone === 'danger').length;
  const occasions = subscribedRows(await repo.listOccasionCatalog(), await repo.listOccasionSubscriptions(household_id));
  const events = await repo.listOwnEvents(household_id, user_id);
  const now = nowItems(occasions, events, new Date());
  const strict = now.find((e) => e.strict) ?? null;
  const shopping = await repo.listShoppingItems(household_id);
  return { overdue, burning, strict, shoppingCount: shopping.filter((i) => !i.checked).length };
}

export function renderHomeText(facts: HomeFacts): string {
  const lines: string[] = [];
  if (facts.overdue > 0) lines.push(`Прострочено ${facts.overdue}`);
  if (facts.burning.length) lines.push(`Горить: ${facts.burning.map((r) => escapeHtml(r.label)).join(', ')}`);
  if (facts.strict) lines.push(`${escapeHtml(facts.strict.title)} · до ${shortDate(facts.strict.to)}`);
  if (facts.shoppingCount > 0) lines.push(`Список · ${facts.shoppingCount}`);
  if (!lines.length) return 'Дім спокійний. Нічого не горить.';
  return [`<b>Дім зараз</b>`, ...lines].join('\n');
}

/** /home без inline-клавіатури — «Відкрити у вебі» лишається текстовим рядком (постановка 14.09). */
export async function renderHome(repo: Repo, household_id: string, user_id: string, web: WebLink): Promise<QuickReply> {
  const facts = await collectHomeFacts(repo, household_id, user_id);
  const text = renderHomeText(facts);
  return { messages: [`${text}\n\n${escapeHtml(`Відкрити у вебі: ${web('/app')}`)}`], html: true };
}
