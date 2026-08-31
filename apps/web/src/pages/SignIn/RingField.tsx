// Пул-6 №8: «кільце замикається» — інтерактивне поле входу. Порт canvas-коду
// з дизайн-брифу «Вхід — фінал» майже дослівно: інгредієнти-кільця з глибиною
// (z-розмір, тіні, паралакс), світло за курсором; трійка найближчих тягнеться,
// пунктирні зв'язки біжать, кільця ◌ замикаються в ● страву.
// Пул-8 №3 (оновлений кіт): плавний старт — вплив курсора наростає (amt),
// позиція згладжується; кільця хаотично дрейфують у своїй околиці; 2/3
// інгредієнтів страви → підказка «+ третій → страва»; замкнуте кільце
// показує іконку продукту замість вузла.
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
  { k: ['ФЕТА', 'РУКОЛА', 'БАГЕТ'], n: 'брускета з фетою · 10 хв' },
  { k: ['ТОМАТИ', 'ОЛИВКИ', 'ЧАСНИК'], n: 'путанеска · 30 хв' },
  { k: ['ЛОСОСЬ', 'ЛИМОН', 'КРІП'], n: 'лосось із кропом · 20 хв' },
  { k: ['ЯЙЦЯ', 'МОЛОКО', 'МАСЛО'], n: 'вершковий омлет · 10 хв' },
  { k: ['ГРЕЧКА', 'ГРИБИ', 'ЦИБУЛЯ'], n: 'гречка з грибами · 25 хв' },
  { k: ['ТОФУ', 'ІМБИР', 'КУНЖУТ'], n: 'тофу стір-фрай · 20 хв' },
  { k: ['ЙОГУРТ', 'ЛИМОН', 'КРІП'], n: 'дзадзикі · 5 хв' },
  { k: ['ШПИНАТ', 'ВЕРШКИ 33%', 'ЧАСНИК'], n: 'крем-шпинат · 15 хв' },
  { k: ['ПЕРЕЦЬ', 'ТОМАТИ', 'ЦИБУЛЯ'], n: 'лечо · 30 хв' },
  { k: ['БАГЕТ', 'ЧАСНИК', 'МАСЛО'], n: 'часниковий багет · 12 хв' },
  { k: ['ФУЕТ', 'БАГЕТ', 'РУКОЛА'], n: 'тост із фуетом · 8 хв' },
  { k: ['РИС', 'КУНЖУТ', 'ЛОСОСЬ'], n: 'поке з лососем · 15 хв' },
];

// Іконка продукту в замкнутому кільці — мінімальні лінійні гліфи з кіта.
const ICON: Record<string, string> = {
  'ВЕРШКИ 33%': 'drop', 'МОЛОКО': 'drop', 'ЙОГУРТ': 'drop', 'МАСЛО': 'cheese',
  'ЛОСОСЬ': 'fish', 'ЯЙЦЯ': 'egg', 'ТОФУ': 'cheese', 'ПАРМЕЗАН': 'cheese', 'ФЕТА': 'cheese', 'ФУЕТ': 'salami',
  'РИС': 'grain', 'ГРЕЧКА': 'grain', 'НУТ': 'grain', 'КУНЖУТ': 'grain',
  'РУКОЛА': 'leaf', 'ШПИНАТ': 'leaf', 'КРІП': 'leaf',
  'БАГЕТ': 'bread', 'ЦИБУЛЯ': 'bulb', 'ЧАСНИК': 'bulb', 'ІМБИР': 'bulb',
  'ТОМАТИ': 'round', 'ОЛИВКИ': 'round', 'ПЕРЕЦЬ': 'round', 'ЛИМОН': 'round', 'ГРИБИ': 'mush',
};

interface Part {
  l: string; amber?: 1;
  hx: number; hy: number; x: number; y: number;
  close: number; lean: number; leanY: number; ph: number; z: number;
  f1: number; f2: number; a1: number; a2: number;
  hvx: number; hvy: number;
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
    // Плавний старт: вплив курсора наростає, позиція згладжується — поле не
    // смикається, коли курсор влітає з краю.
    const sm = { x: 0, y: 0, init: false };
    let amt = 0;

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
            f1: 0.00035 + Math.random() * 0.0005, f2: 0.0002 + Math.random() * 0.0004,
            a1: 10 + Math.random() * 16, a2: 4 + Math.random() * 9,
            hvx: 0, hvy: 0,
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

    const drawIcon = (type: string, x: number, y: number, s: number, a: number) => {
      ctx.save(); ctx.translate(x, y);
      ctx.strokeStyle = `rgba(242,244,240,${a.toFixed(3)})`;
      ctx.fillStyle = `rgba(242,244,240,${(a * 0.9).toFixed(3)})`;
      ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      if (type === 'drop') { ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.9, s * 0.1, 0, s * 0.75); ctx.quadraticCurveTo(-s * 0.9, s * 0.1, 0, -s); ctx.stroke(); }
      else if (type === 'fish') { ctx.ellipse(-s * 0.15, 0, s * 0.7, s * 0.42, 0, 0, 6.29); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.95, -s * 0.4); ctx.lineTo(s * 0.95, s * 0.4); ctx.closePath(); ctx.stroke(); }
      else if (type === 'egg') { ctx.ellipse(0, 0, s * 0.6, s * 0.8, 0, 0, 6.29); ctx.stroke(); ctx.beginPath(); ctx.arc(0, s * 0.1, s * 0.25, 0, 6.29); ctx.fill(); }
      else if (type === 'grain') { ([[-s * 0.5, s * 0.3], [0, -s * 0.4], [s * 0.5, s * 0.3]] as const).forEach((pt) => { ctx.moveTo(pt[0] + s * 0.22, pt[1]); ctx.arc(pt[0], pt[1], s * 0.22, 0, 6.29); }); ctx.fill(); }
      else if (type === 'leaf') { ctx.moveTo(0, s * 0.8); ctx.quadraticCurveTo(-s * 0.9, 0, 0, -s * 0.8); ctx.quadraticCurveTo(s * 0.9, 0, 0, s * 0.8); ctx.moveTo(0, s * 0.8); ctx.lineTo(0, -s * 0.5); ctx.stroke(); }
      else if (type === 'bread') { ctx.moveTo(-s * 0.8, s * 0.3); ctx.quadraticCurveTo(0, -s * 0.8, s * 0.8, s * 0.3); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.1); ctx.lineTo(-s * 0.1, s * 0.1); ctx.moveTo(s * 0.1, -s * 0.2); ctx.lineTo(s * 0.3, 0); ctx.stroke(); }
      else if (type === 'cheese') { ctx.moveTo(-s * 0.8, s * 0.5); ctx.lineTo(s * 0.8, s * 0.5); ctx.lineTo(s * 0.55, -s * 0.55); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, s * 0.15, s * 0.13, 0, 6.29); ctx.fill(); }
      else if (type === 'salami') { ctx.ellipse(0, 0, s * 0.75, s * 0.5, -0.6, 0, 6.29); ctx.stroke(); ctx.beginPath(); ctx.arc(-s * 0.2, s * 0.1, s * 0.11, 0, 6.29); ctx.arc(s * 0.25, -s * 0.15, s * 0.11, 0, 6.29); ctx.fill(); }
      else if (type === 'bulb') { ctx.arc(0, s * 0.2, s * 0.55, 0, 6.29); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -s * 0.35); ctx.lineTo(0, -s * 0.85); ctx.moveTo(-s * 0.3, -s * 0.3); ctx.lineTo(-s * 0.45, -s * 0.7); ctx.moveTo(s * 0.3, -s * 0.3); ctx.lineTo(s * 0.45, -s * 0.7); ctx.stroke(); }
      else if (type === 'mush') { ctx.moveTo(-s * 0.7, 0); ctx.quadraticCurveTo(0, -s * 1.1, s * 0.7, 0); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-s * 0.2, s * 0.1); ctx.lineTo(-s * 0.2, s * 0.7); ctx.lineTo(s * 0.2, s * 0.7); ctx.lineTo(s * 0.2, s * 0.1); ctx.stroke(); }
      else { ctx.arc(0, 0, s * 0.6, 0, 6.29); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.quadraticCurveTo(s * 0.35, -s * 0.9, s * 0.5, -s * 0.65); ctx.stroke(); }
      ctx.restore();
    };

    const frame = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      const mt = mouse.current, hasM = mt.x > -999;
      amt += ((hasM ? 1 : 0) - amt) * 0.055;
      if (hasM) {
        if (!sm.init) { sm.x = mt.x; sm.y = mt.y; sm.init = true; }
        sm.x += (mt.x - sm.x) * 0.11;
        sm.y += (mt.y - sm.y) * 0.11;
      }
      const m = sm, active = sm.init && amt > 0.03;
      const bgg = ctx.createLinearGradient(0, 0, 0, H);
      bgg.addColorStop(0, 'rgba(242,244,240,.07)'); bgg.addColorStop(0.4, 'rgba(0,0,0,0)'); bgg.addColorStop(1, 'rgba(22,32,18,.4)');
      ctx.fillStyle = bgg; ctx.fillRect(0, 0, W, H);
      if (active) {
        const lg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 360);
        lg.addColorStop(0, `rgba(242,244,240,${(0.13 * amt).toFixed(3)})`); lg.addColorStop(1, 'rgba(242,244,240,0)');
        ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
      }
      const par = active ? { x: (m.x - W / 2) * 0.014 * amt, y: (m.y - H / 2) * 0.014 * amt } : { x: 0, y: 0 };
      ctx.fillStyle = 'rgba(242,244,240,.11)';
      for (let gx = 30; gx < W + 52; gx += 52) for (let gy = 26; gy < H + 52; gy += 52) {
        ctx.beginPath(); ctx.arc(gx - par.x, gy - par.y, 1.1, 0, 6.29); ctx.fill();
      }
      const short = H < 400;
      parts.forEach((p) => {
        const zz = p.z;
        // Хаотичний дрейф дому: повільний random walk у своїй околиці.
        p.hvx += (Math.random() - 0.5) * 0.012; p.hvy += (Math.random() - 0.5) * 0.011;
        p.hvx *= 0.985; p.hvy *= 0.985;
        p.hx += p.hvx; p.hy += p.hvy;
        if (p.hx < 70) { p.hx = 70; p.hvx = Math.abs(p.hvx); } if (p.hx > W - 130) { p.hx = W - 130; p.hvx = -Math.abs(p.hvx); }
        const yMin = short ? 20 : 130, yMax = short ? H - 20 : H - 60;
        if (p.hy < yMin) { p.hy = yMin; p.hvy = Math.abs(p.hvy); } if (p.hy > yMax) { p.hy = yMax; p.hvy = -Math.abs(p.hvy); }
        p.x = p.hx + Math.cos(t * p.f1 + p.ph) * p.a1 * zz + Math.sin(t * p.f2 + p.ph * 2.7) * p.a2 + (active ? (W / 2 - m.x) * 0.06 * (1 - zz) * amt : 0);
        p.y = p.hy + Math.sin(t * p.f1 * 0.9 + p.ph * 1.4) * p.a1 * 0.8 * zz + Math.cos(t * p.f2 * 1.2 + p.ph) * p.a2 + (active ? (H / 2 - m.y) * 0.06 * (1 - zz) * amt : 0);
      });
      let trio: Part[] = [];
      if (active && amt > 0.35) {
        trio = parts.map((p) => ({ p, d: Math.hypot(p.x - m.x, p.y - m.y) }))
          .sort((a, b) => a.d - b.d).slice(0, 3).filter((o) => o.d < 230).map((o) => o.p);
      }
      const names = trio.map((p) => p.l);
      const dish = trio.length === 3 ? DISHES.find((D) => D.k.every((k) => names.includes(k))) : null;
      // Підказка: 2 з 3 інгредієнтів якоїсь страви вже в трійці.
      let hint: string | null = null;
      if (!dish && trio.length >= 2) {
        let best: typeof DISHES[number] | null = null;
        for (const D of DISHES) {
          const nHave = D.k.filter((k) => names.includes(k)).length;
          if (nHave === 2) { best = D; break; }
        }
        if (best) hint = `+ ${best.k.find((k) => !names.includes(k))} → ${best.n.split(' · ')[0]}`;
      }
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
          ctx.strokeStyle = `rgba(242,244,240,${((dish ? 0.8 : 0.4) * amt).toFixed(3)})`;
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
        // Вузол гасне, коли кільце замикається — його місце займає іконка.
        const dotA = (0.2 + 0.8 * cl) * za * Math.max(0, 1 - cl * 1.6);
        if (dotA > 0.02) {
          ctx.fillStyle = `rgba(242,244,240,${dotA.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, (2.2 + 1.6 * cl) * (0.6 + 0.5 * zz), 0, 6.29); ctx.fill();
        }
        if (cl > 0.25) drawIcon(ICON[p.l] ?? 'round', p.x, p.y, rr * 0.62 * (0.7 + 0.3 * cl), Math.min(1, (cl - 0.25) * 1.8) * za);
        ctx.font = `500 ${Math.round(8.5 + 2.5 * zz)}px "IBM Plex Mono", monospace`;
        ctx.fillStyle = p.amber
          ? `rgba(232,200,132,${((0.55 + 0.45 * cl) * za).toFixed(3)})`
          : `rgba(211,224,205,${((0.4 + 0.6 * cl) * za).toFixed(3)})`;
        ctx.fillText((p.amber ? '◔ ' : '') + p.l, p.x + rr + 8, p.y + 4);
      });
      if (active) {
        ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(t / 900);
        ring(0, 0, 15, dish ? 1 : 0, `rgba(242,244,240,${((dish ? 0.95 : 0.6) * amt).toFixed(3)})`, 2.5);
        ctx.restore();
        ctx.fillStyle = `rgba(242,244,240,${(0.95 * amt).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, 4.5 * (0.5 + 0.5 * amt), 0, 6.29); ctx.fill();
        const label = dish ? `✓ ${dish.n}` : (hint ?? (trio.length === 3 ? 'щось нове… — спитай Кухню' : ''));
        if (label && amt > 0.5) {
          ctx.globalAlpha = Math.min(1, (amt - 0.5) * 3);
          ctx.font = '600 12px "IBM Plex Mono", monospace';
          const w = ctx.measureText(label).width;
          ctx.fillStyle = dish ? '#2c3f26' : '#1d2126';
          ctx.beginPath(); ctx.roundRect(m.x - w / 2 - 12, m.y + 28, w + 24, 26, 8); ctx.fill();
          ctx.fillStyle = '#f2f4f0'; ctx.fillText(label, m.x - w / 2, m.y + 45);
          ctx.globalAlpha = 1;
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
