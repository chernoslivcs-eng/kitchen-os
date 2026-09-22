// Шерінг v3 (spec §1): три рендерери на canvas 1080×1920 — постер (фото,
// скрим детермінований за яскравістю), вертикаль (лише коли назва влізає),
// чисте тло (тема застосунку). Спільна геометрія — з макета «Kitchen OS -
// Share v3.dc.html» (істина для вигляду).
import type { FrameData, MeasureFn, Brightness, CropState } from './frame';
import {
  fitTitle, fitIngredients, fitIngredientName, fitDescription, verticalFontSize, fitVerticalColumn, fitVerticalIngLine, classifyBrightness, clampCrop,
  splitLayoutTitle, layoutGridItems, layoutChipLabel, ellipsize,
} from './frame';

export const FRAME_W = 1080;
export const FRAME_H = 1920;
const PAD = 96;
const RIGHT = FRAME_W - PAD; // 984

export type FrameKind = 'poster' | 'vertical' | 'layout' | 'clean';

export interface Palette { ink: string; bg: string; sage: string; sageDot: string; shadow: string }
const DARK_ON_PHOTO: Palette = { ink: '#fff', bg: '#fff', sage: '#93b48b', sageDot: '#93b48b', shadow: 'rgba(0,0,0,.5)' };
const LIGHT_ON_PHOTO: Palette = { ink: '#1a1c1e', bg: '#1a1c1e', sage: '#5b7a4f', sageDot: '#5b7a4f', shadow: 'rgba(0,0,0,.25)' };

export interface CleanTheme { bg: string; ink: string; muted: string; sage: string; line2: string }
export const CLEAN_LIGHT: CleanTheme = { bg: '#f4f3ef', ink: '#1a1c1e', muted: '#6b6f74', sage: '#5b7a4f', line2: '#e6e4de' };
export const CLEAN_DARK: CleanTheme = { bg: '#16181b', ink: '#ecebe7', muted: '#a3a7ac', sage: '#93b48b', line2: '#33383e' };

export function measureFn(ctx: CanvasRenderingContext2D): MeasureFn {
  return (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
}

// ── Крoп фото: масштаб 1..3× (пінч/колесо) + зсув по обох осях, межі — фото не відкриває тло ──
export function coverRect(imgW: number, imgH: number, boxW: number, boxH: number, crop: CropState): { sx: number; sy: number; sw: number; sh: number } {
  const c = clampCrop(crop);
  const scale = Math.max(boxW / imgW, boxH / imgH) * c.scale;
  const sw = boxW / scale, sh = boxH / scale;
  const maxOffX = Math.max(0, imgW - sw), maxOffY = Math.max(0, imgH - sh);
  return { sx: c.x * maxOffX, sy: c.y * maxOffY, sw, sh };
}

function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, crop: CropState): void {
  const { sx, sy, sw, sh } = coverRect(img.naturalWidth, img.naturalHeight, FRAME_W, FRAME_H, crop);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, FRAME_W, FRAME_H);
}

/** Яскравість фото після кропу — верх 45% + низ 18%, зменшена копія 54×96. */
export function classifyPhotoBrightness(img: HTMLImageElement, crop: CropState): Brightness {
  const small = document.createElement('canvas');
  small.width = 54; small.height = 96;
  const sctx = small.getContext('2d')!;
  const { sx, sy, sw, sh } = coverRect(img.naturalWidth, img.naturalHeight, 54, 96, crop);
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

/** Знак + «Kitchen OS» по центру (spec «Розкладка»: bottom 110, над порожнім місцем стікера). */
function drawLogoCenter(ctx: CanvasRenderingContext2D, cx: number, y: number, size: number, textColor: string, ringColor: string, dotColor: string, shadowColor: string): void {
  ctx.font = `700 30px ${FONT}`;
  const textW = ctx.measureText('Kitchen OS').width;
  const totalW = size + 14 + textW;
  drawLogoLeft(ctx, cx - totalW / 2, y, size, textColor, ringColor, dotColor, shadowColor);
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
/** Загальна ширина рядка з ручним трекінгом (для право- чи центр-вирівнювання). */
function trackedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return text.length ? w - spacing : 0;
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

  // Хотфікс (прод, 22.09): назва без обмеження ширини налазила на сусідню
  // колонку («анчоуси Rizzoli кантабрійські в оливковій олії» поверх
  // «томати пелаті Metro Chef цілі очищені»). ≤2 рядки в межах colW
  // (fitIngredientName), кількість — під назвою; висота КЛІТИНКИ залежить
  // від числа рядків її власної назви, висота РЯДКА сітки — від вищої з
  // двох клітинок у ньому, щоб наступний рядок нічого не накрив.
  const { shown, more } = fitIngredients(data.ingredients);
  const colW = (maxWidth - 56) / 2;
  const nameFont = `400 28px ${FONT}`;
  const NAME_LH = 30; // = стара фіксована відстань «назва → кількість» на 1 рядку (cy+30)
  const CELL_TAIL = 34 + 12; // рядок кількості (34px) + нижній відступ — як у старому cellH
  const nameLinesOf = shown.map((ing) => fitIngredientName(ing.name, measure, nameFont, colW, 2));
  const cellH = (lines: number) => lines * NAME_LH + CELL_TAIL;
  const totalCells = shown.length + (more != null ? 1 : 0);
  const rows = Math.ceil(totalCells / 2);
  const rowY: number[] = [];
  let cursorY = y;
  for (let r = 0; r < rows; r++) {
    rowY.push(cursorY);
    const li = r * 2, ri = r * 2 + 1;
    const lh = li < shown.length ? nameLinesOf[li]!.length : 1; // «ще N» — як 1-рядкова
    const rh = ri < shown.length ? nameLinesOf[ri]!.length : 1;
    cursorY += cellH(Math.max(lh, rh));
  }
  shown.forEach((ing, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const cx = PAD + col * (colW + 56);
    const cy = rowY[row]!;
    const nameLines = nameLinesOf[i]!;
    shadow(ctx, colors.shadow, 5);
    ctx.fillStyle = colors.label;
    ctx.font = nameFont;
    ctx.textBaseline = 'top';
    nameLines.forEach((line, li) => ctx.fillText(line, cx, cy + li * NAME_LH));
    const qtyY = cy + nameLines.length * NAME_LH;
    ctx.fillStyle = colors.value;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(ing.qty, cx, qtyY);
    if (colors.ingSep) {
      noShadow(ctx);
      ctx.strokeStyle = colors.ingSep;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, qtyY + 34); ctx.lineTo(cx + colW, qtyY + 34);
      ctx.stroke();
    }
  });
  if (more != null) {
    const i = shown.length;
    const col = i % 2, row = Math.floor(i / 2);
    const cx = PAD + col * (colW + 56);
    const cy = rowY[row]!;
    shadow(ctx, colors.shadow, 5);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = colors.label;
    ctx.font = nameFont;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`ще ${more}`, cx, cy + 34);
    ctx.globalAlpha = 1;
  }
  noShadow(ctx);
  return cursorY;
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

// ── Заглушка без фото (правка 8, 22.09): Постер і Вертикаль лишаються в
// каруселі навіть без знімка — тон застосунку + діагональна штриховка 45°,
// текст тим самим складом, що на постері, у палітрі «Чистого тла», гліф
// камери + «Додати фото» по центру. Не шериться: Share.tsx сам вимикає
// кнопки, коли активний саме такий кадр.
function drawHatchedBg(ctx: CanvasRenderingContext2D, theme: CleanTheme): void {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, FRAME_W, FRAME_H);
  ctx.clip();
  ctx.strokeStyle = theme.ink;
  ctx.globalAlpha = 0.06;
  ctx.lineWidth = 2;
  const step = 24;
  const diag = FRAME_W + FRAME_H;
  ctx.beginPath();
  for (let x = -FRAME_H; x < diag; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + FRAME_H, FRAME_H);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}
function drawCameraGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const w = size, h = size * 0.72;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  const r = 8;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();
  ctx.strokeRect(cx - w * 0.16, y - h * 0.16, w * 0.32, h * 0.2);
  ctx.beginPath();
  ctx.arc(cx, cy + h * 0.04, w * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
function drawAddPhotoGlyph(ctx: CanvasRenderingContext2D, theme: CleanTheme): void {
  const cx = FRAME_W / 2, cy = FRAME_H / 2;
  drawCameraGlyph(ctx, cx, cy - 24, 64, theme.sage);
  ctx.font = `600 28px ${FONT}`;
  ctx.fillStyle = theme.sage;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Додати фото', cx, cy + 44);
  ctx.textAlign = 'left';
}
// Той самий склад, що «Чисте тло» (kicker+topSection+bottomSection у
// палітрі теми) — спільний і для drawClean, і для заглушки постера/вертикалі.
function drawCleanContent(ctx: CanvasRenderingContext2D, data: FrameData, theme: CleanTheme, measure: MeasureFn): void {
  drawKickerRow(ctx, data.date, theme.sage, theme.muted, 'transparent');
  drawTopSection(ctx, data, measure, { title: theme.ink, label: theme.muted, value: theme.ink, shadow: 'transparent', ingSep: theme.line2 });
  drawBottomSection(ctx, data, measure, { label: theme.sage, desc: theme.muted, logoText: theme.ink, ring: theme.ink, dot: theme.sage, shadow: 'transparent' });
}

// ── Постер: фото на весь кадр, скрим за детермінованою яскравістю; без
// фото (img=null) — заглушка (theme визначає палітру заглушки). ──
export function drawPoster(ctx: CanvasRenderingContext2D, data: FrameData, img: HTMLImageElement | null, crop: CropState, theme: CleanTheme): Brightness {
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  if (!img) {
    drawHatchedBg(ctx, theme);
    drawCleanContent(ctx, data, theme, measureFn(ctx));
    drawAddPhotoGlyph(ctx, theme);
    return 'light';
  }
  drawPhoto(ctx, img, crop);
  const scheme = classifyPhotoBrightness(img, crop);
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

export function drawVertical(ctx: CanvasRenderingContext2D, data: FrameData, img: HTMLImageElement | null, crop: CropState, theme: CleanTheme, now = new Date()): boolean {
  const measure = measureFn(ctx);
  const size = verticalFontSize(data.title, measure);
  if (size == null) return false;

  if (!img) {
    // Той самий склад, що заглушка постера (spec: «як на справжньому
    // постері») — окремої «вертикальної» заглушки не малюємо.
    drawPoster(ctx, data, null, crop, theme);
    return true;
  }

  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  drawPhoto(ctx, img, crop);
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

  // Правка (п.13, 22.09; замінено 22.09): дві вертикальні колонки поряд із
  // назвою, той самий writing-mode (окремий, незалежний pivot праворуч від
  // назви — «gap:36» між ними, як у первісному D1-макеті; той самий низ
  // 1520, що назва). Колонка 1 — «<характер>. <опис>» 22/600; колонка 2 —
  // рядок інгредієнтів 22/400, роздільник « · » (fitVerticalIngLine сам
  // будує nbsp-захищені токени). Виняток із «мінімум 28px» — свідомий.
  const VCOL_SIZE = 22, VCOL_LH = 1.4, VCOL_GAP = 22, VCOL_LINE_PX = VCOL_SIZE * VCOL_LH;
  const col1Text = data.character ? `${data.character}. ${data.description}` : data.description;
  const col1Lines = fitVerticalColumn(col1Text, measure, 700, VCOL_SIZE, 600, VCOL_LH);
  const col2Lines = fitVerticalIngLine(data.ingredients, measure, 700, VCOL_SIZE, 400, VCOL_LH);
  if (col1Lines.length || col2Lines.length) {
    ctx.save();
    ctx.translate(PAD + size + 36, 1520);
    ctx.rotate(-Math.PI / 2);
    shadow(ctx, 'rgba(0,0,0,.6)', 8);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${VCOL_SIZE}px ${FONT}`;
    col1Lines.forEach((line, i) => ctx.fillText(line, 0, i * VCOL_LINE_PX));
    ctx.font = `400 ${VCOL_SIZE}px ${FONT}`;
    const col2Start = col1Lines.length * VCOL_LINE_PX + (col1Lines.length ? VCOL_GAP : 0);
    col2Lines.forEach((line, i) => ctx.fillText(line, 0, col2Start + i * VCOL_LINE_PX));
    ctx.restore();
    noShadow(ctx);
  }

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

const LAYOUT_MAXW = 840;
const LAYOUT_LEFT = (FRAME_W - LAYOUT_MAXW) / 2; // 120 — центрований 840-блок

// ── «Розкладка»: фото + радіальний скрим, назва двома групами, сітка 3×≤3
// з чіпом хвилин, знак по центру внизу (spec «Розкладка», автоматизована D2).
// Без фото (img=null, правка 8 — поширено й на цей кадр для узгодженості
// з постером/вертикаллю) — та сама заглушка, що постер: власної «розкладко-
// вої» заглушки з підбором кольорів під тему не робила, «як на постері»
// (дизайнерське рішення, спека мовчить конкретно про цей кадр).
export function drawLayout(ctx: CanvasRenderingContext2D, data: FrameData, img: HTMLImageElement | null, crop: CropState, theme: CleanTheme): void {
  if (!img) { drawPoster(ctx, data, null, crop, theme); return; }
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  drawPhoto(ctx, img, crop);

  // radial-gradient(90% 60% at 50% 46%, rgba(8,9,10,.62) 0, .34 55%, .15 100%)
  // canvas не має еліптичних радіальних градієнтів — коло, розтягнуте по x.
  const cx = FRAME_W * 0.5, cy = FRAME_H * 0.46;
  const rx = FRAME_W * 0.9, ry = FRAME_H * 0.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx / ry, 1);
  ctx.translate(-cx, -cy);
  const scrim = ctx.createRadialGradient(cx, cy, 0, cx, cy, ry);
  scrim.addColorStop(0, 'rgba(8,9,10,.62)');
  scrim.addColorStop(0.55, 'rgba(8,9,10,.34)');
  scrim.addColorStop(1, 'rgba(8,9,10,.15)');
  ctx.fillStyle = scrim;
  ctx.fillRect(cx - FRAME_W * 4, cy - FRAME_H * 4, FRAME_W * 8, FRAME_H * 8);
  ctx.restore();

  // Текст завжди білий (spec) — без адаптації до яскравості фото, на відміну від постера.
  const WHITE = '#fff';
  shadow(ctx, 'rgba(0,0,0,.55)', 8);

  // Кікер по центру — «КУХНЯ · РЕЦЕПТ · 21 ВЕРЕСНЯ» (у нас: мін. кегль 28 лишається).
  ctx.font = `600 28px ${FONT}`;
  ctx.fillStyle = WHITE;
  ctx.textBaseline = 'top';
  const kicker = `КУХНЯ · РЕЦЕПТ · ${data.date.toUpperCase()}`;
  const kickerSpacing = 0.14 * 28;
  const kickerW = trackedWidth(ctx, kicker, kickerSpacing);
  drawTracked(ctx, kicker, FRAME_W / 2 - kickerW / 2, 120, kickerSpacing);

  // Назва: дві збалансовані групи, один рядок, tracking −.02em; хвіст — у сітку.
  const measure = measureFn(ctx);
  const titleY = 760;
  const split = splitLayoutTitle(data.title, measure, LAYOUT_MAXW);
  const titleSpacing = -0.02 * split.size;
  ctx.font = `700 ${split.size}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = WHITE;
  if (split.centered) {
    const text = split.left.join(' ').toUpperCase();
    const w = trackedWidth(ctx, text, titleSpacing);
    drawTracked(ctx, text, FRAME_W / 2 - w / 2, titleY, titleSpacing);
  } else {
    const leftText = split.left.join(' ').toUpperCase();
    const rightText = split.right.join(' ').toUpperCase();
    drawTracked(ctx, leftText, LAYOUT_LEFT, titleY, titleSpacing);
    const rightW = trackedWidth(ctx, rightText, titleSpacing);
    drawTracked(ctx, rightText, LAYOUT_LEFT + LAYOUT_MAXW - rightW, titleY, titleSpacing);
  }
  noShadow(ctx);

  // Сітка 3 колонки × ≤3 рядки, row-gap 14; центр 1-го рядка — чіп хвилин.
  const items = layoutGridItems(split.tail, data.ingredients);
  const colW = LAYOUT_MAXW / 3;
  const rowH = 28 + 14;
  const gridTop = 900;
  const gridFont = `600 28px ${FONT}`;
  const gridSpacing = 0.06 * 28;
  ctx.font = gridFont;
  ctx.textBaseline = 'top';
  type Align = 'left' | 'center' | 'right';
  // 9 клітинок row-major [ліво,центр,право]×3; центр 1-го рядка (slot 1) —
  // чіп, не тут. `items` (≤8) мапляться на решту слотів по порядку.
  const SLOTS: Align[] = ['left', 'center', 'right', 'left', 'center', 'right', 'left', 'center', 'right'];
  const colX = (align: Align): number => (align === 'left' ? LAYOUT_LEFT : align === 'right' ? LAYOUT_LEFT + LAYOUT_MAXW : LAYOUT_LEFT + LAYOUT_MAXW / 2);
  shadow(ctx, 'rgba(0,0,0,.45)', 5);
  ctx.fillStyle = WHITE;
  // Клітинка не мусить залазити на сусідню колонку (особливо ліва — під чіп)
  // — обрізаємо з «…» по фактичній (трекованій) ширині, не голій measure().
  const cellMaxW = colW - 16;
  const trackMeasure: MeasureFn = (t) => trackedWidth(ctx, t, gridSpacing);
  items.forEach((text, i) => {
    const slot = i === 0 ? 0 : i + 1; // slot 1 (центр 1-го рядка) пропускаємо — там чіп
    const align = SLOTS[slot]!;
    const row = Math.floor(slot / 3);
    const y = gridTop + row * rowH;
    const upper = ellipsize(text.toUpperCase(), trackMeasure, gridFont, cellMaxW);
    if (align === 'left') { drawTracked(ctx, upper, colX('left'), y, gridSpacing); }
    else if (align === 'right') { const w = trackedWidth(ctx, upper, gridSpacing); drawTracked(ctx, upper, colX('right') - w, y, gridSpacing); }
    else { const w = trackedWidth(ctx, upper, gridSpacing); drawTracked(ctx, upper, colX('center') - w / 2, y, gridSpacing); }
  });
  noShadow(ctx);

  // Чіп «N ХВИЛИН» — центр 1-го рядка, sage bg, padding 2×14, tracking .08em.
  const chipText = layoutChipLabel(data.minutes).toUpperCase();
  const chipSpacing = 0.08 * 28;
  ctx.font = gridFont;
  const chipTextW = trackedWidth(ctx, chipText, chipSpacing);
  const chipPadX = 14, chipPadY = 2;
  const chipW = chipTextW + chipPadX * 2, chipH = 28 + chipPadY * 2;
  const chipX = colX('center') - chipW / 2, chipY = gridTop - chipPadY;
  ctx.fillStyle = '#5b7a4f';
  ctx.fillRect(chipX, chipY, chipW, chipH);
  ctx.fillStyle = WHITE;
  drawTracked(ctx, chipText, chipX + chipPadX, chipY + chipPadY, chipSpacing);

  // Порожнє місце 260×88 під стікер — нічого не малюємо (лише резервуємо
  // простір над знаком, щоб не переплутати з реальним контентом).
  // Знак «Kitchen OS» по центру, bottom 110 (той самий y=1766, що й інші кадри).
  drawLogoCenter(ctx, FRAME_W / 2, 1766, 44, WHITE, WHITE, '#93b48b', 'rgba(0,0,0,.5)');
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
  drawCleanContent(ctx, data, theme, measureFn(ctx));
}
