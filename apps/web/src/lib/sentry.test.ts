// @vitest-environment jsdom
//
// Крок О1б: Sentry у браузері.
//
// Перевіряємо дві речі, які ламаються тихо:
//   1. Конверт справді летить, і в ньому є те, за чим ми потім шукатимемо
//      (рід інциденту, id людини, код події, який вона бачить на екрані).
//   2. У конверт НЕ потрапляє текст людини. Хлібна крихта з кліку несе
//      підпис елемента — а це назви продуктів у коморі й репліки в чаті.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Sentry from '@sentry/react';
import { initSentry, sentryOn, captureCrash, setSentryUser, captureClientIncident, __resetSentry } from './sentry';

const DSN = 'http://publickey@127.0.0.1:9999/1';

let sent: Record<string, unknown>[];

function parseEnvelope(body: string): Record<string, unknown> {
  const lines = body.split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    sent.push(parseEnvelope(String(init.body)));
    return new Response('{}', { status: 200 });
  }));
});

afterEach(async () => {
  await __resetSentry();
  vi.unstubAllGlobals();
});

describe('без DSN', () => {
  it('мовчить, і падіння лишається хоч у консолі', () => {
    initSentry(undefined);
    expect(sentryOn()).toBe(false);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Коду немає — і чипа на екрані помилки не буде: порожній чип гірший за
    // його відсутність.
    expect(captureCrash(new Error('впало'))).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('з DSN', () => {
  beforeEach(() => { initSentry(DSN); });

  it('падіння рендера летить і повертає код, який людина бачить на екрані', async () => {
    const code = captureCrash(new Error('впав рендер комори'), '\n    at Pantry');
    await Sentry.flush(2000);

    expect(code).toMatch(/^[0-9a-f]{8}$/);
    expect(sent).toHaveLength(1);
    const ev = sent[0]!;
    // Код на екрані — початок id події: за ним її і знаходять пошуком.
    expect(String(ev.event_id).startsWith(code!)).toBe(true);
    expect((ev.tags as Record<string, string>).incident).toBe('render-crash');
    expect((ev.contexts as { react?: { componentStack?: string } }).react?.componentStack).toContain('Pantry');
  });

  it('людина в події — тільки id', async () => {
    setSentryUser('u-42');
    captureClientIncident('server-down');
    await Sentry.flush(2000);
    expect(sent[0]!.user).toEqual({ id: 'u-42' });
  });

  it('на виході людина знімається — наступна подія вже нічия', async () => {
    setSentryUser('u-42');
    setSentryUser(null);
    captureClientIncident('server-down');
    await Sentry.flush(2000);
    // setUser(null) лишає порожній обʼєкт, а не прибирає поле — важливо саме
    // те, що id більше немає: наступна подія не приписується тому, хто вийшов.
    expect((sent[0]!.user as { id?: string } | undefined)?.id).toBeUndefined();
  });

  it('крихта з кліку не несе підпису елемента', () => {
    const beforeBreadcrumb = Sentry.getClient()!.getOptions().beforeBreadcrumb!;
    const crumb = beforeBreadcrumb(
      { category: 'ui.click', message: 'button[aria-label="Куряча грудка 400 г"]' },
      {},
    );
    // Лишається ЩО натиснули (категорія), зникає ЩО там було написано.
    expect(crumb!.message).toBeUndefined();
    expect(crumb!.category).toBe('ui.click');
  });

  it('крихта переходу між екранами лишається як є', () => {
    const beforeBreadcrumb = Sentry.getClient()!.getOptions().beforeBreadcrumb!;
    const crumb = beforeBreadcrumb({ category: 'navigation', message: '/pantry' }, {});
    expect(crumb!.message).toBe('/pantry');
  });

  it('набір інтеграцій — рівно чотири обрані, без дефолтного гуртожитку', () => {
    const names = Sentry.getClient()!.getOptions().integrations.map((i) => i.name).sort();
    // Список закритий навмисно. Дефолтний набір тягне за собою перехоплення
    // console і fetch — а там їде текст людини; замість «не додали Replay»
    // перевіряємо, що не додалось НІЧОГО зайвого.
    expect(names).toEqual(['Breadcrumbs', 'Dedupe', 'FunctionToString', 'GlobalHandlers']);
  });
});
