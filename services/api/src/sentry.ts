// Крок О1б: Sentry на сервері.
//
// Тонкий шар навколо @sentry/node, і причина, чому шар взагалі є: увесь код
// продукту говорить про інциденти словами `incident(kind, name, ctx)`, а не
// іменами чужої бібліотеки. Якщо Sentry колись поміняється, міняється цей
// файл, а не двадцять девʼять місць.
//
// Три рішення, які тут закріплені:
//
// 1. БЕЗ OpenTelemetry. За замовчуванням @sentry/node підміняє http, pg і ще
//    десяток модулів заради трейсів. У нашій лямбді трейси не потрібні (латентність
//    ми й так пишемо в token_usage і показуємо на /admin/pulse), а патчинг на
//    кожному cold start коштує часу. `defaultIntegrations: false` лишає ядро
//    й транспорт.
//
// 2. БЕЗ PII. `sendDefaultPii: false` і власний beforeSend, який зрізає тіла
//    запитів і cookie. У тілі чату лежить те, що людина написала про свій дім;
//    у Sentry цьому не місце — там має бути видно, ЩО зламалось, а не про кого.
//    Людину впізнаємо за user_id, і тільки за ним.
//
// 3. Мовчить, якщо DSN немає. Локально, у тестах і на preview змінної немає —
//    і жоден виклик нижче не має ні впасти, ні щось надрукувати.

import * as Sentry from '@sentry/node';

let on = false;
let pending = false;

/** Чи справді ввімкнено — для тестів і для /health. */
export function sentryOn(): boolean {
  return on;
}

/** Тільки для тестів: забути стан між прогонами. */
export async function __resetSentry(): Promise<void> {
  if (on) await Sentry.close(0);
  on = false;
  pending = false;
}

/**
 * @param dsn   Явна DSN — потрібна тесту, який піднімає свій приймач конвертів.
 * @param force Увімкнути навіть під vitest. Тільки для того самого тесту:
 *              інакше кожен прогін пакета стукав би в справжній Sentry.
 */
export function initSentry(dsn = process.env.SENTRY_DSN, force = false): void {
  if (on || !dsn) return;
  if (!force && (process.env.NODE_ENV === 'test' || process.env.VITEST)) return;
  try {
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV ?? 'development',
      // Реліз спільний із фронтом (той самий коміт) — інакше в Sentry це два
      // різні світи, і подію з браузера не звести з подією з лямбди.
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      defaultIntegrations: false,
      integrations: [Sentry.dedupeIntegration()],
      // Трейсів не збираємо: див. рішення 1 вгорі.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend: scrub,
    });
    on = true;
  } catch {
    // Крива DSN не має валити застосунок: спостережність — не функція продукту.
  }
}

/**
 * Зрізає все, що могло принести текст людини. Sentry сам кладе в подію
 * request.data (тіло) і headers — ми обидва прибираємо повністю, а не
 * маскуємо: маска лишає форму, а форма тут теж приватна.
 */
export function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    // Query-рядок теж: у ньому їздять токени запрошень і id рецептів.
    delete event.request.query_string;
  }
  return event;
}

/**
 * Інцидент у Sentry. broke → рівень error, guard → warning: у Sentry це різні
 * списки, і власник має бачити «зламалось» окремо від «спрацював запобіжник».
 */
export function captureIncident(
  kind: 'broke' | 'guard',
  name: string,
  ctx: Record<string, unknown>,
): void {
  if (!on) return;
  pending = true;
  const { user_id, household_id, session_id, err, ...rest } = ctx;
  try {
    Sentry.withScope((scope) => {
      scope.setLevel(kind === 'broke' ? 'error' : 'warning');
      scope.setTag('incident_kind', kind);
      scope.setTag('incident', name);
      if (typeof user_id === 'string') scope.setUser({ id: user_id });
      if (typeof session_id === 'string') scope.setTag('session_id', session_id);
      if (typeof household_id === 'string') scope.setTag('household_id', household_id);
      scope.setContext('incident', rest);
      // Групування — за назвою інциденту, а не за текстом винятку: інакше
      // `chat-model-call-failed` розсипається на сотню окремих проблем через
      // різні повідомлення провайдера.
      scope.setFingerprint([name]);
      if (err instanceof Error) Sentry.captureException(err);
      else Sentry.captureMessage(name);
    });
  } catch {
    // Те саме: спостережність не має права зламати обробник.
  }
}

/**
 * Дочекатись відправки. У лямбді контейнер засинає одразу після відповіді, і
 * без цього подія просто не встигає полетіти.
 */
export async function flushSentry(ms = 2000): Promise<void> {
  if (!on || !pending) return;
  pending = false;
  try { await Sentry.flush(ms); } catch { /* мовчки */ }
}
