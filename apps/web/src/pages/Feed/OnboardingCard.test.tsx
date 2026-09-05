// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OnboardingCard, panelState, firstOpenPanel } from './OnboardingCard';
import type { ChatCard, ProfileFieldV2 } from '../../api';

// Крок 7 (7): карусель «Про тебе» — стани панелей із profile_text і пропусків,
// «Записати» → PATCH і перехід, «Нічого такого» → none, фраза в чаті
// (оновлені props) позначає панель, перезавантаження стартує з першої відкритої.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const f = (text = '', status: ProfileFieldV2['status'] = text ? 'filled' : 'empty'): ProfileFieldV2 => ({ text, status, updated_at: null });
const empty = (): Record<string, ProfileFieldV2> => ({ name: f(), no: f(), ban: f(), love: f(), meh: f(), kit: f(), when: f() });

let calls: { url: string; method: string; body: unknown }[];
let root: Root | undefined; let host: HTMLDivElement | undefined;
function installFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/v1/profile/')) {
      const text = body?.text ?? '';
      return json({ field: { text, status: body?.status === 'none' ? 'none' : text ? 'filled' : 'empty', updated_at: null }, veto_index: [] });
    }
    if (url.startsWith('/v1/onboarding/')) return json({ card: { type: 'onboarding', skipped: [body.skip] } });
    return json({});
  }));
}
async function mount(props: Partial<Parameters<typeof OnboardingCard>[0]> = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const card: ChatCard = { type: 'onboarding', ...(props.card ?? {}) } as ChatCard;
  await act(async () => { root!.render(<OnboardingCard card={card} cardId="m1" profileFields={empty()} {...props} />); });
}
const panel = () => host!.querySelector<HTMLElement>('[data-panel]')!;
const btn = (label: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;

beforeEach(installFetch);
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

describe('panelState / firstOpenPanel', () => {
  it('filled/none — з profile_text, skipped — з картки, інакше empty; старт — перша відкрита', () => {
    const fields = { ...empty(), name: f('Пилип'), ban: f('', 'none') };
    expect(panelState('name', fields, [])).toBe('filled');
    expect(panelState('ban', fields, [])).toBe('none');
    expect(panelState('no', fields, ['no'])).toBe('skipped');
    expect(panelState('love', fields, [])).toBe('empty');
    expect(firstOpenPanel(fields, ['no'])).toBe(3); // name, no, ban зайняті → love
    expect(firstOpenPanel({ ...empty(), name: f('a'), no: f('b'), ban: f('c'), love: f('d'), meh: f('e'), kit: f('g'), when: f('h') }, [])).toBe(7);
  });
});

describe('картка «Про тебе»', () => {
  it('рендерить першу панель: крок, заголовок і початок речення з дизайну, лічильник', async () => {
    await mount();
    expect(panel().dataset.panel).toBe('name');
    expect(host!.textContent).toContain('1 / 7');
    expect(host!.textContent).toContain('Як тебе звати');
    expect(host!.textContent).toContain('Мене звати');
    expect(host!.querySelector('[data-counter]')!.textContent).toBe('0/30');
    expect(btn('Записати').disabled).toBe(true);
    expect(btn('Пропустити')).toBeTruthy();
  });

  it('«Записати» → PATCH /v1/profile/name і перехід на наступну відкриту панель', async () => {
    await mount();
    const edit = host!.querySelector<HTMLSpanElement>('[contenteditable]')!;
    await act(async () => { edit.textContent = 'Пилип'; edit.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(btn('Записати').disabled).toBe(false);
    await act(async () => { btn('Записати').click(); });
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/v1/profile/name', body: { text: 'Пилип' } });
    expect(panel().dataset.panel).toBe('no');
  });

  it('«Пропустити» → PATCH /v1/onboarding/:id {skip} і перехід; панель пропущена при поверненні', async () => {
    await mount();
    await act(async () => { btn('Пропустити').click(); });
    expect(calls.find((c) => c.url === '/v1/onboarding/m1')).toMatchObject({ method: 'PATCH', body: { skip: 'name' } });
    expect(panel().dataset.panel).toBe('no');
    await act(async () => { btn('Назад').click(); });
    expect(panel().dataset.state).toBe('skipped');
    expect(host!.querySelector('[data-meta]')!.textContent).toBe('ПРОПУЩЕНО');
  });

  it('на панелі ban — «Нічого такого» → PATCH {status:none}', async () => {
    await mount({ profileFields: { ...empty(), name: f('Пилип'), no: f('мʼяса') } });
    expect(panel().dataset.panel).toBe('ban');
    await act(async () => { btn('Нічого такого').click(); });
    expect(calls.find((c) => c.url === '/v1/profile/ban')).toMatchObject({ method: 'PATCH', body: { status: 'none' } });
    expect(panel().dataset.panel).toBe('love');
  });

  it('фраза в чаті заповнила поле → нові props позначають панель ЗАПИСАНО з текстом', async () => {
    await mount();
    await act(async () => {
      root!.render(<OnboardingCard card={{ type: 'onboarding' } as ChatCard} cardId="m1" profileFields={{ ...empty(), name: f('Семен') }} />);
    });
    await act(async () => { btn('Назад').click(); btn('Назад').click(); });
    // Ми на панелі name (індекс не міняли: старт був 0)
    expect(panel().dataset.panel).toBe('name');
    expect(panel().dataset.state).toBe('filled');
    expect(host!.querySelector('[data-meta]')!.textContent).toBe('ЗАПИСАНО');
    expect(host!.querySelector<HTMLSpanElement>('[contenteditable]')!.textContent).toBe('Семен');
  });

  it('перезавантаження: стан з profile_text і skipped → стартує з першої відкритої; усе закрито → «Готово»', async () => {
    await mount({ card: { type: 'onboarding', skipped: ['love'] } as ChatCard, profileFields: { ...empty(), name: f('a'), no: f('b'), ban: f('', 'none') } });
    expect(panel().dataset.panel).toBe('meh');
    await act(async () => { root!.unmount(); });
    host!.remove();
    await mount({ card: { type: 'onboarding', skipped: ['love', 'meh', 'kit', 'when'] } as ChatCard, profileFields: { ...empty(), name: f('a'), no: f('b'), ban: f('', 'none') } });
    expect(panel().dataset.panel).toBe('done');
    expect(host!.textContent).toContain('Записав 2 із семи');
    expect(btn('Показати, що вийшло')).toBeTruthy();
  });

  it('9а(1): клік по будь-якому місцю рядка-речення ставить фокус у закінчення', async () => {
    await mount();
    const row = host!.querySelector<HTMLElement>('[data-row-click]')!;
    const edit = host!.querySelector<HTMLSpanElement>('[contenteditable]')!;
    await act(async () => { row.click(); });
    expect(document.activeElement).toBe(edit);
  });

  it('9а(4): рядок мети присутній на кожній панелі, щоб кнопки не стрибали', async () => {
    await mount();
    expect(host!.querySelector('[class*="meta"]')).not.toBeNull();
  });

  it('ліміт: на межі друкований символ блокується, лічильник показує текст ліміту', async () => {
    await mount();
    const edit = host!.querySelector<HTMLSpanElement>('[contenteditable]')!;
    await act(async () => { edit.textContent = 'П'.repeat(30); edit.dispatchEvent(new Event('input', { bubbles: true })); });
    const ev = new KeyboardEvent('keydown', { key: 'а', bubbles: true, cancelable: true });
    await act(async () => { edit.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(host!.querySelector('[data-counter]')!.textContent).toBe('Все сюди вже не влізе. Лишімо головне.');
  });
});
