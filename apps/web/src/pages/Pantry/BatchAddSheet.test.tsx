// @vitest-environment jsdom
// Власник 15.09: форма «Додати» упізнає продукт через суворий резолвер —
// після паузи набору 300 мс тихий рядок під назвою (знак sys.go + текст); зона підставляється з
// підказки лише поки людина її не чіпала.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BatchAddSheet } from './Pantry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined; let host: HTMLDivElement | undefined;
let calls: string[];
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('/v1/pantry/resolve')) {
      const label = decodeURIComponent(url.split('label=')[1] ?? '');
      return label.toLowerCase() === 'молоко' ? json({ key: 'milk_cow_25', name: 'Молоко коровʼяче 2.5%', cat: 'молоко', zone: 'fridge', days: 7 }) : label.toLowerCase() === 'кефір' ? json({ key: null, zone: 'fridge' }) : json({ key: null, zone: null });
    }
    return json({ batch: {} });
  }));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<BatchAddSheet onClose={() => {}} onCreated={async () => {}} />); });
}
const input = () => host!.querySelector<HTMLInputElement>('input')!;
const zone = () => host!.querySelector<HTMLSelectElement>('[data-zone]')!;
const hint = () => host!.querySelector('[data-add-hint]');
async function type(text: string) {
  const el = input();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(350); });

describe('BatchAddSheet · підказка резолвера', () => {
  it('після паузи 300 мс — «→ Молоко коровʼяче 2.5% · Холодильник · ≈ 7 дн»; зона підставляється', async () => {
    await mount();
    expect(hint()).toBeNull();
    await type('моло');
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(calls.filter((c) => c.includes('/resolve'))).toHaveLength(0); // ще не минуло 300 мс
    await type('молоко');
    await settle();
    expect(calls.filter((c) => c.includes('/resolve'))).toHaveLength(1);
    expect(hint()!.textContent).toBe('Молоко коровʼяче 2.5% · Холодильник · ≈ 7 дн');
    expect(hint()!.querySelector('[data-icon]')).toBeTruthy(); // стрілка — знак sys.go, не гліф
    expect(zone().value).toBe('fridge');
  });
  it('«кефір» без ключа, але з зоною — рядок «без категорії», зона підставлена', async () => {
    await mount();
    await act(async () => { zone().value = 'dry'; }); // початковий стан селекта, не «торкнулась»
    await type('кефір'); await settle();
    expect(hint()!.textContent).toBe('без категорії — строк не рахуватиму');
    expect(zone().value).toBe('fridge');
  });
  it('невідоме → «→ без категорії — строк не рахуватиму»; порожня назва — рядка нема', async () => {
    await mount();
    await type('щось xyz'); await settle();
    expect(hint()!.textContent).toBe('без категорії — строк не рахуватиму');
    await type(''); await settle();
    expect(hint()).toBeNull();
  });
  it('зона змінена руками — підказка її не перекриває', async () => {
    await mount();
    await act(async () => { zone().value = 'freezer'; zone().dispatchEvent(new Event('change', { bubbles: true })); });
    await type('молоко'); await settle();
    expect(hint()).toBeTruthy();
    expect(zone().value).toBe('freezer');
  });
});
