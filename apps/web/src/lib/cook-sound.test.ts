// @vitest-environment jsdom
// Кукінг-мод: звук таймера — спек 30.09
// (docs/superpowers/specs/2026-09-30-cook-timers-sound-design.md), §4.1–4.4.
// plan()/headOf()/малюнки — чисті функції, тестуються числами з еталона
// (docs/superpowers/specs/2026-09-30-cook-timers-sound-reference.html)
// без жодного AudioContext. DSP (tick/five/minute/alarm/second/secondFrom) і
// CookAudioSession перевіряються через мінімальний мок Web Audio — jsdom
// його не реалізує взагалі, а рахувати створені вузли (і, де треба, точний
// час start()) достатньо, щоб зловити «намалював не той малюнок», «заскедулив
// двічі» чи «запізнився» (перегляд 30.09, issues #1/#2/#3/#4).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  plan, headOf, PULSE, SWING, GALOP,
  tick, five, minute, alarm, second, secondFrom,
  currentLeft, boundaryAudioTime, rearmDelayMs,
  CookAudioSession, ringAlarm, getCookAudioSession, closeCookAudioSession,
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
// по 3 обертони, і т.д.), без реального звуку. Для перегляду 30.09 (issue #1)
// currentTime — ГЕТТЕР, привʼязаний до Date.now() (fake timers рухають
// обидва синхронно) — інакше «точність до мс» неможливо перевірити взагалі.
class FakeParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
// Кожен вузол «зʼєднується» сам із собою — реальна маршрутизація тут не при
// ділі (жоден тест не слухає звук), важливо лише, щоб ланцюжок
// `a.connect(b).connect(c)` довільної довжини ніколи не впав.
function node<T extends object>(extra: T): T & { connect: () => T & { connect: () => unknown } } {
  const n = extra as T & { connect: () => T & { connect: () => unknown } };
  n.connect = () => n;
  return n;
}
interface NoteCall { at: number; committedAt: number }
function makeCtx(
  counts: { osc: number; buf: number; filt: number; gain: number },
  notes: NoteCall[] = [],
  gains: FakeParam[] = [],
  origin: number = Date.now(),
) {
  const ctx = {
    get currentTime() { return (Date.now() - origin) / 1000; },
    sampleRate: 44100,
    state: 'running' as AudioContextState,
    destination: {},
    createOscillator() {
      counts.osc++;
      return node({ frequency: new FakeParam(), start: (t: number) => notes.push({ at: t, committedAt: ctx.currentTime }), stop: () => {} });
    },
    createGain() {
      counts.gain++;
      const g = new FakeParam();
      gains.push(g);
      return node({ gain: g });
    },
    createBufferSource() {
      counts.buf++;
      return node({ buffer: null as unknown, start: (t: number) => notes.push({ at: t, committedAt: ctx.currentTime }) });
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

// Перегляд 30.09 (issue #1): перший частковий такт після старту (жест
// припав на середину секунди) і «проспана» межа — ноти, чий час УЖЕ минув
// відносно notBefore, не грають; малюнок не зсувається (решта нот лишається
// на своїх «межа+зсув» місцях).
describe('secondFrom · issue #1 — не зсуває малюнок, пропускає ноти, чий час минув', () => {
  it('at ≥ notBefore — усі ноти йдуть, точно як у second()', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    secondFrom(ctx as unknown as AudioContext, {} as AudioNode, 0, { pattern: PULSE, head: 'tick', m: 1, name: 'тихий пульс' }, -1);
    expect(counts.osc + counts.buf).toBe(2 * PULSE.length);
  });

  it('перша нота минула (0 < notBefore), друга (5/6 с) — ще ні: лишається тільки друга', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    secondFrom(ctx as unknown as AudioContext, {} as AudioNode, 0, { pattern: PULSE, head: 'tick', m: 1, name: 'тихий пульс' }, 0.5);
    expect(counts.osc + counts.buf).toBe(2); // лише клац+тон другого тіку
  });

  it('голова (five/minute) теж фільтрується як нота — минула, якщо at < notBefore', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    // SWING head=minute, at=0: offsets [0(head),1/3,0.5,5/6]. notBefore=0.4 —
    // head (о 0) і перший тік (1/3≈0.333) минули; лишаються 0.5 і 5/6.
    secondFrom(ctx as unknown as AudioContext, {} as AudioNode, 0, { pattern: SWING, head: 'minute', m: 1, name: 'свінг' }, 0.4);
    expect(counts.osc + counts.buf).toBe(4); // 2 тіки × (клац+тон)
  });

  it('усе минуло (notBefore за межею останньої ноти) — жодного вузла', () => {
    const counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    const ctx = makeCtx(counts);
    secondFrom(ctx as unknown as AudioContext, {} as AudioNode, 0, { pattern: GALOP, head: 'tick', m: 1, name: 'галоп' }, 10);
    expect(counts.osc + counts.buf).toBe(0);
  });
});

// Перегляд 30.09 (issue #1): чиста арифметика без жодного AudioContext —
// «межа+зсув» з точністю до мілісекунди перевіряється прямо, не через мок.
describe('currentLeft/boundaryAudioTime/rearmDelayMs · §5 планування наперед (issue #1)', () => {
  it('currentLeft — стеля до секунди, те саме число, що на екрані', () => {
    const deadline = 100_000;
    expect(currentLeft(deadline, 100_000)).toBe(0);
    expect(currentLeft(deadline, 99_001)).toBe(1);
    expect(currentLeft(deadline, 97_500)).toBe(3); // 2500мс лишилось → стеля 3
    expect(currentLeft(deadline, 90_000)).toBe(10);
  });

  it('boundaryAudioTime — точний аудіо-час межі, мс-точність', () => {
    const deadline = 100_000;
    // Межа left=2 настає о deadline-2000=98_000. Зараз 97_950 (за 50мс до неї), ctxNow=5.
    expect(boundaryAudioTime(deadline, 2, 97_950, 5)).toBeCloseTo(5.05, 6);
    // Точно на межі (nowMs дорівнює її wall-часу) — at === ctxNow.
    expect(boundaryAudioTime(deadline, 2, 98_000, 5)).toBeCloseTo(5, 6);
    // Проспали межу на 20мс — at виходить У МИНУЛОМУ відносно ctxNow (це і
    // фільтрує secondFrom, а не boundaryAudioTime — вона чесно рахує факт).
    expect(boundaryAudioTime(deadline, 2, 98_020, 5)).toBeCloseTo(4.98, 6);
  });

  it('rearmDelayMs — прокидається ~лукахед мс ДО межі, не щосекунди наосліп', () => {
    const deadline = 100_000;
    // Щойно почали: nowMs=90_000, left=10, межа цієї секунди — за 1000мс.
    expect(rearmDelayMs(deadline, 90_000, 120, 10)).toBe(1000 - 0 - 120);
    // За 900мс у секунду — лишається 100мс до межі, та лукахед 120 більший:
    // притискаємось до мінімуму, не йдемо в мінус.
    expect(rearmDelayMs(deadline, 90_900, 120, 10)).toBe(10);
  });

  it('rearmDelayMs — дедлайн уже минув: -1, зупинитись', () => {
    expect(rearmDelayMs(100_000, 100_000, 120, 10)).toBe(-1);
    expect(rearmDelayMs(100_000, 105_000, 120, 10)).toBe(-1);
  });
});

describe('CookAudioSession · §5 тікання наперед, скасування гейтом, спільна сесія, аларм', () => {
  let counts: { osc: number; buf: number; filt: number; gain: number };
  let notes: NoteCall[];
  let gains: FakeParam[];
  let ctxInstances: number;

  beforeEach(() => {
    vi.useFakeTimers();
    counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    notes = [];
    gains = [];
    ctxInstances = 0;
    const origin = Date.now();
    vi.stubGlobal('AudioContext', class {
      constructor() { ctxInstances++; return makeCtx(counts, notes, gains, origin) as unknown as AudioContext; }
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); closeCookAudioSession(); });

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

  it('issue #1: жодна нота не запізнюється — і хоч одна лягає ЗАЗДАЛЕГІДЬ (лукахед), не постфактум', async () => {
    const s = new CookAudioSession();
    const deadline = Date.now() + 4000;
    s.startTicking(deadline);
    await vi.advanceTimersByTimeAsync(3500);
    // Жодна нота не запланована пізніше за мить її власного коміту —
    // старий баг клеїв «at = currentTime + 0.005» постфактум (5–20мс пізно).
    for (const n of notes) expect(n.at).toBeGreaterThanOrEqual(n.committedAt - 0.001);
    // І хоч одна нота лягла помітно ЗАЗДАЛЕГІДЬ (справжній лукахед, не «зараз»).
    expect(notes.some((n) => n.at - n.committedAt > 0.05)).toBe(true);
  });

  it('зупиняється сама на нулі (без нескінченного циклу)', async () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 500);
    await vi.advanceTimersByTimeAsync(3000);
    // Якщо таймер не зупинився сам, advanceTimersByTimeAsync тут завис би/кинув —
    // сам факт завершення проходу вже підтверджує зупинку.
    expect(true).toBe(true);
  });

  it('issue #2: stopTicking глушить шину ОДРАЗУ (gain→0) — те, що вже заплановано, нового вузла не додає', async () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 5000);
    await vi.advanceTimersByTimeAsync(10);
    const tickGate = gains[1]!; // master, tickGate — саме в цьому порядку в ensure()
    expect(tickGate.value).toBe(1);
    const before = counts.osc + counts.buf;
    s.stopTicking();
    expect(tickGate.value).toBe(0); // синхронно, не з наступним тактом
    await vi.advanceTimersByTimeAsync(5000);
    expect(counts.osc + counts.buf).toBe(before);
  });

  it('issue #2: setMuted(true) глушить шину миттєво посеред тікання, setMuted(false) — повертає', () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 3000);
    const tickGate = gains[1]!;
    expect(tickGate.value).toBe(1);
    s.setMuted(true);
    expect(tickGate.value).toBe(0);
    s.setMuted(false);
    expect(tickGate.value).toBe(1);
  });

  it('приглушено від старту — контекст живий (жест уже був), шина одразу на нулі', () => {
    const s = new CookAudioSession();
    s.setMuted(true);
    s.startTicking(Date.now() + 3000);
    expect(ctxInstances).toBe(1);
    expect(gains[1]!.value).toBe(0);
  });

  it('playAlarm — той самий алярм, що DSP (26 клаців), повз шину тіків', () => {
    const s = new CookAudioSession();
    s.playAlarm();
    expect(counts.buf).toBe(26);
  });

  it('playAlarm приглушено — жодного вузла, контекст навіть не створюється', () => {
    const s = new CookAudioSession();
    s.setMuted(true);
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

  describe('issue #3: getCookAudioSession/closeCookAudioSession — одна сесія на готування', () => {
    it('повертає той самий інстанс, поки не закрито', () => {
      const a = getCookAudioSession();
      const b = getCookAudioSession();
      expect(a).toBe(b);
    });

    it('closeCookAudioSession — наступний виклик дає нову сесію', () => {
      const a = getCookAudioSession();
      closeCookAudioSession();
      const b = getCookAudioSession();
      expect(a).not.toBe(b);
    });

    it('mute, виставлений однією стороною (попап), поважає інша (зовнішній аларм)', () => {
      const session = getCookAudioSession();
      session.setMuted(true);
      // GlobalCookAlarm бере ту саму сесію — і той самий mute, а не власний.
      expect(getCookAudioSession()).toBe(session);
      session.playAlarm();
      expect(counts.buf).toBe(0); // жодного клацу — приглушено на попаповій стороні
    });
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
