// @vitest-environment jsdom
//
// Хотфікс 03.10: прямий перехід на /terms (лінк з закладки, платіжний
// провайдер, оновлення сторінки) — БЕЗ state.background — раніше тихо падав
// на NotFoundPage в основному <Routes> (той не знав цих чотирьох адрес), а
// документ малювався поверх ДРУГИМ, завжди активним <Routes>. Людина бачила
// «Такої сторінки нема» за напівпрозорим тлом попапу. Справжній баг, не
// лише перешкода для пререндеру ботам.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { RootRoutes } from './App';
import { useAuth } from './store/auth';
import { LEGAL_ROUTES, LEGAL_DOCS, type LegalDocKey } from './lib/legal-docs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  useAuth.setState({ status: 'guest', me: null } as never);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/auth/providers') return json({ google: false, telegram: false, telegramBotId: null });
    return json({});
  }));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

async function mountAt(entry: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter initialEntries={[entry]}><RootRoutes /></MemoryRouter>); });
  // Два незалежні лазі-чанки (Landing у основному <Routes>, LegalDocPage у
  // другому) — Suspense кожного розвʼязується своїм циклом мікротасків, тож
  // одного-двох тіків (як у Landing.checkout.test.tsx, де Landing не лазі)
  // тут не досить; фіксоване вікно, не polling на перший непорожній текст,
  // бо текст з'являється частинами (спершу один чанк, тоді другий).
  for (let i = 0; i < 30; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

describe('пряма адреса юрсторінки (без background) — не 404', () => {
  const docs = Object.keys(LEGAL_ROUTES) as LegalDocKey[];
  for (const doc of docs) {
    it(`${LEGAL_ROUTES[doc]}: без «Такої сторінки нема», документ на місці`, async () => {
      await mountAt(LEGAL_ROUTES[doc]);
      expect(host!.textContent).not.toContain('Такої сторінки нема');
      expect(host!.textContent).toContain(LEGAL_DOCS[doc].title);
    });
  }

  it('/terms: тло — реально змонтований лендінг (форма входу в DOM), не порожній NotFoundPage-екран', async () => {
    await mountAt('/terms');
    expect(host!.querySelector('input[type="email"], input[name="email"]')).not.toBeNull();
  });
});
