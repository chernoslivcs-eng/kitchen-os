// Що зараз відкрито — «в якій ситуації ми є».
//
// M13-ROLE-VOICE п.3: посеред збірки кошика людина каже «хочу колу додати»,
// і система веде це через список покупок замість розширити відкритий кошик.
// Модель має стенограму розмови, але не має відчуття ситуації — і мусить
// щоразу виводити його з двадцяти рядків історії.
//
// Сервер це знає точно. Патерн уже працює двічі: `stage` в онбордингу і
// детермінований автомат пост-готування (chat.ts). Це третє застосування.
//
// Режими НАКЛАДАЮТЬСЯ (рішення власника: «завжди») і йдуть за свіжістю —
// найновіше першим. Це відповідає тому, що людина сама тримає в голові.

import type { Card, MessageRow } from './types.js';
import type { RecentCookRunSummary } from './context.js';

export type ModeKind = 'cart_open' | 'recipe_fresh' | 'unrated_run';

export interface KitchenMode {
  kind: ModeKind;
  /** Людський опис для блока — те, що читає модель. */
  label: string;
  /** Коли це сталось. Дає моделі зважити свіжість без наших припущень. */
  at: string;
  /** id повідомлення (кошик) або назва (рецепт, готування). */
  ref?: string;
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Те саме правило, що живило блок «ОЦІНИ ВЧОРАШНЄ» в панелі (Feed.tsx):
// не скасоване, без оцінки, молодше 48 годин.
const UNRATED_WINDOW_MS = 48 * 3600_000;

export function detectModes(
  messages: MessageRow[],
  recentCookRuns: RecentCookRunSummary[],
  now = new Date(),
): KitchenMode[] {
  const out: KitchenMode[] = [];

  // Останній кошик сесії. Попередні — уже не «відкриті»: кошик у Сільпо
  // один, і актуальний завжди останній.
  const lastOf = (type: Card['type']) =>
    [...messages].reverse().find((m) => (m.card as Card | null)?.type === type);

  const cartMsg = lastOf('cart');
  if (cartMsg) {
    const c = cartMsg.card as Extract<Card, { type: 'cart' }>;
    out.push({
      kind: 'cart_open',
      at: cartMsg.created_at,
      ref: cartMsg.id,
      label: `Кошик у Сільпо зібраний о ${hhmm(cartMsg.created_at)}, позицій: ${c.found}.`,
    });
  }

  const recipeMsg = lastOf('recipe_link');
  if (recipeMsg) {
    const r = recipeMsg.card as Extract<Card, { type: 'recipe_link' }>;
    out.push({
      kind: 'recipe_fresh',
      at: recipeMsg.created_at,
      ref: r.title,
      label: `Рецепт «${r.title}» лежить у стрічці, покладений о ${hhmm(recipeMsg.created_at)}.`,
    });
  }

  const fresh = recentCookRuns.find((r) =>
    r.rating == null && now.getTime() - new Date(r.finished_at).getTime() < UNRATED_WINDOW_MS);
  if (fresh) {
    out.push({
      kind: 'unrated_run',
      at: fresh.finished_at,
      ref: fresh.title,
      label: `«${fresh.title}» приготовано о ${hhmm(fresh.finished_at)}, і людина ще не сказала, як вийшло.`,
    });
  }

  // Найсвіжіше першим.
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// Правила поводження — при кожному режимі, а не окремим списком десь вище.
// Той самий урок, що ⚠АЛЕРГЕН у рядку партії: правило далеко від даних не
// працює (QA5-01, QA7-06, flap calendar-lent).
const RULE: Record<ModeKind, string> = {
  cart_open:
    'Поки він відкритий, «додай X», «і ще Y» РОЗШИРЮЮТЬ саме цей кошик —'
    + ' не починають збірку заново і не йдуть у список покупок.',
  recipe_fresh:
    'Правки («поміняй X на Y», «на чотирьох») стосуються ЙОГО, а не комори.',
  unrated_run:
    'Доречно спитати одним реченням, як вийшло — але тільки якщо розмова'
    + ' сама не пішла в інше. Не починай з цього кожну репліку.',
};

export function serializeModes(modes: KitchenMode[]): string {
  if (!modes.length) {
    return '\n\n[РЕЖИМ] нічого не відкрито — ні кошика, ні свіжого рецепта.';
  }
  return '\n\n[РЕЖИМ] (над чим ви працюєте ЗАРАЗ, найсвіжіше першим. Це не стан кухні —'
    + ' стан у своїх блоках; це ситуація, у якій звучить наступна репліка)\n'
    + modes.map((m) => `— ${m.label} ${RULE[m.kind]}`).join('\n');
}
