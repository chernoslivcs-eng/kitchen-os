// @vitest-environment jsdom
//
// 14.09 (рішення власника, відгук тестувальниці): шапка чату розчищена
// повністю, на будь-якій ширині (`wide`/`mid`/`narrow`) — пілюля розмови
// (назва сесії, №22), «+ Нова» (дублювала сайдбар/шухляду) і чіп «Чекають
// на тебе · N» (§11 від 12.09) зняті. Цей файл вартує саме це: жодного з
// трьох елементів у DOM немає, решта шапки (панель, чіпи стану, «Дім
// зараз») лишається на місці.

import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatHead, type ChatHeadProps } from './ChatHead';
import type { HomeNow } from '../../store/homeNow';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const home: HomeNow = { facts: null, overdue: 0, burning: [], now: [], strict: null, shopping: null };

function baseProps(form: ChatHeadProps['form']): ChatHeadProps {
  return {
    home,
    cookLive: null,
    onAllSessions: () => {},
    onCook: () => {},
    onOverdue: () => {},
    onHome: () => {},
    homeOpen: false,
    quietCount: 0,
    form,
  };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(form: ChatHeadProps['form']) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ChatHead {...baseProps(form)} />); });
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

  it('чіп «Дім зараз» лишається', async () => {
    await mount(form);
    expect(host!.querySelector('[data-chip-home]')).not.toBeNull();
  });
});
