// Крапкове поле лендингу v5: два «лепестки» шуму зверху і знизу сцени,
// пʼять смуг яскравості (верхні дві — бурштин і крем). Дихає з часом, нахиляється
// до курсора; reduced motion — один нерухомий кадр. Портовано з канвасу
// «Лендинг v5 - ланцюг» без змін у формулах.

import { useEffect, useRef } from 'react';

interface Props {
  /** Точка курсора в координатах сцени; null — курсор поза сценою. */
  mouse: React.MutableRefObject<{ x: number; y: number } | null>;
  still: boolean;
}

export function DotField({ mouse, still }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let raf = 0;
    let cancelled = false;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const setup = () => {
      const r = cv.getBoundingClientRect();
      const W = r.width, H = r.height;
      if (W < 100 || H < 100) { raf = requestAnimationFrame(setup); return; }
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const step = W < 768 ? 12 : 13;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lobe = (x: number, y: number, ax: number, ay: number, rx: number, ry: number) =>
        Math.max(0, 1 - Math.sqrt(((x - ax) / rx) ** 2 + ((y - ay) / ry) ** 2));
      const n = (x: number, y: number, t: number) =>
        0.5 + 0.5 * Math.sin(x * 0.010 + Math.sin(y * 0.008 + t) * 2.2) * Math.cos(y * 0.012 + Math.sin(x * 0.006 - t * 0.7) * 1.6);
      const cols = Math.ceil(W / step), rows = Math.ceil(H / step);
      const mask = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = i * step + step / 2, y = j * step + step / 2;
        mask[j * cols + i] = Math.max(lobe(x, y, W * 0.5, H * 0.02, W * 0.62, H * 0.3), lobe(x, y, W * 0.5, H * 0.98, W * 0.7, H * 0.26));
      }
      const sm = { x: W / 2, y: H / 2 };
      let amt = 0;
      const draw = (ts: number) => {
        if (cancelled) return;
        const t = still ? 0 : ts / 9000;
        const m = mouse.current;
        const hasM = !!m && !still;
        amt += ((hasM ? 1 : 0) - amt) * 0.06;
        if (hasM && m) { sm.x += (m.x - sm.x) * 0.1; sm.y += (m.y - sm.y) * 0.1; }
        ctx.clearRect(0, 0, W, H);
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const mk = mask[j * cols + i]!;
          if (mk <= 0) continue;
          const x = i * step + step / 2, y = j * step + step / 2;
          const v = Math.round(n(x, y, t) * mk * 5) / 5;
          if (v <= 0.05) continue;
          const band = Math.round(v * 5);
          ctx.fillStyle = band >= 5 ? 'rgba(232,206,150,.85)' : band === 4 ? 'rgba(246,239,224,.7)' : `rgba(242,244,240,${(0.1 + v * 0.4).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(x, y, v * 4.6, 0, 6.29); ctx.fill();
        }
        if (!still) raf = requestAnimationFrame(draw);
      };
      draw(0);
    };
    setup();
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); setup(); });
    ro.observe(cv);
    return () => { cancelled = true; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [mouse, still]);

  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true" />;
}
