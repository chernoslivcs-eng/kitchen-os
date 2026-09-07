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
    // О2 (1.3): «Пропустити» стало «Далі», плюс з'явився «Назад».
    expect(btn('Далі')).toBeTruthy();
    expect(btn('Назад').disabled).toBe(true);   // на першій панелі — приглушений
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

  it('«Далі» на ПОРОЖНІЙ панелі → PATCH /v1/onboarding/:id {skip} і перехід; панель пропущена при поверненні', async () => {
    await mount();
    await act(async () => { btn('Далі').click(); });
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

// --- Крок О2 --------------------------------------------------------------

describe('О2: картка «Про тебе»', () => {
  it('(1.3) ряд читається як речення: Назад · Далі · Записати, головне праворуч', async () => {
    await mount();
    const labels = [...host!.querySelectorAll('[class*="actions"] button')].map((b) => b.textContent);
    expect(labels).toEqual(['Назад', 'Далі', 'Записати']);
  });

  it('(1.4) стрілок ← → більше немає, лічильник унизу лишився', async () => {
    await mount();
    const arrows = [...host!.querySelectorAll('button')].filter((b) => b.textContent === '←' || b.textContent === '→');
    expect(arrows).toEqual([]);
    expect(host!.querySelector('[class*="progress"]')!.textContent).toBe('1 / 7');
  });

  it('(2.1) «Далі» на ЗАПОВНЕНІЙ панелі нічого не пише — просто перехід', async () => {
    // Людина вирішила перечитати свої відповіді: жодна з них не має
    // перетворитись на пропуск дорогою.
    await mount({ profileFields: { ...empty(), name: f('Пилип') } });
    await act(async () => { btn('Назад').click(); });
    expect(panel().dataset.panel).toBe('name');
    expect(panel().dataset.state).toBe('filled');

    calls.length = 0;
    await act(async () => { btn('Далі').click(); });
    expect(calls).toEqual([]);            // ні skip, ні PATCH
    expect(panel().dataset.panel).toBe('no');

    await act(async () => { btn('Назад').click(); });
    expect(host!.querySelector('[data-meta]')!.textContent).toBe('ЗАПИСАНО');
  });

  it('(2.1) «Далі» на ПОРОЖНІЙ панелі пише пропуск', async () => {
    await mount();
    await act(async () => { btn('Далі').click(); });
    expect(calls.find((c) => c.url === '/v1/onboarding/m1')).toMatchObject({ body: { skip: 'name' } });
  });

  it('(2.1) «Нічого такого» на вже відповіданій панелі алергій теж мовчить', async () => {
    await mount({ profileFields: { ...empty(), name: f('a'), no: f('b'), ban: f('', 'none') } });
    await act(async () => { btn('Назад').click(); });
    expect(panel().dataset.panel).toBe('ban');
    calls.length = 0;
    await act(async () => { btn('Нічого такого').click(); });
    expect(calls).toEqual([]);
    expect(panel().dataset.panel).toBe('love');
  });

  it('(2.3) поля приїхали пізніше — картка перескакує на «Готово», а не лишається на 1/7', async () => {
    // Стрічка тягне profile_text асинхронно: на першому рендері полів немає.
    await mount({ profileFields: null, card: { type: 'onboarding', skipped: [] } as ChatCard });
    expect(panel().dataset.panel).toBe('name');
    const all = { ...empty(), name: f('a'), no: f('b'), ban: f('c'), love: f('d'), meh: f('e'), kit: f('g'), when: f('h') };
    await act(async () => {
      root!.render(<OnboardingCard card={{ type: 'onboarding' } as ChatCard} cardId="m1" profileFields={all} />);
    });
    expect(panel().dataset.panel).toBe('done');
  });

  it('(2.3) якщо людина вже гортає сама — перерахунок мовчить', async () => {
    await mount({ profileFields: null, card: { type: 'onboarding', skipped: [] } as ChatCard });
    await act(async () => { btn('Далі').click(); });          // пішла вручну
    expect(panel().dataset.panel).toBe('no');
    const all = { ...empty(), name: f('a'), no: f('b'), ban: f('c'), love: f('d'), meh: f('e'), kit: f('g'), when: f('h') };
    await act(async () => {
      root!.render(<OnboardingCard card={{ type: 'onboarding' } as ChatCard} cardId="m1" profileFields={all} />);
    });
    // Лишились там, де стояли: перебивати ручне гортання ми не маємо права.
    expect(panel().dataset.panel).toBe('no');
  });

  it('(1.6) довгий текст лишається всередині свого блоку, а лінія — під ним', async () => {
    await mount();
    const box = host!.querySelector<HTMLElement>('[data-field-text]')!;
    const edit = host!.querySelector<HTMLSpanElement>('[contenteditable]')!;
    const counter = host!.querySelector<HTMLElement>('[data-counter]')!;

    await act(async () => {
      edit.textContent = 'дуже довгий текст, '.repeat(12);
      edit.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Текст живе В блоці, що має лінію (border-bottom у .fieldText) — тому
    // лінія завжди під ним. Раніше лінія стояла на самому .edit і при
    // переносі перекреслювала рядок посередині.
    expect(box.contains(edit)).toBe(true);
    // Лічильник — ПОЗА блоком тексту, у потоці під ним: інакше він накриває
    // текст, коли той доріс до низу.
    expect(box.contains(counter)).toBe(false);
    expect(box.nextElementSibling!.contains(counter)).toBe(true);
    // Підказка лишилась над рядком і текст на неї не поліз.
    const copy = host!.querySelector<HTMLElement>('[class*="copy"]')!;
    expect(copy.contains(edit)).toBe(false);
  });

  it('(1.5) «Готово» тримає те саме вільне місце, що й панелі', async () => {
    const all = { ...empty(), name: f('a'), no: f('b'), ban: f('c'), love: f('d'), meh: f('e'), kit: f('g'), when: f('h') };
    await mount({ profileFields: all });
    expect(panel().dataset.panel).toBe('done');
    // Порожній блок тієї самої висоти — інакше кнопка «Показати, що вийшло»
    // стрибнула б угору відносно решти панелей.
    expect(host!.querySelector('[class*="spacer"]')).not.toBeNull();
    expect([...host!.querySelectorAll('[class*="actions"] button')].map((b) => b.textContent))
      .toEqual(['Назад', 'Показати, що вийшло']);
  });
});


describe('Крок А1: події картки', () => {
  // Картка живе в СТРІЧЦІ й перемальовується на кожному її відкритті. Наївна
  // подія «на монтування» писала б «почав» і «закінчив» щоразу, коли людина
  // просто прогорнула стрічку вгору — і стовпчик, за яким ми збираємось
  // рахувати проходження, показував би нашу перемальовку, а не її шлях.
  const filled = (): Record<string, ProfileFieldV2> =>
    Object.fromEntries(['name', 'no', 'ban', 'love', 'meh', 'kit', 'when'].map((k) => [k, f('щось')]));

  const sent = () => calls.filter((c) => c.url === '/v1/events/track')
    .flatMap((c) => (c.body as { events: { name: string; props?: Record<string, unknown> }[] }).events);

  async function flushEvents() {
    // Черга шле пачкою раз на 10 с — женемо таймер, щоб побачити, що доїхало.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    const { __resetTracking, startTracking } = await import('../../lib/track');
    __resetTracking();
    startTracking();
  });
  afterEach(async () => {
    const { __resetTracking } = await import('../../lib/track');
    __resetTracking();
    vi.useRealTimers();
  });

  it('свіжа картка пише «почав»', async () => {
    await mount();
    await flushEvents();
    expect(sent().map((e) => e.name)).toContain('onboarding_started');
  });

  it('ГОТОВА картка при перемальовці стрічки не пише ні «почав», ні «закінчив»', async () => {
    await mount({ profileFields: filled() });
    await flushEvents();
    const names = sent().map((e) => e.name);
    expect(names).not.toContain('onboarding_started');
    expect(names).not.toContain('onboarding_finished');
    expect(names).not.toContain('onboarding_panel_reached');
  });

  it('гортання пише панель за номером, а «Далі» на порожній — пропуск', async () => {
    await mount();
    // Перша панель — «Далі» на порожній: це пропуск, той самий, що потім
    // підписує панель «ПРОПУЩЕНО».
    await act(async () => { btn('Далі').click(); });
    await flushEvents();
    const names = sent();
    expect(names.find((e) => e.name === 'onboarding_skipped')?.props).toEqual({ panel: 1 });
    expect(names.find((e) => e.name === 'onboarding_panel_reached')?.props).toEqual({ panel: 2 });
  });

  it('у props — тільки номер: ні ключа поля, ні тексту людини', async () => {
    await mount();
    await act(async () => { btn('Далі').click(); });
    await flushEvents();
    for (const e of sent().filter((x) => x.name.startsWith('onboarding_'))) {
      const keys = Object.keys(e.props ?? {});
      expect(keys.every((k) => k === 'panel')).toBe(true);
    }
  });
});
