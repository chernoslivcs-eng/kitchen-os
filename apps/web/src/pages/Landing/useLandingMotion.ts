// Рух лендінгу — як у componentDidMount() бандла Landing Live:
//   · кадр 1920 масштабується zoom = min(1, w / 1920), --vh = h / zoom (fluid до 1920);
//   · reveal: IntersectionObserver threshold .12 + затримка з data-reveal;
//   · блік за курсором: --gx/--gy на [data-gloss], нахил сцени --rx/--ry/--px/--py;
//   · сцена скролу (≥1280): hero гасне й стискається за прогресом, шапка
//     темніє після 24 px, активний рядок «Що вміє» — найближчий до середини
//     вʼюпорта, телефон у фіналі — паралакс;
//   · жива сесія: запуск за IntersectionObserver ([data-live] → data-play),
//     --f1/--f2 стрічки міряються з висот [data-ph].
// prefers-reduced-motion: дрейф бліку 0, reveal одразу видимий; кейфрейми
// глушить CSS (блок reduce у Landing.module.css).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type Bp = 'desk' | 'tab' | 'mob';
const DESK = '(min-width: 1280px)';
const TAB = '(min-width: 768px)';
const REDUCE = '(prefers-reduced-motion: reduce)';

const pick = (): Bp => {
  if (typeof window === 'undefined') return 'desk';
  return window.matchMedia(DESK).matches ? 'desk' : window.matchMedia(TAB).matches ? 'tab' : 'mob';
};

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia(REDUCE).matches;

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

type Root = RefObject<HTMLElement | null>;

export function useFrameZoom(root: Root, on: boolean) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!on) { el.style.removeProperty('--z'); el.style.removeProperty('--vh'); return; }
    const apply = () => {
      const z = Math.min(1, window.innerWidth / 1920);
      el.style.setProperty('--z', z.toFixed(4));
      el.style.setProperty('--vh', `${Math.round(window.innerHeight / z)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [root, on]);
}

export function useReveal(root: Root, key: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const all = () => el.querySelectorAll<HTMLElement>('[data-reveal]:not([data-in])');
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') { all().forEach((n) => n.setAttribute('data-in', '')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const n = e.target as HTMLElement;
        const d = parseInt(n.dataset.reveal || '0', 10);
        setTimeout(() => n.setAttribute('data-in', ''), d);
        io.unobserve(n);
      }
    }, { threshold: 0.12 });
    all().forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root, key]);
}

export function useGloss(root: Root, key: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ptr = { dx: 0, dy: 0 };
    const onMove = (e: PointerEvent) => {
      const g = el.querySelector('[data-gloss]');
      const f = g?.parentElement?.getBoundingClientRect();
      if (!f) return;
      ptr.dx = Math.max(-1, Math.min(1, (e.clientX - (f.left + f.width / 2)) / Math.max(f.width, 1) * 2));
      ptr.dy = Math.max(-1, Math.min(1, (e.clientY - (f.top + f.height / 2)) / Math.max(f.height, 1) * 2));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    const reduce = reducedMotion();
    const cur = { x: 0, y: 0 };
    let raf = 0;
    const tick = (t: number) => {
      const drift = reduce ? 0 : Math.sin(t / 9000 * Math.PI * 2) * 0.55;
      const tx = drift + ptr.dx * 0.45, ty = ptr.dy * 0.35;
      cur.x += (tx - cur.x) * 0.06; cur.y += (ty - cur.y) * 0.06;
      const gx = `${(50 + cur.x * 60).toFixed(2)}%`, gy = `${(30 + cur.y * 40).toFixed(2)}%`;
      el.querySelectorAll<HTMLElement>('[data-gloss]').forEach((g) => { g.style.setProperty('--gx', gx); g.style.setProperty('--gy', gy); });
      el.querySelectorAll<HTMLElement>('[data-stage]').forEach((s) => {
        s.style.setProperty('--ry', `${(cur.x * 8).toFixed(2)}deg`);
        s.style.setProperty('--rx', `${(cur.y * -6).toFixed(2)}deg`);
        s.style.setProperty('--px', `${(cur.x * 14).toFixed(1)}px`);
        s.style.setProperty('--py', `${(cur.y * 10).toFixed(1)}px`);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); };
  }, [root, key]);
}

/** Стрічка чату: --f1 = c + typing, --f2 = c + typing + d (бандл _measureFeeds). */
function measureFeeds(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>('[data-feed]').forEach((feed) => {
    const gap = parseFloat(getComputedStyle(feed).gap) || 0;
    const hs = (sel: string) => Array.from(feed.querySelectorAll<HTMLElement>(sel)).reduce((a, n) => a + n.offsetHeight + gap, 0);
    const c = hs('[data-ph="c"]'), t = hs('[data-ph="t"]'), d = hs('[data-ph="d"]');
    feed.style.setProperty('--f1', `${(c + t).toFixed(0)}px`);
    feed.style.setProperty('--f2', `${(c + t + d).toFixed(0)}px`);
  });
}

export function useLiveStart(root: Root, key: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    measureFeeds(el);
    const t = setTimeout(() => measureFeeds(el), 800);
    const onResize = () => measureFeeds(el);
    window.addEventListener('resize', onResize);
    const lives = el.querySelectorAll<HTMLElement>('[data-live]');
    if (typeof IntersectionObserver === 'undefined') { lives.forEach((n) => n.setAttribute('data-play', '')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.setAttribute('data-play', ''); io.unobserve(e.target); }
    }, { threshold: 0.2 });
    lives.forEach((n) => io.observe(n));
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); io.disconnect(); };
  }, [root, key]);
}

export function useScrollScene(root: Root, on: boolean) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const illRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  useEffect(() => {
    if (!on) return;
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      raf = 0;
      const sc = window.scrollY > 24;
      const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.6)));
      const h = heroRef.current;
      if (h) { h.style.opacity = String(1 - p); h.style.transform = `scale(${1 - p * 0.06})`; }
      const hd = headerRef.current;
      if (hd) { if (sc) hd.setAttribute('data-scrolled', ''); else hd.removeAttribute('data-scrolled'); }
      // активний рядок «Що вміє» — найближчий до середини вʼюпорта
      const mid = window.innerHeight * 0.5;
      let best = 0, bd = Infinity;
      el.querySelectorAll<HTMLElement>('[data-feat]').forEach((n) => {
        const r = n.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bd) { bd = d; best = parseInt(n.dataset.feat || '0', 10); }
      });
      if (best !== activeRef.current) { activeRef.current = best; setActive(best); }
      // паралакс телефона у фіналі
      const ill = illRef.current;
      if (ill) {
        const r = ill.getBoundingClientRect();
        const c = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
        ill.style.transform = `translateY(${Math.round(-c * 28)}px) rotate(${(-c * 1.2).toFixed(2)}deg)`;
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(run); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    run();
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [root, on]);
  return { active, heroRef, headerRef, illRef };
}
