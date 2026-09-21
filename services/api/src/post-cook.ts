// Правка №6: пост-готування — це розмова, не екран. Фінішний екран Cook Mode
// і модалка «Що списуємо повністю?» видалені СВІДОМО (рішення Пилипа,
// 2026-08-30): канони Бриф-2 п.4 (модалка підтвердження зникнення) і п.7
// (ретро-оцінка на фініш-екрані) скасовано. Замість них — детерміновані ходи
// в сесії запуску: «Списати продукти?» → «так» дає готову intake_diff-картку
// (та сама механіка підтвердження, що й у всіх дій моделі) → apply/«Ні» →
// «Як вийшло?» → відповідь іде звичайним чатом як фідбек-діагносту, а сервер
// сам пише текст у verdict останнього готування. Жоден із цих ходів не
// викликає модель — 0 токенів.

import type { Repo, IntakeOp, CookRunWithRecipe, MessageRow, SessionWriteoff, PantryBatch } from '@kitchen/domain';
import { BY_KEY } from '@kitchen/catalog/seed';
import type { Recipe } from './model.js';

// Точні тексти детермінованих реплік. Шорткат у chat-роуті впізнає їх
// РІВНІСТЮ (не підрядком) — модельна відповідь із таким самим хвостом
// маркером не стане.
export const WRITEOFF_PROMPT = 'Списати продукти?';
export const FEEDBACK_PROMPT = 'Як вийшло?';
// 02.09: текст описував стан, якого не існує. Він писався під сценарій
// «картка чекає рішення», а списання застосовується ОДРАЗУ (пул-8 №2,
// chat.ts) — і в стрічці стояло «✓ ЗАСТОСОВАНО» поруч із проханням
// «перевір і застосуй». Просити застосувати вже застосоване безглуздо.
//
// Історичні повідомлення несуть старий рядок і більше не збігатимуться з
// перевіркою в cards.ts (розпізнавання картки списання за текстом-носієм).
// Наслідок вузький: на ручне застосування СТАРОЇ картки не приїде «Як
// вийшло?». Нові картки не зачеплені, а старі вже застосовані.
export const WRITEOFF_CARD_REPLY = 'Списав із комори — ось що пішло.';
export const WRITEOFF_DECLINED_REPLY = `Гаразд, комору не чіпаю. ${FEEDBACK_PROMPT}`;
export const WRITEOFF_EMPTY_REPLY = `Це готування комори не торкалось — списувати нічого. ${FEEDBACK_PROMPT}`;

// Репліки, після яких наступна відповідь людини — це відповідь на «Як вийшло?».
export const FEEDBACK_MARKERS = new Set([FEEDBACK_PROMPT, WRITEOFF_DECLINED_REPLY, WRITEOFF_EMPTY_REPLY]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?…:;«»"']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// «так»-відповідь на «Списати продукти?». Правило: КОЖНЕ слово з короткого
// словника згоди — «спиши тільки спагеті» не проходить (це вже інструкція,
// нею займеться модель), «так собі» теж ні.
const YES_WORDS = new Set(['так', 'ага', 'угу', 'давай', 'ок', 'окей', 'добре', 'спиши', 'списуй', 'все', 'всі', 'можна', 'звісно', 'аякже']);
export function isYes(text: string): boolean {
  const ws = words(text);
  return ws.length > 0 && ws.length <= 4 && ws.every((w) => YES_WORDS.has(w));
}

// Відмова: перше слово — заперечення. «вийшло ніби непогано» не ловиться.
const NO_FIRST = new Set(['ні', 'не', 'нічого', 'потім', 'пізніше', 'облиш']);
export function isNo(text: string): boolean {
  const first = words(text)[0];
  return first != null && NO_FIRST.has(first);
}

// Живий прохід 19.09: на «Списати продукти?» власник відповів «Так. І що до
// цього з напоїв? Вино?» — isYes на всьому тексті не спрацював, повідомлення
// пішло моделі як чат, і списання ПРОПАЛО. Рішення: рішення читається з
// ПЕРШОГО СЕГМЕНТА (до першої крапки, «!», «?», переносу чи тире), а решта —
// звичайний хід моделі в тому самому повідомленні.
export type LeadingAnswer = { decision: 'yes' | 'no' | null; rest: string };
// Решта, що починається з уточнення («Так, але тільки пасту»), — не згода:
// людина звужує списання, і це має вирішувати модель, а не детермінатика.
const QUALIFIER_START = /^(але|тільки|лише|крім|окрім|без|а не)(?![а-яіїєґ'ʼ])/iu;

export function splitLeadingAnswer(text: string): LeadingAnswer {
  const m = /^([^.!?,\n—–]*)([.!?,\n—–]+)?([\s\S]*)$/.exec(text.trim());
  const head = (m?.[1] ?? text).trim();
  const rest = (m?.[3] ?? '').trim();
  const decision = isNo(head) ? 'no' : isYes(head) ? 'yes' : null;
  // Без розділювача сегмент = увесь текст, і решти нема — як було.
  if (!decision) return { decision: null, rest: '' };
  if (QUALIFIER_START.test(rest)) return { decision: null, rest: '' };
  return { decision, rest };
}

// Оцінка з вільної фрази: словоформи («на четвірку») і цифри тільки в явних
// формах — «4 з 5», «5/5» або сама цифра. Голе число посеред фрази («варив
// 3 години») оцінкою не вважаємо.
export function extractRating(text: string): number | null {
  const t = text.toLowerCase();
  if (/п[ʼ'’]?ятірк/.test(t)) return 5;
  if (/четвірк/.test(t)) return 4;
  if (/трійк/.test(t)) return 3;
  if (/двійк/.test(t)) return 2;
  if (/одиниц/.test(t)) return 1;
  const frac = /(?<!\d)([1-5])\s*(?:з|із|\/)\s*5(?!\d)/.exec(t);
  if (frac) return Number(frac[1]);
  const bare = /^\s*([1-5])\s*$/.exec(t);
  if (bare) return Number(bare[1]);
  return null;
}

// Приводимо (value, unit) рецепта до одиниць партії. Ті самі правила, що в
// domain/apply.ts normalizeUnit: l→ml, kg→g. Несумісні одиниці → null
// (на верхньому рівні це «кількість невідома» → open, не deplete).
export function normalizeForBatch(value: number | null, unit: string | null, batchUnit: string | null): number | null {
  if (value == null || unit == null || batchUnit == null) return null;
  const u = unit.toLowerCase();
  if (batchUnit === 'ml') {
    if (u === 'ml' || u === 'мл') return value;
    if (u === 'l' || u === 'л') return value * 1000;
    return null;
  }
  if (batchUnit === 'g') {
    if (u === 'g' || u === 'г') return value;
    if (u === 'kg' || u === 'кг') return value * 1000;
    return null;
  }
  if (batchUnit === 'pcs') {
    if (u === 'pcs' || u === 'шт' || u === 'штук' || u === 'штука') return value;
    return null;
  }
  if (batchUnit === 'pack') {
    if (u === 'pack' || u === 'пач' || u === 'пачка') return value;
    return null;
  }
  return null;
}

// Готова картка списання по рецепту. Та сама арифметика, що жила в
// авто-списанні cook-runs (QA4-03: невідома кількість → open, не deplete),
// але результат — ops для звичайної intake_diff-картки: людина бачить і
// підтверджує, модель у циклі не бере участі.
//
// Партії v2 (21.09, spec shelf-life-v2): ШТУЧНА партія (pcs/pack) при
// частковому списанні у грамах/мл ВІДДІЛЯЄ одиницю: N зап → (N−1) зап (стара
// партія, лишається sealed) + 1 відкрита з залишком = вага одиниці − вжите.
// Вага одиниці — household_product.pack_size, інакше unit_weight каталогу;
// невідома — відкрита з невідомим залишком. Спершу береться з уже відкритого
// залишку того самого продукту (той самий ланцюжок: 4×400 − 200 − 300 →
// 2 зап + 1 відкрита 300). «open» на всю штучну партію більше не робиться.
const WEIGHT: Record<string, 'g' | 'ml'> = { g: 'g', г: 'g', kg: 'g', кг: 'g', ml: 'ml', мл: 'ml', l: 'ml', л: 'ml' };
const toBase = (v: number, u: string) => (/^(kg|кг|l|л)$/i.test(u) ? v * 1000 : v);

export async function buildWriteoffOps(
  repo: Repo,
  household_id: string,
  recipe: Recipe,
): Promise<IntakeOp[]> {
  const ops: IntakeOp[] = [];
  const all = await repo.listBatches(household_id);
  for (const ing of recipe.ing ?? []) {
    if (!ing.p) continue;
    const batch = await repo.getBatch(ing.p);
    if (!batch || batch.household_id !== household_id) continue;
    if (batch.state === 'depleted') continue;
    const used = normalizeForBatch(ing.v ?? null, ing.u ?? null, batch.unit);
    if (used == null) {
      const base = ing.u ? WEIGHT[ing.u.toLowerCase()] : undefined;
      if ((batch.unit === 'pcs' || batch.unit === 'pack') && ing.v != null && base) {
        ops.push(...await splitUnit(repo, all, batch, toBase(ing.v, ing.u!), base));
        continue;
      }
      // Одиниці несумісні й рецепт без числа (або вагова партія без ваги) — як було: open.
      if (batch.state === 'sealed') ops.push({ op: 'open', label: batch.label, batch_id: batch.id });
      continue;
    }
    if (batch.value != null && batch.value > used) {
      ops.push({
        op: 'correct',
        label: batch.label,
        batch_id: batch.id,
        value: Math.round((batch.value - used) * 100) / 100,
        unit: batch.unit ?? undefined,
      });
    } else {
      ops.push({ op: 'deplete', label: batch.label, batch_id: batch.id });
    }
  }
  return ops;
}

/** Вага/обʼєм однієї одиниці штучної партії (г або мл), якщо відома. */
async function unitWeightOf(repo: Repo, batch: PantryBatch, base: 'g' | 'ml'): Promise<number | null> {
  const product = batch.product_id ? await repo.getProduct(batch.product_id) : null;
  // PR 4: pack_size з pack_unit — перше джерело; без pack_unit (старі рядки) — за одиницею продукту.
  if (product?.pack_size != null) {
    if (product.pack_unit) { if (product.pack_unit === base) return product.pack_size; }
    else if (product.unit === base || product.unit == null) return product.pack_size;
  }
  const key = batch.catalog_key ?? product?.catalog_key ?? null;
  const item = key ? BY_KEY.get(key) : undefined;
  if (base === 'g' && item?.unit_weight) return item.unit_weight;
  return null;
}

async function splitUnit(repo: Repo, all: PantryBatch[], batch: PantryBatch, used: number, base: 'g' | 'ml'): Promise<IntakeOp[]> {
  const ops: IntakeOp[] = [];
  let left = used;
  // 1. Спершу — з уже відкритих залишків того самого продукту в тій самій базовій одиниці.
  const opened = all.filter((b) => b.id !== batch.id && b.state === 'opened' && !b.depleted_at
    && b.unit === base && b.value != null && b.value > 0
    && (batch.product_id ? b.product_id === batch.product_id : b.label === batch.label))
    .sort((a, b) => (a.opened_at ?? a.added_at).localeCompare(b.opened_at ?? b.added_at));
  for (const o of opened) {
    if (left <= 0) break;
    if (o.value! > left) {
      ops.push({ op: 'correct', label: o.label, batch_id: o.id, value: Math.round((o.value! - left) * 100) / 100, unit: base });
      left = 0;
    } else {
      ops.push({ op: 'deplete', label: o.label, batch_id: o.id });
      left = Math.round((left - o.value!) * 100) / 100;
    }
  }
  if (left <= 0) return ops;
  // 2. Решта — з нової одиниці (чи кількох): (N−k) лишаються запечатані.
  const w = await unitWeightOf(repo, batch, base);
  const units = w ? Math.max(1, Math.ceil(left / w)) : 1;
  const count = batch.value ?? 1;
  if (count > units) ops.push({ op: 'correct', label: batch.label, batch_id: batch.id, value: count - units, unit: batch.unit ?? undefined });
  else ops.push({ op: 'deplete', label: batch.label, batch_id: batch.id });
  const product = batch.product_id ? await repo.getProduct(batch.product_id) : null;
  const remainder = w ? Math.round((w * units - left) * 100) / 100 : null;
  if (remainder === 0) return ops;   // одиницю вжито цілком — відкритого залишку нема
  ops.push({
    op: 'add', label: batch.label, zone: batch.zone, state: 'opened',
    ...(product ? { product: product.product, brand: product.brand ?? undefined, variant: product.variant ?? undefined } : {}),
    ...(remainder != null ? { value: remainder, unit: base } : {}),
    evidence: 'user_statement', confidence: 1,
  });
  return ops;
}

// Останнє готування цієї сесії — до нього чіпляються і картка списання,
// і verdict із «Як вийшло?».
export async function latestRunInSession(
  repo: Repo,
  user_id: string,
  session_id: string,
): Promise<CookRunWithRecipe | null> {
  const runs = await repo.listCookRuns(user_id, 10);
  return runs.find((r) => !r.undone_at && r.session_id === session_id) ?? null;
}

// ── D (20.09): [СПИСАНО В ЦІЙ СЕСІЇ] ──────────────────────────────────────
// Живий прохід 19.09: після «Як вийшло?» власник написав «замість вʼялених
// томатів взяв консервовані Helcom» і «взяв десь 40 лимонного соку» — модель
// зробила нотатки, але списані лишились вʼялені томати й 15 мл соку. Щоб
// поправка стала карткою, модель на кожному ході сесії бачить, що саме
// списано після готувань цього дня. Вікно — уся поточна сесія; скасовані
// undo списання не показуються; до двох останніх готувань.
export async function sessionWriteoffs(
  repo: Repo,
  user_id: string,
  session_id: string,
  messages: readonly MessageRow[],
): Promise<SessionWriteoff[]> {
  const cards = messages.filter((m) => m.role === 'assistant' && m.card?.type === 'intake_diff' && (m.text ?? '').startsWith(WRITEOFF_CARD_REPLY));
  if (!cards.length) return [];
  // Готування цієї сесії за порядком; n-та картка списання ↔ n-те готування
  // (списання йде одразу за «Списати продукти?» свого готування).
  const runs = (await repo.listCookRuns(user_id, 20))
    .filter((r) => !r.undone_at && r.session_id === session_id)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const out: SessionWriteoff[] = [];
  for (const [i, m] of cards.entries()) {
    const pc = await repo.getPending(m.id);
    if (!pc || !pc.applied_at || pc.undone_at) continue;           // не застосовано або скасовано — нема чого поправляти
    const run = runs[i] ?? runs[runs.length - 1];
    const recipe = run?.recipe?.payload as Recipe | undefined;
    const ops = (m.card as { ops: IntakeOp[] }).ops;
    const opByBatch = new Map(ops.map((o) => [('batch_id' in o ? o.batch_id : undefined) ?? '', o]));
    const lines = ops.map((o) => {
      const ing = recipe?.ing?.find((i) => i.p && 'batch_id' in o && i.p === o.batch_id);
      const amount = o.op === 'deplete' ? 'усе'
        : o.op === 'open' ? 'відкрито'
        : ing?.v != null ? `${ing.v} ${ing.u ?? ''}`.trim()
        : o.op === 'correct' && o.value != null ? `лишилось ${o.value} ${o.unit ?? ''}`.trim() : '';
      return { label: o.label, amount };
    });
    const notFound = (recipe?.ing ?? []).filter((i) => !i.p || !opByBatch.has(i.p)).map((i) => i.n).filter((n): n is string => !!n);
    out.push({ title: recipe?.t ?? run?.recipe?.title ?? 'Готування', at: m.created_at, lines, notFound });
  }
  return out.slice(-2);
}
