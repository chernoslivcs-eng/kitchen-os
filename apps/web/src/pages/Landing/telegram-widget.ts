// PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915): офіційний Telegram Login Widget не
// вбудовується як видима кнопка (не можна перефарбувати чужий iframe під наш
// стиль) — тягнемо лише його скрипт заради `Telegram.Login.auth(...)`, а
// видима кнопка — своя (SignInForm.tsx). Скрипт викликає колбек напряму,
// без рендеру віджета на сторінці.
const WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    Telegram?: {
      Login: {
        auth: (
          options: { bot_id: string; request_access?: string; lang?: string },
          callback: (user: TelegramWidgetUser | false) => void,
        ) => void;
      };
    };
  }
}

let loadPromise: Promise<void> | null = null;

function loadWidgetScript(): Promise<void> {
  if (window.Telegram?.Login) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loadPromise = null; reject(new Error('telegram widget script failed to load')); };
    document.head.appendChild(script);
  });
  return loadPromise;
}

/** Підвантажити скрипт віджета заздалегідь (десктоп, при монтуванні лендингу) — щоб `auth()` у обробнику кліку відкривав попап СИНХРОННО, а не після await, інакше блокувальники попапів зрізають вікно й на десктопі. Помилку глушимо: telegramLoginAuth сам повторить спробу завантаження. */
export function preloadTelegramWidget(): void {
  void loadWidgetScript().catch(() => { /* спробуємо ще раз у telegramLoginAuth */ });
}

/** Відкриває стандартний попап Telegram (десктоп); callback колись прийде з даними або `false`, якщо людина закрила вікно. На дотикових/вузьких екранах popup не використовується — iOS Safari блокує window.open, коли він стається ПІСЛЯ асинхронного завантаження скрипта, тобто поза жестом тапу (див. isTouchOrNarrow/buildTelegramRedirectUrl). */
export async function telegramLoginAuth(botId: string): Promise<TelegramWidgetUser | null> {
  await loadWidgetScript();
  return new Promise((resolve) => {
    window.Telegram!.Login.auth({ bot_id: botId, request_access: 'write' }, (user) => {
      resolve(user || null);
    });
  });
}

/** Дотик (пальцем) або вузький екран — там, де popup-флоу мовчки не спрацює. */
export function isTouchOrNarrow(): boolean {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || window.innerWidth < 768;
}

/**
 * Редирект-флоу (мобайл): тап → одразу `location.href` на oauth.telegram.org
 * у тому самому жесті — ніякого window.open і асинхронного скрипта, тому
 * Safari на iPhone нічого не блокує. Telegram після підтвердження повертає
 * на return_to (наш /auth/telegram) з тими самими полями у query, що й
 * popup-колбек (id, first_name, …, hash) — TelegramCallback.tsx їх читає.
 */
export function buildTelegramRedirectUrl(botId: string): string {
  const origin = window.location.origin;
  const returnTo = `${origin}/auth/telegram`;
  const params = new URLSearchParams({
    bot_id: botId,
    origin,
    embed: '1',
    request_access: 'write',
    return_to: returnTo,
  });
  return `https://oauth.telegram.org/auth?${params.toString()}`;
}

const TG_ERROR_QUERY_KEY = 'tgError';
let tgErrorConsumed = false;

/** /auth/telegram веде сюди при провалі підпису чи протухлому лінку (?tgError=1) — SignInForm показує той самий текст, що й попап-помилка, і прибирає параметр з адреси, щоб перезавантаження сторінки не повторювало банер. */
export function consumeTelegramRedirectError(): boolean {
  if (tgErrorConsumed) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get(TG_ERROR_QUERY_KEY) !== '1') return false;
  tgErrorConsumed = true;
  params.delete(TG_ERROR_QUERY_KEY);
  const qs = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  return true;
}
