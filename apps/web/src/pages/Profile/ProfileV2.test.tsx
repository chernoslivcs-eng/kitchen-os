// @vitest-environment jsdom
import { KIT_DEFAULTS } from '@kitchen/domain/profile-fields';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ProfileV2 } from './ProfileV2';
import type { ProfileV2Response } from '../../api';
import { useAuth } from '../../store/auth';
import { PROFILE_FIELDS } from '@kitchen/domain/profile-fields';

// v3 (крок 3, 11.09): капс у мета знято (Р20) — «власник», «чекає»; лічильник «176 / 200 · далі вже мемуари».
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
// Р148: стан Telegram у стабі — `null` = сервер відповідає 500.
let telegram: { linked: boolean; username: string | null; linked_at: string | null } | null;
// Злиття акаунтів (15.09): що відповідає GET /v1/account/conflict.
let conflict: Record<string, unknown> | null = null;
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
    if (url === '/v1/telegram' && method === 'GET') return telegram ? json(telegram) : json({ error: 'boom' }, 500);
    if (url === '/v1/telegram/link-token' && method === 'POST') return json({ url: 'https://t.me/kitchen_os_bot?start=tok1', expires_at: '2036-01-01T00:00:00.000Z' });
    if (url === '/v1/telegram' && method === 'DELETE') return json({ ok: true });
    if (url === '/v1/account/conflict' && method === 'GET') return json(conflict);
    if (url === '/v1/account/merge' && method === 'POST') { conflict = null; return json({ ok: true, kind: 'telegram', stats: { batches: 12, products: 9, recipes: 3, sessions: 2 } }); }
    if (url === '/v1/account/conflict/dismiss' && method === 'POST') { conflict = null; return json({ ok: true }); }
    if (url === '/v1/auth/email/attach/request' && method === 'POST') {
      if (body?.email === 'taken@example.com') return json({ error: 'email_taken' }, 409);
      return json({ ok: true }, 202);
    }
    if (url === '/v1/occasions/subscriptions') return json({ subscriptions: [{ occasion_id: 'a', enabled: true }, { occasion_id: 'b', enabled: true }, { occasion_id: 'c', enabled: false }] });
    if (url === '/v1/households/h1/invites' && method === 'GET') return json({ invites: [{ id: 'i1', email: 'guest@x.local', role: 'member', created_at: '2026-09-05T00:00:00.000Z', expires_at: '2036-01-01T00:00:00.000Z', consumed_at: null, revoked_at: null }] });
    if (url === '/v1/households/h1/invite' && method === 'POST') return json({ id: 'i2', household_id: 'h1', email: body.email, role: 'member', expires_at: '2036-01-01T00:00:00.000Z', link: 'http://x/invite?token=t', mail_sent: true });
    if (url === '/v1/invites/i1/revoke') return json(null);
    if (url.startsWith('/v1/households/h1/members/') && method === 'DELETE') return json(null);
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

beforeEach(() => { telegram = { linked: false, username: null, linked_at: null }; conflict = null; installFetch(); });
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
    expect(counter.textContent).toBe('30 / 30 · Все сюди вже не влізе. Лишімо головне.');
    expect((counter as HTMLElement).style.opacity).toBe('1');

    // Нижче ліміту — не блокується, лічильник n/max.
    await act(async () => { el.textContent = 'Пилип'; fire(el, 'input'); });
    const ev2 = new KeyboardEvent('keydown', { key: 'а', bubbles: true, cancelable: true });
    await act(async () => { el.dispatchEvent(ev2); });
    expect(ev2.defaultPrevented).toBe(false);
    expect(host.querySelector('[data-counter="name"]')!.textContent).toBe('5 / 30');
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

  it('порожні нотатки — «Поки порожньо. Дай духовці трохи часу.» (прод-текст, власник 13.09)', async () => {
    await mount({ ...initial(), notes: [] });
    expect(host.textContent).toContain('Поки порожньо. Дай духовці трохи часу.');
  });
});

describe('профіль за Prototype (рішення власника 13.09): без підказок; секція «Дім»', () => {
  it('підказки (`hint`) і приклади (`ex`) не рендеряться — ні праворуч, ні під рядком, ні у фокусі', async () => {
    await mount();
    expect(host.textContent).not.toContain('Стань у рядок');
    const el = edit('no');
    await act(async () => { el.focus(); fire(el, 'focusin'); });
    expect(host.textContent).not.toContain('Те, чого на твоєму столі просто не має бути.');
    expect(host.textContent).not.toContain('кінзи й оливок');
    expect(host.textContent).not.toContain('— нічого тваринного');
  });

  it('«Дім»: список людей з ролями, запрошення через існуючий POST, скасування інвайту', async () => {
    useAuth.setState({
      status: 'signed_in',
      me: {
        user: { id: 'u1', name: 'Пилип', email: 'me@x.local', plan: 'beta' },
        household: { id: 'h1', name: 'Дім', role: 'owner', members: [
          { user_id: 'u1', name: 'Пилип', role: 'owner', joined_at: '2026-09-01T00:00:00.000Z' },
          { user_id: 'u2', name: 'Оксана', role: 'member', joined_at: '2026-09-02T00:00:00.000Z' },
        ] },
        session_id: 's1',
      },
    });
    try {
      await mount();
      await act(async () => { await Promise.resolve(); });
      const home = host.querySelector('[data-section="home"]')!;
      expect(home.textContent).toContain('Дім');
      expect(home.textContent).toContain('Оксана');
      expect(home.textContent).toContain('власник');
      expect(home.textContent).toContain('guest@x.local');
      expect(home.textContent).toContain('чекає');
      expect(calls.some((c) => c.url === '/v1/households/h1/invites')).toBe(true);

      const invite = [...home.querySelectorAll('button')].find((b) => b.textContent === 'Запросити')!;
      await act(async () => { invite.click(); });
      const input = host.querySelector<HTMLInputElement>('[data-invite-form] input')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'new@x.local');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { host.querySelector('[data-invite-form]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      expect(calls.find((c) => c.url === '/v1/households/h1/invite')).toMatchObject({ method: 'POST', body: { email: 'new@x.local' } });
      expect(host.querySelector('[data-invite-link]')!.textContent).toContain('new@x.local');

      const revoke = [...host.querySelectorAll<HTMLButtonElement>('[data-invite="i1"] button')].find((b) => b.textContent === 'Скасувати')!;
      await act(async () => { revoke.click(); });
      expect(calls.some((c) => c.url === '/v1/invites/i1/revoke')).toBe(true);
    } finally {
      useAuth.setState({ status: 'idle', me: null });
    }
  });

  it('«Дім» порожній (лише я): одне речення і дія «Запросити»', async () => {
    useAuth.setState({ status: 'signed_in', me: { user: { id: 'u1', name: 'Пилип', email: 'me@x.local' }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [{ user_id: 'u1', name: 'Пилип', role: 'owner', joined_at: '2026-09-01T00:00:00.000Z' }] }, session_id: 's1' } });
    try {
      await mount();
      const home = host.querySelector('[data-section="home"]')!;
      expect(home.textContent).toContain('Поки готуєш сам.');
      expect([...home.querySelectorAll('button')].some((b) => b.textContent === 'Запросити')).toBe(true);
    } finally { useAuth.setState({ status: 'idle', me: null }); }
  });
});

describe('Р8: база кухні названа окремо', () => {
  it('чотири прилади підписані як не-слова людини, під полем «У мене на кухні є»', async () => {
    // Досі база жила лише в промті, а на екрані її не було — тобто
    // `status: filled` на цьому рядку означав «людина сказала», і це неправда.
    // `mount` нічого не вертає — пише в модульний `host`.
    await mount();
    const line = host.querySelector('[data-baseline="kit"]');
    expect(line, 'рядок бази кухні є').not.toBeNull();
    for (const k of KIT_DEFAULTS) expect(line!.textContent).toContain(k);
    expect(line!.textContent).toContain('не твої слова');
  });

  it('і він один — решта полів справді слова людини', async () => {
    await mount();
    expect(host.querySelectorAll('[data-baseline]').length).toBe(1);
  });
});

describe('етап 4 · лічильник за 20 знаків до стелі, на всіх пʼятьох лімітах (PLAN §3, §6)', () => {
  // ~~Р7~~ зняв «лічильника на 30 немає» як помилку МАКЕТА (макет демонстрував
  // патерн на одному полі), але не як вимогу до реалізації. Реалізація мусить
  // показувати його на кожному ліміті — 30, 140, 200, 250, 260 — і не лише під
  // час набору, а щойно до стелі лишається 20 знаків: обрізати не мовчки.
  const LIMITS: Record<string, number> = { name: 30, ban: 140, no: 200, when: 250, kit: 260 };

  for (const [k, max] of Object.entries(LIMITS)) {
    it(`${k}: за 20 знаків до ${max} — видно без набору; далі від стелі — ні`, async () => {
      await mount();
      const el = edit(k);
      // Далеко від стелі, набір давно скінчився — лічильника не видно.
      await act(async () => { el.textContent = 'а'.repeat(Math.max(1, max - 40)); fire(el, 'input'); el.focus(); fire(el, 'focusin'); });
      const c = host.querySelector<HTMLElement>(`[data-counter="${k}"]`)!;
      // За 20 до стелі — видно, і без набору.
      await act(async () => { el.textContent = 'а'.repeat(max - 20); fire(el, 'input'); });
      await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
      expect(c.style.opacity, `${k}: лічильник за 20 до ${max}`).toBe('1');
      expect(c.textContent).toBe(`${max - 20} / ${max}`);
    });
  }
});

describe('етап 4 · status — три різні форми, не тон (PLAN §6, Б2)', () => {
  // filled — чорний текст; empty — плейсхолдер сірий курсив; none — «нічого
  // такого» сірим БЕЗ курсиву. Три різні речі: «є», «не казав», «свідомо ні».
  // Доти none і empty виглядали однаково — обидва порожнім полем із
  // плейсхолдером, тобто «нічого такого» читалось як «ще не відповідав».
  it('none — «нічого такого» видно словом, і воно не курсив', async () => {
    await mount();  // ban: field('', 'none')
    const row = host.querySelector<HTMLElement>('[data-row="ban"]')!;
    expect(row.getAttribute('data-status')).toBe('none');
    const none = row.querySelector<HTMLElement>('[data-none]');
    expect(none, 'слово «нічого такого» є').toBeTruthy();
    expect(none!.textContent).toBe('нічого такого');
  });

  it('empty — плейсхолдер, а не слово; курсив несе CSS, не розмітка', async () => {
    await mount();  // meh: field('')
    const row = host.querySelector<HTMLElement>('[data-row="meh"]')!;
    expect(row.getAttribute('data-status')).toBe('empty');
    expect(row.querySelector('[data-none]')).toBeNull();
    expect(edit('meh').getAttribute('data-ph')).toBeTruthy();
  });

  it('filled — текст, без плейсхолдера і без слова', async () => {
    await mount();  // name: 'Пилип'
    const row = host.querySelector<HTMLElement>('[data-row="name"]')!;
    expect(row.getAttribute('data-status')).toBe('filled');
    expect(row.querySelector('[data-none]')).toBeNull();
    expect(edit('name').textContent).toBe('Пилип');
  });
});

// Профіль за Prototype (рішення власника 13.09, PROFILE-LOGIC-0913.md §7):
// «…» замість слів «Передати роль / Виключити» — меню з тими самими діями
// й тим самим confirm; запрошення — «лінк діє N год»; «Пости й сезони · N
// підписок ›» → /calendar; під «Видалити акаунт» — що лишиться дому.
describe('профіль за Prototype · дім, мережі, акаунт', () => {
  const twoOfUs = () => useAuth.setState({
    status: 'signed_in',
    me: {
      user: { id: 'u1', name: 'Пилип', email: 'me@x.local', plan: 'beta' },
      household: { id: 'h1', name: 'Дім', role: 'owner', members: [
        { user_id: 'u1', name: 'Пилип', role: 'owner', joined_at: '2026-09-01T00:00:00.000Z' },
        { user_id: 'u2', name: 'Оля', role: 'member', joined_at: '2026-09-02T00:00:00.000Z' },
      ] },
      session_id: 's1',
    },
  });

  it('«…» відкриває меню з «Передати роль власника» і «Виключити з дому»; дія — через confirm, як було', async () => {
    twoOfUs();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      await mount();
      await act(async () => { await Promise.resolve(); });
      const row = host.querySelector('[data-member="u2"]')!;
      expect(row.textContent).not.toContain('Передати роль');
      const more = row.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
      await act(async () => { more.click(); });
      const menu = host.querySelector('[data-member-menu]')!;
      const labels = [...menu.querySelectorAll('button')].map((b) => b.textContent);
      expect(labels).toEqual(['Передати роль власника', 'Виключити з дому']);
      await act(async () => { (menu.querySelectorAll('button')[1] as HTMLButtonElement).click(); });
      expect(confirmSpy).toHaveBeenCalledWith('Виключити Оля?');
      expect(host.querySelector('[data-member-menu]')).toBeNull();
      // Власник сам себе не виключає — «…» у своєму рядку нема.
      expect(host.querySelector('[data-member="u1"] button[aria-expanded]')).toBeNull();
    } finally { confirmSpy.mockRestore(); useAuth.setState({ status: 'idle', me: null }); }
  });

  it('запрошення: «лінк діє N год» під поштою; «Пости й сезони · 2 підписки» веде в календар; текст під «Видалити акаунт» — про Олю', async () => {
    twoOfUs();
    try {
      await mount();
      await act(async () => { await Promise.resolve(); });
      const inv = host.querySelector('[data-invite="i1"]')!;
      expect(inv.textContent).toMatch(/лінк діє \d+ год/);
      const seasons = host.querySelector('[data-seasons]')!;
      expect(seasons.textContent).toContain('Пости й сезони');
      expect(seasons.textContent).toContain('2 підписки');
      expect(host.querySelector('[data-delete-note]')!.textContent).toBe('Комора лишиться Оля — зникнуть лише твої дані.');
      expect(host.textContent).not.toContain('Підказка');
      expect(host.querySelector('[data-section="account"]')!.textContent).toContain('на цьому пристрої');
    } finally { useAuth.setState({ status: 'idle', me: null }); }
  });

  it('сам у домі: тексту під «Видалити акаунт» нема', async () => {
    useAuth.setState({ status: 'signed_in', me: { user: { id: 'u1', name: 'Пилип', email: 'me@x.local' }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [{ user_id: 'u1', name: 'Пилип', role: 'owner', joined_at: '2026-09-01T00:00:00.000Z' }] }, session_id: 's1' } });
    try {
      await mount();
      await act(async () => { await Promise.resolve(); });
      expect(host.querySelector('[data-delete-note]')).toBeNull();
    } finally { useAuth.setState({ status: 'idle', me: null }); }
  });
});

// Р148: рядок «Telegram» в «Акаунті» після «Тариф» і мітка каналу в чаті.
describe('Р148 · Telegram у профілі', () => {
  const row = () => host.querySelector<HTMLElement>('[data-telegram]')!;

  it('не підключено: рядок після «Тариф», кнопка «Підключити»', async () => {
    await mount();
    const rows = [...host.querySelectorAll('[data-section="account"] > div')];
    const plan = rows.findIndex((r) => r.textContent?.startsWith('Тариф'));
    expect(rows[plan + 1]!.hasAttribute('data-telegram')).toBe(true);
    expect(row().textContent).toContain('Telegram');
    const btn = row().querySelector<HTMLButtonElement>('button')!;
    expect(btn.textContent).toBe('Підключити');
    expect(btn.disabled).toBe(false);
  });

  it('підключено: «підключено · @username» і «Відключити» → підтвердження → DELETE', async () => {
    telegram = { linked: true, username: 'pylyp', linked_at: '2026-09-10T00:00:00.000Z' };
    await mount();
    expect(row().textContent).toContain('підключено · @pylyp');
    const btn = [...row().querySelectorAll('button')].find((b) => b.textContent === 'Відключити')!;
    vi.stubGlobal('confirm', vi.fn(() => false));
    await act(async () => { btn.click(); });
    expect(calls.filter((c) => c.url === '/v1/telegram' && c.method === 'DELETE')).toHaveLength(0);
    vi.stubGlobal('confirm', vi.fn(() => true));
    await act(async () => { btn.click(); });
    expect(calls.filter((c) => c.url === '/v1/telegram' && c.method === 'DELETE')).toHaveLength(1);
    expect(row().textContent).toContain('Підключити');
  });

  it('помилка статусу: рядок є, текст E1 з копірайту', async () => {
    telegram = null;
    await mount();
    expect(row().textContent).toContain('Не вийшло звʼязатись із Telegram');
  });

  it('≥768: клік → POST link-token → лінк моноширинним, «Скопіювати», підпис про 15 хв', async () => {
    await mount();
    await act(async () => { row().querySelector<HTMLButtonElement>('button')!.click(); });
    expect(calls.filter((c) => c.url === '/v1/telegram/link-token' && c.method === 'POST')).toHaveLength(1);
    const link = host.querySelector<HTMLElement>('[data-telegram-link]')!;
    expect(link.textContent).toContain('https://t.me/kitchen_os_bot?start=tok1');
    expect(host.textContent).toContain('Скопіювати');
    expect(host.textContent).toContain('лінк діє 15 хв');
  });

  it('<768: клік → POST → window.open(url), без лінка в рядку', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await mount();
    await act(async () => { row().querySelector<HTMLButtonElement>('button')!.click(); });
    expect(open).toHaveBeenCalledWith('https://t.me/kitchen_os_bot?start=tok1');
    expect(host.querySelector('[data-telegram-link]')).toBeNull();
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });
});

// PR 1 (TELEGRAM-AUTH-PAY-PLAN-0915): акаунт народжений із Telegram — пошти
// нема; рядок «Пошта» показує «Telegram», не порожнє місце.
describe('акаунт без пошти', () => {
  it('рядок «Пошта» → «Telegram»', async () => {
    useAuth.setState({
      status: 'signed_in',
      me: { user: { id: 'u1', name: 'Олена', email: null, plan: 'beta' }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [] }, session_id: 's1' },
    } as never);
    try {
      await mount();
      const row = [...host.querySelectorAll('[data-section="account"] > div')].find((r) => r.textContent?.startsWith('Пошта'))!;
      expect(row.textContent).toContain('Telegram');
    } finally { useAuth.setState({ me: null } as never); }
  });
});

describe('PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915) · акаунт без пошти — «Додати пошту»', () => {
  const accountMe = (email: string | null) => ({
    status: 'signed_in' as const,
    me: {
      user: { id: 'u1', name: 'Пилип', email, plan: 'beta' },
      household: { id: 'h1', name: 'Дім', role: 'owner' as const, members: [{ user_id: 'u1', name: 'Пилип', role: 'owner' as const, joined_at: '2026-09-01T00:00:00.000Z' }] },
      session_id: 's1',
    },
  });
  const noEmail = () => useAuth.setState(accountMe(null));

  it('акаунт із поштою — «Додати пошту» не показується', async () => {
    useAuth.setState(accountMe('me@x.local'));
    await mount();
    expect(host.textContent).not.toContain('Додати пошту');
    expect(host.textContent).toContain('me@x.local');
  });

  it('акаунт без пошти — «Додати пошту»; клік відкриває поле; надсилання → POST attach/request, «Лист надіслано»', async () => {
    noEmail();
    await mount();
    expect(host.textContent).toContain('Додати пошту');
    const addBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Додати пошту')!;
    await act(async () => { addBtn.click(); });
    const input = host.querySelector<HTMLInputElement>('[data-section="account"] input[type="email"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'new@example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    const sent = calls.filter((c) => c.url === '/v1/auth/email/attach/request');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ email: 'new@example.com' });
    expect(host.textContent).toContain('Лист надіслано');
  });

  it('пошта вже зайнята іншим акаунтом (409) — показує «Ця пошта вже має акаунт», поле лишається', async () => {
    noEmail();
    await mount();
    const addBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Додати пошту')!;
    await act(async () => { addBtn.click(); });
    const input = host.querySelector<HTMLInputElement>('[data-section="account"] input[type="email"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'taken@example.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(host.textContent).toContain('Ця пошта вже має акаунт');
    expect(host.querySelector<HTMLInputElement>('[data-section="account"] input[type="email"]')).not.toBeNull();
  });
});

// Злиття акаунтів (власник 15.09): «Підключити Telegram» → бот сказав, що
// Telegram уже має акаунт → у профілі note з кнопками; «Обʼєднати» → sage-note
// і рядок Telegram «підключено»; «Ні, лишити окремо» → note зникає.
describe('злиття акаунтів', () => {
  const yana = { kind: 'telegram', from_user_id: 'u-tg', household_name: 'Дім Яна', pantry_count: 12, recipe_count: 3, sole_member: true, proven_at: '2026-09-15T12:00:00.000Z' };
  it('конфлікт → note під рядком Telegram з текстом і двома кнопками', async () => {
    conflict = yana;
    await mount();
    const note = host.querySelector('[data-merge="ask"]')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('Цей Telegram уже має свій акаунт «Дім Яна»: комора 12, рецептів 3, у домі лише ти. Обʼєднати з цим акаунтом? Усе звідти переїде сюди, той акаунт закриється. Це не скасувати.');
    const btns = [...note.querySelectorAll('button')].map((b) => b.textContent);
    expect(btns).toEqual(['Обʼєднати', 'Ні, лишити окремо']);
    // Стоїть саме під рядком Telegram.
    expect(note.previousElementSibling?.matches('[data-telegram], [data-telegram-link]')).toBe(true);
  });
  it('«Обʼєднати» → POST merge, note «Обʼєднано…», рядок Telegram → підключено', async () => {
    conflict = yana;
    await mount();
    const btn = [...host.querySelectorAll('[data-merge="ask"] button')].find((b) => b.textContent === 'Обʼєднати')!;
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(calls.find((c) => c.url === '/v1/account/merge')?.body).toEqual({ from_user_id: 'u-tg' });
    const done = host.querySelector('[data-merge="done"]')!;
    expect(done.textContent).toBe('Обʼєднано. Telegram підключено, комора спільна: 12 позицій додано.');
    expect(host.querySelector('[data-telegram]')!.textContent).toContain('підключено');
  });
  it('«Ні, лишити окремо» → POST dismiss, note зникає, Telegram не підключений', async () => {
    conflict = yana;
    await mount();
    const btn = [...host.querySelectorAll('[data-merge="ask"] button')].find((b) => b.textContent === 'Ні, лишити окремо')!;
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(calls.some((c) => c.url === '/v1/account/conflict/dismiss')).toBe(true);
    expect(host.querySelector('[data-merge]')).toBeNull();
    expect(host.querySelector('[data-telegram]')!.textContent).toContain('Підключити');
  });
  it('у тому домі є ще хтось — текст «спершу вийди», кнопки «Обʼєднати» нема', async () => {
    conflict = { ...yana, sole_member: false };
    await mount();
    const note = host.querySelector('[data-merge="ask"]')!;
    expect(note.textContent).toContain('Спершу вийди з того дому');
    expect([...note.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Ні, лишити окремо']);
  });
  it('конфлікт по пошті — note під рядком «Пошта»', async () => {
    conflict = { ...yana, kind: 'email' };
    await mount();
    const note = host.querySelector('[data-merge="ask"]')!;
    expect(note.textContent).toContain('Ця пошта уже має свій акаунт');
    expect(note.previousElementSibling?.querySelector('[data-section="account"] input, .accKey') ?? note.previousElementSibling).not.toBeNull();
  });
});
