// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ProfileV2 } from './ProfileV2';
import { pickProfilePage } from './ProfileRoute';
import type { ProfileV2Response } from '../../api';
import { PROFILE_FIELDS } from '@kitchen/domain/profile-fields';

// Раунд 4, крок 6 (§8): сім рядків з даними, PATCH по blur, ліміт блокує
// ввід, нотатка прибирається і повертається, стара сторінка — без прапора.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const field = (text: string, status: 'empty' | 'filled' | 'none' = text ? 'filled' : 'empty') =>
  ({ text, status, updated_at: text ? '2026-09-05T00:00:00.000Z' : null });

const initial = (): ProfileV2Response => ({
  fields: {
    name: field('Пилип'), no: field('мʼяса й птиці'), ban: field('', 'none'), love: field('супи'),
    meh: field(''), kit: field('гриль'), when: field('ввечері'),
  },
  notes: [
    { id: 'n1', text: 'Духовка гріє на 20 сильніше', source: 'assistant', created_at: '2026-09-02T10:00:00.000Z' },
    { id: 'n2', text: 'Пармезан солоний — воду солити менше', source: 'user', created_at: '2026-09-04T10:00:00.000Z' },
  ],
  defaults: { kit: ['плита', 'духовка', 'мікрохвильовка', 'холодильник'] },
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

function installFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/v1/retail') return json({ silpo: { status: 'unavailable' } });
    if (url.startsWith('/v1/profile/notes/') && method === 'DELETE') return new Response(null, { status: 204 });
    if (url.startsWith('/v1/profile/notes/') && method === 'POST') return json({ note: { id: 'n1', text: 'x', source: 'assistant', created_at: '2026-09-02T10:00:00.000Z' } });
    if (url.startsWith('/v1/profile/') && method === 'PATCH') {
      const text = String(body?.text ?? '');
      return json({ field: { text, status: text ? 'filled' : 'empty', updated_at: '2026-09-05T00:00:00.000Z' }, veto_index: [] });
    }
    return json({ error: 'unexpected' }, 500);
  }));
}

async function mount(data = initial()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<MemoryRouter><ProfileV2 initial={data} /></MemoryRouter>); });
}

const edit = (k: string) => host.querySelector<HTMLSpanElement>(`[data-row="${k}"] [contenteditable]`)!;
const fire = (el: Element, type: string, init: EventInit = {}) => el.dispatchEvent(new Event(type, { bubbles: true, ...init }));

beforeEach(installFetch);
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Профіль v6', () => {
  it('рендерить сім рядків: початок речення з домену, текст із даних, «Мені не можна» — нічого такого', async () => {
    await mount();
    const rows = host.querySelectorAll('[data-row]');
    expect(rows).toHaveLength(7);
    for (const k of ['name', 'no', 'ban', 'love', 'meh', 'kit', 'when'] as const) {
      expect(host.querySelector(`[data-row="${k}"]`)!.textContent).toContain(PROFILE_FIELDS[k].lead);
    }
    expect(edit('no').textContent).toBe('мʼяса й птиці');
    expect(edit('meh').textContent).toBe('');
    expect(edit('meh').getAttribute('data-ph')).toBe('дуже гостре, багато мʼяса, довго готувати');
    expect(host.textContent).toContain('Профіль');
    expect(host.textContent).toContain('Нотатки');
    expect(host.textContent).toContain('Акаунт');
    expect(host.textContent).toContain('Тариф');
  });

  it('PATCH /v1/profile/:key по blur, якщо текст змінився; без зміни — нічого', async () => {
    await mount();
    const el = edit('love');
    await act(async () => { el.focus(); fire(el, 'focusin'); });
    await act(async () => { fire(el, 'focusout'); });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    await act(async () => { el.textContent = 'супи, тайську кухню'; fire(el, 'input'); });
    await act(async () => { fire(el, 'focusout'); });
    const patch = calls.filter((c) => c.method === 'PATCH');
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({ url: '/v1/profile/love', body: { text: 'супи, тайську кухню' } });
  });

  it('пауза 800 мс теж зберігає; помилка → тост і один повтор', async () => {
    vi.useFakeTimers();
    await mount();
    const el = edit('when');
    await act(async () => { el.textContent = 'вранці'; fire(el, 'input'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(850); });
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.url)).toEqual(['/v1/profile/when']);

    // Помилка мережі: тост «Не збереглось. Спробую ще» і повтор через 1,5 с.
    (fetch as unknown as { mockImplementationOnce: (f: () => Promise<Response>) => void })
      .mockImplementationOnce(async () => new Response('{"error":"boom"}', { status: 500 }));
    await act(async () => { el.textContent = 'вранці, на двох'; fire(el, 'input'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(850); });
    expect(host.textContent).toContain('Не збереглось. Спробую ще');
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    // Відповідь мок-fetch читається асинхронно — дати мікротаскам дожити.
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    // Невдалий виклик іде через mockImplementationOnce і в `calls` не пишеться:
    // перший успішний + повтор після помилки = 2, а зникнення тосту нижче
    // доводить, що повтор пройшов.
    const patches = calls.filter((c) => c.method === 'PATCH' && c.url === '/v1/profile/when');
    expect(patches).toHaveLength(2);
    expect(patches[1]!.body).toEqual({ text: 'вранці, на двох' });
    expect(host.textContent).not.toContain('Не збереглось');
  });

  it('ліміт: на межі друкований символ блокується, лічильник показує текст ліміту', async () => {
    await mount();
    const el = edit('name');
    await act(async () => { el.textContent = 'П'.repeat(30); fire(el, 'input'); el.focus(); fire(el, 'focusin'); });
    const ev = new KeyboardEvent('keydown', { key: 'а', bubbles: true, cancelable: true });
    await act(async () => { el.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    const counter = host.querySelector('[data-counter="name"]')!;
    expect(counter.textContent).toBe('Все сюди вже не влізе. Лишімо головне.');
    expect((counter as HTMLElement).style.opacity).toBe('1');

    // Нижче ліміту — не блокується, лічильник n/max.
    await act(async () => { el.textContent = 'Пилип'; fire(el, 'input'); });
    const ev2 = new KeyboardEvent('keydown', { key: 'а', bubbles: true, cancelable: true });
    await act(async () => { el.dispatchEvent(ev2); });
    expect(ev2.defaultPrevented).toBe(false);
    expect(host.querySelector('[data-counter="name"]')!.textContent).toBe('5/30');
  });

  it('Enter — blur, без нового рядка', async () => {
    await mount();
    const el = edit('kit');
    const blur = vi.spyOn(el, 'blur');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => { el.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(blur).toHaveBeenCalled();
  });

  it('нотатка: «прибрати» → DELETE і тост «Прибрано. Повернути»; «Повернути» → restore і рядок на місці', async () => {
    await mount();
    expect(host.querySelectorAll('[data-note]')).toHaveLength(2);
    const remove = host.querySelector<HTMLButtonElement>('[data-note="n1"] button')!;
    await act(async () => { remove.click(); });
    expect(host.querySelectorAll('[data-note]')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/v1/profile/notes/n1');
    expect(host.textContent).toContain('Прибрано.');
    const restore = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Повернути')!;
    await act(async () => { restore.click(); });
    expect(host.querySelectorAll('[data-note]')).toHaveLength(2);
    expect(host.querySelector('[data-note="n1"]')).not.toBeNull();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/restore'))?.url).toBe('/v1/profile/notes/n1/restore');
    expect(host.textContent).not.toContain('Прибрано.');
  });

  it('порожні нотатки — «Поки порожньо. Дай духовці трохи часу.»', async () => {
    await mount({ ...initial(), notes: [] });
    expect(host.textContent).toContain('Поки порожньо. Дай духовці трохи часу.');
  });
});

describe('вибір сторінки', () => {
  it('відповідь без fields (прапор вимкнено) → стара сторінка; з fields → v6', () => {
    expect(pickProfilePage({ profile: { allergies: [], wishes: [], antipatterns: [], equipment: {} } as never, notes: [], eaters: [] })).toBe('v1');
    expect(pickProfilePage(initial())).toBe('v2');
  });
});
