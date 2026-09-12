// Моушн знаків. Дві моделі поруч (Р117, 12.09):
//   · Icon Motion v2 — `ai/project/Kitchen OS - Icon Motion.dc.html` (власник,
//     16 знаків): рух запускається на pointerenter і click носія, дограється
//     до кінця (data-play на носії), повтор — лише після завершення; частини
//     знака (data-p) і keyframes — 1:1 з файлу; тривалості й криві по знаку.
//   · 1.5b — Icons.dc.html (масив `system`, поле `m`) для 8 знаків поза
//     файлом (close · back · draw(next) · lift(out) · fold · dial · waves ·
//     nod): :hover-модель і токени --dur-icon-* лишаються як були.
// Рухів не вигадуємо: є ключ у файлі/бандлі — робиться він; нема — `null`.
// Продукти — статичні. Зони й cooking — QUESTIONS §15, статичні.
import type { IconName } from './icons';

export type MotionKey =
  | 'bubble' | 'door' | 'book' | 'checks' | 'flip' | 'home' | 'roll' | 'unroll'
  | 'turn' | 'listen' | 'lift' | 'clip' | 'orbit' | 'sliders' | 'swap' | 'tick'
  | 'draw' | 'out' | 'close' | 'back' | 'fold' | 'dial' | 'waves' | 'nod';

/**
 * Icon Motion v2: повна тривалість руху по знаку (data-dur у файлі) — стільки
 * носій тримає data-play; знімається за dur + 80 мс. Ключі поза списком —
 * :hover-модель 1.5b.
 */
export const V2_DURATION: Partial<Record<MotionKey, number>> = {
  bubble: 1050, door: 1050, book: 1150, checks: 1000, flip: 900, home: 980, roll: 1050, unroll: 850,
  turn: 620, listen: 1300, lift: 880, clip: 1050, orbit: 1150, sliders: 1250, swap: 1050, tick: 750,
};
export const isV2 = (m: MotionKey | null | undefined): m is keyof typeof V2_DURATION => !!m && m in V2_DURATION;
/** Натиск (v2): scale .955 за 110 мс. */
export const PRESS_MS = 110;

/** Живі стани (Icons «Живі стани»): йдуть, поки триває процес, без наведення. */
export type LiveKey = 'flame' | 'timer' | 'mic' | 'think';

export const MOTION: Record<Extract<IconName, `sys.${string}` | `landing.${string}` | `auth.${string}`>, MotionKey | null> = {
  // 24 знаки масиву `system` бандла — кожен зі своїм рухом.
  'sys.chat':       'bubble',   // бабл ледь дихає
  'sys.pantry':     'door',     // нижні дверцята прочиняються (власні шляхи)
  'sys.recipes':    'book',     // сторінка перегортається через корінець (власні шляхи)
  'sys.list':       'checks',   // дописує галочки
  'sys.calendar':   'flip',     // гортає сторінку
  'sys.home':       'home',     // відкриває двері
  'sys.cart':       'roll',     // котиться — колеса крутяться
  'sys.receipt':    'unroll',   // розгортається, рядки проявляються
  'sys.add':        'turn',     // плавно повертається на 90°
  'sys.voice':      'listen',   // капсула набирає, дуга домальовується
  'sys.send':       'lift',     // стрілка йде вгору й повертається знизу (v2; носій overflow hidden)
  'sys.attach':     'clip',     // скріпка домальовується одним рухом (v2)
  'sys.search':     'orbit',    // лупа робить коло
  'sys.filter':     'sliders',  // бігунки їдуть у різні боки
  'sys.sort':       'swap',     // стрілки міняються місцями
  'sys.done':       'tick',     // галочка ставиться одним штрихом (v2)
  'sys.close':      'close',    // хрестик мʼяко стискається
  'sys.undo':       'back',     // стрілка їде назад
  'sys.next':       'draw',     // шеврон домальовується
  'sys.out':        'out',      // стрілка вилітає з рамки (1.5b; ключ свій, бо lift тепер v2 у «Надіслати»)
  'sys.collapse':   'fold',     // роздільник зʼїжджає
  'sys.theme':      'dial',     // прокручується
  'sys.sound':      'waves',    // хвилі виходять по черзі
  'sys.profile':    'nod',      // голова киває
  // Системні знаки поза масивом бандла — статичні.
  'sys.photo': null, 'sys.text': null, 'sys.open': null, 'sys.opened': null, 'sys.expand': null,
  'sys.panelClose': null, 'sys.login': null, 'sys.menu': null, 'sys.back': null, 'sys.later': null,
  'sys.import': null, 'sys.saved': null, 'sys.share': null, 'sys.reply': null, 'sys.stop': null,
  'sys.retry': null, 'sys.tradition': null, 'sys.gallery': null, 'sys.prev': null,
  // 12.09 (ANSWERS A): ряд «Дії й стани» в Icons — без моушну, лише натиск.
  'sys.less': null, 'sys.go': null, 'sys.hide': null, 'sys.toList': null, 'sys.hint': null,
  'sys.mail': null, 'sys.trash': null, 'sys.more': null, 'sys.notes': null,
  // Лендінг (етап 9): знаки системної сімʼї з блоку «landing» в icons.ts —
  // у масиві бандла їх немає, тому статичні.
  'landing.opened': null, 'landing.leftover': null, 'landing.recent': null, 'landing.variety': null, 'landing.toPanel': null,
  'auth.sent': null, 'auth.delivered': null, 'auth.household': null, 'auth.otherUser': null,
};

/**
 * Частини знаків Icon Motion v2 — 1:1 з файлу (viewBox 24, штрих 1.75).
 * Дерево елементів: `p` → data-p (частина, яку рухає CSS), `draw` → data-draw
 * + pathLength=1 (домальовування), `ve` → vector-effect non-scaling-stroke.
 * Знаки, де змінився сам гліф (проти lucide 0.460): чат (бабл + три крапки),
 * календар (рядок дат крапками), список (дві галочки + три рядки + тиха
 * лінія), кошик (спиці в колесах), книга (лист — повна сторінка), комора
 * (полиця + копія дверцят із заливкою під рамку).
 */
export interface IconPart {
  tag?: 'path' | 'circle' | 'rect' | 'g';
  p?: string;
  d?: string;
  draw?: boolean;
  ve?: boolean;
  attrs?: Record<string, string | number>;
  children?: IconPart[];
}
const P = (d: string, extra: Omit<IconPart, 'd'> = {}): IconPart => ({ d, ...extra });

export const CUSTOM_PATHS: Partial<Record<IconName, IconPart[]>> = {
  // Чат — бабл дихає, точки набігають.
  'sys.chat': [
    { tag: 'g', p: 'bub', children: [
      P('M7.9 20A9 9 0 1 0 4 16.1L2 22Z'),
      { tag: 'circle', p: 'd1', attrs: { cx: 8.4, cy: 11, r: 1.05, fill: 'currentColor', stroke: 'none' } },
      { tag: 'circle', p: 'd2', attrs: { cx: 12, cy: 11, r: 1.05, fill: 'currentColor', stroke: 'none' } },
      { tag: 'circle', p: 'd3', attrs: { cx: 15.6, cy: 11, r: 1.05, fill: 'currentColor', stroke: 'none' } },
    ] },
  ],
  // Комора — нижні дверцята прочиняються; polиця shelf1 проявляється за дверцятами.
  'sys.pantry': [
    P('M5 10V6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v4'),
    P('M5 10h14'),
    P('M15 5.5v2.5'),
    P('M5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10'),
    P('M8 16h8', { p: 'shelf1', attrs: { opacity: 0 } }),
    { tag: 'g', p: 'door', children: [
      P('M5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10', { ve: true }),
      P('M15 13v3.5', { ve: true }),
    ] },
  ],
  // Рецепти — сторінка йде через корінець (leaf — повна сторінка, origin 12 12).
  'sys.recipes': [
    P('M12 7v14'),
    P('M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3z'),
    P('M21 18a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3z'),
    P('M12 7a4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-9z', { p: 'leaf', ve: true, attrs: { opacity: 0 } }),
  ],
  // Список — галочки дописуються по черзі, рядки під'їжджають. Без блимання
  // (правка власника 12.09): основна галочка статична й лише притемнюється,
  // копія c1t/c2t обводить її поверх і гасне — знак ніколи не порожній.
  'sys.list': [
    P('m3 7 2 2 4-4', { p: 'c1' }), P('m3 7 2 2 4-4', { p: 'c1t', draw: true }),
    P('m3 17 2 2 4-4', { p: 'c2' }), P('m3 17 2 2 4-4', { p: 'c2t', draw: true }),
    P('M13 6h8', { p: 'r1' }), P('M13 12h8', { p: 'r2' }), P('M13 18h8', { p: 'r3' }),
    P('M3 12h6', { attrs: { opacity: 0.45 } }),
  ],
  // Календар — дати відлітають і приходять нові.
  'sys.calendar': [
    P('M8 2v4', { p: 'pin1' }), P('M16 2v4', { p: 'pin2' }),
    { tag: 'g', p: 'sheet', children: [
      { tag: 'rect', attrs: { x: 3, y: 4, width: 18, height: 18, rx: 2 } },
      P('M3 10h18'),
    ] },
    { tag: 'g', p: 'dates', children: [
      { tag: 'circle', attrs: { cx: 7.6, cy: 15, r: 1, fill: 'currentColor', stroke: 'none' } },
      { tag: 'circle', attrs: { cx: 12, cy: 15, r: 1, fill: 'currentColor', stroke: 'none' } },
      { tag: 'circle', attrs: { cx: 16.4, cy: 15, r: 1, fill: 'currentColor', stroke: 'none' } },
    ] },
  ],
  // Дім зараз — двері відчиняються всередину (hdoor — копія, origin 9.5 21).
  'sys.home': [
    P('M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
    P('M9.5 21v-6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6'),
    P('M9.5 21v-6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6', { p: 'hdoor', ve: true }),
  ],
  // Кошик — котиться, колеса крутяться (спиці sp1/sp2).
  'sys.cart': [
    { tag: 'g', p: 'cart', children: [
      P('M2.5 3h1.8l2.5 11.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 1.95-1.55L21 7.6H5.4'),
      { tag: 'circle', attrs: { cx: 8, cy: 20.6, r: 1.6 } }, P('M8 20.6v-1.6', { p: 'sp1' }),
      { tag: 'circle', attrs: { cx: 19, cy: 20.6, r: 1.6 } }, P('M19 20.6v-1.6', { p: 'sp2' }),
    ] },
  ],
  // Чек — розгортається, рядки проявляються.
  'sys.receipt': [
    { tag: 'g', p: 'body', children: [
      P('M5 3.5A1.5 1.5 0 0 1 6.5 2h11A1.5 1.5 0 0 1 19 3.5V22l-2.33-1.3L14.33 22 12 20.7 9.67 22 7.33 20.7 5 22Z', { ve: true }),
      P('M8.5 7h7', { p: 'l1', ve: true }), P('M8.5 11h7', { p: 'l2', ve: true }), P('M8.5 15h4.5', { p: 'l3', ve: true }),
    ] },
  ],
  // Додати — чверть оберту (рухається весь svg).
  'sys.add': [P('M5 12h14'), P('M12 5v14')],
  // Голос — капсула набирає, дуга домальовується, ніжка проявляється.
  'sys.voice': [
    P('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', { p: 'cap', ve: true }),
    P('M19 10v2a7 7 0 0 1-14 0v-2', { p: 'arc', draw: true }),
    P('M12 19v3', { p: 'stand' }),
  ],
  // Надіслати — стрілка йде вгору й повертається знизу (носій overflow hidden).
  'sys.send': [{ tag: 'g', p: 'arrow', children: [P('M12 19V5'), P('m5 12 7-7 7 7')] }],
  // Вкласти — скріпка домальовується одним рухом.
  'sys.attach': [P('m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48', { p: 'clip', draw: true })],
  // Пошук — лупа робить коло.
  'sys.search': [{ tag: 'g', p: 'lens', children: [{ tag: 'circle', attrs: { cx: 11, cy: 11, r: 7 } }] }, P('m21 21-4.3-4.3')],
  // Фільтр — бігунки їдуть у різні боки.
  'sys.filter': [
    P('M3 7h18', { attrs: { opacity: 0.45 } }), P('M3 12h18', { attrs: { opacity: 0.45 } }), P('M3 17h18', { attrs: { opacity: 0.45 } }),
    P('M14 5v4', { p: 'k1' }), P('M10 10v4', { p: 'k2' }), P('M15 15v4', { p: 'k3' }),
  ],
  // Порядок — стрілки міняються місцями.
  'sys.sort': [
    { tag: 'g', p: 'up', children: [P('M7 20V4'), P('m3 8 4-4 4 4')] },
    { tag: 'g', p: 'down', children: [P('M17 4v16'), P('m21 16-4 4-4-4')] },
  ],
  // Готово — галочка ставиться одним штрихом.
  'sys.done': [P('M20 6 9 17l-5-5', { p: 'tick', draw: true })],
};

/** Живий стан ↔ знак: flame — «Горить», timer — таймер, mic — диктовка, think — «Думаю». */
export const LIVE_ICON: Record<LiveKey, IconName> = {
  flame: 'live.burning', timer: 'cook.timer', mic: 'sys.voice', think: 'live.thinking',
};
