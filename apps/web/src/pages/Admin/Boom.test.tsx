// @vitest-environment jsdom
//
// Крок О1: димовий тест символікації, фронтова половина.
//
// Крок А2: перевірки доступу тут більше немає — вона переїхала на каркас
// адмінки (AdminShell.test.tsx), і 404 тепер справжня сторінка продукту, а не
// саморобний прямокутник. Тут лишилось те, заради чого сторінка існує: вибух
// у рендері, екран замість білої сторінки й читабельний стек.
//
// Головне тут — не сам вибух, а те, що людина після нього бачить ЕКРАН, а не
// білу сторінку, і що подія при цьому все одно летить. Обидві половини цієї
// пари ламаються тихо: межу React ніхто не чіпає місяцями, і дізнатись, що
// вона перестала ловити, можна лише падінням.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BoomPage } from './Boom';
import { ErrorBoundary } from '../../components/ErrorState/ErrorBoundary';
import { SMOKE_TEST_MARK } from '../../lib/sentry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let quiet: ReturnType<typeof vi.spyOn>;

async function mount(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(ui); });
}

beforeEach(() => {
  // React друкує впіймане падіння в консоль — у прогоні це шум, не сигнал.
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined; host = undefined;
  quiet.mockRestore();
  vi.unstubAllGlobals();
});

describe('/admin/boom', () => {
  it('власнику падає в РЕНДЕРІ, і людина бачить екран, а не білу сторінку', async () => {
    await mount(<ErrorBoundary onError={() => 'a1b2c3d4'}><BoomPage /></ErrorBoundary>);
    // Саме екран Е1, з обома рядками заголовка.
    expect(document.querySelector('[data-error-screen]')).toBeTruthy();
    expect(host!.textContent).toContain('Комора на місці.');
    expect(host!.textContent).toContain('Цей екран — ні.');
  });

  it('межа НЕ ковтає подію — вона йде назовні', async () => {
    const seen: Error[] = [];
    await mount(<ErrorBoundary onError={(e) => { seen.push(e); return 'a1b2c3d4'; }}><BoomPage /></ErrorBoundary>);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toContain('димовий тест символікації');
    // Стек із трьома нашими кадрами — те, заради чого сорсмепи існують.
    const stack = seen[0]!.stack ?? '';
    expect(stack).toContain('measureShelf');
    expect(stack).toContain('describeShelf');
    expect(stack).toContain('renderNightPlan');
  });

  it('текст винятку РІЗНИЙ на кожному прогоні — інакше дедуп з\'їдає другий', async () => {
    // dedupeIntegration відкидає подію, ідентичну попередній надісланій. Два
    // прогони поспіль кидали той самий виняток з того самого рядка — і другий
    // мовчки не доїжджав. Спіймано на проді 07.09.2026.
    const seen: Error[] = [];
    await mount(<ErrorBoundary onError={(e) => { seen.push(e); return 'a1'; }}><BoomPage /></ErrorBoundary>);
    await act(async () => { root?.unmount(); });
    root = undefined; host?.remove(); host = undefined;
    await mount(<ErrorBoundary onError={(e) => { seen.push(e); return 'a2'; }}><BoomPage /></ErrorBoundary>);

    expect(seen).toHaveLength(2);
    expect(seen[0]!.message).not.toBe(seen[1]!.message);
    // Впізнаваний початок лишається — за ним шукають подію.
    expect(seen[0]!.message).toContain('димовий тест символікації');
    expect(seen[1]!.message).toContain('димовий тест символікації');
  });

  it('виняток позначений — за міткою captureCrash тримає групування сталим', async () => {
    // Ціна різного тексту — «кожен прогін окрема проблема в Sentry». Її
    // платить мітка: без неї фронтова половина засмітила б список, який
    // власник читає щодня.
    const seen: Error[] = [];
    await mount(<ErrorBoundary onError={(e) => { seen.push(e); return 'a1b2c3d4'; }}><BoomPage /></ErrorBoundary>);
    expect((seen[0] as Error & { [SMOKE_TEST_MARK]?: boolean })[SMOKE_TEST_MARK]).toBe(true);
  });

  it('код інциденту видно на екрані — за ним власник знайде подію', async () => {
    await mount(<ErrorBoundary onError={() => 'a1b2c3d4'}><BoomPage /></ErrorBoundary>);
    expect(document.querySelector('[data-error-code]')?.textContent).toBe('a1b2c3d4');
  });
});
