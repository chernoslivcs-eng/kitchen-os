// @vitest-environment jsdom
//
// Постановка 2026-09-25 (режим без підписки), Task 10: POST /v1/chat → 402
// paywall — модель не викликана (сервером), репліка людини зникає зі
// стрічки, відповідь асистента — текст сервера + кнопка на екран «Підписка».
// Стиль — Feed.test.tsx (мок fetch напряму, не api-модуль).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';
import { usePanelStore } from '../../store/panel';
import { ArtifactPanel } from '../../components/ArtifactPanel/ArtifactPanel';
import { useAuth } from '../../store/auth';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAYWALL_TEXT = 'Я зберіг те, що в нас уже є. Зараз я не розбираю нові повідомлення, чеки, фото й голос і не веду комору далі. Поки зупинимось тут — не найгірше місце для паузи.';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

function installFetch(chatResponse: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/chat') return chatResponse();
    if (url === '/v1/pantry') return json({ count: 0, batches: [], products: [] });
    if (url === '/v1/shopping') return json({ count: 0, items: [] });
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/recipes') return json({ recipes: [] });
    if (url === '/v1/cook-runs') return json({ runs: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-25T06:00:00Z' }, messages: [] });
    return json({});
  }));
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><Feed /><ArtifactPanel /></MemoryRouter>);
  });
}

const q = <T extends Element>(sel: string) => host!.querySelector<T>(sel);
const textarea = () => q<HTMLTextAreaElement>('textarea')!;
const sendBtn = () => q<HTMLButtonElement>('button[type="submit"]')!;

async function type(text: string) {
  const el = textarea();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => { sendBtn().click(); });
}

beforeEach(() => {
  useAuth.setState({ me: null });
  usePanelStore.setState({ artifacts: [], freshKeys: [], active: null, lastManualPick: 0, hidden: false, fresh: false });
  vi.stubGlobal('matchMedia', (m: string) => ({ matches: true, media: m, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

describe('Task 10: 402 paywall у чаті', () => {
  it('текст асистента видно, репліка людини зникає, кнопка веде на /profile/subscription', async () => {
    installFetch(() => json({ kind: 'paywall', state: 'lapsed', text: PAYWALL_TEXT, cta: { label: 'Продовжити', to: '/profile/subscription' } }, 402));
    await mount();
    await type('що на вечерю?');
    await submit();
    // effect-хвіст помилки — той самий цикл мікротасків, що й у Feed.test.tsx.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(host!.textContent).toContain(PAYWALL_TEXT);
    expect(host!.textContent).not.toContain('що на вечерю?');
    const link = q<HTMLAnchorElement>('a[href="/profile/subscription"]');
    expect(link?.textContent).toContain('Продовжити');
  });

  it('не 402/не paywall — звичайний «не відповіло», хід лишається позначений', async () => {
    installFetch(() => json({ error: 'model_unavailable' }, 502));
    await mount();
    await type('що на вечерю?');
    await submit();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(host!.textContent).toContain('що на вечерю?');
    expect(host!.textContent).not.toContain(PAYWALL_TEXT);
    expect(q('a[href="/profile/subscription"]')).toBeNull();
  });
});
