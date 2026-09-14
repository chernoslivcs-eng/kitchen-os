// @vitest-environment jsdom
//
// 14.09 (рішення власника, відгук тестувальниці): шапка чату розчищена
// повністю, на будь-якій ширині (`wide`/`mid`/`narrow`) — пілюля розмови
// (назва сесії, №22), «+ Нова» (дублювала сайдбар/шухляду) і чіп «Чекають
// на тебе · N» (§11 від 12.09) зняті. Того самого дня (пізніше, окрема
// правка): чіп дому стиснуто до «⌂ · N» — лише знак і число активних
// станів, той самий вигляд на всіх ширинах, без слів і без числа при нулі
// станів. Цей файл вартує все це разом: жодного з трьох знятих елементів
// у DOM немає, чіп дому — компактний скрізь, решта шапки (панель, чіпи
// стану) лишається на місці.

import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatHead, type ChatHeadProps } from './ChatHead';
import type { HomeNow } from '../../store/homeNow';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calmHome: HomeNow = { facts: null, overdue: 0, burning: [], now: [], strict: null, shopping: null };
const busyHome: HomeNow = { facts: null, overdue: 2, burning: [], now: [], strict: null, shopping: null };

function baseProps(form: ChatHeadProps['form'], home: HomeNow = calmHome): ChatHeadProps {
  return {
    home,
    cookLive: null,
    onAllSessions: () => {},
    onCook: () => {},
    onOverdue: () => {},
    onHome: () => {},
    homeOpen: false,
    form,
  };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(form: ChatHeadProps['form'], home?: HomeNow) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ChatHead {...baseProps(form, home)} />); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

describe.each(['wide', 'mid', 'narrow'] as const)('ChatHead, форма %s', (form) => {
  it('пілюлі сесії нема', async () => {
    await mount(form);
    expect(host!.querySelector('[data-session-pill]')).toBeNull();
    expect(host!.textContent).not.toContain('Нова розмова');
  });

  it('«+ Нова» нема — нова розмова лише в сайдбарі/шухляді', async () => {
    await mount(form);
    expect(host!.querySelector('[data-new-session]')).toBeNull();
    expect(host!.textContent).not.toContain('Нова');
  });

  it('чіп «Чекають на тебе» нема, навіть якщо був би рахунок', async () => {
    await mount(form);
    expect(host!.querySelector('[data-chip-pending]')).toBeNull();
    expect(host!.textContent).not.toContain('Чекають на тебе');
  });

  it('панель (кнопка «Розгорнути панель») лишається в розмітці', async () => {
    await mount(form);
    expect(host!.querySelector('[aria-label="Розгорнути панель"]')).not.toBeNull();
  });

  it('чіп дому — лише знак, без числа, коли нема активних станів; без слів «Дім»/«зараз»/«ще»/«тихо»', async () => {
    await mount(form, calmHome);
    const chip = host!.querySelector('[data-chip-home]')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('');
    for (const word of ['Дім', 'зараз', 'ще', 'тихо']) expect(host!.textContent).not.toContain(word);
  });

  it('чіп дому — знак і число, коли є активний стан (той самий вигляд на всіх формах)', async () => {
    await mount(form, busyHome);
    const chip = host!.querySelector('[data-chip-home]')!;
    expect(chip.textContent!.trim()).toBe('· 1');
  });
});

// 14.09 (власник): «?» — круглий чіп праворуч, після «Дім», на всіх формах;
// окремий елемент, щоб не перетинатись із правками самого чіпа «Дім».
describe('«?» довідка', () => {
  for (const form of ['wide', 'mid', 'narrow'] as const) {
    it(`є на ${form}, aria «Довідка», стоїть після чіпа «Дім», тап → onHelp`, async () => {
      let hit = 0;
      host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
      await act(async () => { root!.render(<ChatHead {...baseProps(form)} onHelp={() => { hit += 1; }} helpOpen={false} />); });
      const btn = host!.querySelector<HTMLButtonElement>('[data-chip-help]')!;
      expect(btn.getAttribute('aria-label')).toBe('Довідка');
      expect(btn.previousElementSibling?.hasAttribute('data-chip-home')).toBe(true);
      await act(async () => { btn.click(); });
      expect(hit).toBe(1);
    });
  }
});
