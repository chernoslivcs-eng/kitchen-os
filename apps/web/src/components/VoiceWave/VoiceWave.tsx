// Components A4 · Диктування: хвиля від РЕАЛЬНОЇ гучності (AnalyserNode), не
// фейк-луп — людина бачить, що її чутно. Риски 3 px по вертикальній осі поля,
// одна лінія; поки нічого не почуто — на всю ширину поля, з першими словами
// стискається до 12 барів і поступається місцем тексту (A4: «текст
// розпізнавання пише в поле, а не в бабл»). Таймер «0:07» праворуч від
// хвилі, на тій самій осі. Reduced motion або мік без дозволу — статичний
// індикатор REC.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './VoiceWave.module.css';

const BAR = 3;
const GAP = 3;

export function VoiceWave({ heard }: { heard: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heardRef = useRef<HTMLSpanElement>(null);
  const [seconds, setSeconds] = useState(0);
  const [fallback, setFallback] = useState(false);
  const compact = heard.trim().length > 0;

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Останні слова завжди видно: рядок один, прокручений у хвіст.
  useLayoutEffect(() => {
    const el = heardRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [heard]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFallback(true);
      return;
    }
    let raf = 0;
    let audio: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let alive = true;
    let ro: ResizeObserver | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        audio = new AudioContext();
        const analyser = audio.createAnalyser();
        analyser.fftSize = 64;
        audio.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const cv = canvasRef.current;
        const ctx = cv?.getContext('2d');
        if (!cv || !ctx) return;
        // Буфер полотна — за його CSS-шириною (вона змінюється: повна ↔ 12
        // барів) і щільністю пікселів, щоб риски були різкі.
        const dpr = window.devicePixelRatio || 1;
        const fit = () => {
          const w = Math.max(1, Math.round(cv.clientWidth));
          const h = Math.max(1, Math.round(cv.clientHeight));
          if (cv.width !== w * dpr || cv.height !== h * dpr) {
            cv.width = w * dpr; cv.height = h * dpr;
          }
        };
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(cv);
        const draw = () => {
          analyser.getByteFrequencyData(data);
          const w = cv.width / dpr, h = cv.height / dpr;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = getComputedStyle(cv).color;
          const bars = Math.max(1, Math.floor((w + GAP) / (BAR + GAP)));
          let sum = 0;
          for (let i = 0; i < bars; i++) {
            // Кожна риска — свій зріз спектра; мінімум 2px, щоб тиша дихала.
            const v = data[Math.floor((i / bars) * data.length)]! / 255;
            sum += v;
            const bh = Math.max(2, v * h);
            ctx.fillRect(i * (BAR + GAP), (h - bh) / 2, BAR, bh);
          }
          // Моушн-2 №3: тиша → хвиля пригашена, мова → повна. CSS-transition
          // 250ms робить crossfade, клас сіпаємо тільки на перетині порогу.
          cv.classList.toggle(styles.loud!, sum / bars > 0.06);
          raf = requestAnimationFrame(draw);
        };
        draw();
      } catch {
        // Мік уже тримає SpeechRecognition чи заборонений — не страшно.
        if (alive) setFallback(true);
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      void audio?.close().catch(() => {/* вже закрито */});
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <span className={styles.wrap} data-voice-wave data-compact={compact || undefined}>
      {fallback
        ? <span className={styles.rec} aria-hidden="true"><span className={styles['rec-dot']} aria-hidden />REC</span>
        : <canvas ref={canvasRef} className={`${styles.wave} ${compact ? styles['wave-compact'] : ''}`} aria-hidden="true" />}
      {compact && <span ref={heardRef} className={styles.heard} data-heard>{heard}</span>}
      <span className={styles.timer} aria-hidden="true">{mm}:{ss}</span>
    </span>
  );
}
