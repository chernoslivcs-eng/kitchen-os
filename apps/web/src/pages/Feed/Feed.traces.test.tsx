// @vitest-environment jsdom
//
// Сліди у стрічці: чек, списання і застосований список покупок.
//
// Тіло цих карток у стрічці приховане — `.artifact-in-feed { display: none }`
// (Feed.module.css). Отже слід і Є їхнє єдине видиме представлення: без нього
// застосована картка не показує в стрічці НІЧОГО. Для списання це особливо
// різко — воно свідомо не стає артефактом («сталась і минула», artifacts.ts),
// тож рядка «Використали: …» ніщо не заміняє.
//
// Тесту на це не існувало, і П5 вирізав усі три блоки побічно, разом зі
// слідом традицій, який стояв поруч і йшов під ніж разом із родиною
// `profile`. 1651 зелений тест цього не помітив — саме тому файл існує.
//
// Перевіряється СТРУКТУРА, а не textContent усього хоста: `display: none`
// у jsdom тексту не ховає, тож `textContent` показав би й приховане тіло
// картки, і слід зник би непомітно ще раз.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';
import { usePanelStore } from '../../store/panel';
import styles from './Feed.module.css';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let waiting: { resolve: (body: unknown) => void }[];

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

function installFetch(shopping: { count: number; items: unknown[] } = { count: 0, items: [] }) {
  waiting = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/chat') return new Promise((resolve) => { waiting.push({ resolve: (b) => resolve(json(b)) }); });
    if (url === '/v1/pantry') return json({ count: 0, batches: [], products: [] });
    if (url === '/v1/shopping') return json(shopping);
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-08T06:00:00Z' }, messages: [] });
    return json({});
  }));
}

/** Один хід: людина написала — сервер відповів карткою, застосованою одразу. */
async function feedWith(card: unknown) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter><Feed /></MemoryRouter>); });

  const el = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, 'ось чек');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { host!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
  await act(async () => {
    waiting[0]!.resolve({ reply: 'Готово.', card, card_id: 'c1', auto_applied: true, undo_token: 'u1' });
  });
}

const traces = () => [...host!.querySelectorAll(`.${styles.trace}`)];
const traceText = () => traces().map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' | ');

beforeEach(() => {
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

describe('слід у стрічці — єдине видиме представлення прихованої картки', () => {
  it('чек: слід із родом і кількістю рядків, зі стрілкою в панель', async () => {
    installFetch();
    await feedWith({
      type: 'intake_diff',
      source: { kind: 'chat_receipt' },
      ops: [{ op: 'add', label: 'молоко' }, { op: 'add', label: 'хліб' }, { op: 'add', label: 'сіль' }],
    });

    expect(traces()).toHaveLength(1);
    // «Чек», бо source.kind — чековий; без нього було б «У комору». Етап 6b:
    // слова етапу 3 звичайним регістром, форма — пігулка бандла зі знаком.
    expect(traceText()).toContain('Чек');
    expect(traceText()).toContain('3');
    expect(traceText()).toContain('позиції');
    expect(host!.querySelector(`.${styles['trace-icon']} svg`)).toBeTruthy();
    // Стрілка — обіцянка, що слід кудись веде (вкладка «Чек» у панелі).
    expect(host!.querySelector(`.${styles['trace-go']}`)).toBeTruthy();
  });

  it('списання: рядок «Використали: …» з назвами — іншого сліду в нього немає', async () => {
    installFetch();
    await feedWith({
      type: 'intake_diff',
      ops: [{ op: 'deplete', label: 'томати' }, { op: 'deplete', label: 'цибуля' }],
    });

    const line = host!.querySelector(`.${styles['writeoff-line']}`);
    expect(line).toBeTruthy();
    expect(line!.textContent).toContain('Використали');
    expect(line!.textContent).toContain('томати');
    expect(line!.textContent).toContain('цибуля');
    // Списання артефактом не стає — стрілки в порожнечу тут бути не має.
    expect(traces()).toHaveLength(0);
  });

  it('застосований список покупок: слід із «Список» і кнопкою СКАСУВАТИ', async () => {
    installFetch({ count: 2, items: [{ id: 'i1', label: 'олія' }, { id: 'i2', label: 'рис' }] });
    await feedWith({ type: 'shopping', items: [{ op: 'add', label: 'олія' }, { op: 'add', label: 'рис' }] });

    expect(traces()).toHaveLength(1);
    expect(traceText()).toContain('Список');
    // Скасування живе на самому сліді, не лише в тості, який уже згас.
    const undo = host!.querySelector(`.${styles['trace-undo']}`);
    expect(undo).toBeTruthy();
    expect(undo!.textContent).toContain('СКАСУВАТИ');
  });
});
