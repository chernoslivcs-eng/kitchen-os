// 12.09 (ANSWERS B7): коли порядок рядків змінюється (правка строку, нова
// партія), рядок ЇДЕ на нове місце, а не зʼявляється там стрибком. FLIP:
// запамʼятали, де рядки стояли, після перемальовки виміряли знову і програли
// різницю назад до нуля. Тривалість — токен --dur-base (240), крива — standard;
// reduced-motion занулює токен, і рух зникає сам.
import { useLayoutEffect, useRef } from 'react';

export function useFlipRows(ids: string[], elementId: (id: string) => string): void {
  const prev = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const next = new Map<string, number>();
    const dur = durBase();
    for (const id of ids) {
      const el = document.getElementById(elementId(id));
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const was = prev.current.get(id);
      if (was == null || dur <= 0 || typeof el.animate !== 'function') continue;
      const dy = was - top;
      if (Math.abs(dy) < 1) continue;
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: dur, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
    prev.current = next;
  });
}

function durBase(): number {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-base').trim();
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 240;
    return v.endsWith('ms') ? n : n * 1000;
  } catch { return 240; }
}
