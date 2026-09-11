// Етап 1.5b — моушн знаків за Icons.dc.html (масив `system`, поле `m`).
// Знак → ключ руху. Рухається не знак, а його частина: 1–2 px, 600–900 мс,
// одна крива ease-in-out, без відскоку (Icons «Специфікація»). Keyframes і
// правила наведення — в Icon.module.css, ключ іде в `data-motion`.
//
// Рухів не вигадуємо: є ключ у масиві бандла — робиться він; нема — `null`
// (знак системної сімʼї, якого в масиві з 24 немає, стоїть статично).
// Продукти — статичні (бандл: «без моушну»). Зони й cooking — бандл мовчить →
// QUESTIONS §15, до відповіді статичні.
import type { IconName } from './icons';

export type MotionKey =
  | 'bubble' | 'door' | 'book' | 'checks' | 'flip' | 'home' | 'roll' | 'unroll'
  | 'turn' | 'listen' | 'lift' | 'draw' | 'orbit' | 'sliders' | 'swap' | 'close'
  | 'back' | 'fold' | 'dial' | 'waves' | 'nod';

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
  'sys.send':       'lift',     // стрілка зсувається вгору
  'sys.attach':     'draw',     // скріпка домальовується
  'sys.search':     'orbit',    // лупа робить коло
  'sys.filter':     'sliders',  // бігунки їдуть у різні боки
  'sys.sort':       'swap',     // стрілки міняються місцями
  'sys.done':       'draw',     // галочка ставиться
  'sys.close':      'close',    // хрестик мʼяко стискається
  'sys.undo':       'back',     // стрілка їде назад
  'sys.next':       'draw',     // шеврон домальовується
  'sys.out':        'lift',     // стрілка вилітає з рамки
  'sys.collapse':   'fold',     // роздільник зʼїжджає
  'sys.theme':      'dial',     // прокручується
  'sys.sound':      'waves',    // хвилі виходять по черзі
  'sys.profile':    'nod',      // голова киває
  // Системні знаки поза масивом бандла — статичні.
  'sys.photo': null, 'sys.text': null, 'sys.open': null, 'sys.opened': null, 'sys.expand': null,
  'sys.panelClose': null, 'sys.login': null, 'sys.menu': null, 'sys.back': null, 'sys.later': null,
  'sys.import': null, 'sys.saved': null, 'sys.share': null, 'sys.reply': null, 'sys.stop': null,
  'sys.retry': null, 'sys.tradition': null,
  // Лендінг (етап 9): знаки системної сімʼї з блоку «landing» в icons.ts —
  // у масиві бандла їх немає, тому статичні.
  'landing.opened': null, 'landing.leftover': null, 'landing.recent': null, 'landing.variety': null, 'landing.toPanel': null,
  'auth.sent': null, 'auth.delivered': null, 'auth.household': null, 'auth.otherUser': null,
};

/** Знаки, які бандл малює власними шляхами (Icons.dc.html:218-229), щоб
 *  розділити частини під рух: lucide-react їх не проксує. */
export const CUSTOM_PATHS: Partial<Record<IconName, string[]>> = {
  'sys.recipes': [
    'M12 7v14',
    'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3z',
    'M21 18a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3z',
    'M12 8.5c1.6-1.6 3.6-2.3 6-2.3',   // листок: opacity 0 у спокої, гортається на ховері
  ],
  'sys.pantry': [
    'M5 10V6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v4',
    'M5 10h14',
    'M5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10',   // нижні дверцята
    'M15 13v4',                                      // ручка
  ],
};

/** Живий стан ↔ знак: flame — «Горить», timer — таймер, mic — диктовка, think — «Думаю». */
export const LIVE_ICON: Record<LiveKey, IconName> = {
  flame: 'live.burning', timer: 'cook.timer', mic: 'sys.voice', think: 'live.thinking',
};
