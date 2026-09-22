// Шерінг v3 (spec §1): три рендерери на canvas 1080×1920 — постер (фото,
// скрим детермінований за яскравістю), вертикаль (лише коли назва влізає),
// чисте тло (тема застосунку). Спільна геометрія — з макета «Kitchen OS -
// Share v3.dc.html» (істина для вигляду).
import type { FrameData, MeasureFn, Brightness } from './frame';
import { fitTitle, fitIngredients, fitDescription, verticalFontSize, classifyBrightness } from './frame';

export const FRAME_W = 1080;
export const FRAME_H = 1920;
const PAD = 96;
const RIGHT = FRAME_W - PAD; // 984

export type FrameKind = 'poster' | 'vertical' | 'clean';

export interface Palette { ink: string; bg: string; sage: string; sageDot: string; shadow: string }
const DARK_ON_PHOTO: Palette = { ink: '#fff', bg: '#fff', sage: '#93b48b', sageDot: '#93b48b', shadow: 'rgba(0,0,0,.5)' };
const LIGHT_ON_PHOTO: Palette = { ink: '#1a1c1e', bg: '#1a1c1e', sage: '#5b7a4f', sageDot: '#5b7a4f', shadow: 'rgba(0,0,0,.25)' };

export interface CleanTheme { bg: string; ink: string; muted: string; sage: string; line2: string }
export const CLEAN_LIGHT: CleanTheme = { bg: '#f4f3ef', ink: '#1a1c1e', muted: '#6b6f74', sage: '#5b7a4f', line2: '#e6e4de' };
export const CLEAN_DARK: CleanTheme = { bg: '#16181b', ink: '#ecebe7', muted: '#a3a7ac', sage: '#93b48b', line2: '#33383e' };

export function measureFn(ctx: CanvasRenderingContext2D): MeasureFn {
  return (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
}

// ── Крoп фото: зсув по вертикалі (0..1, 0.5 — центр), межі — фото не відкриває тло ──
export function coverRect(imgW: number, imgH: number, boxW: number, boxH: number, offsetNorm: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const sw = boxW / scale, sh = boxH / scale;
  const maxOffX = imgW - sw, maxOffY = imgH - sh;
  const sx = maxOffX / 2;
  const sy = Math.min(Math.max(offsetNorm, 0), 1) * maxOffY;
  return { sx, sy, sw, sh };
}

function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, offsetNorm: number): void {
  const { sx, sy, sw, sh } = coverRect(img.naturalWidth, img.naturalHeight, FRAME_W, FRAME_H, offsetNorm);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, FRAME_W, FRAME_H);
}

/** Яскравість фото після кропу — верх 45% + низ 18%, зменшена копія 54×96. */
export function classifyPhotoBrightness(img: HTMLImageElement, offsetNorm: number): Brightness {
  const small = document.createElement('canvas');
  small.width = 54; small.height = 96;
  const sctx = small.getContext('2d')!;
  const { sx, sy, sw, sh } = coverRect(img.naturalWidth, img.naturalHeight, 54, 96, offsetNorm);
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, 54, 96);
  const { data } = sctx.getImageData(0, 0, 54, 96);
  return classifyBrightness(data, 54, 96);
}

function shadow(ctx: CanvasRenderingContext2D, color: string, blur: number): void {
  ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetY = 2;
}
function noShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

const FONT = 'Onest, system-ui, sans-serif';

/** Знак: кружок з обводкою + крапка sage — той самий рисунок, що в App. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, ringColor: string, dotColor: string): void {
  const rr = size / 2;
  ctx.save();
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = Math.max(3, size * 0.11);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x + rr, y + rr, rr * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(x + rr, y + rr, rr * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Знак + «Kitchen OS», лівий нижній кут (spec §1: усі кадри). */
function drawLogoLeft(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, textColor: string, ringColor: string, dotColor: string, shadowColor: string): void {
  drawMark(ctx, x, y, size, ringColor, dotColor);
  shadow(ctx, shadowColor, 6);
  ctx.fillStyle = textColor;
  ctx.font = `700 30px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('Kitchen OS', x + size + 14, y + size / 2 + 1);
  noShadow(ctx);
}

function drawKickerRow(ctx: CanvasRenderingContext2D, date: string, kickerColor: string, dateColor: string, shadowColor: string): void {
  shadow(ctx, shadowColor, 6);
  ctx.font = `600 28px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = kickerColor;
  // tracking .14em руками — canvas не має letter-spacing у всіх рушіях однаково.
  drawTracked(ctx, 'КУХНЯ · РЕЦЕПТ', PAD, 120, 0.14 * 28);
  ctx.fillStyle = dateColor;
  ctx.textAlign = 'right';
  ctx.fillText(date, RIGHT, 120);
  noShadow(ctx);
  ctx.textAlign = 'left';
}

function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  let cx = x;
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = align;
}

/** Заголовок+час+інгредієнти — спільна верхня секція постера й чистого тла. */
function drawTopSection(
  ctx: CanvasRenderingContext2D, data: FrameData, measure: MeasureFn,
  colors: { title: string; label: string; value: string; shadow: string; ingSep?: string },
): number {
  let y = 300;
  const maxWidth = RIGHT - PAD;
  const { lines, size } = fitTitle(data.title, measure, maxWidth);
  shadow(ctx, colors.shadow, 10);
  ctx.fillStyle = colors.title;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const lh = size * 1.02;
  lines.forEach((l, i) => ctx.fillText(l, PAD, y + size * 0.86 + i * lh));
  y += lines.length * lh + 30;
  noShadow(ctx);

  shadow(ctx, colors.shadow, 6);
  ctx.fillStyle = colors.label;
  ctx.font = `400 28px ${FONT}`;
  ctx.textBaseline = 'top';
  drawTracked(ctx, 'ЧАС', PAD, y, 0.1 * 28);
  y += 40;
  ctx.fillStyle = colors.value;
  ctx.font = `600 48px ${FONT}`;
  ctx.fillText(`${data.minutes} хв`, PAD, y);
  y += 48 + 30;
  noShadow(ctx);

  const { shown, more } = fitIngredients(data.ingredients);
  const colW = (maxWidth - 56) / 2;
  const cellH = 34 + 2 + 28 + 12; // qty + gap + name-line-approx + gap
  shown.forEach((ing, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const cx = PAD + col * (colW + 56);
    const cy = y + row * cellH;
    shadow(ctx, colors.shadow, 5);
    ctx.fillStyle = colors.label;
    ctx.font = `400 28px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(ing.name, cx, cy);
    ctx.fillStyle = colors.value;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(ing.qty, cx, cy + 30);
    if (colors.ingSep) {
      noShadow(ctx);
      ctx.strokeStyle = colors.ingSep;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 64); ctx.lineTo(cx + colW, cy + 64);
      ctx.stroke();
    }
  });
  if (more != null) {
    const i = shown.length;
    const col = i % 2, row = Math.floor(i / 2);
    const cx = PAD + col * (colW + 56);
    const cy = y + row * cellH;
    shadow(ctx, colors.shadow, 5);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = colors.label;
    ctx.font = `400 28px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`ще ${more}`, cx, cy + 34);
    ctx.globalAlpha = 1;
  }
  noShadow(ctx);
  const rows = Math.ceil((shown.length + (more != null ? 1 : 0)) / 2);
  return y + rows * cellH;
}

/** «Про смак» + опис + знак — нижня секція, top 1570…1810 (spec §1). */
function drawBottomSection(
  ctx: CanvasRenderingContext2D, data: FrameData, measure: MeasureFn,
  colors: { label: string; desc: string; logoText: string; ring: string; dot: string; shadow: string },
): void {
  let y = 1570;
  shadow(ctx, colors.shadow, 6);
  ctx.fillStyle = colors.label;
  ctx.font = `600 28px ${FONT}`;
  ctx.textBaseline = 'top';
  drawTracked(ctx, 'ПРО СМАК', PAD, y, 0.1 * 28);
  y += 40;
  ctx.fillStyle = colors.desc;
  ctx.font = `400 28px ${FONT}`;
  const descLines = fitDescription(data.description, measure, 860);
  descLines.forEach((l, i) => ctx.fillText(l, PAD, y + i * (28 * 1.4)));
  noShadow(ctx);

  drawLogoLeft(ctx, PAD, 1766, 44, colors.logoText, colors.ring, colors.dot, colors.shadow);
}

// ── Постер: фото на весь кадр, скрим за детермінованою яскравістю ──
export function drawPoster(ctx: CanvasRenderingContext2D, data: FrameData, img: HTMLImageElement, cropOffset: number): Brightness {
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  drawPhoto(ctx, img, cropOffset);
  const scheme = classifyPhotoBrightness(img, cropOffset);
  const pal = scheme === 'light' ? LIGHT_ON_PHOTO : DARK_ON_PHOTO;
  const scrimBase = scheme === 'light' ? '244,243,239' : '8,9,10';
  const stops: [number, number][] = scheme === 'light'
    ? [[0, .86], [.44, .78], [.52, .1], [.78, .04], [.84, .84], [1, .92]]
    : [[0, .6], [.44, .5], [.52, .1], [.78, .06], [.84, .62], [1, .7]];
  const grad = ctx.createLinearGradient(0, 0, 0, FRAME_H);
  for (const [off, a] of stops) grad.addColorStop(off, `rgba(${scrimBase},${a})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);

  const measure = measureFn(ctx);
  drawKickerRow(ctx, data.date, pal.ink, pal.ink, pal.shadow);
  drawTopSection(ctx, data, measure, { title: pal.ink, label: pal.ink, value: pal.ink, shadow: pal.shadow });
  drawBottomSection(ctx, data, measure, { label: pal.ink, desc: pal.ink, logoText: pal.bg, ring: pal.ink, dot: pal.sageDot, shadow: pal.shadow });
  return scheme;
}

// ── Вертикаль: лише коли назва влізає (96 → 72 → нема кадру) ──
export function verticalAvailable(data: FrameData, ctx: CanvasRenderingContext2D): boolean {
  return verticalFontSize(data.title, measureFn(ctx)) != null;
}

export function drawVertical(ctx: CanvasRenderingContext2D, data: FrameData, img: HTMLImageElement, cropOffset: number, now = new Date()): boolean {
  const measure = measureFn(ctx);
  const size = verticalFontSize(data.title, measure);
  if (size == null) return false;

  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  drawPhoto(ctx, img, cropOffset);
  const toRight = ctx.createLinearGradient(0, 0, FRAME_W, 0);
  toRight.addColorStop(0, 'rgba(8,9,10,.6)'); toRight.addColorStop(0.4, 'rgba(8,9,10,.34)'); toRight.addColorStop(0.68, 'rgba(8,9,10,.04)');
  ctx.fillStyle = toRight; ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  const toBottom = ctx.createLinearGradient(0, 0, 0, FRAME_H);
  toBottom.addColorStop(0, 'rgba(8,9,10,.28)'); toBottom.addColorStop(0.28, 'rgba(8,9,10,0)'); toBottom.addColorStop(0.76, 'rgba(8,9,10,0)'); toBottom.addColorStop(1, 'rgba(8,9,10,.5)');
  ctx.fillStyle = toBottom; ctx.fillRect(0, 0, FRAME_W, FRAME_H);

  shadow(ctx, 'rgba(0,0,0,.5)', 6);
  ctx.font = '600 28px ' + FONT;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  drawTracked(ctx, 'КУХНЯ · РЕЦЕПТ', PAD, 120, 0.14 * 28);
  noShadow(ctx);

  // Назва вертикально: rotate(-90°), читається знизу вгору, низ на y 1520,
  // ліворуч (spec §1). Крапка sage наприкінці (кінець читання = верх кадру).
  ctx.save();
  ctx.translate(PAD + size * 0.5, 1520);
  ctx.rotate(-Math.PI / 2);
  shadow(ctx, 'rgba(0,0,0,.6)', 8);
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(data.title, 0, 0);
  const tw = measure(data.title, `700 ${size}px ${FONT}`);
  ctx.fillStyle = '#93b48b';
  ctx.fillText('.', tw + size * 0.03, 0);
  ctx.restore();
  noShadow(ctx);

  let y = 1810 - 26 - 12 - 40 - 12 - 44;
  ctx.font = '600 28px ' + FONT;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  ctx.fillText(weekdayDate(data.date, now), PAD, y);
  y += 40;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, y + 20); ctx.lineTo(PAD + 240, y + 20); ctx.stroke();
  ctx.font = '700 40px ' + FONT;
  ctx.fillText(`${data.minutes} ХВ`, PAD + 240 + 28, y + 6);
  y += 40 + 26;
  drawLogoLeft(ctx, PAD, y, 44, '#fff', '#fff', '#93b48b', 'rgba(0,0,0,.5)');
  return true;
}

function weekdayDate(dateLabel: string, now: Date): string {
  const WEEKDAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота'];
  return `${WEEKDAYS[now.getDay()]} · ${dateLabel}`;
}

// ── Чисте тло: той самий грид постера, тон застосунку (тема користувача) ──
export function drawClean(ctx: CanvasRenderingContext2D, data: FrameData, theme: CleanTheme): void {
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  const measure = measureFn(ctx);
  drawKickerRow(ctx, data.date, theme.sage, theme.muted, 'transparent');
  drawTopSection(ctx, data, measure, { title: theme.ink, label: theme.muted, value: theme.ink, shadow: 'transparent', ingSep: theme.line2 });
  drawBottomSection(ctx, data, measure, { label: theme.sage, desc: theme.muted, logoText: theme.bg, ring: theme.ink, dot: theme.sage, shadow: 'transparent' });
}
