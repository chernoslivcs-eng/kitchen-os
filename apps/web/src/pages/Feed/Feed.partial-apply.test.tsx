// @vitest-environment jsdom
// Етап 3, PLAN §4: частковий успіх живе на сліді, а не лише в тості.
//
// Сервер віддає applied / missed / already_there / truncated з першого дня.
// Слід казав «ЗАСТОСОВАНО» булевим, і «9 із 14» зникало разом із тостом за
// кілька секунд — а саме слід є тим тривалим, до чого людина повертається.
// Тест іде через межу з API: мок /v1/cards/c1/apply віддає частковий
// результат, і перевіряється те, що видно в сліді після закриття тосту.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';
import { usePanelStore } from '../../store/panel';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let waiting: { resolve: (body: unknown) => void }[];

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

// Картка комори на 14 рядків — щоб «із 14» було звідки взяти.
// Чек із чату: саме цей шлях PLAN §4 описує як «чекає рішення · N →
// Застосувати N із M». Картка з чату без джерела кнопки в тілі не має.
const intake = {
  type: 'intake_diff',
  source: { kind: 'chat_receipt', at: '2026-09-08T09:00:00.000Z', nonfood: [], unmatched: [] },
  ops: Array.from({ length: 14 }, (_, i) => ({ op: 'add', label: `Позиція ${i + 1}`, value: 1, unit: 'pcs', zone: 'dry' })),
};

function installFetch(applyResult: unknown) {
  waiting = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/chat') return new Promise((resolve) => { waiting.push({ resolve: (b) => resolve(json(b)) }); });
    if (url === '/v1/cards/c1/apply') return json(applyResult);
    if (url === '/v1/pantry') return json({ count: 0, batches: [], products: [] });
    if (url === '/v1/shopping') return json({ count: 0, items: [] });
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-08T06:00:00Z' }, messages: [] });
    return json({});
  }));
}

const q = <T extends Element>(sel: string) => host!.querySelector<T>(sel);
// Картка приходить згорнутою — «Потрібне твоє підтвердження» розгортає її.
const expand = async () => {
  const head = [...host!.querySelectorAll('button')].find((b) => /підтвердження/.test(b.textContent ?? ''));
  if (head) await act(async () => { head.click(); });
};
// Кнопка картки комори — «Застосувати N» (число позицій у тексті), тому
// шукаємо за початком, не за точним збігом.
const applyButton = () =>
  [...host!.querySelectorAll('button')].find((b) => /^Застосувати/.test(b.textContent?.trim() ?? ''));

async function mountAndGetCard() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Feed /></MemoryRouter>); });
  const el = q<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, 'купив усе за списком');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { q<HTMLButtonElement>('button[type="submit"]')!.click(); });
  await act(async () => { waiting[0]!.resolve({ reply: 'Записати в комору?', card: intake, card_id: 'c1' }); });
}

beforeEach(() => {
  vi.useRealTimers();
  usePanelStore.setState({ artifacts: [], freshKeys: [], active: null, lastManualPick: 0, hidden: false, fresh: false });
  vi.stubGlobal('matchMedia', (m: string) => ({ matches: true, media: m, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

describe('частковий успіх — у сліді, не лише в тості', () => {
  it('9 із 14, 5 пропущено — слід це каже після застосування', async () => {
    installFetch({ applied: 9, undo_token: 'u1', already: false, missed: ['a', 'b', 'c', 'd', 'e'] });
    await mountAndGetCard();
    // Один слід, два моменти. ДО — бурштин і те саме число, що потім буде «із 14».
    const before = host!.querySelector('[data-trace-tone]');
    expect(before?.getAttribute('data-trace-tone')).toBe('pending');
    expect(host!.textContent).toContain('ОЧІКУЄ · 14');
    await expand();
    const apply = applyButton();
    expect(apply, 'кнопка застосування на картці').toBeTruthy();
    await act(async () => { apply!.click(); });
    // Слід — мітка над карткою. Читаємо весь текст ходу: слово має бути там,
    // а не в тості, який зникне.
    const text = host!.textContent ?? '';
    expect(text).toContain('9 із 14');
    expect(text).toContain('5 пропущено');
    // ПІСЛЯ — той самий елемент сліду, інший тон. Не два компоненти.
    const after = host!.querySelector('[data-trace-tone]');
    expect(after?.getAttribute('data-trace-tone')).toBe('applied');
    expect(host!.querySelectorAll('[data-trace-tone]').length).toBe(1);
  });

  it('усе влучило — чисел у сліді немає', async () => {
    installFetch({ applied: 14, undo_token: 'u1', already: false });
    await mountAndGetCard();
    await expand();
    await act(async () => { applyButton()!.click(); });
    expect(host!.textContent).not.toContain(' із 14');
  });
});
