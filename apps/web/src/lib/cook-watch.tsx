import { useEffect, useRef, useState } from 'react';
import { loadCookSession } from './cook-session';
import { useCookStore } from '../store/cook';
import { CookAudioSession, ringAlarm } from './cook-sound';

// Пул-7 №1: таймер живе поза Cook Mode.
// · <CookCountdown deadline> — живий «М:СС» для банерів «Готування триває»
//   (мобільний у Стрічці + cook-live у сайдбарі). Рахує сам, з дедлайну.
// · <GlobalCookAlarm> — вартовий на App-рівні: коли дедлайн минув, а попап
//   Cook Mode закритий, дзвонить/вібрує/шле нотифікацію. Спек 30.09 §2.3:
//   один раз на кожен таймер, що добіг — не лише поточний крок (deadline),
//   а й фонові (timers) зі збереженої сесії; повтору кожні 30с більше нема.

export function CookCountdown({ deadline }: { deadline?: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const iv = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(iv);
  }, [deadline]);
  // 6b-5c: без власного роздільника — префікс («Готуємо · », «таймер ») ставить
  // той, хто вставляє; порожньо, коли таймер не йде.
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  if (left <= 0) return <>час вийшов</>;
  return <>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</>;
}

// Один AudioContext для всіх алярмів поза Cook Mode (§5: не по одному на
// виклик) — але, на відміну від сесії кроку в Cook.tsx, живе рівно стільки,
// скільки застосунок: тут ніколи не тікає, лише зрідка дзвонить один раз.
let outsideAudio: CookAudioSession | null = null;
function outsideSession(): CookAudioSession {
  return (outsideAudio ??= new CookAudioSession());
}

export function GlobalCookAlarm() {
  const overlayOpen = useCookStore((s) => s.args != null);
  // §2.3: «один раз на кожен таймер, що добіг» — rung тримає дедлайни, які
  // вже прозвучали цього разу (поточний час не змінюється, поки годинник не
  // покаже НОВИЙ дедлайн: наступний крок, новий +1 хв). Скидається щоразу,
  // коли ефект перезапускається (Cook Mode відкрили/закрили) або сесії нема.
  const rungRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (overlayOpen) return;   // усередині Cook Mode дзвонить його власний алярм
    rungRef.current = new Set();
    const iv = window.setInterval(() => {
      const s = loadCookSession();
      if (!s) { rungRef.current.clear(); return; }
      const now = Date.now();
      const due: number[] = [];
      if (s.deadline && s.deadline <= now) due.push(s.deadline);
      for (const t of Object.values(s.timers ?? {})) {
        if (t.deadline && t.deadline <= now) due.push(t.deadline);
      }
      for (const d of due) {
        if (rungRef.current.has(d)) continue;
        rungRef.current.add(d);
        ringAlarm(outsideSession(), s.recipe.t);
      }
    }, 1000);
    return () => window.clearInterval(iv);
  }, [overlayOpen]);
  return null;
}
