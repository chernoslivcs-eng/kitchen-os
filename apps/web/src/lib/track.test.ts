// @vitest-environment jsdom
//
// Крок О1а: черга подій. Ламається тихо у двох місцях — якщо не батчить
// (двадцять запитів замість одного), і якщо не шле на згортання вкладки
// (людина закриває застосунок, і день обривається на середині).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { track, startTracking, __resetTracking, __queue, MAX_BATCH } from './track';

let sent: { events: { name: string; props?: Record<string, unknown> }[]; device?: { w: number; class: string; ua: string | null } }[];
let stop: () => void;

beforeEach(() => {
  sent = [];
  __resetTracking();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    return new Response('{}', { status: 200 });
  }));
  stop = startTracking();
});
afterEach(() => {
  stop?.();
  __resetTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('черга', () => {
  it('копить і шле ОДНІЄЮ пачкою раз на десять секунд', async () => {
    track('pantry_opened');
    track('cook_started', { steps: 5 });
    track('shopping_opened');
    expect(sent).toHaveLength(0);          // одразу нічого не летить

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);          // один запит, не три
    expect(sent[0]!.events.map((e) => e.name))
      .toEqual(['pantry_opened', 'cook_started', 'shopping_opened']);
  });

  it('шле на згортання вкладки, не чекаючи таймера', async () => {
    track('calendar_opened');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.events[0]!.name).toBe('calendar_opened');
  });

  it('повна пачка йде одразу, не чекаючи десяти секунд', async () => {
    for (let i = 0; i < 20; i++) track('pantry_opened');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.events).toHaveLength(20);
  });

  it('втрата події — не помилка: мережа впала, застосунок живе', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    track('pantry_opened');
    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
    // Повторів не робимо: подія про нас, не про людину.
    expect(__queue()).toHaveLength(0);
  });

  it('черга не росте безмежно, якщо мережі немає довго', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    for (let i = 0; i < 500; i++) {
      track('pantry_opened');
      // Стеля тримається на КОЖНОМУ кроці, не лише в кінці: п'ятсот подій
      // офлайн не мають з'їсти памʼять вкладки.
      expect(__queue().length).toBeLessThanOrEqual(MAX_BATCH);
    }
  });

  it('props їдуть як є — структурні', async () => {
    track('cook_step_reached', { step: 3, of: 7 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent[0]!.events[0]!.props).toEqual({ step: 3, of: 7 });
  });
});

describe('пристрій у конверті', () => {
  // Крок А1: пристрій їде РАЗ НА ПАЧКУ. Двадцять однакових знімків в одному
  // запиті були б двадцятьма копіями того самого факту.
  it('конверт несе ширину й клас — один раз на всю пачку', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    track('welcome_started');
    track('welcome_card_reached', { card: 1 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.device).toMatchObject({ w: 390, class: 'mobile' });
    // У самих подіях пристрою немає — інакше він задвоївся б на кожному рядку.
    expect(sent[0]!.events.every((e) => !('device' in e))).toBe(true);
  });

  it('клас у конверті рахується з ШИРИНИ, а не з чогось іще', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    track('pantry_opened');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent[0]!.device).toMatchObject({ w: 1024, class: 'desktop' });
  });
});
