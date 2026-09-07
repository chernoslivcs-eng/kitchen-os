// @vitest-environment jsdom
//
// Крок О1: пульс дня.
//
// Що тут може зламатись тихо і дорого: сторінка мовчки покаже неправду про
// гроші або про стан картки, і власник ухвалить рішення по ній. Тому предмет
// тесту — саме числа й слова, а не наявність розмітки.
//
// CSS-модулі у vitest резолвляться в порожній обʼєкт — перевіряємо текст і
// data-атрибути, не класи.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { PulsePage } from './Pulse';
import type { AdminContext } from './AdminShell';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const PULSE = {
  day: '2026-09-06',
  household_id: 'h-1',
  household_name: 'Дім Пилипа',
  guest: false,
  members: [
    { user_id: 'u-1', name: 'Пилип', role: 'owner' },
    { user_id: 'u-2', name: 'Оля', role: 'member' },
  ],
  turns: [
    { at: at(9, 12), user_id: 'u-1', who: 'Пилип', role: 'user', text: 'купив куряче філе', card_type: null, card_state: null, latency_ms: null, usd: null, price_from: null },
    { at: at(9, 12), user_id: 'u-1', who: 'Пилип', role: 'assistant', text: 'Записав.', card_type: 'intake_diff', card_state: 'застосована', latency_ms: 2400, usd: 0.0123, price_from: 'message' },
    { at: at(19, 40), user_id: 'u-2', who: 'Оля', role: 'assistant', text: 'Ось що можна', card_type: 'recipe', card_state: 'відхилена', latency_ms: 5100, usd: null, price_from: 'time' },
    // Старий рядок обліку: указівника на хід немає, ціна зшита за часом.
    { at: at(20, 5), user_id: 'u-2', who: 'Оля', role: 'assistant', text: 'І ще одне', card_type: null, card_state: null, latency_ms: 3100, usd: 0.0044, price_from: 'time' },
  ],
  money: {
    day: { calls: 4, input: 12000, output: 800, cached: 9000, usd: 0.0412 },
    week: { calls: 21, input: 70000, output: 4200, cached: 51000, usd: 0.2610 },
    byMember: [
      { user_id: 'u-1', name: 'Пилип', role: 'owner', day: { calls: 3, input: 9000, output: 600, cached: 9000, usd: 0.0300 }, week: { calls: 15, input: 50000, output: 3000, cached: 40000, usd: 0.1800 } },
      { user_id: 'u-2', name: 'Оля', role: 'member', day: { calls: 1, input: 3000, output: 200, cached: 0, usd: 0.0112 }, week: { calls: 6, input: 20000, output: 1200, cached: 11000, usd: 0.0810 } },
    ],
  },
  events: [
    { id: 'e1', user_id: 'u-1', who: 'Пилип', role: 'owner', name: 'pantry_opened', props: {}, created_at: at(9, 10) },
    { id: 'e0', user_id: 'u-1', who: 'Пилип', role: 'owner', name: 'attachment_added', props: { kind: 'image', how: 'drop' }, created_at: at(9, 11) },
    { id: 'e2', user_id: 'u-2', who: 'Оля', role: 'member', name: 'incident:response-contains-allergen', props: { kind: 'guard', allergen: 'горіхи' }, created_at: at(19, 41) },
    { id: 'e3', user_id: 'u-2', who: 'Оля', role: 'member', name: 'incident:chat-model-call-failed', props: { kind: 'broke' }, created_at: at(19, 42) },
  ],
};

let calls: string[];

function install(body: unknown = PULSE, status = 200) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (status !== 200) return new Response('{"error":"not_found"}', { status });
    return json(body);
  }));
}

/**
 * Крок А2: пульс живе всередині каркаса адмінки й бере з нього контекст дому.
 * Тут каркас підмінений заглушкою — предмет цього файлу самі числа й слова, а
 * доступ і рейка перевіряються в AdminShell.test.tsx.
 */
function ShellStub({ house }: { house: AdminContext['house'] }) {
  const ctx: AdminContext = {
    households: [], myHouseholdId: 'h-1', house,
    hiddenTechnical: 0, technicalTotal: 0, showTechnical: false, setShowTechnical: () => {},
    reload: () => {},
  };
  return <Outlet context={ctx} />;
}

async function mount(path = '/admin/pulse', house: AdminContext['house'] = null) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ShellStub house={house} />}>
            <Route path="/admin/pulse" element={<PulsePage />} />
            <Route path="/admin/h/:household_id" element={<PulsePage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => { install(); });
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

describe('пульс дня', () => {
  it('питає сьогоднішній день у місцевих межах, не в UTC', async () => {
    // Різниця між місцевим днем і UTC видно лише вранці й пізно ввечері —
    // тобто рівно тоді, коли цю сторінку й відкривають. Щоб тест ловив це
    // завжди, а не залежав від годинного поясу машини, пояс і час задаємо самі:
    // 2026-09-05 22:00 UTC — це вже 6 вересня в Токіо.
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T22:00:00Z'));
    try {
      await mount();
      expect(calls[0]).toBe('/v1/admin/pulse?day=2026-09-06');
    } finally {
      vi.useRealTimers();
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it('показує стан картки словом, а не прапорцем', async () => {
    await mount();
    const text = host!.textContent!;
    expect(text).toContain('застосована');
    expect(text).toContain('відхилена');
  });

  it('репліку не обрізає — сенс дня саме в тому, що людина написала', async () => {
    await mount();
    expect(host!.textContent).toContain('купив куряче філе');
  });

  it('ціна ходу — чотири знаки; без них центи обнулились би', async () => {
    await mount();
    expect(host!.textContent).toContain('$0.0123');
  });

  it('невідома ціна — риска, і це не те саме, що нуль', async () => {
    await mount();
    const rows = [...host!.querySelectorAll('table:not([data-money-by-member]) tbody tr')];
    // Третій хід: виклик був (латентність є), а ціни моделі ми не знаємо.
    const cells = [...rows[2]!.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells[6]).toBe('5.1 с');
    expect(cells[7]).toBe('—');
    // Репліка людини викликів не робила — там просто порожньо, не «$0».
    const first = [...rows[0]!.querySelectorAll('td')].map((c) => c.textContent);
    expect(first[7]).toBe('');
  });

  it('юніт-економіка порахована до місяця — заради неї сторінка й існує', async () => {
    await mount();
    expect(host!.textContent).toContain('$0.0412');
    // 0.0412 × 30 — оце й зіставляють із $5 підписки.
    expect(host!.textContent).toContain('$1.24');
  });

  it('інциденти в стрічці названі родом, а не кодом', async () => {
    await mount();
    const text = host!.textContent!;
    expect(text).toContain('response-contains-allergen');
    expect(text).toContain('запобіжник');
    expect(text).toContain('зламалось');
    // Префікс `incident:` — службовий, людині його читати не треба.
    expect(text).not.toContain('incident:');
  });

  it('подробиці події видно, а рід інциденту в них не дублюється', async () => {
    await mount();
    expect(host!.textContent).toContain('allergen=горіхи');
    expect(host!.textContent).not.toContain('kind=guard');
  });

  it('«kind» у звичайній події — не рід інциденту, і його не ховаємо', async () => {
    await mount();
    // attachment_added каже kind='image' — це рід ВКЛАДЕННЯ, і без нього
    // подія втрачає половину сенсу: лишається спосіб без предмета.
    expect(host!.textContent).toContain('kind=image');
    expect(host!.textContent).toContain('how=drop');
  });

  // Крок А2: перевірка доступу переїхала на каркас — див. AdminShell.test.tsx.
  // Тут її більше немає навмисно: два місця, що вирішують те саме, розходяться.

  it('стрілка «день →» не пускає в майбутнє', async () => {
    await mount();
    const next = [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes('день →'))!;
    expect(next.disabled).toBe(true);
  });

  it('крок назад перепитує саме попередній день', async () => {
    await mount();
    const prev = [...host!.querySelectorAll('button')].find((b) => b.textContent?.includes('← день'))!;
    await act(async () => { prev.click(); });
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(calls[calls.length - 1]).toBe(`/v1/admin/pulse?day=${y}`);
  });

  it('гроші розкладені по людях, з роллю словом', async () => {
    await mount();
    const rows = [...host!.querySelectorAll('[data-money-by-member] tbody tr')];
    expect(rows).toHaveLength(2);
    const cells = rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    // Імʼя · роль · за день · викликів · за тиждень.
    expect(cells[0]).toEqual(['Пилип', 'власник', '$0.0300', '3', '$0.1800']);
    expect(cells[1]).toEqual(['Оля', 'учасник', '$0.0112', '1', '$0.0810']);
  });

  it('роль перекладена — «owner» у таблиці нічого не пояснює', async () => {
    await mount();
    const text = host!.querySelector('[data-money-by-member]')!.textContent!;
    expect(text).toContain('власник');
    expect(text).toContain('учасник');
    expect(text).not.toContain('owner');
    expect(text).not.toContain('member');
  });

  it('підсумок дому стоїть окремо від рядків людей', async () => {
    await mount();
    // $0.0412 — це підсумок дому, і він не дорівнює жодному окремому рядку.
    expect(host!.textContent).toContain('$0.0412');
    expect(host!.textContent).toContain('Ціна дня на дім');
  });

  it('ходи підписані імʼям людини, а не лише роллю в діалозі', async () => {
    await mount();
    const rows = [...host!.querySelectorAll('table:not([data-money-by-member]) tbody tr')];
    const cells = [...rows[0]!.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells[1]).toBe('Пилип');
    // Хід Олі теж підписаний нею, а не власником.
    const third = [...rows[2]!.querySelectorAll('td')].map((c) => c.textContent);
    expect(third[1]).toBe('Оля');
  });

  it('точна ціна й оцінка виглядають по-різному — інакше на здогадці будували б економіку', async () => {
    await mount();
    const exact = host!.querySelector('[data-price-from="message"]')!;
    const guessed = [...host!.querySelectorAll('[data-price-from="time"]')].map((n) => n.textContent);
    expect(exact.textContent).toBe('$0.0123');
    // «≈» — не прикраса: до А1 указівника на хід не існувало, і ціна зшивалась
    // за часом. На такому числі не можна будувати юніт-економіку.
    expect(exact.textContent).not.toContain('≈');
    expect(guessed).toContain('≈ $0.0044');
    // А там, де ціни моделі ми не знаємо, риска лишається рискою: «≈ —» не
    // означало б нічого.
    expect(guessed).toContain('—');
  });

  it('заголовок присвійний і каже, чий це дім', async () => {
    await mount();
    expect(host!.textContent).toContain('Пульс дому Пилипа');
  });

  it('у гостях це видно на екрані, а не лише в адресному рядку', async () => {
    install({ ...PULSE, household_id: 'h-2', household_name: 'Дім Олі', guest: true });
    await mount('/admin/h/h-2', { id: 'h-2', name: 'Дім Олі', people: 1, last_turn_at: null, turns: 0, last_seen_at: null, mine: false, owner_name: 'Оля', owner_email: 'olya@gmail.com', technical: false });
    expect(host!.textContent).toContain('Пульс дому Олі');
    expect(host!.querySelector('[data-guest-tag]')).toBeTruthy();
  });

  it('чужий дім питається з household_id, свій — без нього', async () => {
    await mount('/admin/h/h-2', { id: 'h-2', name: 'Дім Олі', people: 1, last_turn_at: null, turns: 0, last_seen_at: null, mine: false, owner_name: null, owner_email: null, technical: false });
    expect(calls[0]).toContain('household_id=h-2');
    install();
    await act(async () => { root?.unmount(); });
    await mount();
    expect(calls[0]).not.toContain('household_id');
  });

  it('дім, у якому нічого не сталось, не валить сторінку — і каже це словами', async () => {
    install({ ...PULSE, turns: [], events: [], money: { day: { calls: 0, input: 0, output: 0, cached: 0, usd: 0 }, week: { calls: 0, input: 0, output: 0, cached: 0, usd: 0 }, byMember: [] } });
    await mount();
    expect(host!.querySelector('[data-nothing]')).toBeTruthy();
    expect(host!.textContent).toContain('У цьому домі ще нічого не сталось');
  });

  it('події теж підписані людиною', async () => {
    await mount();
    const tables = [...host!.querySelectorAll('table')];
    const events = tables[tables.length - 1]!;
    const first = [...events.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')].map((c) => c.textContent);
    expect(first[1]).toBe('Пилип');
  });
});

