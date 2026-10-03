// @vitest-environment jsdom
//
// Пошукова база, крок 1 (рішення власника 03.10): title/description/OG на
// лендінгу — текст власника з брифу, заборонені фрази («памʼятає», «з того,
// що є») не повинні туди протекти.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Landing } from './Landing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
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
  document.title = '';
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Landing /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const og = (prop: string) => document.head.querySelector(`meta[property="${prop}"]`)?.getAttribute('content');

describe('Landing · пошукова база (крок 1)', () => {
  it('title і description — текст власника, дослівно', async () => {
    await mount();
    expect(document.title).toBe('Kitchen OS — асистент для домашньої кухні');
    expect(og('og:description')).toBe('Асистент для домашньої кухні: знає, що у тебе вдома, пропонує, що приготувати, веде по кроках і сам веде список покупок. 7 днів безкоштовно, без картки.');
  });

  it('заборонені фрази з брифу копі («памʼятає», «з того, що є») відсутні в title/description', async () => {
    await mount();
    const text = `${document.title} ${og('og:description')}`;
    expect(text).not.toMatch(/памʼята/i);
    expect(text).not.toMatch(/з того,? що (вже )?є/i);
  });

  it('OG: type=website, image — обкладинка лендінгу, canonical на origin+/', async () => {
    await mount();
    expect(og('og:type')).toBe('website');
    expect(og('og:image')).toBe(`${window.location.origin}/landing/og-cover.jpg`);
    const canonical = document.head.querySelector('link[rel="canonical"]')?.getAttribute('href');
    expect(canonical).toBe(`${window.location.origin}/`);
  });
});
