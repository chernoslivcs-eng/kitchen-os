// Крок О1б: Sentry у браузері.
//
// Навіщо окремо від серверного: половина падінь ніколи не доходить до сервера
// взагалі. Білий екран через помилку рендера, впала мережа посеред готування,
// старий кеш service worker після деплою — сервер про це не дізнається ніяк, а
// людина бачить саме це.
//
// Що НЕ вмикаємо і чому:
//   — Session Replay. Запис екрана людини на її кухні — це не те, на що вона
//     підписувалась, коли розповідала нам про свій дім.
//   — Performance / tracing. Латентність моделі ми міряємо самі (token_usage),
//     а трейси браузера роздули б і бандл, і рахунок.
//   — автоматичні breadcrumbs із console і fetch-тіл: у них їде текст людини.
//
// DSN приходить збіркою (VITE_SENTRY_DSN). Немає змінної — модуль мовчить, і
// в дев-режимі це нормальний стан.

import * as Sentry from '@sentry/react';

let on = false;

export function sentryOn(): boolean {
  return on;
}

/** Тільки для тестів: забути стан між прогонами. */
export async function __resetSentry(): Promise<void> {
  if (on) await Sentry.close(0);
  on = false;
}

export function initSentry(dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined): void {
  if (on || !dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Той самий реліз, що й у лямбди, — щоб подія з браузера і подія з
      // сервера зводились в одну історію. Значення підставляє vite.config.
      release: __SENTRY_RELEASE__ || undefined,
      // Мінімальний набір: без tracing, без replay, без console-breadcrumbs.
      defaultIntegrations: false,
      integrations: [
        Sentry.dedupeIntegration(),
        Sentry.globalHandlersIntegration(),      // window.onerror + unhandledrejection
        Sentry.breadcrumbsIntegration({ console: false, fetch: false, xhr: false, dom: true, history: true }),
        Sentry.functionToStringIntegration(),
      ],
      sendDefaultPii: false,
      // Розширення браузера падають у нашому коді регулярно і не про нас.
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
      ],
      beforeBreadcrumb: (crumb) => {
        // Хлібні крихти з DOM несуть текст елемента — а це назви продуктів у
        // коморі й репліки в чаті. Лишаємо тільки те, НА ЩО натиснули.
        if (crumb.category === 'ui.click' || crumb.category === 'ui.input') delete crumb.message;
        return crumb;
      },
    });
    on = true;
  } catch {
    // Крива DSN не має валити застосунок.
  }
}

/**
 * Хто це. Ставиться після me() і знімається на виході — без цього подія в
 * Sentry не зводиться зі стрічкою дня на /admin/pulse.
 * Тільки id: пошта і імʼя туди не їдуть.
 */
export function setSentryUser(user_id: string | null): void {
  if (!on) return;
  try {
    Sentry.setUser(user_id ? { id: user_id } : null);
  } catch { /* мовчки */ }
}

/**
 * Падіння з ErrorBoundary. Повертає короткий код події — той самий, що людина
 * бачить чипом на екрані помилки й може назвати в листі.
 */
export function captureCrash(error: Error, componentStack?: string | null): string | null {
  if (!on) {
    console.error(error);
    return null;
  }
  try {
    const id = Sentry.captureException(error, {
      contexts: componentStack ? { react: { componentStack } } : undefined,
      tags: { incident_kind: 'broke', incident: 'render-crash' },
    });
    // Вісім знаків: достатньо, щоб знайти подію пошуком, і достатньо коротко,
    // щоб людина продиктувала його голосом.
    return id ? id.slice(0, 8) : null;
  } catch {
    return null;
  }
}

/** Мережевий інцидент, який людина вже побачила смугою (401/429/офлайн). */
export function captureClientIncident(name: string, ctx: Record<string, unknown> = {}): void {
  if (!on) return;
  try {
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setTag('incident_kind', 'guard');
      scope.setTag('incident', name);
      scope.setContext('incident', ctx);
      scope.setFingerprint([name]);
      Sentry.captureMessage(name);
    });
  } catch { /* мовчки */ }
}
