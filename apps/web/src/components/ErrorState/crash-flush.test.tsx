// @vitest-environment jsdom
//
// Крок А2: подія про падіння мусить ВИЙТИ, а не лягти в чергу назавжди.
//
// Що було зламано. `startTracking()` живе в App.tsx усередині `Shell`, а
// `ErrorBoundary` стоїть НАД ним. Коли Shell падає, він розмонтовується, його
// прибирання робить `clearInterval` і знімає слухач `visibilitychange` — і
// подія `error_shown`, яку екран падіння щойно поклав у чергу, лишається там
// назавжди: зливати її вже нікому. Далі кнопка на екрані робить
// `location.reload()`, і модуль із чергою помирає разом із вкладкою.
//
// Наслідок був простий: скільки людей бачать екран «ЕКРАН ЗДАВСЯ», ми не
// знаємо. Перевірено на проді після димового тесту — жодна з двох подій не
// доїхала.
//
// Тому предмет тесту — те, що ПІШЛО В МЕРЕЖУ, а не те, що лежить у черзі. І
// перевіряється це при МЕРТВОМУ інтервалі: саме так виглядає світ на екрані
// падіння.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorScreen } from './ErrorScreen';
import { __resetTracking } from '../../lib/track';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let sent: { events: { name: string; props?: Record<string, unknown> }[] }[];

beforeEach(() => {
  sent = [];
  __resetTracking();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    return new Response('{}', { status: 200 });
  }));
  // startTracking() НЕ викликаємо навмисно: на екрані падіння каркас уже
  // розмонтований, інтервалу не існує. Якщо злив покладається на нього —
  // тест це й покаже.
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined; host = undefined;
  __resetTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountCrashScreen() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <ErrorScreen
        kicker="екран здався"
        code="a1b2c3d4"
        h1a="Комора на місці."
        h1b="Цей екран — ні."
        body="Перезавантаж сторінку."
        cta="Перезавантажити"
        onCta={() => {}}
      />,
    );
  });
  // Один мікротік — щоб fetch, поставлений у чергу мікрозадач, устиг піти.
  await act(async () => { await Promise.resolve(); });
}

describe('подія про падіння виходить одразу', () => {
  it('подія в мережі ДО того, як міг би спрацювати інтервал', async () => {
    await mountCrashScreen();
    // Жодного таймера не проганяли — і все одно пачка вже пішла.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.events.map((e) => e.name)).toContain('error_shown');
  });

  it('мертвий інтервал цьому не заважає — саме в цьому вся суть', async () => {
    await mountCrashScreen();
    const before = sent.length;
    // Проганяємо час: якби подія чекала на інтервал, вона пішла б тут — а
    // на справжньому екрані падіння не пішла б ніколи, бо інтервал знято.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(before).toBe(1);
    expect(sent).toHaveLength(1);   // і не задвоїлась
  });

  it('подія несе стан, у якому людина побачила екран', async () => {
    await mountCrashScreen();
    expect(sent[0]!.events[0]!.props).toEqual({ state: 'екран здався' });
  });
});
