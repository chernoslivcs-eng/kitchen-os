// Крок О1а: черга подій поведінки.
//
// Події — не кліки підряд, а десяток осмислених точок. Кожна відповідає на
// питання, яке ми не можемо поставити людині напряму: де вона застрягла, що
// кинула на півдорозі, де не знайшла слів.
//
// Правила, які тримають цю чергу дешевою:
//   — шлемо пачкою раз на 10 с і на visibilitychange (не unload: він не
//     спрацьовує на мобільних, коли вкладку згортають);
//   — втрата події не помилка, повторів не робимо. Подія — це не транзакція;
//   — у props тільки СТРУКТУРНЕ: номер кроку, назва зрізу, рід вкладення.
//     Назв продуктів і вмісту комори тут не буває ніколи.

import { readDevice } from './device';

export type EventName =
  | 'pantry_opened' | 'pantry_filter_changed' | 'pantry_card_opened'
  | 'recipe_opened' | 'cook_started' | 'cook_step_reached' | 'cook_finished' | 'cook_abandoned'
  | 'shopping_opened' | 'calendar_opened'
  | 'attachment_added'
  | 'chat_input_abandoned'
  | 'error_shown'
  // Крок А1: знайомство (Семен, 11 карток) і картка «Про тебе» (7 панелей).
  // Саме там людина може мовчки застрягти й піти — і саме там ми були сліпі.
  // Підкреслення, як у решти подій продукту: через дефіс пишуться ІНЦИДЕНТИ
  // ('intake-op-missed'), і це два різні набори.
  | 'welcome_started' | 'welcome_card_reached' | 'welcome_finished' | 'welcome_skipped'
  | 'onboarding_started' | 'onboarding_panel_reached' | 'onboarding_finished' | 'onboarding_skipped';

interface Queued { name: EventName; props?: Record<string, unknown>; at: string }

const FLUSH_MS = 10_000;
export const MAX_BATCH = 20;

let queue: Queued[] = [];
let timer = 0;
let started = false;

async function flush(): Promise<void> {
  if (!queue.length) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  try {
    await fetch('/v1/events/track', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      // Крок А1: пристрій — РАЗ НА ПАЧКУ, у конверт, а не в кожну подію.
      // Двадцять однакових знімків в одному запиті були б двадцятьма копіями
      // того самого факту; сервер проставить його на рядки сам.
      body: JSON.stringify({ events: batch, device: readDevice() }),
      // keepalive — щоб пачка доїхала, коли вкладку вже згортають.
      keepalive: true,
    });
  } catch {
    // Мовчки. Подія, що не доїхала, не варта ні повтору, ні тосту людині:
    // вона про нас, а не про неї.
  }
}

/** Ставить подію в чергу. Нічого не чекає й ніколи не кидає. */
export function track(name: EventName, props?: Record<string, unknown>): void {
  queue.push({ name, props, at: new Date().toISOString() });
  // Повна пачка йде одразу. Це ж і тримає чергу обмеженою: flush забирає
  // рядки синхронно, до першого await, тож довша за MAX_BATCH вона не буває
  // навіть офлайн — окрема стеля була б мертвим кодом.
  if (queue.length >= MAX_BATCH) void flush();
}

/**
 * Крок А2: злити чергу ЗАРАЗ, не чекаючи тіку.
 *
 * Потрібно рівно в одному місці — на екрані падіння. `startTracking()` живе
 * всередині `Shell`, а `ErrorBoundary` стоїть НАД ним: коли Shell падає, його
 * прибирання робить `clearInterval` і знімає слухач visibilitychange. Подія
 * `error_shown`, яку екран падіння щойно поклав у чергу, лишається там
 * назавжди — зливати її вже нікому, а кнопка «Перезавантажити» доб'є модуль
 * разом із вкладкою. Перевірено на проді: жодна з двох подій не доїхала.
 *
 * Нічого в самій черзі не міняє: та сама пачка, той самий keepalive (саме він
 * і дає пачці доїхати, коли за мить піде перезавантаження), те саме правило
 * «втрата події не помилка».
 */
export function flushNow(): void {
  void flush();
}

/** Вмикається раз, у каркасі. Повторний виклик — no-op. */
export function startTracking(): () => void {
  if (started) return () => {};
  started = true;
  timer = window.setInterval(() => void flush(), FLUSH_MS);
  const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    started = false;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
  };
}

/** Для тестів: скинути стан між прогонами. */
export function __resetTracking(): void {
  queue = [];
  started = false;
  window.clearInterval(timer);
}
export const __queue = () => queue;
