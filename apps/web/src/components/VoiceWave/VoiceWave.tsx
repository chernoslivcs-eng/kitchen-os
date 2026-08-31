// Моушн-кіт §04: жива хвиля диктування — бари від РЕАЛЬНОЇ гучності
// (AnalyserNode), не фейк-луп: людина бачить, що її чутно. Поруч — таймер
// запису в моно. Reduced motion або мік без дозволу → статичний ● REC.

import { useEffect, useRef, useState } from 'react';
import styles from './VoiceWave.module.css';

const BARS = 12;

export function VoiceWave() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [seconds, setSeconds] = useState(0);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFallback(true);
      return;
    }
    let raf = 0;
    let audio: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let alive = true;
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
        const draw = () => {
          analyser.getByteFrequencyData(data);
          ctx.clearRect(0, 0, cv.width, cv.height);
          const bw = 3, gap = (cv.width - BARS * bw) / (BARS - 1);
          const color = getComputedStyle(cv).color;
          ctx.fillStyle = color;
          for (let i = 0; i < BARS; i++) {
            // Кожен бар — свій зріз спектра; мінімум 2px, щоб тиша дихала.
            const v = data[Math.floor((i / BARS) * data.length)]! / 255;
            const bh = Math.max(2, v * cv.height);
            ctx.fillRect(i * (bw + gap), (cv.height - bh) / 2, bw, bh);
          }
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
      void audio?.close().catch(() => {/* вже закрито */});
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <span className={styles.wrap} aria-hidden="true">
      {fallback
        ? <span className={styles.rec}>● REC</span>
        : <canvas ref={canvasRef} width={56} height={22} className={styles.wave} />}
      <span className={styles.timer}>{mm}:{ss}</span>
    </span>
  );
}
