// Публікація страви (M15). Приймає рецепт з react-router state,
// дає завантажити фото готової страви, малює overlay поверх на canvas
// і дає завантажити готовий PNG.
//
// Метрики — з рецепта: назва, час, порції, «N з M — з того, що було».
// N рахується через ing.p (те, що модель повʼязала з коморою), M — total ing.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import type { Recipe } from '../../api';
import { plural } from '../../lib/plural';
import styles from './Share.module.css';

interface State { recipe?: Recipe; photoUrl?: string | null; recipeId?: string | null }

export function SharePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as State | null);
  const recipe = state?.recipe ?? null;
  const recipeId = state?.recipeId ?? null;
  const shareUrl = recipeId ? `${window.location.origin}/r/${recipeId}` : null;
  const [photoUrl, setPhotoUrl] = useState<string | null>(state?.photoUrl ?? null);
  const [downloading, setDownloading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  if (!recipe) {
    return (
      <div className={styles.screen}>
        <div style={{ padding: 22, color: 'var(--fg-muted)' }}>
          <p>Публікувати нема що. Спершу приготуй у Cook Mode.</p>
          <button className={styles.exit} style={{ marginTop: 12 }} onClick={() => navigate('/app')}>← У стрічку</button>
        </div>
      </div>
    );
  }

  const r = recipe;                 // TS-локальна константа, гарантовано не null
  const total = r.ing.length;
  const fromPantry = r.ing.filter((i) => i.p).length;

  function onPickPhoto(files: FileList | null) {
    if (!files?.length) return;
    const url = URL.createObjectURL(files[0]!);
    setPhotoUrl(url);
  }

  async function download() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas) return;
    setDownloading(true);
    try {
      // 1080x1440 — 3:4, комфортно для сторіз-подібних форматів
      canvas.width = 1080;
      canvas.height = 1440;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (img && img.complete) {
        // Малюємо фото, покриваючи весь canvas з обрізанням.
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const cw = canvas.width, ch = canvas.height;
        const scale = Math.max(cw / iw, ch / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        // Без фото — темний фон + маленька крапка знака.
        ctx.fillStyle = '#101317';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawOverlay(ctx, canvas.width, canvas.height, {
        title: r.t,
        time: r.tm,
        servings: r.sv,
        fromPantry,
        total,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `kitchen-os-${r.t.toLowerCase().replace(/\s+/g, '-')}.png`;
      a.click();
    } finally {
      setDownloading(false);
    }
  }

  const [copied, setCopied] = useState(false);
  async function copyLink() {
    // Формуємо підпис із назвою, метриками і посиланням на публічний рецепт.
    // Друзі клікають лінк — бачать рецепт read-only, можуть залогінитись і готувати.
    const parts = [
      r.t,
      `${r.tm} хв`,
      `${fromPantry} з ${total} — з того, що було`,
      'Kitchen OS',
    ];
    if (shareUrl) parts.push(shareUrl);
    try {
      await navigator.clipboard.writeText(parts.join(' · '));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {/* deny — не проблема, просто не скопіювало */}
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <button className={styles.exit} onClick={() => navigate(-1)}>← Назад</button>
        <MonoLabel className={styles.title}>ПУБЛІКАЦІЯ</MonoLabel>
        <div style={{ width: 42 }} />
      </div>

      <div className={styles.body}>
        <div className={`${styles.canvas} ${!photoUrl ? styles.empty : ''}`}>
          {photoUrl ? (
            <img ref={imgRef} src={photoUrl} alt="" crossOrigin="anonymous" />
          ) : (
            <div className={styles.placeholder}>
              Додай фото готової страви — оверлей із назвою й метриками намалюється зверху.
            </div>
          )}
          <div className={styles.overlay}>
            <div className={styles.top}>
              <span>{fromPantry} з {total} — з того, що було</span>
              <div className={styles.logo}>
                <svg width="14" height="14" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="19" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeDasharray="104 15" transform="rotate(-58 24 24)" />
                  <circle cx="24" cy="24" r="7" fill="#a9c98f" />
                </svg>
                <span>KITCHEN OS</span>
              </div>
            </div>
            <div className={styles.bottom}>
              <div className={styles.dish}>{r.t}</div>
              <div className={styles.stats}>
                {r.tm && <span>{r.tm} ХВ</span>}
                {r.sv && <span>{r.sv} {plural(r.sv, ['ПОРЦІЯ', 'ПОРЦІЇ', 'ПОРЦІЙ'])}</span>}
              </div>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => onPickPhoto(e.target.files)}
        />
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            {photoUrl ? 'Інше фото' : 'Додати фото'}
          </Button>
          <Button variant="primary" onClick={download} loading={downloading}>
            Завантажити PNG
          </Button>
        </div>
        <Button variant="secondary" onClick={copyLink}>{copied ? 'Скопійовано ✓' : 'Скопіювати підпис'}</Button>
        {shareUrl && (
          <div className={styles.hint} style={{ marginTop: -6 }}>
            Друзі клацнуть <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>/r/{recipeId?.slice(0, 8)}…</span> — побачать той же рецепт, зможуть готувати в себе.
          </div>
        )}

        <div className={styles.hint}>
          Публікація — не для лайків, а для памʼяті: врятовані продукти, вечері поспіль вдома. Метрика — «зібрав із того, що було», а не калорії.
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

interface OverlayData {
  title: string;
  time?: number;
  servings?: number;
  fromPantry: number;
  total: number;
}

function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, d: OverlayData) {
  const pad = 60;
  // Top-left мета: N з M
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '600 26px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;
  ctx.fillText(`${d.fromPantry} З ${d.total} — З ТОГО, ЩО БУЛО`.toUpperCase(), pad, pad);

  // Top-right логотип
  ctx.textAlign = 'right';
  ctx.fillText('KITCHEN OS', w - pad, pad);
  ctx.textAlign = 'left';

  // Bottom: назва + мета
  const bottomY = h - pad - 200;
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 84px Onest, sans-serif';
  ctx.shadowBlur = 14;
  wrapText(ctx, d.title, pad, bottomY, w - pad * 2, 94);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '600 26px "IBM Plex Mono", ui-monospace, monospace';
  ctx.shadowBlur = 8;
  const stats = [
    d.time ? `${d.time} ХВ` : null,
    d.servings ? `${d.servings} ${plural(d.servings, ['ПОРЦІЯ', 'ПОРЦІЇ', 'ПОРЦІЙ'])}` : null,
  ].filter(Boolean).join('   ·   ');
  ctx.fillText(stats, pad, h - pad - 60);

  ctx.shadowBlur = 0;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  let lineY = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    const metrics = ctx.measureText(test);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, lineY);
}
