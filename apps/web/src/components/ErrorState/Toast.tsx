// Етап 10 (Errors E3): тост — подія не вдалась (або вдалась і її можна
// скасувати). Крапка роду ліворуч, речення, дія словом праворуч (шавлія, 600).
// Без іконки: помилка говорить тим самим голосом, що «Скасовано» чи «Збережу в
// рецептах…».
//
// Живе окремим компонентом, бо Комора й Список свого тоста не мали взагалі —
// невдале завантаження там показувалось порожнім екраном, тобто брехнею.
//
// FIXES-V3 №11 (рішення власника): один компонент на всі екрани. Час тримає
// сам тост, коли є кому сказати «зник» (`onDismiss`): 4 с без дії, 8 с з
// дією. На ≤768 — вгорі під шапкою, по центру, і змах угору закриває; на
// десктопі — як E3, знизу над композитором (рішення пізніше). Без `onDismiss`
// тост стоїть, поки його не зніме той, хто показав (невдале завантаження
// екрана — доки не натиснуть «Повторити»).

import { useEffect, useRef, useState } from 'react';
import styles from './Toast.module.css';

/** Рід крапки (E3): danger — не вдалось; amber — попередження («Тека не піде», «Не збереглось»); sage — вдалось. */
export type ToastTone = 'danger' | 'amber' | 'sage';

interface Props {
  text: string;
  tone?: ToastTone;
  action?: { label: string; run: () => void };
  /** Є — тост зникає сам (4 с / 8 с з дією) і від змаху вгору на ≤768. */
  onDismiss?: () => void;
}

export const TOAST_TTL = { plain: 4_000, withAction: 8_000 } as const;
const SWIPE_UP_PX = 40;

export function Toast({ text, tone = 'danger', action, onDismiss }: Props) {
  const [leaving, setLeaving] = useState(false);
  const startY = useRef<number | null>(null);
  const dismissRef = useRef(onDismiss); dismissRef.current = onDismiss;

  const leavingRef = useRef(false);
  const leave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    // Вихід — той самий шлях, що вхід, лише назад; після нього — геть.
    window.setTimeout(() => dismissRef.current?.(), 160);
  };

  // Новий текст у тому самому вузлі (інший тост услід) — знову живий.
  useEffect(() => { leavingRef.current = false; setLeaving(false); }, [text]);
  useEffect(() => {
    if (!onDismiss) return;
    const t = window.setTimeout(leave, action ? TOAST_TTL.withAction : TOAST_TTL.plain);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, !!action, !!onDismiss]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!onDismiss) return;
    startY.current = e.clientY;
    // Палець виходить за межі тоста раніше, ніж пройде 40 px — тримаємо вказівник.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    if (startY.current - e.clientY >= SWIPE_UP_PX) { startY.current = null; leave(); }
  };
  const onPointerEnd = () => { startY.current = null; };

  return (
    <div className={`${styles.toast} ${leaving ? styles.leaving : ''}`} role="status" data-toast data-toast-tone={tone}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
      <span className={`${styles.dot} ${styles[`dot-${tone}`]}`} aria-hidden="true" />
      <span className={styles.text}>{text}</span>
      {action && (
        <button type="button" className={styles.action} onClick={action.run} data-toast-action>
          {action.label}
        </button>
      )}
    </div>
  );
}
