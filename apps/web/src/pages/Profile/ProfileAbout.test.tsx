// @vitest-environment jsdom
//
// Крок П3 (2, 3, 4): «ПРО ТЕБЕ» і «НОТАТКИ» — один компонент на сторінку й на
// панель, курсор у кінець рядка на вказівник моделі, і тихий рядок покриття
// під полями, з яких будується вето.
//
// Найдорожче тут — покриття. Людина бачить «Мені не можна фундук і арахіс» і
// вважає, що захищена від обох; насправді за словом може стояти рядок `free`,
// який вето не читає ніколи. З екрана це не відрізнити.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ProfileAbout } from './ProfileAbout';
import { ProfileV2 } from './ProfileV2';
import type { ProfileV2Response } from '../../api';
import { useAuth } from '../../store/auth';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const field = (text: string, status: 'empty' | 'filled' | 'none' = text ? 'filled' : 'empty') =>
  ({ text, status, updated_at: text ? '2026-09-05T00:00:00.000Z' : null });

const initial = (over: Partial<ProfileV2Response> = {}): ProfileV2Response => ({
  fields: {
    name: field('Пилип'), no: field('кінзи'), ban: field('фундук, лактоза'), love: field('супи'),
    meh: field(''), kit: field('гриль'), when: field('ввечері'),
  },
  notes: [
    { id: 'n1', text: 'Духовка гріє на 20 сильніше', source: 'assistant', created_at: '2026-09-02T10:00:00.000Z' },
  ],
  defaults: { kit: ['плита', 'духовка', 'мікрохвильовка', 'холодильник'] },
  // Так виглядає індекс насправді: «фундук» каталог знає, «лактоза» — ні.
  veto: [
    { field: 'ban', kind: 'category', ref: 'фундук', label: 'фундук', allergy: true },
    { field: 'ban', kind: 'free', ref: null, label: 'лактоза', allergy: true },
    { field: 'no', kind: 'category', ref: 'кінза', label: 'кінзи', allergy: false },
  ],
  ...over,
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/v1/profile/') && (init?.method ?? 'GET') === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const text = String(body.text ?? '');
      return json({ field: { text, status: text ? 'filled' : 'empty', updated_at: null }, veto_index: [] });
    }
    // Сторінка тягне ще й дім та мережі — віддаємо порожні, але правильної форми.
    if (url.endsWith('/invites')) return json({ invites: [] });
    if (url === '/v1/retail') return json({ silpo: { status: 'unavailable' } });
    return json({});
  }));
}

async function mount(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter>{ui}</MemoryRouter>); });
}

beforeEach(() => {
  installFetch();
  useAuth.setState({
    status: 'signed_in',
    me: {
      user: { id: 'u1', name: 'Пилип', email: 'p@x.local', plan: 'beta' },
      household: { id: 'h1', name: 'Дім', role: 'owner', members: [] },
      session_id: 's1',
    },
  } as never);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

const q = (sel: string) => host!.querySelector(sel);

describe('П3 (4): рядок покриття', () => {
  it('показує, які слова продукт упізнав, а які лише запамʼятав', async () => {
    await mount(<ProfileAbout initial={initial()} />);
    const ban = q('[data-coverage="ban"]')!;
    expect(ban).toBeTruthy();
    expect(ban.textContent).toContain('фундук');
    // «лактоза» — рядок free: вето його не читає, і це має бути видно.
    const unknown = ban.querySelector('[data-coverage-unknown]')!;
    expect(unknown).toBeTruthy();
    expect(unknown.textContent).toContain('лактоза');
    expect(unknown.textContent).not.toContain('фундук');
  });

  it('стоїть лише під полями, з яких будується вето', async () => {
    await mount(<ProfileAbout initial={initial()} />);
    expect(q('[data-coverage="no"]')).toBeTruthy();
    expect(q('[data-coverage="ban"]')).toBeTruthy();
    // «Я люблю» і «на кухні є» вето не годують — там рядка немає.
    expect(q('[data-coverage="love"]')).toBeNull();
    expect(q('[data-coverage="kit"]')).toBeNull();
  });

  it('усе впізнано — «не знаю» не зʼявляється взагалі', async () => {
    await mount(<ProfileAbout initial={initial({
      veto: [{ field: 'ban', kind: 'category', ref: 'фундук', label: 'фундук', allergy: true }],
    })} />);
    expect(q('[data-coverage="ban"]')).toBeTruthy();
    expect(q('[data-coverage-unknown]')).toBeNull();
  });

  it('індексу немає — рядка немає, а не порожній рядок', async () => {
    await mount(<ProfileAbout initial={initial({ veto: undefined })} />);
    expect(q('[data-coverage="ban"]')).toBeNull();
  });
});

describe('П3 (3): курсор на вказівник моделі', () => {
  it('фокус стає в рядок і в КІНЕЦЬ наявного тексту — продукт нічого не вписує', async () => {
    const before = initial().fields.ban.text;
    await mount(<ProfileAbout initial={initial()} focusKey="ban" />);
    const edit = q('[data-row="ban"] [contenteditable]') as HTMLElement;
    expect(document.activeElement).toBe(edit);
    // Текст не змінився: панель відкрилась порожнім хвостом.
    expect(edit.textContent).toBe(before);
  });

  it('без вказівника фокус нікуди не стає', async () => {
    await mount(<ProfileAbout initial={initial()} />);
    expect(document.activeElement).not.toBe(q('[data-row="ban"] [contenteditable]'));
  });

  it('свіжу нотатку видно як свіжу', async () => {
    await mount(<ProfileAbout initial={initial()} freshNoteIds={['n1']} />);
    expect(q('[data-note="n1"]')!.hasAttribute('data-fresh')).toBe(true);
  });
});

describe('П3 (2): сторінка і панель — той самий компонент', () => {
  it('усе, що дає ProfileAbout, є й на сторінці', async () => {
    await mount(<ProfileAbout initial={initial()} />);
    const alone = [...host!.querySelectorAll('[data-row]')].map((e) => e.getAttribute('data-row'));
    const coverageAlone = !!q('[data-coverage="ban"]');
    await act(async () => { root!.unmount(); });
    host!.remove();

    await mount(<ProfileV2 initial={initial()} />);
    const onPage = [...host!.querySelectorAll('[data-row]')].map((e) => e.getAttribute('data-row'));
    // Ті самі сім рядків у тому самому порядку — бо це буквально один код.
    expect(onPage).toEqual(alone);
    expect(!!q('[data-coverage="ban"]')).toBe(coverageAlone);
  });

  it('сторінка лишила собі те, що в панель не їде', async () => {
    await mount(<ProfileV2 initial={initial()} />);
    // ДІМ / МЕРЕЖІ / АКАУНТ — налаштування, поруч із чатом їм нема чого робити.
    expect(q('[data-section="home"]')).toBeTruthy();
    await act(async () => { root!.unmount(); });
    host!.remove();
    await mount(<ProfileAbout initial={initial()} />);
    expect(q('[data-section="home"]')).toBeNull();
  });
});
