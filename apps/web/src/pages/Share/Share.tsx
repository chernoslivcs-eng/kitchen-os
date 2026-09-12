// Публікація страви (M15, переробка пул-5 №7). Фото користувача + шар
// системи зверху — як Strava над фото пробіжки. Прев'ю І експорт малює один
// і той самий canvas-код: що бачиш, те й шериш.
//
// Формати: сторіз 9:16 (default) і пост 4:5. Шаблони оверлеїв — чотири з
// дизайн-брифу «Патерни та оверлеї»: A стек статів по центру, B кутовий
// блок, C велике твердження «ВЕЧЕРЯ Є.», D вертикальна рейка. Спільні
// правила брифу: текст із м'якою тінню прямо на фото, без плашок і скрімів,
// знак завжди присутній, мета — в моно.
//
// «Поділитись» на мобілці — navigator.share з PNG-файлом: системний шит
// підхоплює Інстаграм (сторіз/пост). Без підтримки share — завантаження PNG.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon/Icon';
import type { Recipe } from '../../api';
import { plural } from '../../lib/plural';
import styles from './Share.module.css';

interface State { recipe?: Recipe; photoUrl?: string | null; recipeId?: string | null }

type Format = 'story' | 'post';
type Template = 'A' | 'B' | 'C' | 'D';

/* Палітра експорту — з токенів --export-* (Share.module.css .screen), не hex у коді. */
function exportPalette(el: Element) {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { ink: v('--export-ink'), bg: v('--export-bg'), sage: v('--export-sage'), shadow: v('--export-shadow') };
}
let PAL = { ink: '', bg: '', sage: '', shadow: '' };

const FORMATS: Record<Format, { w: number; h: number; label: string }> = {
  story: { w: 1080, h: 1920, label: 'Сторіз 9:16' },
  post: { w: 1080, h: 1350, label: 'Пост 4:5' },
};

const TEMPLATES: Array<{ id: Template; label: string }> = [
  { id: 'A', label: 'Стек' },
  { id: 'B', label: 'Кут' },
  { id: 'C', label: 'ВЕЧЕРЯ Є.' },
  { id: 'D', label: 'Рейка' },
];

export function SharePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as State | null);
  const recipe = state?.recipe ?? null;
  const recipeId = state?.recipeId ?? null;
  const shareUrl = recipeId ? `${window.location.origin}/r/${recipeId}` : null;
  const [photoUrl, setPhotoUrl] = useState<string | null>(state?.photoUrl ?? null);
  const [format, setFormat] = useState<Format>('story');
  const [template, setTemplate] = useState<Template>('A');
  const [busy, setBusy] = useState<'share' | 'download' | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const r = recipe;
  const total = r?.ing.length ?? 0;
  const fromPantry = r?.ing.filter((i) => i.p).length ?? 0;

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !r) return;
    const { w, h } = FORMATS[format];
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Шрифти мають бути готові до першого замальовування, інакше canvas
    // тихо малює системним і прев'ю бреше про фінальний PNG.
    await document.fonts.ready;
    PAL = exportPalette(canvas);
    const img = photoRef.current;
    if (img && img.complete && img.naturalWidth) {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = PAL.bg;
      ctx.font = '400 34px Onest, system-ui, sans-serif';
      ctx.textAlign = 'center';
      // Нижня третина: жоден із чотирьох шаблонів туди не пише.
      ctx.fillText('Тапни, щоб додати фото страви', w / 2, h * 0.8);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
    const d: OverlayData = {
      title: r.t, time: r.tm, servings: r.sv, fromPantry, total,
    };
    DRAW[template](ctx, w, h, d);
  }, [r, format, template, fromPantry, total]);

  useEffect(() => { void redraw(); }, [redraw, photoUrl]);

  useEffect(() => {
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  if (!r) {
    return (
      <div className={styles.screen}>
        <div className={styles.column}>
          <p className={styles.hint}>Спершу приготуй страву — тоді тут зʼявиться, чим поділитися.</p>
          <button type="button" className={styles.share} onClick={() => navigate('/app')}>У стрічку</button>
        </div>
      </div>
    );
  }

  function onPickPhoto(files: FileList | null) {
    if (!files?.length) return;
    const url = URL.createObjectURL(files[0]!);
    const img = new Image();
    img.onload = () => { photoRef.current = img; void redraw(); };
    img.src = url;
    setPhotoUrl(url);
  }

  function fileName() {
    return `kitchen-os-${r!.t.toLowerCase().replace(/\s+/g, '-')}.png`;
  }

  async function toPngBlob(): Promise<Blob | null> {
    await redraw();
    return new Promise((res) => canvasRef.current?.toBlob((b) => res(b), 'image/png') ?? res(null));
  }

  function caption(): string {
    const parts = [r!.t, `${r!.tm} хв`, `${fromPantry} з ${total} — з того, що було`, 'Kitchen OS'];
    if (shareUrl) parts.push(shareUrl);
    return parts.join(' · ');
  }

  const canSystemShare = typeof navigator.canShare === 'function';

  async function share() {
    setBusy('share');
    try {
      const blob = await toPngBlob();
      if (!blob) return;
      const file = new File([blob], fileName(), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        // text не додаємо: Інстаграм ігнорує його, а деякі шити через нього
        // ховають файл. Підпис — окремою кнопкою в буфер.
        await navigator.share({ files: [file] }).catch(() => {/* скасував — ок */});
      } else {
        downloadBlob(blob);
      }
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy('download');
    try {
      const blob = await toPngBlob();
      if (blob) downloadBlob(blob);
    } finally {
      setBusy(null);
    }
  }

  function downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {/* deny — не проблема */}
  }

  // ── Вигляд (feat/cook-share-v3) — оболонка за Cook and Share
  // «Поділитись · 390» поверх наявної механіки: шапка (share-2 · «Поділитись
  // стравою» · сегмент формату), превʼю на всю ширину, стрічка мініатюр
  // (оверлеї A–D), «Поділитись» чорнилом + download. На 1440 — та сама
  // колонка. Картка без фото, 1:1/4:5/16:9, дві палітри й шість стилів
  // (C3/C4) — не робились (Р75).
  const primaryShare = canSystemShare;
  return (
    <div className={styles.screen} data-share-page>
      <div className={styles.column}>
        <div className={styles.top}>
          <button type="button" className={styles.back} onClick={() => navigate(-1)} aria-label="Назад" data-share-back>
            <Icon name="sys.back" size={16} inherit decorative />
          </button>
        </div>
        <div className={styles.head}>
          <Icon name="sys.share" size={16} inherit decorative />
          <span className={styles.title}>Поділитись стравою</span>
          <span className={styles.gap} />
          <div className={styles.seg} role="tablist" aria-label="Формат">
            {(Object.keys(FORMATS) as Format[]).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={format === f}
                className={`${styles['seg-btn']} ${format === f ? styles['seg-on'] : ''}`} data-tap onClick={() => setFormat(f)} data-format={f}>
                {FORMATS[f].label}
              </button>
            ))}
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className={styles.preview}
          style={{ aspectRatio: `${FORMATS[format].w} / ${FORMATS[format].h}` }}
          onClick={() => fileInputRef.current?.click()}
          aria-label={photoUrl ? 'Превʼю. Тапни, щоб змінити фото' : 'Тапни, щоб додати фото страви'}
          role="button"
        />
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onPickPhoto(e.target.files)} />

        {/* Стрічка мініатюр — чотири оверлеї брифу (A стек · B кут · C твердження · D рейка). */}
        <div className={styles.thumbs} role="tablist" aria-label="Оверлей">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={template === t.id}
              className={`${styles.thumb} ${styles[`thumb-${t.id}`]} ${template === t.id ? styles['thumb-on'] : ''}`}
              onClick={() => setTemplate(t.id)} title={t.label} aria-label={t.label} data-template={t.id}>
              <span className={styles['thumb-mark']} aria-hidden />
            </button>
          ))}
          <button type="button" className={`${styles.thumb} ${styles['thumb-photo']}`} onClick={() => fileInputRef.current?.click()} title={photoUrl ? 'Інше фото' : 'Додати фото'} aria-label={photoUrl ? 'Інше фото' : 'Додати фото'} data-pick-photo>
            <Icon name="sys.photo" size={16} inherit decorative />
          </button>
        </div>

        <div className={styles.actions}>
          {primaryShare ? (
            <button type="button" className={styles.share} onClick={share} disabled={busy !== null} data-share>
              <Icon name="sys.share" size={16} inherit decorative />{busy === 'share' ? 'Готую…' : 'Поділитись'}
            </button>
          ) : (
            <button type="button" className={styles.share} onClick={download} disabled={busy !== null} data-share>
              <Icon name="sys.import" size={16} inherit decorative />{busy === 'download' ? 'Готую…' : 'Завантажити PNG'}
            </button>
          )}
          {primaryShare && (
            <button type="button" className={styles.download} onClick={download} disabled={busy !== null} aria-label="Завантажити PNG" title="Завантажити PNG" data-download>
              <Icon name="sys.import" size={16} inherit decorative />
            </button>
          )}
        </div>
        <button type="button" className={styles.caption} onClick={copyCaption}>{copied ? 'Скопійовано' : 'Скопіювати підпис'}</button>
        {shareUrl && <div className={styles.hint}>Хто відкриє лінк — побачить той самий рецепт і зможе готувати в себе.</div>}
        <div className={styles.hint}>Це радше памʼять про вечерю, ніж звіт про неї. Що приготував і скільки вже було вдома — цього достатньо.</div>
      </div>
    </div>
  );
}

// ————————————————————————————— оверлеї —————————————————————————————
// Спільна мова брифу: Onest для великого, Golos для підписів, Plex Mono для
// мети; м'яка тінь замість плашок; знак (розірване кільце + вузол) завжди.

interface OverlayData {
  title: string;
  time?: number;
  servings?: number;
  fromPantry: number;
  total: number;
}

function shadow(ctx: CanvasRenderingContext2D, blur: number) {
  ctx.shadowColor = PAL.shadow;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = 2;
}

function noShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  // Розірване кільце зі зсувом -58° + вузол — як в SVG знака.
  const rr = size / 2;
  ctx.save();
  shadow(ctx, 8);
  ctx.strokeStyle = PAL.bg;
  ctx.lineWidth = Math.max(3, size * 0.11);
  ctx.lineCap = 'round';
  const gap = 0.75; // радіан розриву
  const start = -(58 * Math.PI) / 180 + gap / 2;
  ctx.beginPath();
  ctx.arc(x + rr, y + rr, rr * 0.82, start, start + (Math.PI * 2 - gap));
  ctx.stroke();
  ctx.fillStyle = PAL.sage;
  ctx.beginPath();
  ctx.arc(x + rr, y + rr, rr * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLogoRow(ctx: CanvasRenderingContext2D, cx: number, y: number, size: number, align: 'center' | 'right', rightX?: number) {
  ctx.font = `800 ${Math.round(size * 0.72)}px Onest, sans-serif`;
  const label = 'KITCHEN OS';
  const tw = ctx.measureText(label).width;
  const total = size + size * 0.4 + tw;
  const startX = align === 'center' ? cx - total / 2 : (rightX ?? cx) - total;
  drawMark(ctx, startX, y, size);
  shadow(ctx, 6);
  ctx.fillStyle = PAL.bg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, startX + size + size * 0.4, y + size / 2 + 1);
  noShadow(ctx);
}

function statLine(d: OverlayData): string {
  return [
    d.time ? `${d.time} ХВ` : null,
    d.servings ? `${d.servings} ${plural(d.servings, ['ПОРЦІЯ', 'ПОРЦІЇ', 'ПОРЦІЙ'])}` : null,
  ].filter(Boolean).join(' · ');
}

// A · стек статів по центру, згори (бриф: центр над стравою).
function drawA(ctx: CanvasRenderingContext2D, w: number, h: number, d: OverlayData) {
  const cx = w / 2;
  let y = h * 0.07;
  ctx.textAlign = 'center';
  const pair = (label: string, value: string, valueSize: number) => {
    shadow(ctx, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '600 30px "Golos Text", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, y);
    y += 44;
    shadow(ctx, 10);
    ctx.fillStyle = PAL.bg;
    ctx.font = `800 ${valueSize}px Onest, sans-serif`;
    y += wrapCentered(ctx, value, cx, y, w * 0.84, valueSize * 1.12);
    y += 30;
  };
  pair('Страва', d.title, 58);
  if (d.time) pair('Час', `${d.time} хв`, 58);
  pair('З того, що було', `${d.fromPantry} з ${d.total}`, 48);
  noShadow(ctx);
  ctx.textAlign = 'left';
  drawLogoRow(ctx, cx, y + 14, 40, 'center');
}

// B · кутовий блок справа зверху (бриф: коли страва знизу кадру).
function drawB(ctx: CanvasRenderingContext2D, w: number, h: number, d: OverlayData) {
  const rx = w - w * 0.065;
  let y = h * 0.06;
  ctx.textAlign = 'right';
  const pair = (label: string, value: string) => {
    shadow(ctx, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 26px "Golos Text", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(label, rx, y);
    y += 38;
    shadow(ctx, 9);
    ctx.fillStyle = PAL.bg;
    ctx.font = '800 40px Onest, sans-serif';
    ctx.fillText(value, rx, y);
    y += 66;
  };
  pair('Страва', d.title.length > 26 ? `${d.title.slice(0, 25)}…` : d.title);
  if (d.time) pair('Час', `${d.time} хв`);
  if (d.servings) pair('Порції', String(d.servings));
  pair('З того, що було', `${d.fromPantry} з ${d.total}`);
  noShadow(ctx);
  ctx.textAlign = 'left';
  drawLogoRow(ctx, rx, y + 8, 34, 'right', rx);
}

// C · велике твердження + мікро-стек у куті (бриф: «ВЕЧЕРЯ Є.»).
function drawC(ctx: CanvasRenderingContext2D, w: number, h: number, d: OverlayData) {
  const rx = w - w * 0.065;
  let y = h * 0.055;
  ctx.textAlign = 'right';
  const micro = (label: string, value: string) => {
    shadow(ctx, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '600 24px "Golos Text", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(label, rx, y);
    y += 34;
    shadow(ctx, 8);
    ctx.fillStyle = PAL.bg;
    ctx.font = '800 34px Onest, sans-serif';
    ctx.fillText(value, rx, y);
    y += 56;
  };
  if (d.time) micro('Час', `${d.time} хв`);
  micro('З того, що було', `${d.fromPantry} з ${d.total}`);
  noShadow(ctx);
  ctx.textAlign = 'left';
  drawLogoRow(ctx, rx, y + 6, 30, 'right', rx);

  const size = Math.round(w * 0.17);
  shadow(ctx, 18);
  ctx.fillStyle = PAL.bg;
  ctx.font = `800 ${size}px Onest, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('ВЕЧЕРЯ', w * 0.06, h * 0.47);
  ctx.textAlign = 'right';
  ctx.fillText('Є.', w - w * 0.06, h * 0.47 + size * 1.02);
  ctx.textAlign = 'left';
  noShadow(ctx);

  // Назва страви — дрібно під твердженням, щоб контекст не губився.
  shadow(ctx, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillText(d.title.toUpperCase(), w * 0.06, h * 0.47 + size * 1.02 + 64);
  noShadow(ctx);
}

// D · вертикальна рейка зліва (бриф: фото не можна перекривати взагалі).
function drawD(ctx: CanvasRenderingContext2D, w: number, h: number, d: OverlayData) {
  const x = w * 0.06;
  const line = [d.title.toUpperCase(), statLine(d), `${d.fromPantry} З ${d.total} — З ТОГО, ЩО БУЛО`]
    .filter(Boolean).join(' · ');
  ctx.save();
  ctx.translate(x, h / 2);
  ctx.rotate(-Math.PI / 2);
  shadow(ctx, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '500 28px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // letter-spacing руками: канвас не вміє tracking для fillText у всіх браузерах.
  ctx.fillText(line.split('').join(' '), 0, 0);
  ctx.restore();
  noShadow(ctx);
  ctx.textAlign = 'left';
  drawMark(ctx, x - 20, h - h * 0.06 - 40, 40);
}

const DRAW: Record<Template, (ctx: CanvasRenderingContext2D, w: number, h: number, d: OverlayData) => void> = {
  A: drawA, B: drawB, C: drawC, D: drawD,
};

// Центрований wrap; повертає висоту, яку зайняв текст.
function wrapCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineHeight));
  return lines.length * lineHeight;
}
