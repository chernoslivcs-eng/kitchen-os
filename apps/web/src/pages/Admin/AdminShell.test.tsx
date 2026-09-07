// @vitest-environment jsdom
//
// Крок А2: каркас адмінки — і головне в ньому не рейка, а те, що бачить
// СТОРОННЯ людина.
//
// Раніше кожна адмінська сторінка малювала власний сірий прямокутник із
// написом «404» — не схожий ні на що в продукті. Саме цим адмінка себе й
// видавала: людина, яка натрапила на приховану адресу, бачила не порожнє
// місце, а щось явно інше, і розуміла, що тут щось є. Тому предмет тесту —
// не «показали 404», а «показали ТОЙ САМИЙ екран, що на будь-яку неіснуючу
// адресу», без жодної відмінності.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminShell } from './AdminShell';
import { HouseholdsPage } from './Households';
import { NotFoundPage } from '../NotFound/NotFound';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let calls: string[];

const HOUSEHOLDS = {
  my_household_id: 'h-1',
  households: [
    { id: 'h-1', name: 'Дім Пилипа', people: 2, last_turn_at: new Date().toISOString(), turns: 44, last_seen_at: new Date().toISOString(), mine: true, owner_name: 'Пилип', owner_email: 'p@example.com' },
    { id: 'h-2', name: 'Дім Олі', people: 1, last_turn_at: new Date().toISOString(), turns: 9, last_seen_at: new Date().toISOString(), mine: false, owner_name: 'Оля', owner_email: 'olya@example.com' },
    // Дім, у якому нічого не сталось. На пілоті таких більшість.
    { id: 'h-3', name: 'Дім Дани', people: 1, last_turn_at: null, turns: 0, last_seen_at: '2026-09-02T19:04:00.000Z', mine: false, owner_name: 'Дана', owner_email: 'dana@example.com' },
  ],
};

function install(ok: boolean, body: unknown = HOUSEHOLDS) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return ok
      ? new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } });
  }));
}

async function mount(path = '/admin') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AdminShell />}>
            <Route path="/admin" element={<HouseholdsPage />} />
            <Route path="/admin/h/:household_id" element={<div data-house-screen />} />
          </Route>
          {/* Та сама сторінка, що ловить будь-яку неіснуючу адресу продукту. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/** Розмітка справжньої 404 продукту — з нею й звіряємось. */
async function realNotFoundMarkup(): Promise<string> {
  const h = document.createElement('div');
  document.body.appendChild(h);
  const r = createRoot(h);
  await act(async () => {
    r.render(<MemoryRouter initialEntries={['/чогось-такого-нема']}><Routes><Route path="*" element={<NotFoundPage />} /></Routes></MemoryRouter>);
  });
  const html = h.innerHTML;
  await act(async () => { r.unmount(); });
  h.remove();
  return html;
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

describe('каркас адмінки: доступ', () => {
  beforeEach(() => install(false));

  it('стороннього зустрічає СПРАВЖНЯ 404 продукту, а не саморобний прямокутник', async () => {
    const real = await realNotFoundMarkup();
    await mount();
    // Байт у байт та сама розмітка. Якщо колись повернеться свій «404» —
    // цей рядок і впаде.
    expect(host!.innerHTML).toBe(real);
    expect(host!.querySelector('[data-error-screen]')).toBeTruthy();
  });

  it('відмова не показує ні рейки, ні натяку на те, що адмінка існує', async () => {
    await mount();
    expect(host!.querySelector('[data-admin]')).toBeNull();
    expect(host!.textContent).not.toContain('АДМІНКА');
    expect(host!.textContent).not.toContain('ЗВЕДЕННЯ');
  });

  it('та сама відмова на кожному екрані адмінки, не лише на першому', async () => {
    await mount('/admin/h/h-2');
    expect(host!.querySelector('[data-error-screen]')).toBeTruthy();
    expect(host!.querySelector('[data-house-screen]')).toBeNull();
  });

  it('поки доступ невідомий — не блимає нічим: проблиск рейки сказав би все', async () => {
    // Відповідь навмисно зависає: це і є момент «checking».
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    await mount();
    expect(host!.innerHTML).toBe('');
  });
});

describe('каркас адмінки: рейка і дім', () => {
  beforeEach(() => install(true));

  it('адмінка має власний каркас — продуктового навколо неї немає', async () => {
    await mount();
    expect(host!.querySelector('[data-admin]')).toBeTruthy();
    expect(host!.textContent).toContain('ЗВЕДЕННЯ');
    expect(host!.textContent).toContain('ПРИВОДИ');
    expect(host!.textContent).toContain('ДИМОВИЙ ТЕСТ');
    expect(host!.textContent).toContain('← У ПРОДУКТ');
  });

  it('доступ перевіряється ОДНИМ запитом — тим самим, що дає список домів', async () => {
    await mount();
    expect(calls).toEqual(['/v1/admin/households']);
  });

  it('у чужому домі каркас у стані «у гостях» — паспарту і присвійний підпис', async () => {
    await mount('/admin/h/h-2');
    const bar = host!.querySelector('[data-guest-bar]');
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain('У ГОСТЯХ');
    expect(bar!.textContent).toContain('ДІМ ОЛІ');
    expect(bar!.textContent).toContain('ЛИШЕ ЧИТАННЯ');
    // Стан живе на каркасі, тож переживає перехід між екранами всередині дому.
    expect(host!.querySelector('[data-house-box]')!.textContent).toContain('лише читання');
  });

  it('у СВОЄМУ домі паспарту немає — інакше маркер перестав би щось означати', async () => {
    await mount('/admin/h/h-1');
    expect(host!.querySelector('[data-guest-bar]')).toBeNull();
    expect(host!.querySelector('[data-house-box]')!.textContent).toContain('це твій дім');
  });
});

describe('список домів', () => {
  beforeEach(() => install(true));

  it('дім без жодного ходу присутній у списку і не валить сторінку', async () => {
    await mount();
    const silent = host!.querySelector('[data-household="h-3"]');
    expect(silent).toBeTruthy();
    expect(silent!.hasAttribute('data-silent')).toBe(true);
    // Саме текстом, а не порожньою коміркою: «ходів не було» — це факт про
    // людину, і на пілоті найцінніший.
    expect(silent!.textContent).toContain('ходів не було');
    expect(silent!.textContent).toContain('не написала');
  });

  it('власника дому видно поіменно — власник цих людей особисто кликав', async () => {
    await mount();
    const row = host!.querySelector('[data-household="h-2"]')!;
    expect(row.textContent).toContain('Оля');
    expect(row.textContent).toContain('olya@example.com');
  });

  it('свій дім помічений — щоб не сплутати його з чужим', async () => {
    await mount();
    expect(host!.querySelector('[data-household="h-1"]')!.textContent).toContain('твій');
    expect(host!.querySelector('[data-household="h-2"]')!.textContent).not.toContain('твій');
  });

  it('порожній продукт каже це словами, а не порожньою таблицею', async () => {
    install(true, { my_household_id: 'h-1', households: [] });
    await mount();
    expect(host!.querySelector('[data-empty]')).toBeTruthy();
    expect(host!.textContent).toContain('Домів ще немає');
  });
});
