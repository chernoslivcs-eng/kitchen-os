// @vitest-environment jsdom
//
// Крок А1: події знайомства (Семен, 11 карток).
//
// Знайомство — перше, що бачить нова людина, і досі воно не лишало по собі
// жодного сліду. Ламається це тихо в одному місці: «Пропустити» і «Почати з
// того, що є» ведуть в ОДНЕ місце (finish → /app), і найпростіший спосіб їх
// написати — одна подія на обидві кнопки. Тоді відповідь на «скільки людей
// дочитує Семена» стане неправдою, схожою на правду: усі дочитали.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingPage } from './Onboarding';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let calls: { url: string; body: unknown }[];
let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(async () => {
  // Етап 11: крок памʼятається в kos-onb-step (як у бандлі) — кожен тест починає з першої картки.
  localStorage.clear();
  calls = [];
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  const { __resetTracking, startTracking } = await import('../../lib/track');
  __resetTracking();
  startTracking();

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
  });
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  const { __resetTracking } = await import('../../lib/track');
  __resetTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const btn = (label: string) => [...host!.querySelectorAll('button')]
  .find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;

async function sent() {
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  return calls.filter((c) => c.url === '/v1/events/track')
    .flatMap((c) => (c.body as { events: { name: string; props?: Record<string, unknown> }[] }).events);
}

describe('події знайомства', () => {
  it('відкриття пише «почав» і першу картку', async () => {
    const events = await sent();
    expect(events.map((e) => e.name)).toContain('welcome_started');
    expect(events.find((e) => e.name === 'welcome_card_reached')?.props).toEqual({ card: 1 });
  });

  it('гортання називає НОМЕР картки — саме він каже, де людина відпала', async () => {
    await act(async () => { btn('Далі').click(); });
    await act(async () => { btn('Далі').click(); });
    const reached = (await sent()).filter((e) => e.name === 'welcome_card_reached').map((e) => e.props);
    expect(reached).toEqual([{ card: 1 }, { card: 2 }, { card: 3 }]);
  });

  it('«Пропустити» — це НЕ «дочитав», і подія каже, на якій картці', async () => {
    await act(async () => { btn('Далі').click(); });
    await act(async () => { btn('Пропустити').click(); });
    const events = await sent();
    expect(events.find((e) => e.name === 'welcome_skipped')?.props).toEqual({ card: 2 });
    // Найгірша з можливих помилок тут — порахувати того, хто пішов, як того,
    // хто дочитав.
    expect(events.map((e) => e.name)).not.toContain('welcome_finished');
  });

  it('фінальна кнопка на останній картці — «дочитав», без «пропустив»', async () => {
    // №37: потік один — 11 карток Семена і 7 карток знайомства; «Готово» на 18-й.
    for (let i = 0; i < 11; i++) await act(async () => { btn('Далі').click(); });
    expect(host!.textContent).toContain('Як тебе звати');
    for (let i = 0; i < 6; i++) await act(async () => { btn('Далі').click(); });
    await act(async () => { btn('Готово').click(); });
    const events = await sent();
    expect(events.map((e) => e.name)).toContain('welcome_finished');
    expect(events.map((e) => e.name)).toContain('onboarding_finished');
    expect(events.map((e) => e.name)).not.toContain('welcome_skipped');
  });

  it('№37: знайомство — «Пропустити» на картці лишає поле порожнім і нічого не пише', async () => {
    for (let i = 0; i < 11; i++) await act(async () => { btn('Далі').click(); });
    const before = calls.filter((c) => c.url.startsWith('/v1/profile/')).length;
    await act(async () => { [...host!.querySelectorAll('[data-intake-skip]')][0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(calls.filter((c) => c.url.startsWith('/v1/profile/')).length).toBe(before);
    expect(host!.textContent).toContain('Це просто не їмо');
    const events = await sent();
    expect(events.find((e) => e.name === 'onboarding_skipped')?.props).toEqual({ panel: 1 });
    expect(events.map((e) => e.name)).not.toContain('welcome_skipped');
  });

  it('№37: «Далі» з текстом пише поле в профіль — PATCH /v1/profile/:key', async () => {
    for (let i = 0; i < 11; i++) await act(async () => { btn('Далі').click(); });
    const input = host!.querySelector<HTMLInputElement>('[data-intake-input]')!;
    // Контрольований input у React: значення — через нативний сеттер, інакше трекер не бачить зміни.
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Пилип'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { btn('Далі').click(); });
    const patch = calls.find((c) => c.url === '/v1/profile/name');
    expect(patch?.body).toEqual({ text: 'Пилип' });
  });

  it('у props — тільки номер картки, нічого про людину', async () => {
    await act(async () => { btn('Далі').click(); });
    await act(async () => { btn('Пропустити').click(); });
    for (const e of (await sent()).filter((x) => x.name.startsWith('welcome_'))) {
      expect(Object.keys(e.props ?? {}).every((k) => k === 'card')).toBe(true);
    }
  });
});
