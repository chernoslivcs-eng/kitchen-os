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

/** Відкриває стандартний попап Telegram (десктоп) чи застосунок (телефон); callback колись прийде з даними або `false`, якщо людина закрила вікно. */
export async function telegramLoginAuth(botId: string): Promise<TelegramWidgetUser | null> {
  await loadWidgetScript();
  return new Promise((resolve) => {
    window.Telegram!.Login.auth({ bot_id: botId, request_access: 'write' }, (user) => {
      resolve(user || null);
    });
  });
}
