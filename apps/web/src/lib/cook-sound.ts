// Кукінг-мод: звук таймера — спек 30.09
// (docs/superpowers/specs/2026-09-30-cook-timers-sound-design.md), еталон
// docs/superpowers/specs/2026-09-30-cook-timers-sound-reference.html — той
// самий HTML, який власник слухав і затвердив 30.09. Числа (частоти,
// гучності, тривалості, темп) перенесені БЕЗ ЗМІНИ; будь-яка зміна — лише
// через власника на слух, не звідси.
//
// §5: один AudioContext на сесію готування — цей модуль сам його не створює
// й не тримає. tone/click/bell/tick/five/minute/alarm/second беруть
// ctx/master параметрами, тож їх можна викликати з будь-якого місця, що
// володіє контекстом (Cook.tsx, cook-watch.tsx) — одна реалізація, не дві
// копії тону 880 Гц, як було.
//
// plan/PULSE/SWING/GALOP/headOf — чисті функції без AudioContext узагалі:
// саме вони юніт-тестуються (§4.1–4.4), решта — DSP, перевіряється на слух.

/** Сила тіку: 0 сильний, 1 середній, 2 легкий, 3 підстук. */
export type TickLevel = 0 | 1 | 2 | 3;

/** [частота клацу, гучність клацу, частота тону, гучність тону, довжина клацу]. */
const LEVEL: [number, number, number, number, number][] = [
  [3500, 0.95, 4300, 0.024, 0.012],
  [3150, 0.72, 3900, 0.017, 0.011],
  [2950, 0.50, 3700, 0.011, 0.010],
  [3900, 0.28, 4600, 0.006, 0.008],
];

/** Синус із миттєвою атакою (3 мс) і експоненційним спадом за d секунд. */
export function tone(ctx: AudioContext, master: AudioNode, t: number, f: number, g: number, d: number): void {
  const o = ctx.createOscillator(), a = ctx.createGain();
  o.frequency.value = f;
  a.gain.setValueAtTime(0.0001, t);
  a.gain.exponentialRampToValueAtTime(g, t + 0.003);
  a.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(a).connect(master); o.start(t); o.stop(t + d + 0.05);
}

/** Клац механізму: білий шум довжиною d із кубічним спадом крізь смуговий фільтр. */
export function click(ctx: AudioContext, master: AudioNode, t: number, f: number, q: number, g: number, d: number): void {
  const n = Math.ceil(ctx.sampleRate * d), b = ctx.createBuffer(1, n, ctx.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const s = ctx.createBufferSource(); s.buffer = b;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
  const a = ctx.createGain(); a.gain.value = g;
  s.connect(bp).connect(a).connect(master); s.start(t);
}

const PARTIALS = [1, 2.4, 3.9];
const PARTIAL_GAIN = [1, 0.5, 0.22];

/** Дзвоник: три негармонійні обертони, вищі гаснуть швидше. */
export function bell(ctx: AudioContext, master: AudioNode, t: number, base: number, d: number, g: number): void {
  // PARTIAL_GAIN тієї самої довжини, що PARTIALS — індекс завжди в межах.
  PARTIALS.forEach((r, i) => tone(ctx, master, t, base * r, g * PARTIAL_GAIN[i]!, d / (1 + i * 0.7)));
}

export function tick(ctx: AudioContext, master: AudioNode, t: number, level: TickLevel, m: number): void {
  // TickLevel — 0|1|2|3, LEVEL має рівно чотири рядки: індекс завжди в межах.
  const v = LEVEL[level]!;
  click(ctx, master, t, v[0], 7, v[1] * m, v[4]);
  tone(ctx, master, t, v[2], v[3] * m, 0.022);
}

export function five(ctx: AudioContext, master: AudioNode, t: number, m: number): void {
  click(ctx, master, t, 2500, 6, 1.25 * m, 0.017);
  tone(ctx, master, t, 2900, 0.05 * m, 0.06);
}

/** Хвилина: важчий подвійний клац механізму, другий клац через 0,125 с. */
export function minute(ctx: AudioContext, master: AudioNode, t: number, m: number): void {
  click(ctx, master, t, 1900, 5, 1.7 * m, 0.022);
  tone(ctx, master, t, 2200, 0.06 * m, 0.07);
  click(ctx, master, t + 0.125, 2600, 6, 1.35 * m, 0.017);
  tone(ctx, master, t + 0.125, 3000, 0.045 * m, 0.06);
}

/** Аларм: 26 ударів молоточка кожні 52 мс (≈1,35 с) і відзвук 1,3 с. Дзвонить один раз. */
export function alarm(ctx: AudioContext, master: AudioNode, t: number): void {
  for (let i = 0; i < 26; i++) {
    const e = i < 3 ? 0.6 + i * 0.13 : 1 - Math.max(0, i - 18) * 0.09;
    click(ctx, master, t + i * 0.052, 3800, 5, 0.35 * e, 0.01);
    bell(ctx, master, t + i * 0.052, 2093, 0.16, 0.085 * e);
  }
  bell(ctx, master, t + 26 * 0.052, 2093, 1.3, 0.09);
}

/** Малюнок секунди: [зсув від початку секунди в секундах, сила]. Темп 120 = дві долі на секунду. */
export type SecondPattern = [number, TickLevel][];

export const PULSE: SecondPattern = [[0, 2], [5 / 6, 3]];
export const SWING: SecondPattern = [[0, 0], [1 / 3, 2], [0.5, 1], [5 / 6, 2]];
export const GALOP: SecondPattern = [[0, 0], [0.25, 2], [0.375, 3], [0.5, 1], [0.75, 2], [0.875, 3]];

export type SecondHead = 'tick' | 'five' | 'minute';

/** Голова секунди: акцент хвилини або пʼяти секунд замінює перший тік малюнка. В останні 3 с акцентів нема (плян нижче туди й не заходить — галоп head завжди 'tick'). */
export function headOf(left: number): SecondHead {
  return left % 60 === 0 ? 'minute' : left % 5 === 0 ? 'five' : 'tick';
}

export interface SecondPlan {
  pattern: SecondPattern;
  head: SecondHead;
  /** Множник гучності малюнка (§4.2 «Тихий пульс»). */
  m: number;
  /** Назва малюнка — для стенду/діагностики, у звук не йде. */
  name: 'тихий пульс' | 'свінг' | 'галоп';
}

/**
 * Сценарій «Тихий пульс» (§4.2). `left` — скільки секунд лишилось на
 * початку цієї секунди (те саме число, що на екрані).
 */
export function plan(left: number): SecondPlan {
  if (left > 10) return { pattern: PULSE, head: headOf(left), m: 0.7, name: 'тихий пульс' };
  if (left > 3) return { pattern: SWING, head: headOf(left), m: 1, name: 'свінг' };
  return { pattern: GALOP, head: 'tick', m: 1, name: 'галоп' };
}

/** Один такт секунди за планом: голова (тік/пʼять/хвилина) + решта малюнка. */
export function second(ctx: AudioContext, master: AudioNode, t: number, p: SecondPlan): void {
  if (p.head === 'minute') minute(ctx, master, t, p.m);
  else if (p.head === 'five') five(ctx, master, t, p.m);
  p.pattern.forEach(([o, level]) => {
    if (o === 0) { if (p.head === 'tick') tick(ctx, master, t, level, p.m); }
    else tick(ctx, master, t + o, level, p.m);
  });
}

/**
 * Той самий такт, але ноти, чий час УЖЕ минув відносно `notBefore`, не
 * плануються — малюнок лишається привʼязаним до межі `at`, не зсувається.
 * Два випадки, коли це потрібно: перший (можливо частковий) такт одразу
 * після старту/зміни дедлайну, і «проспана» межа (дроселена вкладка) — коли
 * `at` сам виявляється в минулому відносно `notBefore`. Коли `at ≥ notBefore`
 * (звичайне планування наперед), поведінка як у `second()` — жодна нота не
 * відсікається.
 */
export function secondFrom(ctx: AudioContext, master: AudioNode, at: number, p: SecondPlan, notBefore: number): void {
  if (p.head === 'minute') { if (at >= notBefore) minute(ctx, master, at, p.m); }
  else if (p.head === 'five') { if (at >= notBefore) five(ctx, master, at, p.m); }
  p.pattern.forEach(([o, level]) => {
    const t = at + o;
    if (t < notBefore) return;
    if (o === 0) { if (p.head === 'tick') tick(ctx, master, t, level, p.m); }
    else tick(ctx, master, t, level, p.m);
  });
}

// ── §5: один AudioContext на сесію готування ────────────────────────────
// Нижче — та частина, якої еталон не мав (він створював контекст на кожну
// пробу з нуля, для стенду це нормально). Тут — керування ЖИВИМ контекстом:
// створення/відновлення на жест, тіки наперед за ctx.currentTime від
// дедлайну (не setInterval-калбеком), і скасування — гейтом, а не спробою
// «відкликати» вже заплановані ноти (Web Audio цього не вміє).

const MASTER_GAIN = 0.7; // та сама гучність проби, на якій слухав власник.
/** Наскільки заздалегідь плануємо наступну секунду (мс до її межі). */
const LOOKAHEAD_MS = 120;
/** Мінімальна пауза між перевірками — не крутимось частіше цього. */
const MIN_DELAY_MS = 10;

type ACConstructor = typeof AudioContext;
function AudioCtor(): ACConstructor | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: ACConstructor }).webkitAudioContext;
}

/**
 * §4.6: на iOS Safari 16.4+ перемикає аудіосесію на «playback» перед
 * створенням контексту — гіпотеза власника про обхід глушення перемикачем
 * «дзвінок/тиша» (розвідка §6 крок 1). Best-effort і безпечний: фіча є не
 * всюди, а сама зміна нешкідлива, якщо не спрацює.
 */
function tryPlaybackSession(): void {
  try {
    const as = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (as) as.type = 'playback';
  } catch { /* нема або відмовив — Web Audio й так спробує на голу гучність */ }
}

/** §5: «left», яке зараз на екрані — початок поточної секунди відліку. */
export function currentLeft(deadlineMs: number, nowMs: number): number {
  return Math.ceil((deadlineMs - nowMs) / 1000);
}

/** §5: точний аудіо-час початку секунди `left` — може вийти в минулому
 *  відносно `ctxNow`, якщо прокинулись пізніше за межу (secondFrom це фільтрує). */
export function boundaryAudioTime(deadlineMs: number, left: number, nowMs: number, ctxNow: number): number {
  const startWall = deadlineMs - left * 1000;
  return ctxNow + (startWall - nowMs) / 1000;
}

/**
 * §5: через скільки мс прокинутись знову — трохи ДО кінця поточної секунди
 * (лукахед), а не наосліп щосекунди: межі рахує дедлайн, не setInterval.
 * -1 — дедлайн уже минув, зупинитись.
 */
export function rearmDelayMs(deadlineMs: number, nowMs: number, lookaheadMs: number, minDelayMs: number): number {
  const leftNow = currentLeft(deadlineMs, nowMs);
  if (leftNow <= 0) return -1;
  const curStartWall = deadlineMs - leftNow * 1000;
  const msIntoSecond = nowMs - curStartWall;
  return Math.max(minDelayMs, 1000 - msIntoSecond - lookaheadMs);
}

export class CookAudioSession {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  // Перегляд 30.09 (issue #2): тіки йдуть через окрему шину, не напряму в
  // master. Web Audio не вміє «відмінити» вже заплановану ноту —
  // stopTicking/mute глушать ВИХІД шини миттєво (gain→0), і те, що вже
  // лежить у графі, долунює нечутно, замість ще майже секунди цокати
  // старим планом. Аларм — повз шину, напряму в master: його вимикає
  // окрема перевірка `muted` перед стартом, не гейт.
  private tickGate: GainNode | null = null;
  private timer: number | null = null;
  private deadline: number | null = null;
  private lastScheduledLeft: number | null = null;
  private muted = false;
  // Перегляд 30.09, раунд 2 (issue A): бажаний стан шини — ЄДИНЕ джерело
  // правди для порівняння. AudioParam.value НЕ читаємо ніде: у реальному
  // браузері геттер не встигає синхронно відобразити щойно записане —
  // лишається старим ще ~300 мс (виміряно на стенді), тоді як jsdom-мок
  // оновлював його синхронно, тож старий баг ховався від тестів. Наслідок:
  // stopTicking→startTicking в одному коміті React («+1 хв», зміна кроку)
  // читав застаріле value===1 і мовчки НЕ переписував шину, яку stopTicking
  // щойно закрив, — вона лишалась німою до наступного природного пробудження.
  private gateOpen: boolean | null = null;
  // issue B: чи аларм цього дедлайну вже закомічено в граф (чи зіграно
  // приглушеним) — раз на дедлайн, скидається на кожному startTicking/stopTicking.
  private alarmScheduled = false;

  private ensure(): AudioContext | null {
    const C = AudioCtor();
    if (!C) return null;
    tryPlaybackSession();
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.tickGate = this.ctx.createGain();
      this.tickGate.gain.value = 0;
      this.tickGate.connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** §4.5: двостановий перемикач власника (три стани — окремий крок макетів).
   *  Гейт синхронізується ОДРАЗУ — мут глушить і посеред секунди, не з
   *  наступним запланованим тактом. */
  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGate(!m);
  }

  /** issue A: єдине місце, що пише в AudioParam шини — завжди cancel+set,
   *  без умови. Порівняння «чи треба писати» робить лише syncGate, і робить
   *  його проти this.gateOpen (звичайне поле класу), НІКОЛИ проти
   *  AudioParam.value: той у браузері ще ~300мс показує старе значення після
   *  щойного запису, тож порівняння з ним могло мовчки пропустити потрібний
   *  запис (issue A). */
  private applyGate(open: boolean): void {
    if (!this.ctx || !this.tickGate) return;
    this.gateOpen = open;
    this.tickGate.gain.cancelScheduledValues(this.ctx.currentTime);
    this.tickGate.gain.setValueAtTime(open ? 1 : 0, this.ctx.currentTime);
  }

  private syncGate(): void {
    if (!this.ctx || !this.tickGate) return;
    const want = !this.muted;
    if (this.gateOpen !== want) this.applyGate(want);
  }

  /**
   * §5/§3: тікання кроку, що на екрані, поки він біжить. `deadlineMs` — той
   * самий дедлайн, за яким рахує видимий таймер (одне джерело меж секунд).
   * Перший такт після старту може бути частковим (жест припав на середину
   * секунди) — secondFrom грає лише ноти, чий час іще не минув. Далі кожен
   * цикл планує НАСТУПНУ секунду заздалегідь (лукахед ~120 мс) на точний
   * аудіо-час її межі, а не постфактум, коли `left` уже змінився.
   */
  startTicking(deadlineMs: number): void {
    this.stopTicking();
    if (!this.ensure()) return;
    this.deadline = deadlineMs;
    this.alarmScheduled = false; // issue B: нове тікання — аларм цього дедлайну ще не грав.
    // issue A: примусово, не через syncGate/порівняння — «на старті завжди»,
    // незалежно від того, яким this.gateOpen міг лишитись після stopTicking
    // щойно перед цим у ТОМУ Ж коміті React.
    this.applyGate(!this.muted);
    this.scheduleNext();
  }

  private scheduleNext = (): void => {
    if (this.deadline == null || !this.ctx || !this.tickGate || !this.master) return;
    this.syncGate();
    const nowMs = Date.now();
    const ctxNow = this.ctx.currentTime;
    const leftNow = currentLeft(this.deadline, nowMs);

    // issue C: «ще не планували САМЕ ЦЕ left», не «лише перший виклик».
    // lastScheduledLeft тільки спадає (left рахує до нуля), тож будь-яке
    // попереднє значення БІЛЬШЕ за поточне left означає, що одну чи кілька
    // меж проспали (дросельована вкладка) — і поточну секунду теж ще не
    // планували: її майбутні ноти (secondFrom сама відсіє минулі) мають
    // дограти, а не мовчати цілу секунду.
    const shouldSchedule = (left: number) => this.lastScheduledLeft == null || this.lastScheduledLeft > left;

    if (leftNow <= 0) {
      // Проспали й саму межу нуля разом з рештою — аларм негайно (той самий
      // фолбек, що й завжди був), а не мовчки нічого.
      this.commitAlarm(boundaryAudioTime(this.deadline, 0, nowMs, ctxNow));
      this.timer = null;
      return;
    }

    if (shouldSchedule(leftNow)) {
      const at = boundaryAudioTime(this.deadline, leftNow, nowMs, ctxNow);
      secondFrom(this.ctx, this.tickGate, at, plan(leftNow), ctxNow);
      this.lastScheduledLeft = leftNow;
    }
    const nextLeft = leftNow - 1;
    if (shouldSchedule(nextLeft)) {
      const at = boundaryAudioTime(this.deadline, nextLeft, nowMs, ctxNow);
      if ((at - ctxNow) * 1000 <= LOOKAHEAD_MS) {
        // issue B: left=0 — не тік, а межа аларму. Той самий лукахед-цикл,
        // що й секунди, планує його звук наперед точно на межу, повз шину.
        if (nextLeft === 0) this.commitAlarm(at);
        else secondFrom(this.ctx, this.tickGate, at, plan(nextLeft), ctxNow);
        this.lastScheduledLeft = nextLeft;
      }
    }

    const delay = rearmDelayMs(this.deadline, nowMs, LOOKAHEAD_MS, MIN_DELAY_MS);
    if (delay < 0) { this.timer = null; return; }
    this.timer = window.setTimeout(this.scheduleNext, delay);
  };

  /**
   * issue B: закомічує звук аларму РІВНО ОДИН РАЗ на дедлайн, на аудіо-час
   * `at` (точна межа left=0, або «зараз», якщо межу проспали). Скасовний
   * лише непрямо: доки цей метод ще не викликаний, пауза/«+1 хв»/зміна
   * кроку йдуть через stopTicking → новий deadline/scheduleNext більше сюди
   * не дійде для СТАРОЇ межі. Раз закомічено — як і з тіками, Web Audio не
   * вміє відкликати вже заплановану ноту; це той самий прийнятий компроміс,
   * що й для тіків (вікно ~120мс перед межею).
   */
  private commitAlarm(at: number): void {
    if (this.alarmScheduled || !this.ctx || !this.master) return;
    this.alarmScheduled = true;
    if (!this.muted) alarm(this.ctx, this.master, Math.max(at, this.ctx.currentTime));
  }

  /**
   * issue B: викликає Cook.tsx зі свого (неточного, 250мс) інтервалу на
   * нулі поточного кроку. Якщо сесія вже сама заздалегідь закомітила звук
   * на точну межу — нічого не робить (без дублю). Якщо ще ні (лукахед-вікно
   * проспали цілком, наприклад дросельована вкладка) — грає негайно, той
   * самий фолбек, що працював і раніше. Вібро/нотифікацію/стан Cook.tsx
   * робить сам, незалежно від цього виклику.
   */
  ensureAlarm(): void {
    if (this.alarmScheduled) return;
    this.alarmScheduled = true;
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    alarm(ctx, this.master, ctx.currentTime + 0.04);
  }

  /** §5: пауза, зміна кроку, закриття кукінг-моду — шину глушимо ОДРАЗУ;
   *  заплановане в графі долунює нечутно, не «ще майже секунду». */
  stopTicking(): void {
    if (this.timer != null) { window.clearTimeout(this.timer); this.timer = null; }
    this.deadline = null;
    this.lastScheduledLeft = null;
    this.alarmScheduled = false;
    this.applyGate(false);
  }

  /** §4.4/§2.1/§2.2/§2.3: аларм один раз — той самий звук для кроку, фону й закритого кукінг-моду. */
  playAlarm(): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    alarm(ctx, this.master, ctx.currentTime + 0.04);
  }

  close(): void {
    this.stopTicking();
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.tickGate = null;
  }
}

let sharedSession: CookAudioSession | null = null;
/**
 * §5 (перегляд 30.09, issue #3): ОДНА сесія на все готування, не по одній
 * на попап і на зовнішній вартовий. Контекст, який жест «Старт» таймера вже
 * розбудив, лишається придатним дзвонити й тоді, коли попап закрито — на
 * iOS контекст, створений або відновлений БЕЗ жесту (як робив старий
 * `ringOutside`), лишається suspended.
 */
export function getCookAudioSession(): CookAudioSession {
  return (sharedSession ??= new CookAudioSession());
}

/** Кінець сесії готування (finish() / скасування старої сесії заради нової
 *  — cook-session.ts): наступне готування створить свіжу на своєму жесті.
 *  Закриття самого попапа сюди НЕ веде — лише stopTicking. */
export function closeCookAudioSession(): void {
  sharedSession?.close();
  sharedSession = null;
}

/**
 * Вібро + системна нотифікація, БЕЗ звуку. issue B: крок на екрані
 * (Cook.tsx) звук більше не запускає звідси — сесія вже закомітила його
 * заздалегідь, точно на межу (CookAudioSession.ensureAlarm). Це лишається
 * для решти сигналу на тому самому (неточному, 250мс) переході секунди до
 * нуля, який і був завжди.
 */
export function notifyOnly(title: string, opts: { onlyWhenHidden?: boolean } = {}): void {
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* desktop */ }
  try {
    const okToShow = 'Notification' in window && Notification.permission === 'granted' && (!opts.onlyWhenHidden || document.hidden);
    if (okToShow) new Notification('Kitchen OS · таймер', { body: `${title} — час вийшов`, tag: 'kitchen-os-timer' });
  } catch { /* нотифікації не критичні */ }
}

/**
 * Аларм + вібро + системна нотифікація — фоновий крок і закритий кукінг-мод
 * (cook-watch.tsx): там нема ритму, який синхронізувати, тож звук лишається
 * реактивним, як і був (§5, issue B: тільки крок на екрані отримав
 * прецизійне планування наперед — див. ensureAlarm/notifyOnly вище).
 *
 * `onlyWhenHidden` — та відмінність, яку не можна було стерти об'єднанням:
 * зсередини Cook Mode нотифікація зайва, поки вкладка видима (таймер і так
 * на очах); зовні — вона потрібна незалежно від видимості вкладки, бо
 * людина не дивиться на Cook Mode, навіть якщо дивиться на застосунок.
 */
export function ringAlarm(session: CookAudioSession, title: string, opts: { onlyWhenHidden?: boolean } = {}): void {
  session.playAlarm();
  notifyOnly(title, opts);
}
