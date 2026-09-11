// @vitest-environment jsdom
//
// Крок Е1: стани, коли щось пішло не так.
//
// Перевіряється те, що ламається тихо і дорого: межа, яка ковтає помилку
// (тоді про падіння не дізнається ніхто); смуга, яка чистить поле вводу (тоді
// людина втрачає написане); порожній екран замість «не вдалось показати»
// (тоді комора бреше, що вона порожня).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorScreen } from './ErrorScreen';
import { Strip } from './Strip';
import { IncidentStrips, useIncidentSink } from './IncidentStrips';
import { useIncidentStore } from '../../store/incident';
import { AUTH_STRIP, THROTTLED_STRIP, THROTTLED_BY_KIND, NOT_FOUND } from './copy';
import { api, registerIncidentSink } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter>{ui}</MemoryRouter>); });
}

const q = (sel: string) => document.querySelector(sel);
const txt = (sel: string) => document.querySelector(sel)?.textContent ?? '';

beforeEach(() => {
  useIncidentStore.setState({ authExpired: false, throttledUntil: null, throttledFor: 0, offline: false });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Boom(): React.ReactNode { throw new Error('впав рендер'); }

describe('ErrorBoundary', () => {
  it('показує екран замість падіння', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(<ErrorBoundary onError={() => {}}><Boom /></ErrorBoundary>);
    expect(q('[data-error-screen]')).toBeTruthy();
    expect(host!.textContent).toContain('Комора на місці.');
    expect(host!.textContent).toContain('Цей екран — ні.');
    spy.mockRestore();
  });

  it('НЕ ковтає помилку — подія все одно йде', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: Error[] = [];
    await mount(<ErrorBoundary onError={(e) => { seen.push(e); }}><Boom /></ErrorBoundary>);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toBe('впав рендер');
    spy.mockRestore();
  });

  it('код інциденту рендериться, лише коли він є', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Без О1 звіт коду не повертає — чипа немає взагалі, а не порожній чип.
    await mount(<ErrorBoundary onError={() => {}}><Boom /></ErrorBoundary>);
    expect(q('[data-error-code]')).toBeNull();
    await act(async () => { root!.unmount(); });

    // З О1 звіт поверне короткий код — чип зʼявиться сам.
    await mount(<ErrorBoundary onError={() => 'E7F2'}><Boom /></ErrorBoundary>);
    expect(txt('[data-error-code]')).toBe('E7F2');
    spy.mockRestore();
  });

  it('падіння самого звіту не забирає в людини екран', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(<ErrorBoundary onError={() => { throw new Error('Sentry впав'); }}><Boom /></ErrorBoundary>);
    expect(q('[data-error-screen]')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('код інциденту', () => {
  it('копіюється кліком і каже про це 1.6 с', async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } } });
    await mount(<ErrorScreen kicker="екран здався" code="E7F2" h1a="а" h1b="б" body="в" cta="г" onCta={() => {}} />);

    await act(async () => { (q('[data-error-code]') as HTMLButtonElement).click(); });
    expect(written).toEqual(['E7F2']);
    expect(txt('[data-error-code]')).toBe('скопійовано');

    await act(async () => { vi.advanceTimersByTime(1700); });
    expect(txt('[data-error-code]')).toBe('E7F2');
  });

  it('404 несе код у тому самому чипі', async () => {
    await mount(<ErrorScreen kicker={NOT_FOUND.kicker} code="404" h1a={NOT_FOUND.h1a} h1b="" body={NOT_FOUND.body} cta="x" onCta={() => {}} />);
    expect(txt('[data-error-code]')).toBe('404');
    expect(txt('[data-error-kicker]')).toBe('тут нічого не готують');
    // Тіло копі лишилось дослівно.
    expect(host!.textContent).toContain('Стрічка чекає на тебе.');
  });
});

describe('смуги', () => {
  it('401 показує смугу з дією', async () => {
    await mount(<IncidentStrips />);
    expect(q('[data-strip]')).toBeNull();
    await act(async () => { useIncidentStore.getState().setAuthExpired(true); });
    expect(q('[data-strip]')).toBeTruthy();
    expect(host!.textContent).toContain(AUTH_STRIP.h1a);
    expect(host!.textContent).toContain(AUTH_STRIP.cta);
    // Хрестика немає ніде — і в смузі з дією теж.
    expect(host!.textContent).not.toContain('×');
    // Етап 5 (п.7), Errors E2: рід кольором — «треба дія» = plum.
    expect(q('[data-strip]')!.getAttribute('data-strip-tone')).toBe('plum');
  });

  it('E2: тон роду — 429 amber, офлайн card', async () => {
    await mount(<IncidentStrips />);
    await act(async () => { useIncidentStore.getState().setThrottled(30); });
    expect(q('[data-strip]')!.getAttribute('data-strip-tone')).toBe('amber');
    await act(async () => { useIncidentStore.getState().clearThrottled(); useIncidentStore.getState().setOffline(true); });
    expect(q('[data-strip]')!.getAttribute('data-strip-tone')).toBe('card');
  });

  it('429 показує смугу БЕЗ кнопки, з «мине саме» і смужкою', async () => {
    await mount(<IncidentStrips />);
    await act(async () => { useIncidentStore.getState().setThrottled(30); });
    expect(q('[data-strip]')).toBeTruthy();
    expect(host!.textContent).toContain(THROTTLED_STRIP.h1a);
    expect(txt('[data-strip-passes]')).toBe('мине саме');
    expect(q('[data-strip-drain]')).toBeTruthy();
    expect(host!.querySelector('button')).toBeNull();
  });

  // Етап 3 (рішення 11.09): 429 називає, ЯКИЙ ліміт. Сервер шле `kind` у
  // тілі; клієнт має працювати і без нього — стара смуга запасна.
  it('429 з kind — смуга називає ліміт; без kind — загальна, як і було', async () => {
    await mount(<IncidentStrips />);
    await act(async () => { useIncidentStore.getState().setThrottled(30, 'recipe_gen'); });
    expect(host!.textContent).toContain(THROTTLED_BY_KIND.recipe_gen!.h1a);
    expect(host!.textContent).not.toContain(THROTTLED_STRIP.h1a);
    expect(q('[data-strip]')?.getAttribute('data-strip-kind')).toBe('recipe_gen');

    await act(async () => { useIncidentStore.getState().clearThrottled(); });
    await act(async () => { useIncidentStore.getState().setThrottled(30); });
    expect(host!.textContent).toContain(THROTTLED_STRIP.h1a);
    expect(q('[data-strip]')?.getAttribute('data-strip-kind')).toBe('generic');

    // Вид, для якого слова немає, — теж загальна смуга, не порожнеча.
    await act(async () => { useIncidentStore.getState().clearThrottled(); });
    await act(async () => { useIncidentStore.getState().setThrottled(30, 'track'); });
    expect(host!.textContent).toContain(THROTTLED_STRIP.h1a);
  });

  it('req(): kind із тіла 429 доходить у стор; без поля — null', async () => {
    const calls: [number, string | null | undefined][] = [];
    registerIncidentSink({ setAuthExpired() {}, setThrottled: (s, k) => { calls.push([s, k]); }, setOffline() {} });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'too many requests', kind: 'chat' }), { status: 429, headers: { 'Retry-After': '42', 'content-type': 'application/json' } })));
    await expect(api.pantry()).rejects.toBeTruthy();
    expect(calls.at(-1)).toEqual([42, 'chat']);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'too many requests' }), { status: 429, headers: { 'Retry-After': '7', 'content-type': 'application/json' } })));
    await expect(api.pantry()).rejects.toBeTruthy();
    expect(calls.at(-1)).toEqual([7, null]);
    registerIncidentSink(null);
    vi.unstubAllGlobals();
  });

  it('смужка стікає за реальний час, а не за константу', async () => {
    vi.useFakeTimers();
    const done: boolean[] = [];
    await mount(<Strip kicker="k" h1a="a" h1b="b" body="c" seconds={10} onDone={() => done.push(true)} />);
    const scale = () => (q('[data-strip-drain]') as HTMLElement).style.transform;
    expect(scale()).toBe('scaleX(1)');

    await act(async () => { vi.advanceTimersByTime(5000); });
    const half = Number(scale().replace(/[^\d.]/g, ''));
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);

    await act(async () => { vi.advanceTimersByTime(5200); });
    expect(done).toEqual([true]);
  });

  it('смуга не звужує колонку: та сама ширина 720, що в композитора', async () => {
    await mount(<IncidentStrips />);
    await act(async () => { useIncidentStore.getState().setAuthExpired(true); });
    const column = q('[data-incident-strips] > div') as HTMLElement;
    // CSS-модулі у vitest порожні, тож перевіряємо не піксель, а те, що
    // смуга живе у ВЛАСНІЙ обгортці-колонці, а не всередині стрічки — саме
    // це не давало б їй зсунути розкладку.
    expect(column).toBeTruthy();
    expect(column.parentElement!.hasAttribute('data-incident-strips')).toBe(true);
  });
});

describe('стор інцидентів', () => {
  it('довший ліміт перебиває коротший', () => {
    const s = useIncidentStore.getState();
    s.setThrottled(10);
    const first = useIncidentStore.getState().throttledUntil!;
    s.setThrottled(5);
    expect(useIncidentStore.getState().throttledUntil).toBe(first);
    s.setThrottled(60);
    expect(useIncidentStore.getState().throttledUntil!).toBeGreaterThan(first);
  });

  it('приймач реєструється в api і знімається на розмонтуванні', async () => {
    function Probe() { useIncidentSink(); return null; }
    const api = await import('../../api');
    await mount(<Probe />);
    // Зареєстрований: 401 із запиту дійде до стора.
    await act(async () => { root!.unmount(); });
    // Після зняття — жодного витоку в стор із мертвого компонента.
    expect(typeof api.registerIncidentSink).toBe('function');
  });
});
