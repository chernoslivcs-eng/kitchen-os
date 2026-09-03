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

import type { Card, MessageRow, HouseholdEventRow } from './types.js';
import type { RecentCookRunSummary } from './context.js';

export type ModeKind = 'cart_open' | 'recipe_fresh' | 'unrated_run' | 'event_near';

export interface KitchenMode {
  kind: ModeKind;
  /** Людський опис для блока — те, що читає модель. */
  label: string;
  /** Коли це сталось. Дає моделі зважити свіжість без наших припущень. */
  at: string;
  /** id повідомлення (кошик) або назва (рецепт, готування). */
  ref?: string;
  /** Сесія щойно почалась — ця відповідь буде першою в ній. */
  sessionOpening?: boolean;
}

const DAY = 86_400_000;
const NEAR_DAYS = 3;

function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Найближча подія дому в межах трьох днів. Разова рахується від своєї дати,
 * тижнева — від найближчого свого дня тижня.
 *
 * Закрите й згасле не рахується: «мама привезе цибулю» через місяць — шум,
 * і саме проти нього писався expires_at.
 */
function nearestEvent(
  events: HouseholdEventRow[],
  now: Date,
): { event: HouseholdEventRow; at: number; label: string } | null {
  const today = dayStart(now.getTime());
  let best: { event: HouseholdEventRow; at: number; label: string } | null = null;

  for (const e of events) {
    if (e.done_at) continue;
    if (e.expires_at && new Date(e.expires_at).getTime() < now.getTime()) continue;

    let at: number | null = null;
    if (e.rule.t === 'once') {
      const [y = 1970, m = 1, d = 1] = e.rule.at.split('-').map(Number);
      at = new Date(y, m - 1, d).getTime();
    } else if (e.rule.t === 'weekly') {
      const cur = new Date(today);
      for (let i = 0; i <= NEAR_DAYS; i++) {
        if (cur.getDay() === e.rule.dow) { at = dayStart(cur.getTime()); break; }
        cur.setDate(cur.getDate() + 1);
      }
    }
    if (at === null) continue;

    const days = Math.round((at - today) / DAY);
    if (days < 0 || days > NEAR_DAYS) continue;
    const label = days === 0 ? 'СЬОГОДНІ' : days === 1 ? 'ЗАВТРА' : `ЗА ${days} ДНІ`;
    if (!best || at < best.at) best = { event: e, at, label };
  }
  return best;
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
  // Плани дому: подія за три дні чи ближче стає ситуацією, а не довідкою.
  events: HouseholdEventRow[] = [],
): KitchenMode[] {
  const out: KitchenMode[] = [];

  // Нагадування нульової вартості: ні cron, ні пуша, ні листа — подія просто
  // звучить у першій репліці, коли вона близько. Три дні — межа, за якою
  // «попереду» перестає бути абстракцією: за тиждень робити ще нічого, а
  // сьогодні вже пізно щось докупити.
  const near = nearestEvent(events, now);
  if (near) {
    out.push({
      kind: 'event_near',
      at: new Date(near.at).toISOString(),
      ref: near.event.id,
      sessionOpening: messages.length === 0,
      label: `${near.label}: ${near.event.title}`
        + (near.event.note ? ` — ${near.event.note}` : ''),
    });
  }

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
      // Порожня історія = ця відповідь буде першою в сесії. Дизайн панелі
      // забирає зріз, де жив блок «ОЦІНИ ВЧОРАШНЄ», а асистент першим НЕ
      // пише (механізму немає) — тож єдине місце, де це може прозвучати,
      // саме перша відповідь.
      sessionOpening: messages.length === 0,
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
  event_near:
    'Згадуй лише коли доречно — коли розмова сама зайшла про те, що готувати.'
    + ' Не нагадуй двічі за розмову й не починай нею репліку.',
};

// Те саме, але коли відповідь буде першою в сесії. Різниця не косметична:
// далі в розмові питання про вчорашнє — доречність, а на відкритті — єдина
// нагода, бо потім розмова піде своїм руслом і вже не повернеться.
const OPENING_RULE: Partial<Record<ModeKind, string>> = {
  // Найдешевше нагадування, яке в продукті взагалі можливе: жодного cron,
  // жодного пуша — подія просто звучить у першій репліці, коли вона близько.
  // Далі в розмові вона вже не потрібна: людина її почула.
  event_near:
    'ПОЧАТОК СЕСІЇ — тут це доречно назвати одним реченням усередині'
    + ' відповіді. Не окремим абзацом, не списком і не замість відповіді на'
    + ' те, про що спитали. Далі в розмові не повторюй.',
  unrated_run:
    'ПОЧАТОК СЕСІЇ — саме тут про це варто спитати одним реченням, перш ніж'
    + ' переходити до того, про що спитали. Далі в розмові вже не нагадуй.',
};

export function serializeModes(modes: KitchenMode[]): string {
  if (!modes.length) {
    return '\n\n[РЕЖИМ] нічого не відкрито — ні кошика, ні свіжого рецепта.';
  }
  return '\n\n[РЕЖИМ] (над чим ви працюєте ЗАРАЗ, найсвіжіше першим. Це не стан кухні —'
    + ' стан у своїх блоках; це ситуація, у якій звучить наступна репліка)\n'
    + modes.map((m) => `— ${m.label} ${(m.sessionOpening && OPENING_RULE[m.kind]) || RULE[m.kind]}`).join('\n');
}
