import { useEffect, useRef, useState } from 'react';
import { loadCookSession } from './cook-session';
import { useCookStore } from '../store/cook';
import { getCookAudioSession, ringAlarm } from './cook-sound';
import { Toast } from '../components/ErrorState/Toast';
import styles from './cook-watch.module.css';

// Пул-7 №1: таймер живе поза Cook Mode.
// · <CookCountdown deadline> — живий «М:СС» для банерів «Готування триває»
//   (мобільний у Стрічці + cook-live у сайдбарі). Рахує сам, з дедлайну.
// · <GlobalCookAlarm> — вартовий на App-рівні: коли дедлайн минув, а попап
//   Cook Mode закритий, дзвонить/вібрує/шле нотифікацію, і (макет 30.09,
//   §2.3) показує плашку поверх застосунку — один раз на кожен таймер, що
//   добіг: не лише поточний крок (deadline), а й фонові (timers) зі
//   збереженої сесії; повтору кожні 30с більше нема.

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

interface DueToast {
  id: number;
  stepIdx: number;
  stepText: string;
  recipeName: string;
  recipe: import('../api').Recipe;
  recipeId?: string;
  returnSessionId?: string | null;
}

export function GlobalCookAlarm() {
  const overlayOpen = useCookStore((s) => s.args != null);
  // §2.3: «один раз на кожен таймер, що добіг» — rung тримає дедлайни, які
  // вже прозвучали цього разу (поточний час не змінюється, поки годинник не
  // покаже НОВИЙ дедлайн: наступний крок, новий +1 хв). Скидається щоразу,
  // коли ефект перезапускається (Cook Mode відкрили/закрили) або сесії нема.
  const rungRef = useRef<Set<number>>(new Set());
  const [toasts, setToasts] = useState<DueToast[]>([]);
  const toastSeq = useRef(0);
  const removeToast = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  useEffect(() => {
    if (overlayOpen) return;   // усередині Cook Mode дзвонить його власний алярм і своя плашка
    rungRef.current = new Set();
    setToasts([]); // нове стеження — стара плашка (якщо ще висіла) тут ні до чого
    const iv = window.setInterval(() => {
      const s = loadCookSession();
      if (!s) { rungRef.current.clear(); return; }
      const now = Date.now();
      const due: { deadline: number; stepIdx: number }[] = [];
      if (s.deadline && s.deadline <= now) due.push({ deadline: s.deadline, stepIdx: s.stepIdx });
      for (const [k, t] of Object.entries(s.timers ?? {})) {
        if (t.deadline && t.deadline <= now) due.push({ deadline: t.deadline, stepIdx: Number(k) });
      }
      for (const d of due) {
        if (rungRef.current.has(d.deadline)) continue;
        rungRef.current.add(d.deadline);
        // Перегляд 30.09 (issue #3): та сама спільна сесія, що й у Cook.tsx
        // — не власний контекст, створений тут без жесту (на iOS лишався б
        // suspended рівно тоді, коли треба дзвонити).
        ringAlarm(getCookAudioSession(), s.recipe.t);
        setToasts((list) => [...list, {
          id: toastSeq.current++,
          stepIdx: d.stepIdx,
          stepText: s.recipe.st[d.stepIdx]?.t ?? 'Крок',
          recipeName: s.recipe.t,
          recipe: s.recipe,
          recipeId: s.recipeId,
          returnSessionId: s.returnSessionId,
        }]);
      }
    }, 1000);
    return () => window.clearInterval(iv);
  }, [overlayOpen]);

  if (overlayOpen || toasts.length === 0) return null;
  return (
    <div className={styles.layer}>
      <div className={styles.col}>
        {toasts.map((t, i) => {
          const fromEnd = toasts.length - 1 - i;
          return (
            <div key={t.id} className={styles.slot} style={{ transform: `translateY(${fromEnd * 56}px)`, zIndex: 85 - fromEnd }}>
              <Toast text=" · час вийшов" lead={t.stepText} mutedPrefix={t.recipeName} tone="sage" placement="chin" closable
                onDismiss={() => removeToast(t.id)}
                onTap={() => {
                  removeToast(t.id);
                  useCookStore.getState().open({ recipe: t.recipe, recipeId: t.recipeId, returnSessionId: t.returnSessionId, startAt: t.stepIdx });
                }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
