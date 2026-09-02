// Правка №6: пост-готування — це розмова, не екран. Фінішний екран Cook Mode
// і модалка «Що списуємо повністю?» видалені СВІДОМО (рішення Пилипа,
// 2026-08-30): канони Бриф-2 п.4 (модалка підтвердження зникнення) і п.7
// (ретро-оцінка на фініш-екрані) скасовано. Замість них — детерміновані ходи
// в сесії запуску: «Списати продукти?» → «так» дає готову intake_diff-картку
// (та сама механіка підтвердження, що й у всіх дій моделі) → apply/«Ні» →
// «Як вийшло?» → відповідь іде звичайним чатом як фідбек-діагносту, а сервер
// сам пише текст у verdict останнього готування. Жоден із цих ходів не
// викликає модель — 0 токенів.

import type { Repo, IntakeOp, CookRunWithRecipe } from '@kitchen/domain';
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
export async function buildWriteoffOps(
  repo: Repo,
  household_id: string,
  recipe: Recipe,
): Promise<IntakeOp[]> {
  const ops: IntakeOp[] = [];
  for (const ing of recipe.ing ?? []) {
    if (!ing.p) continue;
    const batch = await repo.getBatch(ing.p);
    if (!batch || batch.household_id !== household_id) continue;
    if (batch.state === 'depleted') continue;
    const used = normalizeForBatch(ing.v ?? null, ing.u ?? null, batch.unit);
    if (used == null) {
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
