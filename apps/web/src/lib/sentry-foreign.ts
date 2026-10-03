// Чужі скрипти в нашій сторінці (прод, 03.10).
//
// Браузери всередині застосунків (Instagram, Facebook, WKWebView) вставляють
// у документ свої скрипти — заповнювачі прогалин, містки до нативного шару.
// Падають вони в себе, а Sentry бачить нашу сторінку й записує це на нас:
//
//   ReferenceError: Can't find variable: CONFIG
//     at updateGapFiller (https://kitchen-os.app/:311:46)
//   TypeError: undefined is not an object (evaluating
//     'window.webkit.messageHandlers.scrollEventHandler.postMessage')
//     at sendScrollEvent (https://kitchen-os.app/:20:57)
//
// Правило: якщо в стеку НЕМА ні одного кадру з нашого бандла — подія не наша.
//
// Чому не по тексту повідомлення: назви чужих функцій і класи помилок
// міняються з кожним оновленням того застосунку, а фільтр по тексту старіє
// молча. Чому не `allowUrls`: він дивиться на один «винний» кадр, а питання в
// іншому — чи є наш код у стеку взагалі. Чуже зверху, наше нижче — це цілком
// може бути наше падіння (чужий код подзвонив у наш обробник), і такі події
// ми лишаємо.
//
// Своїм вважається файл із нашого ж origin і зі шляху, куди vite кладе бандл.
// Обидві умови потрібні: `/assets/` буває й на чужих доменах, а наш origin
// віддає ще й сам документ, у якому ці скрипти й сидять.
const BUNDLE_PATH = '/assets/';

interface MaybeFrame { filename?: string }
interface MaybeValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: MaybeFrame[] };
  mechanism?: { type?: string };
}
interface MaybeEvent {
  exception?: { values?: MaybeValue[] };
  threads?: { values?: MaybeValue[] };
  stacktrace?: { frames?: MaybeFrame[] };
}

function framesOf(event: MaybeEvent): MaybeFrame[] {
  const out: MaybeFrame[] = [];
  for (const v of event.exception?.values ?? []) out.push(...(v.stacktrace?.frames ?? []));
  for (const v of event.threads?.values ?? []) out.push(...(v.stacktrace?.frames ?? []));
  out.push(...(event.stacktrace?.frames ?? []));
  return out;
}

function isOurs(filename: string | undefined, origin: string): boolean {
  if (!filename) return false;
  // Sentry інколи віддає шлях без origin — тоді він наш за означенням.
  if (filename.startsWith(BUNDLE_PATH)) return true;
  return filename.startsWith(`${origin}${BUNDLE_PATH}`);
}

/**
 * Чи ми покликали це самі. `captureException` ставить механізм 'generic'
 * (перевірено на нашому ж captureCrash), а window.onerror і
 * unhandledrejection — 'onerror' і 'onunhandledrejection'.
 *
 * Різниця важлива: `captureCrash` із ErrorBoundary — завжди наша подія, навіть
 * коли стек у ній нічого не каже. Стек React-падіння буває обрізаний або з
 * безіменними кадрами (мініфікація, асинхронні межі), і фільтрувати ТАКЕ по
 * кадрах означало б втратити справжнє падіння тихо — рівно те, від чого ми
 * тут захищаємось, лише в інший бік.
 *
 * Чужі скрипти ж приходять саме з інструментації: вони падають у себе, нам їх
 * приносить глобальний обробник.
 */
function isDeliberate(event: MaybeEvent): boolean {
  const values = [...(event.exception?.values ?? []), ...(event.threads?.values ?? [])];
  return values.some((v) => v.mechanism?.type === 'generic');
}

/**
 * Подію створив не наш код. Події БЕЗ кадрів такими не вважаються: їх мало
 * (onerror без стеку, наші ж captureMessage), і вони можуть бути наші —
 * викидати їх означало б лікувати тишею.
 */
export function isForeignEvent(event: MaybeEvent, origin: string = location.origin): boolean {
  const frames = framesOf(event);
  if (!frames.length) return false;
  if (isDeliberate(event)) return false;
  return !frames.some((f) => isOurs(f.filename, origin));
}
