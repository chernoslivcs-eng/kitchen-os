// @vitest-environment jsdom
// E (20.09): /link/expired?kind=telegram — лінк із бота застарів чи відкликаний.
// Перевидати його зі сторінки не можна (тільки бот: /web), тож без поля пошти.
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LinkExpiredPage } from './LinkGone';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); });

async function mount(entry: string) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter initialEntries={[entry]}><LinkExpiredPage /></MemoryRouter>); });
}

describe('/link/expired?kind=telegram', () => {
  it('текст про бота, без поля пошти', async () => {
    await mount('/link/expired?kind=telegram');
    expect(host!.textContent).toContain('/web');
    expect(host!.querySelector('[data-link-email]')).toBeNull();
  });
  it('без kind — як було: поле пошти є', async () => {
    await mount('/link/expired');
    expect(host!.querySelector('[data-link-email]')).not.toBeNull();
  });
});
