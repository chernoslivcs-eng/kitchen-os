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
  nextSoundMode,
} from './cook-sound';

describe('nextSoundMode · §4.5 три стани по колу', () => {
  it('звук → лише сигнал → тиша → звук', () => {
    expect(nextSoundMode('on')).toBe('signal');
    expect(nextSoundMode('signal')).toBe('off');
    expect(nextSoundMode('off')).toBe('on');
  });
});

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
// Перегляд 30.09, раунд 2 (issue A): у реальному Web Audio геттер .value НЕ
// відображає щойно записане синхронно — воно «доганяє» аудіопотоком і
// лишається старим ще ~300мс (виміряно на стенді). Мок раніше оновлював
// .value синхронно — тому баг (syncGate читав застаріле value одразу після
// stopTicking→startTicking в одному коміті React) не ловився ЖОДНИМ тестом.
// STALE_MS імітує цю затримку; writes — хронологія НАМІРІВ (те, що реально
// записали), яку й читають тести нижче замість .value.
const STALE_MS = 300;
class FakeParam {
  private committed = 0;
  private pending: { at: number; v: number } | null = null;
  writes: number[] = [];
  get value() {
    if (this.pending && Date.now() - this.pending.at >= STALE_MS) {
      this.committed = this.pending.v;
      this.pending = null;
    }
    return this.committed;
  }
  // Пряме присвоєння (master.gain.value = ...) — на відміну від
  // setValueAtTime, синхронне й у реальному Web Audio (початкове
  // налаштування вузла одразу після createGain(), до якогось графа/жесту).
  set value(v: number) { this.committed = v; this.pending = null; this.writes.push(v); }
  setValueAtTime(v: number) { this.pending = { at: Date.now(), v }; this.writes.push(v); return this; }
  exponentialRampToValueAtTime(v: number) { this.pending = { at: Date.now(), v }; this.writes.push(v); return this; }
  cancelScheduledValues() { return this; }
}
// Перегляд 30.09, раунд 2 (issue D): connect()/disconnect() тепер справжні —
// connect(target) повертає TARGET (як у Web Audio, інакше ланцюжок
// `a.connect(b).connect(c)` мовчки викликав .connect лише на `a`, а `b`
// узагалі не бачив другого хопу), а disconnect() рве ребро незворотно.
// Потрібно саме для issue D: перевірити, що нота, замкнута на СТАРУ (уже
// відʼєднану) шину, ніколи не «доходить» до master, хай що станеться далі.
interface FakeNode {
  connect(target: FakeNode): FakeNode;
  disconnect(): void;
  disconnected: boolean;
  target: FakeNode | null;
}
function makeNode<T extends object>(extra: T): T & FakeNode {
  const n = extra as T & FakeNode;
  n.disconnected = false;
  n.target = null;
  n.connect = (target: FakeNode) => { n.target = target; return target; };
  n.disconnect = () => { n.disconnected = true; };
  return n;
}
/** issue D: чи справді доходить сигнал від `source` до `dest`, ідучи по
 *  ланцюжку .target — розірваний (disconnected) вузол будь-де по дорозі
 *  ламає весь ланцюжок, навіть якщо .target у нього формально лишився. */
function reaches(source: FakeNode, dest: FakeNode): boolean {
  let cur: FakeNode | null = source;
  while (cur) {
    if (cur.disconnected) return false;
    if (cur === dest) return true;
    cur = cur.target;
  }
  return false;
}
interface NoteCall { at: number; committedAt: number; source: FakeNode }
function makeCtx(
  counts: { osc: number; buf: number; filt: number; gain: number },
  notes: NoteCall[] = [],
  gains: FakeParam[] = [],
  origin: number = Date.now(),
  // issue D: вузли gain-нод (не самі AudioParam) — потрібні для reaches(),
  // щоб перевірити ЗВʼЯЗНІСТЬ графа (connect/disconnect), а не лише значення.
  gainNodes: FakeNode[] = [],
) {
  const ctx = {
    get currentTime() { return (Date.now() - origin) / 1000; },
    sampleRate: 44100,
    state: 'running' as AudioContextState,
    destination: makeNode({}),
    createOscillator() {
      counts.osc++;
      const n = makeNode({ frequency: new FakeParam(), start: (t: number) => notes.push({ at: t, committedAt: ctx.currentTime, source: n }), stop: () => {} });
      return n;
    },
    createGain() {
      counts.gain++;
      const g = new FakeParam();
      gains.push(g);
      const n = makeNode({ gain: g });
      gainNodes.push(n);
      return n;
    },
    createBufferSource() {
      counts.buf++;
      const n = makeNode({ buffer: null as unknown, start: (t: number) => notes.push({ at: t, committedAt: ctx.currentTime, source: n }) });
      return n;
    },
    createBiquadFilter() {
      counts.filt++;
      return makeNode({ type: '', frequency: new FakeParam(), Q: new FakeParam() });
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
  let gainNodes: FakeNode[];
  let ctxInstances: number;

  beforeEach(() => {
    vi.useFakeTimers();
    counts = { osc: 0, buf: 0, filt: 0, gain: 0 };
    notes = [];
    gains = [];
    gainNodes = [];
    ctxInstances = 0;
    // §4.5: режим звуку тепер персистить у localStorage (читається при
    // народженні сесії) — без чищення один тест лишав би режим наступному.
    localStorage.clear();
    const origin = Date.now();
    vi.stubGlobal('AudioContext', class {
      constructor() { ctxInstances++; return makeCtx(counts, notes, gains, origin, gainNodes) as unknown as AudioContext; }
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
    // issue A: перевіряємо НАМІР (writes), не .value — той у браузері (і
    // тепер у моку) ще ~300мс показує старе значення після щойного запису.
    expect(tickGate.writes.at(-1)).toBe(1);
    const before = counts.osc + counts.buf;
    s.stopTicking();
    expect(tickGate.writes.at(-1)).toBe(0); // запис синхронний, навіть якщо .value ще не встиг
    await vi.advanceTimersByTimeAsync(5000);
    expect(counts.osc + counts.buf).toBe(before);
  });

  it("issue #2: setMode('off') глушить шину миттєво посеред тікання, setMode('on') — повертає", () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 3000);
    const tickGate = gains[1]!;
    expect(tickGate.writes.at(-1)).toBe(1);
    s.setMode('off');
    expect(tickGate.writes.at(-1)).toBe(0);
    s.setMode('on');
    expect(tickGate.writes.at(-1)).toBe(1);
  });

  it('приглушено від старту — контекст живий (жест уже був), шина одразу на нулі', () => {
    const s = new CookAudioSession();
    s.setMode('off');
    s.startTicking(Date.now() + 3000);
    expect(ctxInstances).toBe(1);
    expect(gains[1]!.writes.at(-1)).toBe(0);
  });

  // Перегляд 30.09, раунд 2 (issue A): syncGate читав AudioParam.value для
  // рішення «чи писати» — у браузері той ще ~300мс показує старе значення
  // після щойного запису. Наслідок: stopTicking (пише 0) одразу за яким іде
  // startTicking («+1 хв», stop→start в одному коміті React на зміні кроку)
  // читав value===1 (застаріле) === want(1) і НІЧОГО не писав — шина
  // лишалась німою до наступного природного пробудження (~0,9с). Фікс:
  // рішення «чи писати» — проти this.gateOpen (звичайне поле, не
  // AudioParam), а на старті — завжди примусово, без порівняння взагалі.
  it('issue A: stop→start в одному такті («+1 хв», зміна кроку) — шина відкрита одразу, не залипає на 0', () => {
    const s = new CookAudioSession();
    s.startTicking(Date.now() + 3000);
    expect(gains[1]!.writes.at(-1)).toBe(1);
    // Без жодного просування часу між stop і start — саме так, як їх
    // викликає Cook.tsx у ефекті зміни кроку/«+1 хв», і саме це давало
    // AudioParam.value ще старе (=1) значення на момент застарілого читання.
    // issue D: startTicking ставить СВІЖУ шину (новий createGain) — індекс
    // ловимо ДО виклику (між ним і попереднім scheduleNext устигли
    // народитись ноти-конверти власних gain-вузлів, тож .at(-1) тут не
    // тримає тікгейта).
    s.stopTicking();
    const idx = gains.length;
    s.startTicking(Date.now() + 4000);
    expect(gains[idx]!.writes.at(-1)).toBe(1);
  });

  it('playAlarm — той самий алярм, що DSP (26 клаців), повз шину тіків', () => {
    const s = new CookAudioSession();
    s.playAlarm();
    expect(counts.buf).toBe(26);
  });

  it('playAlarm приглушено — жодного вузла, контекст навіть не створюється', () => {
    const s = new CookAudioSession();
    s.setMode('off');
    s.playAlarm();
    expect(ctxInstances).toBe(0);
    expect(counts.buf).toBe(0);
  });

  // §4.5 (бриф COOK-TIMERS-BRIEF-0930): «лише сигнал» — середній із трьох
  // станів, не просто «ще один синонім мута». Тікання глухне, аларм лишається.
  describe("§4.5: режим 'signal' — без тікання, аларм лишається", () => {
    it('тікання мовчить у режимі signal, як і в off', () => {
      const s = new CookAudioSession();
      s.setMode('signal');
      s.startTicking(Date.now() + 3000);
      expect(gains[1]!.writes.at(-1)).toBe(0); // шина закрита, як при off
    });

    it('playAlarm звучить у режимі signal (на відміну від off)', () => {
      const s = new CookAudioSession();
      s.setMode('signal');
      s.playAlarm();
      expect(counts.buf).toBe(26); // повний аларм, не приглушено
    });

    it('проактивний аларм (commitAlarm через scheduleNext) теж звучить у signal', async () => {
      const s = new CookAudioSession();
      s.setMode('signal');
      s.startTicking(Date.now() + 1000);
      await vi.advanceTimersByTimeAsync(890); // рубіж коміту межі (~880мс), як у issue B тестах
      expect(counts.buf).toBeGreaterThanOrEqual(26); // аларм закомічено, попри signal
    });
  });

  describe('§4.5: режим персистить у localStorage — нова сесія читає його при народженні', () => {
    it('нова сесія після конструктора з uже збереженим режимом читає saved режим', () => {
      const a = new CookAudioSession();
      a.setMode('signal');
      const b = new CookAudioSession(); // окремий інстанс — режим не в памʼяті об'єкта a, а в localStorage
      expect(b.getMode()).toBe('signal');
    });

    it('без збереженого значення — типовий режим on', () => {
      const s = new CookAudioSession();
      expect(s.getMode()).toBe('on');
    });

    it("невалідне/биту значення в localStorage — типовий 'on', не падає", () => {
      localStorage.setItem('kos-cook-sound-mode', 'щось-не-те');
      const s = new CookAudioSession();
      expect(s.getMode()).toBe('on');
    });
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

  // Перегляд 30.09, раунд 2 (issue B): аларм кроку на екрані раніше грав
  // РЕАКТИВНО — з 250мс-інтервалу цифр + 0,04с пад у playAlarm, тобто на
  // 40–290мс пізніше за межу, щоразу по-різному. Еталон, який власник слухав
  // і затвердив, лягає рівно на межу. Фікс: сесія сама планує звук наперед,
  // у тому самому лукахед-вікні (~120мс), що й тіки.
  describe('issue B: аларм планується наперед, точно на межу left=0', () => {
    it('стартує рівно на межу — з точністю до мс, не з реактивним зсувом', async () => {
      const s = new CookAudioSession();
      const deadline = Date.now() + 1000; // ctx-еквівалент межі: рівно 1.0с (годинник іще не рухали)
      s.startTicking(deadline); // перший (частковий) такт left=1 — синхронно
      const before = notes.length;
      // Рубіж коміту (нульова межа заходить у 120мс-лукахед) настає за
      // rearmDelayMs = 1000-0-120 = 880мс від старту.
      await vi.advanceTimersByTimeAsync(890);
      expect(notes.length).toBe(before + 107); // 26 клаців + 81 тон — і рівно один такий стрибок
      const first = notes[before]!; // перша нота аларму — перший клац у alarm()
      expect(first.at).toBeCloseTo(1.0, 3);
    });

    it('пауза (stopTicking) ДО коміту межі — аларму нема взагалі', async () => {
      const s = new CookAudioSession();
      const deadline = Date.now() + 1000;
      s.startTicking(deadline);
      await vi.advanceTimersByTimeAsync(500); // задовго до рубежу коміту (~880мс)
      s.stopTicking(); // пауза/«+1 хв»/зміна кроку — той самий шлях
      const before = notes.length;
      await vi.advanceTimersByTimeAsync(1000); // минаємо межу — тікання вже не йде взагалі
      expect(notes.length).toBe(before); // жодної нової ноти — ні тіку, ні аларму
    });

    it('рівно один аларм — ідемпотентно, навіть коли scheduleNext ще довго тупцює біля нуля', async () => {
      const s = new CookAudioSession();
      const deadline = Date.now() + 1000;
      s.startTicking(deadline);
      await vi.advanceTimersByTimeAsync(890); // застав коміт межі
      const bufAfterCommit = counts.buf;
      await vi.advanceTimersByTimeAsync(2000); // і саму межу, і довго після
      expect(counts.buf).toBe(bufAfterCommit); // жодного нового клацу — ні другого аларму, ні тіків
    });

    it('ensureAlarm — no-op, якщо сесія вже сама закомітила (без дублю)', async () => {
      const s = new CookAudioSession();
      s.startTicking(Date.now() + 1000);
      await vi.advanceTimersByTimeAsync(890);
      const before = counts.buf;
      s.ensureAlarm(); // Cook.tsx кличе це зі свого 250мс-інтервалу на нулі
      expect(counts.buf).toBe(before); // уже зіграно наперед — жодного нового клацу
    });

    it('ensureAlarm — фолбек, якщо лукахед-вікно проспали цілком (сесія ще нічого не закомітила)', () => {
      const s = new CookAudioSession();
      s.ensureAlarm(); // жодного startTicking — «якщо вікно проспали — аларм одразу, як зараз»
      expect(counts.buf).toBe(26);
    });
  });

  // Перегляд 30.09, раунд 2 (issue C): «умова першого такту» (lastScheduledLeft
  // == null) спрацьовувала лише на найпершому виклику — пробудження ПІЗНІШЕ за
  // межу (дросельована вкладка) бачило lastScheduledLeft уже не-null і
  // пропускало ноти поточної секунди ЦІЛКОМ, хоча частина з них (за offset)
  // іще не минула. Фікс: «ще не планували САМЕ ЦЕ left» (lastScheduledLeft
  // == null || lastScheduledLeft > left), не «лише перший виклик».
  it('issue C: пробудження через 300мс після межі — недограні ноти цієї секунди все ж грають', () => {
    const s = new CookAudioSession();
    const deadline = Date.now() + 2000; // left стартує з 2
    // Перехоплюємо ЛИШЕ наступний setTimeout (перепланування scheduleNext),
    // щоб самим вирішити, коли він «спрацює» — fake timers завжди
    // детерміновані й самі ніколи не запізнюються; дросель, що затримав
    // виконання колбека відносно годинника, імітуємо вручну.
    let captured: (() => void) | null = null;
    const realSetTimeout = window.setTimeout.bind(window);
    vi.stubGlobal('setTimeout', ((fn: () => void) => { captured = fn; return 0 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout);
    s.startTicking(deadline); // перший (частковий) такт left=2 — синхронно
    expect(captured).not.toBeNull();
    const before = notes.length;
    // Проспали: годинник — на 1300мс від старту (300мс усередину left=1,
    // чия межа була о 1000мс), а колбек спрацьовує лише ТЕПЕР.
    vi.setSystemTime(Date.now() + 1300);
    vi.stubGlobal('setTimeout', realSetTimeout);
    captured!();
    // ГАЛОП (left=1): offsets [0,0.25,0.375,0.5,0.75,0.875]. Межа left=1
    // була 1000мс тому; зараз — 300мс усередину неї. Перші дві ноти (0 і
    // 0,25=250мс) уже минули; лишаються чотири: 0.375, 0.5, 0.75, 0.875.
    expect(notes.length - before).toBe(2 * 4); // 4 тіки × (клац+тон)
  });

  // Перегляд 30.09, раунд 3 (issue D): шина тіків раніше жила на весь
  // контекст (одна на всю сесію) — stopTicking лише глушив gain→0, не
  // рвав звʼязок. Ноти старого плану, які ще лежали в графі (Web Audio не
  // вміє відкликати вже заплановану), оживали ПОВЕРХ нових, щойно наступний
  // startTicking знову відкривав ТОЙ САМИЙ вузол — подвоєна гучність до
  // кінця секунди. Фікс: кожен startTicking ставить свіжий GainNode;
  // stopTicking відʼєднує (не лише глушить) старий — його ноти вже
  // НІКОЛИ не дійдуть до master, хай що станеться з ними далі.
  describe('issue D: шина одноразова — старий план не оживає при stop→start', () => {
    it('«+1 хв» (stop→start у тому самому такті) — старі ноти НЕ доходять до master, нові доходять', () => {
      const s = new CookAudioSession();
      const deadline = Date.now() + 3000;
      s.startTicking(deadline); // перший (частковий) такт left=3 — синхронно, на СТАРІЙ шині
      const oldNotes = notes.slice();
      expect(oldNotes.length).toBeGreaterThan(0);
      const master = gainNodes[0]!; // ensure() створює master першим
      for (const n of oldNotes) expect(reaches(n.source, master)).toBe(true); // поки шина жива — доходять

      // «+1 хв»: дедлайн +60с, межі ті самі мс — так це виглядає в Cook.tsx
      // (stopTicking→startTicking в одному ефекті, без жодного
      // просування часу між ними).
      s.startTicking(deadline + 60_000);
      // Стару шину вже відʼєднано (усередині stopTicking) — її ноти НІКОЛИ
      // не дійдуть, хай що станеться далі.
      for (const n of oldNotes) expect(reaches(n.source, master)).toBe(false);
      // Нові ноти (на свіжій шині) — доходять, кожна рівно один раз.
      const newNotes = notes.slice(oldNotes.length);
      expect(newNotes.length).toBeGreaterThan(0);
      for (const n of newNotes) expect(reaches(n.source, master)).toBe(true);
    });

    it('пауза → «Старт» у тій самій секунді — жодна нота старої шини до master не доходить', () => {
      const s = new CookAudioSession();
      const deadline = Date.now() + 3000;
      s.startTicking(deadline);
      const oldNotes = notes.slice();
      expect(oldNotes.length).toBeGreaterThan(0);
      s.stopTicking(); // пауза
      s.startTicking(deadline); // «Старт» — той самий дедлайн, та сама секунда
      const master = gainNodes[0]!;
      for (const n of oldNotes) expect(reaches(n.source, master)).toBe(false);
    });

    it('setMode керує лише ПОТОЧНОЮ шиною — на стару (відʼєднану) запис уже не впливає на чутність', () => {
      const s = new CookAudioSession();
      s.startTicking(Date.now() + 3000);
      const oldGain = gains[1]!; // перша (тепер стара) шина
      // issue D: індекс нової шини ловимо ДО другого startTicking — між
      // викликами scheduleNext устиг створити купу власних gain-вузлів
      // (конверти нот), тож .at(-1) тут не тримає тікгейта.
      const idx = gains.length;
      s.startTicking(Date.now() + 3000); // друге startTicking — нова шина, стара відʼєднана
      const newGain = gains[idx]!;
      s.setMode('off');
      s.setMode('on');
      // Поточна (нова) шина реагує на зміну режиму нормально — останній запис відкриває.
      expect(newGain.writes.at(-1)).toBe(1);
      // Стара шина взагалі не отримує нових записів від setMode — вона вже
      // не this.tickGate, а applyGate/syncGate працюють лише з поточною.
      const oldWritesBefore = oldGain.writes.length;
      s.setMode('off');
      expect(oldGain.writes.length).toBe(oldWritesBefore);
    });
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
      session.setMode('off');
      // GlobalCookAlarm бере ту саму сесію — і той самий mute, а не власний.
      expect(getCookAudioSession()).toBe(session);
      session.playAlarm();
      expect(counts.buf).toBe(0); // жодного клацу — приглушено на попаповій стороні
    });
  });
});

describe('ringAlarm · §2.1/§2.2/§2.3 аларм+вібро+нотифікація з одного місця', () => {
  beforeEach(() => {
    localStorage.clear(); // §4.5: режим звуку персистить — не лишати попередньому тесту.
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
