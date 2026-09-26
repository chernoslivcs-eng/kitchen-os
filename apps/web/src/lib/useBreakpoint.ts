// Винесено з pages/Landing/useLandingMotion.ts (постановка 2026-09-25, екран
// «Підписка»): три пороги дизайн-системи (desk ≥1280, tab ≥768, mob <768) —
// той самий хук, що вже стояв на лендінгу, тепер спільний і для PlanCard.
import { useEffect, useState } from 'react';

export type Bp = 'desk' | 'tab' | 'mob';
const DESK = '(min-width: 1280px)';
const TAB = '(min-width: 768px)';

const pick = (): Bp => {
  if (typeof window === 'undefined') return 'desk';
  return window.matchMedia(DESK).matches ? 'desk' : window.matchMedia(TAB).matches ? 'tab' : 'mob';
};

export function useBreakpoint(): Bp {
  const [bp, setBp] = useState<Bp>(pick);
  useEffect(() => {
    const qs = [window.matchMedia(DESK), window.matchMedia(TAB)];
    const on = () => setBp(pick());
    qs.forEach((q) => q.addEventListener('change', on));
    return () => qs.forEach((q) => q.removeEventListener('change', on));
  }, []);
  return bp;
}
