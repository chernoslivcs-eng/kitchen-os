// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://kitchen-os.app/app" }
//
// Чужі скрипти в нашій сторінці (прод, 03.10).
//
// Браузери всередині застосунків — Instagram, Facebook, WKWebView — вставляють
// у документ свої скрипти: заповнювачі прогалин, містки до нативного шару.
// Вони падають у себе, а Sentry бачить нашу сторінку й пише це на нас. Два
// живих приклади з проду того дня:
//
//   ReferenceError: Can't find variable: CONFIG
//     at updateGapFiller (https://kitchen-os.app/:311:46)
//   TypeError: undefined is not an object (evaluating
//     'window.webkit.messageHandlers.scrollEventHandler.postMessage')
//     at sendScrollEvent (https://kitchen-os.app/:20:57)
//
// Обидва кадри — у самому HTML-документі (`kitchen-os.app/:NN`). Наш index.html
// скриптів усередині не має зовсім (на це теж є перевірка нижче), тож такий
// кадр за означенням чужий.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Sentry from '@sentry/react';
import { initSentry, __resetSentry } from './sentry-impl';
import { isForeignEvent } from './sentry-foreign';

const DSN = 'http://publickey@127.0.0.1:9999/1';
const OURS = 'https://kitchen-os.app/assets/index-B7xK2a.js';

let sent: unknown[];

const frame = (filename: string, func: string) => ({ filename, function: func, in_app: true });
// Так виглядає подія від window.onerror — саме ними приходять чужі скрипти.
const eventWith = (frames: Array<{ filename: string; function: string }>) => ({
  exception: { values: [{ type: 'TypeError', value: 'щось', stacktrace: { frames }, mechanism: { type: 'onerror', handled: false } }] },
});
// А так — наш власний виклик captureException (captureCrash з ErrorBoundary).
const deliberate = (frames: Array<{ filename: string; function: string }>) => ({
  exception: { values: [{ type: 'Error', value: 'щось', stacktrace: { frames }, mechanism: { type: 'generic', handled: true } }] },
});

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    sent.push(String(init.body));
    return new Response('{}', { status: 200 });
  }));
  initSentry(DSN);
});

afterEach(async () => {
  await __resetSentry();
  vi.unstubAllGlobals();
});

describe('isForeignEvent', () => {
  // Без цього рядка половина тестів нижче проходила б з хибної причини: при
  // іншому origin наш же бандл перестав би бути нашим, і «чуже не летить»
  // ставало б тривіальним.
  it('тест працює від імені нашого домену', () => {
    expect(location.origin).toBe('https://kitchen-os.app');
  });

  it('обидва живих приклади з проду — чужі', () => {
    expect(isForeignEvent(eventWith([frame('https://kitchen-os.app/:311:46', 'updateGapFiller')]))).toBe(true);
    expect(isForeignEvent(eventWith([frame('https://kitchen-os.app/:20:57', 'sendScrollEvent')]))).toBe(true);
  });

  it('кадр у нашому бандлі — наш', () => {
    expect(isForeignEvent(eventWith([frame(OURS, 'CookPage')]))).toBe(false);
  });

  it('подія без кадрів лишається: їх мало, і вони можуть бути наші', () => {
    expect(isForeignEvent({})).toBe(false);
    expect(isForeignEvent({ exception: { values: [{ type: 'Error', value: 'з onerror без стеку' }] } })).toBe(false);
    expect(isForeignEvent(eventWith([]))).toBe(false);
  });

  it('чужий кадр ЗВЕРХУ, наш нижче — лишаємо: це може бути наше падіння', () => {
    // Саме через цей випадок тут beforeSend, а не allowUrls: той дивиться на
    // один кадр, а нам треба знати, чи є наш код у стеку взагалі.
    expect(isForeignEvent(eventWith([
      frame(OURS, 'applyCard'),
      frame('https://kitchen-os.app/:311:46', 'updateGapFiller'),
    ]))).toBe(false);
  });

  it('чужий /assets/ на чужому домені нашим не стає', () => {
    expect(isForeignEvent(eventWith([frame('https://scontent.cdninstagram.com/assets/ig.js', 'x')]))).toBe(true);
  });

  it('кадри без назви файлу нашими не вважаються', () => {
    expect(isForeignEvent(eventWith([frame('<anonymous>', 'eval')]))).toBe(true);
  });

  // Межа фільтра: він про те, що ПРИНІС глобальний обробник. Те, що ми
  // покликали самі, летить завжди — стек React-падіння буває обрізаний, і
  // тихо втратити справжнє падіння гірше за чужий шум у списку.
  it('наш власний captureException летить навіть із чужим стеком', () => {
    expect(isForeignEvent(deliberate([frame('https://kitchen-os.app/:311:46', 'updateGapFiller')]))).toBe(false);
    expect(isForeignEvent(deliberate([frame('<anonymous>', 'eval')]))).toBe(false);
  });
});

describe('beforeSend у справжньому SDK', () => {
  const flush = () => Sentry.flush(0);

  it('чуже не летить, наше летить', async () => {
    Sentry.captureEvent(eventWith([frame('https://kitchen-os.app/:311:46', 'updateGapFiller')]));
    await flush();
    expect(sent).toHaveLength(0);

    Sentry.captureEvent(eventWith([frame(OURS, 'CookPage')]));
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('повідомлення без стеку (наш captureClientIncident) летить', async () => {
    Sentry.captureMessage('offline');
    await flush();
    expect(sent).toHaveLength(1);
  });
});

// Весь фільтр стоїть на тому, що кадр у самому документі не може бути нашим.
// Щойно в index.html з'явиться скрипт усередині — його падіння почнуть тихо
// зникати, і цей тест має впасти раніше, ніж це помітять по тишині в Sentry.
describe('index.html', () => {
  it('не має скриптів усередині документа — інакше фільтр глушив би наше', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    for (const tag of scripts) expect(tag, tag).toMatch(/\ssrc=/);
  });
});
