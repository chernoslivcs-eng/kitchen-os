import { useEffect, useState } from 'react';
import { loadCookSession } from './cook-session';
import { useCookStore } from '../store/cook';

// Пул-7 №1: таймер живе поза Cook Mode.
// · <CookCountdown deadline> — живий «М:СС» для банерів «Готування триває»
//   (мобільний у Стрічці + cook-live у сайдбарі). Рахує сам, з дедлайну.
// · <GlobalCookAlarm> — вартовий на App-рівні: коли дедлайн минув, а попап
//   Cook Mode закритий, дзвонить/вібрує/шле нотифікацію — одразу і далі
//   кожні 30с (та сама каденція, що в самому Cook Mode).

export function CookCountdown({ deadline }: { deadline?: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const iv = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(iv);
  }, [deadline]);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  if (left <= 0) return <> · час вийшов</>;
  return <> · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</>;
}

function ringOutside(recipeTitle: string) {
  try {
    type AC = typeof AudioContext;
    const Ctx: AC | undefined = window.AudioContext
      ?? (window as { webkitAudioContext?: AC }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.65);
      osc.onended = () => void ctx.close();
    }
  } catch { /* без звуку — лишається вібро */ }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* desktop */ }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Kitchen OS · таймер', {
        body: `${recipeTitle} — час вийшов`,
        tag: 'kitchen-os-timer',
      });
    }
  } catch { /* нотифікації не критичні */ }
}

export function GlobalCookAlarm() {
  const overlayOpen = useCookStore((s) => s.args != null);
  useEffect(() => {
    if (overlayOpen) return;   // усередині Cook Mode дзвонить його власний алярм
    let lastRing = 0;
    const iv = window.setInterval(() => {
      const s = loadCookSession();
      if (!s?.deadline || Date.now() < s.deadline) { lastRing = 0; return; }
      if (Date.now() - lastRing < 30_000) return;
      lastRing = Date.now();
      ringOutside(s.recipe.t);
    }, 1000);
    return () => window.clearInterval(iv);
  }, [overlayOpen]);
  return null;
}
