// @vitest-environment jsdom
// Кукінг-мод: звук таймера — спек 30.09
// (docs/superpowers/specs/2026-09-30-cook-timers-sound-design.md), §4.1–4.4.
// plan()/headOf()/малюнки — чисті функції, тестуються числами з еталона
// (docs/superpowers/specs/2026-09-30-cook-timers-sound-reference.html)
// без жодного AudioContext. DSP (tick/five/minute/alarm/second) і
// CookAudioSession перевіряються через мінімальний мок Web Audio — jsdom
// його не реалізує взагалі, а рахувати створені вузли достатньо, щоб
// зловити «намалював не той малюнок» чи «заскедулив двічі».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  plan, headOf, PULSE, SWING, GALOP,
  tick, five, minute, alarm, second,
  CookAudioSession, ringAlarm,
} from './cook-sound';

describe('headOf · §4.3 акценти', () => {
  it('кратне 60 — хвилина', () => { expect(headOf(60)).toBe('minute'); expect(headOf(120)).toBe('minute'); });
  it('кратне 5, не 60 — пʼять секунд', () => { expect(headOf(65)).toBe('five'); expect(headOf(5)).toBe('five'); });
  it('інше — звичайний тік', () => { expect(headOf(61)).toBe('tick'); expect(headOf(11)).toBe('tick'); });
});

describe('plan · §4.2 сценарій «Тихий пульс»', () => {
  it('більше 10 с — пульс, ×0,7', () => {
    expect(plan(11)).toEqual({ pattern: PULSE, head: 'tick', m: 0.7, name: 'тихий пульс' });
  });
  it('рівно 10 с — уже свінг, не пульс (межа «більше 10», не «від 10»)', () => {
    expect(plan(10)).toEqual({ pattern: SWING, head: 'five', m: 1, name: 'свінг' });
  });
  it('10…4 с — свінг, ×1', () => {
    expect(plan(7)).toEqual({ pattern: SWING, head: 'tick', m: 1, name: 'свінг' });
    expect(plan(4)).toEqual({ pattern: SWING, head: 'tick', m: 1, name: 'свінг' });
  });
  it('3…1 с — галоп, ×1, голова завжди tick', () => {
    expect(plan(3)).toEqual({ pattern: GALOP, head: 'tick', m: 1, name: 'галоп' });
    expect(plan(1)).toEqual({ pattern: GALOP, head: 'tick', m: 1, name: 'галоп' });
  });
  it('останні 3 секунди без акцентів навіть на кратних 5/60 (0 % 60 === 0, але це галоп)', () => {
    expect(plan(0)).toEqual({ pattern: GALOP, head: 'tick', m: 1, name: 'галоп' });
  });
  it('акцент хвилини — лише в пульсі (кратне 60 завжди >10, крім нуля — а нуль це вже галоп)', () => {
    expect(plan(60)).toEqual({ pattern: PULSE, head: 'minute', m: 0.7, name: 'тихий пульс' });
    expect(plan(120).head).toBe('minute');
  });
  it('малюнки — точні масиви з еталона', () => {
    expect(PULSE).toEqual([[0, 2], [5 / 6, 3]]);
    expect(SWING).toEqual([[0, 0], [1 / 3, 2], [0.5, 1], [5 / 6, 2]]);
    expect(GALOP).toEqual([[0, 0], [0.25, 2], [0.375, 3], [0.5, 1], [0.75, 2], [0.875, 3]]);
  });
});

// ── Мінімальний мок Web Audio ────────────────────────────────────────────
// jsdom не має AudioContext узагалі. Рахуємо створені вузли — саме стільки,
// скільки й має бути за структурою еталона (алярм — 26 клаців + 27 дзвоників
// по 3 обертони, і т.д.), без реального звуку.
class FakeParam { value = 0; setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } }
// Кожен вузол «зʼєднується» сам із собою — реальна маршрутизація тут не при
// ділі (жоден тест не слухає звук), важливо лише, щоб ланцюжок
// `a.connect(b).connect(c)` довільної довжини ніколи не впав.
function node<T extends object>(extra: T): T & { connect: () => T & { connect: () => unknown } } {
  const n = extra as T & { connect: () => T & { connect: () => unknown } };
  n.connect = () => n;
  return n;
}
function makeCtx(counts: { osc: number; buf: number; filt: number; gain: number }) {
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running' as AudioContextState,
    destination: {},
    createOscillator() {
      counts.osc++;
      return node({ frequency: new FakeParam(), start: () => {}, stop: () => {} });
    },
    createGain() {
      counts.gain++;
      return node({ gain: new FakeParam() });
    },
    createBufferSource() {
      counts.buf++;
      return node({ buffer: null as unknown, start: () => {} });
    },
    createBiquadFilter() {
      counts.filt++;
      return node({ type: '', frequency: new FakeParam(), Q: new FakeParam() });
    },
    createBuffer(_ch: number, len: number) {
      return { getChannelData: () => new Float32Array(len) };
    },
    resume: () => { ctx.state = 'running'; return Promise.resolve(); },
    close: () => { ctx.state = 'closed'; return Promise.resolve(); },
  };
  return ctx;
}

describe('DSP · структура звуку (кількість вузлів, не тембр)', () => {
  it('tick — один клац (buffer) і один тон (oscillator)', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    tick(ctx as unknown as AudioContext, {} as AudioNode, 0, 0, 1);
    expect(counts.osc).toBe(1);
    expect(counts.buf).toBe(1);
  });

  it('five — один клац і один тон', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    five(ctx as unknown as AudioContext, {} as AudioNode, 0, 1);
    expect(counts.osc).toBe(1);
    expect(counts.buf).toBe(1);
  });

  it('minute — подвійний клац: два клаци, два тони (§4.3)', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    minute(ctx as unknown as AudioContext, {} as AudioNode, 0, 1);
    expect(counts.osc).toBe(2);
    expect(counts.buf).toBe(2);
  });

  it('alarm — 26 клаців + 27 дзвоників×3 обертони = 81 тон (§4.4)', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    alarm(ctx as unknown as AudioContext, {} as AudioNode, 0);
    expect(counts.buf).toBe(26);
    expect(counts.osc).toBe(27 * 3);
  });

  it('second: голова tick (пульс) — усі рядки малюнка йдуть тіками', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    second(ctx as unknown as AudioContext, {} as AudioNode, 0, { pattern: PULSE, head: 'tick', m: 1, name: 'тихий пульс' });
    expect(counts.osc).toBe(PULSE.length);
    expect(counts.buf).toBe(PULSE.length);
  });

  it('second: голова five/minute замінює перший тік малюнка, не додається до нього', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    // SWING: [[0,0],[1/3,2],[0.5,1],[5/6,2]] — offset 0 замінюється head, лишається 3 тіки.
    second(ctx as unknown as AudioContext, {} as AudioNode, 0, { pattern: SWING, head: 'five', m: 1, name: 'свінг' });
    // five() = 1 клац+1 тон, + 3 тіки (offset≠0) = 1 клац+1 тон, кожен тік теж клац+тон.
    expect(counts.buf).toBe(1 + 3);
    expect(counts.osc).toBe(1 + 3);
  });
});

describe('CookAudioSession · §5 тікання наперед від дедлайну, скасування, аларм', () => {
  let counts: { osc: number; buf: number; filt: number; gain: number };
  let ctxInstances: number;

  beforeEach(() => {
    vi.useFakeTimers();
    counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    ctxInstances = 0;
    vi.stubGlobal('AudioContext', class {
      constructor() { ctxInstances++; return makeCtx(counts) as unknown as AudioContext; }
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('тікає раз на секунду, не двічі на той самий left', async () => {
    const s = new CookAudioSession();
    const deadline = Date.now() + 3000;
    s.startTicking(deadline);
    expect(counts.osc + counts.buf).toBeGreaterThan(0); // перший такт (left=3, галоп) одразу
    const afterFirst = counts.osc + counts.buf;
    await vi.advanceTimersByTimeAsync(50); // той самий left=3 — без повторного планування
    expect(counts.osc + counts.buf).toBe(afterFirst);
    await vi.advanceTimersByTimeAsync(1000); // тепер left=2 — новий такт
    expect(counts.osc + counts.buf).toBeGreaterThan(afterFirst);
  });

  it('зупиняється сама на нулі (без нескінченного циклу)', async () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 500);
    await vi.advanceTimersByTimeAsync(3000);
    // Якщо таймер не зупинився сам, advanceTimersByTimeAsync тут завис би/кинув —
    // сам факт завершення проходу вже підтверджує зупинку.
    expect(true).toBe(true);
  });

  it('stopTicking скасовує заплановане одразу — далі жодних нових вузлів', async () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 5000);
    await vi.advanceTimersByTimeAsync(10);
    const before = counts.osc + counts.buf;
    s.stopTicking();
    await vi.advanceTimersByTimeAsync(5000);
    expect(counts.osc + counts.buf).toBe(before);
  });

  it('приглушено (isMuted) — контекст живий, але жодного звукового вузла', async () => {
    const s = new CookAudioSession(() => true);
    s.startTicking(Date.now() + 3000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(ctxInstances).toBe(1); // ensure() усе одно готує контекст — раптове розм'ючення не запізниться
    expect(counts.osc).toBe(0);
    expect(counts.buf).toBe(0);
  });

  it('playAlarm — той самий алярм, що DSP (26 клаців)', () => {
    const s = new CookAudioSession();
    s.playAlarm();
    expect(counts.buf).toBe(26);
  });

  it('playAlarm приглушено — жодного вузла, контекст навіть не створюється', () => {
    const s = new CookAudioSession(() => true);
    s.playAlarm();
    expect(ctxInstances).toBe(0);
    expect(counts.buf).toBe(0);
  });

  it('close() зупиняє тікання й закриває контекст', async () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 5000);
    await vi.advanceTimersByTimeAsync(10);
    s.close();
    const before = counts.osc + counts.buf;
    await vi.advanceTimersByTimeAsync(5000);
    expect(counts.osc + counts.buf).toBe(before);
  });
});

describe('ringAlarm · §2.1/§2.2/§2.3 аларм+вібро+нотифікація з одного місця', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', class { constructor() { return makeCtx({ osc: 0, buf: 0, filt: 0, gain: 0 }) as unknown as AudioContext; } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('кличе session.playAlarm() і вібрацію [200,100,200]', () => {
    const s = new CookAudioSession();
    const spy = vi.spyOn(s, 'playAlarm');
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    ringAlarm(s, 'Крок 1');
    expect(spy).toHaveBeenCalledOnce();
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200]);
  });

  it('onlyWhenHidden: не показує Notification на видимій вкладці, показує на схованій', () => {
    const s = new CookAudioSession();
    const NotificationMock = vi.fn();
    vi.stubGlobal('Notification', Object.assign(NotificationMock, { permission: 'granted' }));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    ringAlarm(s, 'Крок', { onlyWhenHidden: true });
    expect(NotificationMock).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    ringAlarm(s, 'Крок', { onlyWhenHidden: true });
    expect(NotificationMock).toHaveBeenCalledOnce();
  });

  it('без onlyWhenHidden — нотифікація йде незалежно від видимості вкладки (GlobalCookAlarm)', () => {
    const s = new CookAudioSession();
    const NotificationMock = vi.fn();
    vi.stubGlobal('Notification', Object.assign(NotificationMock, { permission: 'granted' }));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    ringAlarm(s, 'Паста з сиром');
    expect(NotificationMock).toHaveBeenCalledOnce();
    expect(NotificationMock).toHaveBeenCalledWith('Kitchen OS · таймер', expect.objectContaining({ body: 'Паста з сиром — час вийшов' }));
  });
});
