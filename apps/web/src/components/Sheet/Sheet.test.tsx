// @vitest-environment jsdom
//
// Рішення власника 20.09 (Р183 живий стенд: на <600 шторка каталогу лишалась
// зовсім без видимого імені — Sheet ніс лише невидимий aria-label): Sheet
// отримав необов'язковий проп `title` — видимий заголовок шапки (стиль
// ArtifactPanel `.rail-kicker-title`, 15/600, без знака), що також стає
// aria-label діалогу (пріоритет над `ariaLabel`). Без title — поведінка не
// змінюється (жоден наявний виклик Sheet цей проп не передає).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sheet } from './Sheet';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; });

async function mount(el: React.ReactElement) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(el); });
}

describe('Sheet · видимий заголовок (проп title)', () => {
  it('без title — як було: немає видимого заголовка, aria-label = ariaLabel', async () => {
    await mount(<Sheet onClose={() => {}} ariaLabel="Каталог подій"><div>вміст</div></Sheet>);
    const dialog = host!.querySelector('[data-sheet]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Каталог подій');
    expect(host!.textContent).not.toContain('Каталог подій');
  });

  it('з title — рендерить видимий заголовок і бере aria-label з нього (ariaLabel лишається, не використовується)', async () => {
    await mount(<Sheet onClose={() => {}} ariaLabel="старе імʼя для скрінрідера" title="Каталог подій"><div>вміст</div></Sheet>);
    const dialog = host!.querySelector('[data-sheet]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Каталог подій');
    expect(host!.textContent).toContain('Каталог подій');
  });
});
