// @vitest-environment jsdom
//
// Юридичні документи (23.09): попап на Sheet, маршрут працює без сесії
// (нема жодного fetch у цій сторінці), закриття повертає туди, звідки
// відкрили (`state.background`), або на `/`, якщо зайшли напряму.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router-dom';
import { LegalDocPage } from './LegalDocPage';
import { LEGAL_DOCS, type LegalDocKey } from '../../lib/legal-docs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = undefined;
});

async function mount(initialEntries: InitialEntry[], initialIndex?: number) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <Routes>
          <Route path="/" element={<div data-marker="home">лендінг</div>} />
          <Route path="/profile" element={<div data-marker="profile">профіль</div>} />
          <Route path="/terms" element={<LegalDocPage doc="terms" />} />
          <Route path="/privacy" element={<LegalDocPage doc="privacy" />} />
          <Route path="/refund" element={<LegalDocPage doc="refund" />} />
          <Route path="/contacts" element={<LegalDocPage doc="contacts" />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

async function pressEscape() {
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
}

describe('LegalDocPage · рендер', () => {
  it('оферта: заголовок шторки і текст самого документа', async () => {
    await mount(['/terms']);
    expect(host!.textContent).toContain('Оферта');
    expect(host!.textContent).toContain('Публічна оферта на надання послуг Kitchen OS');
  });

  it('політика: працює без жодного /v1-запиту (не залогінений відвідувач)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await mount(['/privacy']);
    expect(host!.textContent).toContain('Політика конфіденційності Kitchen OS');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('LegalDocPage · пошукова база (крок 1)', () => {
  const docs: LegalDocKey[] = ['terms', 'privacy', 'refund', 'contacts'];
  for (const doc of docs) {
    it(`/${doc}: title і description — із LEGAL_DOCS`, async () => {
      await mount([`/${doc}`]);
      const { title, description } = LEGAL_DOCS[doc];
      expect(document.title).toBe(`${title} · Kitchen OS`);
      const metaDesc = document.head.querySelector('meta[name="description"]')?.getAttribute('content');
      expect(metaDesc).toBe(description);
      const ogTitle = document.head.querySelector('meta[property="og:title"]')?.getAttribute('content');
      expect(ogTitle).toBe(`${title} · Kitchen OS`);
    });
  }
});

describe('LegalDocPage · закриття', () => {
  it('відкрито лінком (state.background) — Escape повертає на сторінку, звідки відкрили', async () => {
    await mount([
      '/profile',
      { pathname: '/terms', state: { background: { pathname: '/profile', search: '', hash: '', state: null, key: 'prev' } } },
    ], 1);
    expect(host!.querySelector('[data-marker]')).toBeNull();
    await pressEscape();
    expect(host!.querySelector('[data-marker="profile"]')).not.toBeNull();
  });

  it('прямий перехід (нема background) — Escape веде на /', async () => {
    await mount(['/terms']);
    await pressEscape();
    expect(host!.querySelector('[data-marker="home"]')).not.toBeNull();
  });
});
