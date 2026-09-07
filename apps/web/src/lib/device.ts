// Крок А1: пристрій, з якого людина дивиться.
//
// Пілотна людина знайшла на телефоні баг — у картці «Про тебе» не вводиться
// текст, — і продукт про це не знав і не міг знати: у подіях немає нічого про
// пристрій. Тихий провал на одному класі пристроїв був невидимий за
// побудовою. Ця дрібниця це й закриває.
//
// Головний сигнал — ШИРИНА. Клас — похідне від неї, зручність для очей.
// Тому в подію їдуть обидва: якщо межі колись поїдуть, ширина лишиться
// правдою, з якої клас можна перерахувати запитом.

import type { DeviceClass } from '@kitchen/domain';

/**
 * Межі — НЕ вигадані, а зняті з розкладки продукту: styles/tokens.css, де
 * `body.with-sidebar` перемикається двічі. До 768 таб-бар унизу (телефон);
 * 768–1023 — смужка 64px (планшет); від 1024 — сайдбар 232px (десктоп).
 *
 * Ці два числа мусять мінятися парою з tokens.css. Якщо там колись зʼявиться
 * третя межа для класу пристрою — вона мусить приїхати й сюди.
 */
export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1024;

/** Клас пристрою з ширини вікна. Єдине місце, де ці межі перетворюються на слово. */
export function deviceClass(width: number): DeviceClass {
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= TABLET_MIN) return 'tablet';
  return 'mobile';
}

// Родина браузера й ОС — грубо, підрядками. Бібліотеку розбору User-Agent не
// тягнемо свідомо: нам треба відповісти на питання «це зламалось у всіх на
// айфонах?», а не побудувати точний портрет машини. Порядок перевірок —
// від вужчого до ширшого: Edge каже про себе «Chrome», Chrome — «Safari».
const BROWSERS: [RegExp, string][] = [
  [/\bEdg\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\//, 'Chrome'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b|\biPad\b|\biPod\b|\biOS\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b|\bCrOS\b/, 'Linux'],
];

const first = (ua: string, table: [RegExp, string][]) => table.find(([re]) => re.test(ua))?.[1];

/**
 * «Safari · iOS». Невпізнане лишається порожнім: слово «Unknown» у стовпчику
 * читалося б як факт про пристрій, хоча воно факт про нас.
 */
export function uaFamily(ua: string): string | null {
  const parts = [first(ua, BROWSERS), first(ua, SYSTEMS)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export interface DeviceEnvelope {
  w: number;
  class: DeviceClass;
  ua: string | null;
}

/** Знімок пристрою на момент відправки пачки. Поза браузером — нічого. */
export function readDevice(): DeviceEnvelope | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window.innerWidth;
  if (!Number.isFinite(w) || w <= 0) return undefined;
  return { w: Math.round(w), class: deviceClass(w), ua: uaFamily(navigator.userAgent ?? '') };
}
