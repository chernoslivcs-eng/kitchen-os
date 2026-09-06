// @vitest-environment jsdom
//
// Пул-9: композитор і стрічка під час думання.
//   №1 вирівнювання смуги «Краще не відкладати» — не інлайн-марджин, а клас
//       у модулі, тож медіа-правило колонки 720 більше не програє інлайну;
//   №2 вкладення видно в надісланій репліці;
//   №3 очікування має час, а після 45 с — другий рядок;
//   №4 «Стоп» рве виклик і не додає картку.
//
// CSS-модулі у vitest резолвляться в порожній обʼєкт, тому перевіряються не
// імена класів (їх у DOM просто не буде), а те, що ЛАМАЛОСЬ: інлайн-стилі,
// структура, порядок викликів.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ChatCall { body: { text?: string; attachments?: { id: string }[] } }
let chatCalls: ChatCall[];
let waiting: { resolve: (body: unknown) => void; reject: (e: Error) => void }[];
let batches: { id: string; label: string; state: string; expires_at: string | null }[];

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

function installFetch() {
  chatCalls = [];
  waiting = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url === '/v1/chat') {
      chatCalls.push({ body });
      // Виклик зависає, поки тест його сам не відпустить — так видно і
      // послідовність черги, і те, що робить «Стоп» посеред думання.
      return new Promise((resolve, reject) => {
        waiting.push({ resolve: (b) => resolve(json(b)), reject });
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    }
    if (url === '/v1/pantry') return json({ count: batches.length, batches, products: [] });
    if (url === '/v1/shopping') return json({ count: 0, items: [] });
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-06T06:00:00Z' }, messages: [] });
    if (url === '/v1/attachments') return json({ id: 'att-new', url: '/v1/attachments/att-new/bytes', kind: 'image', bytes: 10, content_type: 'image/jpeg' });
    return json({});
  }));
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><Feed /></MemoryRouter>);
  });
}

const q = <T extends Element>(sel: string) => host!.querySelector<T>(sel);
const qa = (sel: string) => [...host!.querySelectorAll(sel)];
const textarea = () => q<HTMLTextAreaElement>('textarea')!;
const sendBtn = () => q<HTMLButtonElement>('button[type="submit"]')!;
const stopBtn = () => q<HTMLButtonElement>('button[data-stop]');

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
  batches = [];
  installFetch();
  vi.useRealTimers();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('№1 смуга «Краще не відкладати»', () => {
  beforeEach(() => {
    batches = [{ id: 'b1', label: 'сметана', state: 'opened', expires_at: new Date(Date.now() + 86_400_000).toISOString() }];
  });

  it('стилі живуть у модулі, не інлайном — інакше auto-марджини колонки програють', async () => {
    await mount();
    const strip = q<HTMLButtonElement>('[data-stale-strip]');
    expect(strip).toBeTruthy();
    // Саме інлайновий margin бив медіа-правило `.composer-wrap > *` і зсував
    // смугу ліворуч. Жодного інлайн-стилю на ній тепер немає.
    expect(strip!.getAttribute('style')).toBeNull();
  });

  it('смуга — прямий сусід композитора в одній обгортці', async () => {
    await mount();
    const strip = q<HTMLElement>('[data-stale-strip]')!;
    const form = q<HTMLFormElement>('form')!;
    // Обидва — прямі діти `.composer-wrap`: інсет має задаватись однією
    // системою правил, а не двома різними.
    expect(strip.parentElement).toBe(form.parentElement);
  });
});

describe('№2 вкладення в надісланій репліці', () => {
  it('файли лишаються видимими у ході, кожен — посилання на /bytes', async () => {
    await mount();
    const input = q<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'chek.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await submit();

    const links = qa('[data-turn-attachments] a') as HTMLAnchorElement[];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/v1/attachments/att-new/bytes');
    // Підпису «[вкладення]» за людину більше немає.
    expect(host!.textContent).not.toContain('[вкладення]');
  });
});

describe('№3 очікування', () => {
  it('рядок несе час, а після 45 с — другий рядок', async () => {
    await mount();
    await type('що приготувати');
    await submit();

    expect(q('[data-wait]')?.textContent).toContain('0:00');
    expect(q('[data-wait-long]')).toBeNull();

    // Таймер справжній — підміняємо годинник, а не сам напис.
    const t0 = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 47_000);
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(q('[data-wait]')?.textContent).toContain('0:47');
    expect(q('[data-wait-long]')?.textContent).toBe('Ще тримаю');
  });
});

describe('№4 «Стоп»', () => {
  it('обриває хід: картки не зʼявляється, хід позначений «зупинив»', async () => {
    await mount();
    await type('порахуй калорії');
    await submit();
    expect(stopBtn()).toBeTruthy();

    await act(async () => { stopBtn()!.click(); });
    // Сервер може добігти й відповісти — відповідь уже не приймається.
    await act(async () => {
      waiting[0]!.resolve({ reply: 'ось відповідь', card: { type: 'proposal', items: [] }, card_id: 'c1' });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(q('[data-aborted]')?.textContent).toBe('зупинив');
    expect(host!.textContent).not.toContain('ось відповідь');
    expect(stopBtn()).toBeNull();
  });
});
