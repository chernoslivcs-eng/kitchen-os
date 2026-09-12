// @vitest-environment jsdom
//
// В4 (Р120): на <704 артефакт живе чіпом у шапці — знак роду + число, коли
// артефактів більше одного; active, поки шторка відкрита; нема артефактів —
// нема чіпа. Тап — та сама дія, що була в пілюлі над композитором.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatHead, type ChatHeadProps } from './ChatHead';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); root = undefined; });

const base: ChatHeadProps = {
  title: 'Вечеря', when: 'сьогодні',
  home: { overdue: 0, strict: null, soon: 0, cooking: null, quiet: [] } as unknown as ChatHeadProps['home'],
  cookLive: null, onNewSession: () => {}, onAllSessions: () => {}, onCook: () => {}, onOverdue: () => {},
  onHome: () => {}, homeOpen: false, quietCount: 0, form: 'narrow',
};
async function mount(props: Partial<ChatHeadProps>) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<ChatHead {...base} {...props} />); });
  return host;
}

describe('В4 · чіп артефакта в шапці', () => {
  it('без артефактів чіпа нема', async () => {
    const h = await mount({});
    expect(h.querySelector('[data-chip-artifact]')).toBeNull();
  });
  it('один артефакт — знак без числа; тап — onOpen', async () => {
    const onOpen = vi.fn();
    const h = await mount({ artifact: { kind: 'cart', count: 1, open: false, onOpen } });
    const chip = h.querySelector<HTMLButtonElement>('[data-chip-artifact]')!;
    expect(chip).toBeTruthy();
    expect(chip.querySelector('[data-icon]')).toBeTruthy();
    expect(chip.textContent?.trim()).toBe('');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.hasAttribute('data-tap'), 'хіт 44').toBe(true);
    await act(async () => { chip.click(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it('кілька артефактів — число; відкрита шторка — active', async () => {
    const h = await mount({ artifact: { kind: 'recipe', count: 3, open: true, onOpen: () => {} } });
    const chip = h.querySelector<HTMLButtonElement>('[data-chip-artifact]')!;
    expect(chip.textContent?.trim()).toBe('3');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.className).toMatch(/chip-active/);
  });
});
