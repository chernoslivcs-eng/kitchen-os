// @vitest-environment jsdom
//
// 14.09 (рішення власника, відгук тестувальниці): пілюля розмови (назва
// сесії, №22) знята з шапки чату повністю — на будь-якій ширині. Цей файл
// вартує саме це: незалежно від форми (`wide`/`mid`/`narrow`) пілюлі в DOM
// немає, а решта шапки (панель, «+ Нова», чіпи) лишається на місці.

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
    onNewSession: () => {},
    onAllSessions: () => {},
    onCook: () => {},
    onOverdue: () => {},
    onHome: () => {},
    homeOpen: false,
    quietCount: 0,
    pendingCount: 0,
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

  it('панель (кнопка «Розгорнути панель») і «+ Нова» лишаються в розмітці', async () => {
    await mount(form);
    expect(host!.querySelector('[aria-label="Розгорнути панель"]')).not.toBeNull();
    expect(host!.querySelector('[data-new-session]')).not.toBeNull();
  });

  it('чіп «Дім зараз» лишається', async () => {
    await mount(form);
    expect(host!.querySelector('[data-chip-home]')).not.toBeNull();
  });
});
