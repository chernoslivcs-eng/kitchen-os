// Пул-6 №8: «кільце замикається» — інтерактивне поле входу. Порт canvas-коду
// з дизайн-брифу «Вхід — фінал» майже дослівно: інгредієнти-кільця з глибиною
// (z-розмір, тіні, паралакс), світло за курсором; трійка найближчих тягнеться,
// пунктирні зв'язки біжать, кільця ◌ замикаються в ● страву. Відома трійка —
// плашка з назвою, невідома — «щось нове… — спитай Кухню».
// animate=false (мобайл, reduced motion) — один статичний кадр без RAF.

import { useEffect, useRef } from 'react';

const ITEMS: Array<{ l: string; amber?: 1 }> = [
  { l: 'ВЕРШКИ 33%', amber: 1 }, { l: 'ФУЕТ' }, { l: 'ПАРМЕЗАН' }, { l: 'ЯЙЦЯ' },
  { l: 'ЛОСОСЬ' }, { l: 'РИС' }, { l: 'ФЕТА', amber: 1 }, { l: 'ТОМАТИ' },
  { l: 'НУТ' }, { l: 'ІМБИР' }, { l: 'ЧАСНИК' }, { l: 'КУНЖУТ' },
  { l: 'РУКОЛА' }, { l: 'БАГЕТ', amber: 1 }, { l: 'ЦИБУЛЯ' }, { l: 'ОЛИВКИ' },
  { l: 'ШПИНАТ', amber: 1 }, { l: 'МОЛОКО' }, { l: 'ГРЕЧКА' }, { l: 'ЛИМОН' },
  { l: 'МАСЛО' }, { l: 'ПЕРЕЦЬ' }, { l: 'ГРИБИ' }, { l: 'КРІП' },
  { l: 'ЙОГУРТ', amber: 1 }, { l: 'ТОФУ' },
];

const DISHES = [
  { k: ['ВЕРШКИ 33%', 'ФУЕТ', 'ПАРМЕЗАН'], n: 'вершкова фетучіні · 25 хв · рятує вершки' },
  { k: ['ЛОСОСЬ', 'РИС', 'ІМБИР'], n: 'лосось терияки · 30 хв' },
  { k: ['ЯЙЦЯ', 'ФЕТА', 'ТОМАТИ'], n: 'шакшука · 25 хв · рятує фету' },
  { k: ['НУТ', 'ЧАСНИК', 'КУНЖУТ'], n: 'хумус · 15 хв' },
  { k: ['ГРИБИ', 'ЦИБУЛЯ', 'РИС'], n: 'різото з грибами · 40 хв' },
  { k: ['ШПИНАТ', 'ЯЙЦЯ', 'ПАРМЕЗАН'], n: 'фритата зі шпинатом · 20 хв' },
];

interface Part {
  l: string; amber?: 1;
  hx: number; hy: number; x: number; y: number;
  close: number; lean: number; leanY: number; ph: number; z: number;
}

export function RingField({ animate }: { animate: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const cv = canvasRef.current, stage = stageRef.current;
    if (!cv || !stage) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const GAP = 1.05, A0 = -1.02;
    let W = 0, H = 0;
    let parts: Part[] = [];
    let raf = 0;

    const resize = () => {
      const r = stage.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      if (!parts.length && W > 0) {
        const cols = 5, gw = (W - 190) / (cols - 1);
        // Низька шапка (мобайл 220px): рівномірна розкладка без «хедлайнового»
        // відступу — інакше всі ряди злипаються в одну смугу.
        const short = H < 400;
        const baseY = short ? 34 : 135;
        const rowStep = short ? (H - 60) / 4.6 : (H - 240) / 4.6;
        parts = ITEMS.map((it, i) => {
          const c = i % cols, row = Math.floor(i / cols);
          const p: Part = {
            ...it,
            hx: 90 + c * gw + (row % 2 ? gw * 0.32 : 0) + (Math.random() - 0.5) * 34,
            hy: baseY + row * rowStep + (Math.random() - 0.5) * (short ? 8 : 22),
            x: 0, y: 0, close: 0, lean: 0, leanY: 0, ph: Math.random() * 6.28, z: 0.4 + Math.random() * 0.6,
          };
          p.x = p.hx; p.y = p.hy;
          return p;
        });
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    const ring = (x: number, y: number, r: number, close: number, color: string, lw: number) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
      const gap = GAP * (1 - close);
      ctx.beginPath(); ctx.arc(x, y, r, A0 + gap / 2, A0 - gap / 2 + Math.PI * 2); ctx.stroke();
    };

    const frame = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      const m = mouse.current, active = m.x > -999;
      const bgg = ctx.createLinearGradient(0, 0, 0, H);
      bgg.addColorStop(0, 'rgba(242,244,240,.07)'); bgg.addColorStop(0.4, 'rgba(0,0,0,0)'); bgg.addColorStop(1, 'rgba(22,32,18,.4)');
      ctx.fillStyle = bgg; ctx.fillRect(0, 0, W, H);
      if (active) {
        const lg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 360);
        lg.addColorStop(0, 'rgba(242,244,240,.13)'); lg.addColorStop(1, 'rgba(242,244,240,0)');
        ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
      }
      const par = active ? { x: (m.x - W / 2) * 0.014, y: (m.y - H / 2) * 0.014 } : { x: 0, y: 0 };
      ctx.fillStyle = 'rgba(242,244,240,.11)';
      for (let gx = 30; gx < W + 52; gx += 52) for (let gy = 26; gy < H + 52; gy += 52) {
        ctx.beginPath(); ctx.arc(gx - par.x, gy - par.y, 1.1, 0, 6.29); ctx.fill();
      }
      parts.forEach((p) => {
        const zz = p.z;
        p.x = p.hx + Math.cos(t * 0.00048 + p.ph) * 17 * zz + Math.sin(t * 0.00031 + p.ph * 2) * 6 + (active ? (W / 2 - m.x) * 0.06 * (1 - zz) : 0);
        p.y = p.hy + Math.sin(t * 0.00042 + p.ph) * 14 * zz + Math.cos(t * 0.00027 + p.ph * 2) * 5 + (active ? (H / 2 - m.y) * 0.06 * (1 - zz) : 0);
      });
      let trio: Part[] = [];
      if (active) {
        trio = parts.map((p) => ({ p, d: Math.hypot(p.x - m.x, p.y - m.y) }))
          .sort((a, b) => a.d - b.d).slice(0, 3).filter((o) => o.d < 230).map((o) => o.p);
      }
      const dish = trio.length === 3 ? DISHES.find((D) => D.k.every((k) => trio.some((p) => p.l === k))) : null;
      parts.forEach((p) => {
        const inT = trio.includes(p);
        p.lean += ((inT ? (m.x - p.x) * 0.2 : 0) - p.lean) * 0.1;
        p.leanY += ((inT ? (m.y - p.y) * 0.2 : 0) - p.leanY) * 0.1;
        p.x += p.lean; p.y += p.leanY;
      });
      if (trio.length) {
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 7]); ctx.lineDashOffset = -t / 24;
        trio.forEach((p) => {
          ctx.strokeStyle = dish ? 'rgba(242,244,240,.8)' : 'rgba(242,244,240,.4)';
          ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        });
        ctx.setLineDash([]);
      }
      parts.forEach((p) => {
        const inTrio = trio.includes(p);
        p.close += ((inTrio ? 1 : 0) - p.close) * 0.1;
        const cl = p.close;
        const amberPulse = p.amber ? 0.65 + 0.35 * Math.sin(t / 400 + p.ph) : 1;
        const zz = p.z, za = 0.3 + 0.7 * zz, rr = (11 + 2 * cl) * (0.55 + 0.55 * zz);
        const col = p.amber
          ? `rgba(232,200,132,${((0.6 + 0.4 * cl) * amberPulse * za).toFixed(3)})`
          : `rgba(242,244,240,${((0.4 + 0.6 * cl) * za).toFixed(3)})`;
        if (cl > 0.25 || zz > 0.82) { ctx.shadowColor = 'rgba(18,26,14,.55)'; ctx.shadowBlur = 16 * zz; ctx.shadowOffsetY = 5; }
        ring(p.x, p.y, rr, cl, col, (1.6 + cl) * (0.55 + 0.55 * zz));
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = `rgba(242,244,240,${((0.2 + 0.8 * cl) * za).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, (2.2 + 1.6 * cl) * (0.6 + 0.5 * zz), 0, 6.29); ctx.fill();
        ctx.font = `500 ${Math.round(8.5 + 2.5 * zz)}px "IBM Plex Mono", monospace`;
        ctx.fillStyle = p.amber
          ? `rgba(232,200,132,${((0.55 + 0.45 * cl) * za).toFixed(3)})`
          : `rgba(211,224,205,${((0.4 + 0.6 * cl) * za).toFixed(3)})`;
        ctx.fillText((p.amber ? '◔ ' : '') + p.l, p.x + rr + 8, p.y + 4);
      });
      if (active) {
        ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(t / 900);
        ring(0, 0, 15, dish ? 1 : 0, `rgba(242,244,240,${dish ? 0.95 : 0.6})`, 2.5);
        ctx.restore();
        ctx.fillStyle = 'rgba(242,244,240,.95)';
        ctx.beginPath(); ctx.arc(m.x, m.y, 4.5, 0, 6.29); ctx.fill();
        const label = dish ? dish.n : (trio.length === 3 ? 'щось нове… — спитай Кухню' : '');
        if (label) {
          ctx.font = '600 12px "IBM Plex Mono", monospace';
          const w = ctx.measureText(label).width;
          ctx.fillStyle = '#1d2126';
          ctx.beginPath(); ctx.roundRect(m.x - w / 2 - 12, m.y + 28, w + 24, 26, 8); ctx.fill();
          ctx.fillStyle = '#f2f4f0'; ctx.fillText(label, m.x - w / 2, m.y + 45);
        }
      }
    };

    if (animate) {
      const loop = (t: number) => { frame(t); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    } else {
      // Статичний кадр: шрифти мають довантажитись, інакше підписи системні.
      void document.fonts.ready.then(() => { resize(); frame(0); });
      frame(0);
    }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [animate]);

  return (
    <div
      ref={stageRef}
      style={{ position: 'absolute', inset: 0 }}
      onMouseMove={animate ? (e) => {
        const r = stageRef.current!.getBoundingClientRect();
        mouse.current.x = e.clientX - r.left;
        mouse.current.y = e.clientY - r.top;
      } : undefined}
      onMouseLeave={animate ? () => { mouse.current.x = -9999; mouse.current.y = -9999; } : undefined}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}
