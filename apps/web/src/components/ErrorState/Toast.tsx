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
//
// Макет 30.09 (COOK-TIMERS-BRIEF-0930, плашка фонового таймера кукінг-моду):
// та сама «крапка + речення», яку той самий тост уже мав — додано лише те,
// чого бракувало: хрестик (closable), тап по тілу (onTap) і розміщення
// «чубчиком» над шапкою (placement="chin"). Позиціонування chin — position:
// absolute щодо НАЙБЛИЖЧОГО позиційованого предка: точний контейнер (грід,
// що дзеркалить колонку фокуса, максимальна ширина) — турбота викликача, не
// цього компонента (Cook.tsx/cook-watch.tsx самі ставлять контекст).

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './Toast.module.css';

/** Рід крапки (E3): danger — не вдалось; amber — попередження («Тека не піде», «Не збереглось»); sage — вдалось. */
export type ToastTone = 'danger' | 'amber' | 'sage';

interface Props {
  text: string;
  /**
   * Макет 30.09: плашка поза кукінг-модом несе «{рецепт} · {крок} · час
   * вийшов» — назва рецепта приглушена. Окремий props, не розмітка всередині
   * `text`: той лишається рядком (стабільна залежність ефекту «новий текст —
   * знову живий», не новий React-елемент щорендеру).
   */
  mutedPrefix?: string;
  /**
   * Макет 30.09 (виміряно в бандлі: fontWeight 600 на назві кроку, 400 на
   * «· час вийшов» і на mutedPrefix): жирна частина перед `text` — назва
   * кроку в плашці таймера. Той самий принцип, що й mutedPrefix — окремий
   * props, не розмітка в text.
   */
  lead?: string;
  tone?: ToastTone;
  action?: { label: string; run: () => void };
  /** Є — тост зникає сам (4 с / 8 с з дією) і від змаху вгору на ≤768. */
  onDismiss?: () => void;
  /** Хрестик закриття (зона 44) — макет 30.09: плашка фонового таймера. */
  closable?: boolean;
  /** Тап по тілу (не по хрестику й не по дії) — макет 30.09. */
  onTap?: () => void;
  /**
   * `chin` — «чубчик» поверх шапки (макет 30.09, плашка фонового таймера):
   * position absolute щодо предка, якого готує викликач; своя тривалість
   * появи/зникнення (240 мс, моушн-пас макета), не позиція `default`
   * (fixed знизу/згори вʼюпорту, як E3). На ≥1024 в цьому розміщенні відлік
   * ставиться на паузу під курсором — 2 с після відходу.
   */
  placement?: 'default' | 'chin';
}

export const TOAST_TTL = { plain: 4_000, withAction: 8_000 } as const;
const SWIPE_UP_PX = 40;
/** Моушн-пас макета 30.09: хрестик і тап — лише прозорість, 120 мс. */
const FADE_MS = 120;
/** Моушн-пас макета 30.09: зникнення chin (авто/змах) — 240 мс, той самий дур, що поява. */
const CHIN_EXIT_MS = 240;
/** «Після відходу курсора ще 2 с» (макет 30.09, ≥1024) — фіксована пільга, не залишок від 4 с. */
const HOVER_GRACE_MS = 2_000;
const HOVER_MIN_WIDTH = '(min-width: 1024px)';

type LeaveMode = 'auto' | 'fade';

export function Toast({ text, mutedPrefix, lead, tone = 'danger', action, onDismiss, closable, onTap, placement = 'default' }: Props) {
  const [leaving, setLeaving] = useState(false);
  const [leaveMode, setLeaveMode] = useState<LeaveMode>('auto');
  const startY = useRef<number | null>(null);
  const dismissRef = useRef(onDismiss); dismissRef.current = onDismiss;
  const onTapRef = useRef(onTap); onTapRef.current = onTap;
  const ttlTimerRef = useRef<number | null>(null);

  const leavingRef = useRef(false);
  const leave = (mode: LeaveMode, after?: () => void) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaveMode(mode);
    setLeaving(true);
    if (ttlTimerRef.current != null) { window.clearTimeout(ttlTimerRef.current); ttlTimerRef.current = null; }
    // Вихід — той самий шлях, що вхід, лише назад; після нього — геть.
    const ms = mode === 'fade' ? FADE_MS : placement === 'chin' ? CHIN_EXIT_MS : 160;
    window.setTimeout(() => { dismissRef.current?.(); after?.(); }, ms);
  };

  const armTtl = (ms: number) => {
    if (ttlTimerRef.current != null) window.clearTimeout(ttlTimerRef.current);
    ttlTimerRef.current = window.setTimeout(() => leave('auto'), ms);
  };

  // Новий текст у тому самому вузлі (інший тост услід) — знову живий.
  useEffect(() => { leavingRef.current = false; setLeaving(false); }, [text]);
  useEffect(() => {
    if (!onDismiss) return;
    armTtl(action ? TOAST_TTL.withAction : TOAST_TTL.plain);
    return () => { if (ttlTimerRef.current != null) window.clearTimeout(ttlTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- таймер живе від ознак «є дія»/«є onDismiss», не від самих обʼєктів, що нові щорендеру
  }, [text, !!action, !!onDismiss]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!onDismiss) return;
    startY.current = e.clientY;
    // Палець виходить за межі тоста раніше, ніж пройде 40 px — тримаємо вказівник.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    if (startY.current - e.clientY >= SWIPE_UP_PX) { startY.current = null; leave('auto'); }
  };
  const onPointerEnd = () => { startY.current = null; };

  // Макет 30.09, ≥1024: під курсором відлік на паузі, після відходу — ще 2 с
  // (фіксована пільга, не залишок оригінальних 4 с). Лише для chin — інші
  // місця показу тоста цього не просили.
  const onMouseEnter = () => {
    if (placement !== 'chin' || !onDismiss) return;
    if (!window.matchMedia?.(HOVER_MIN_WIDTH)?.matches) return;
    if (ttlTimerRef.current != null) { window.clearTimeout(ttlTimerRef.current); ttlTimerRef.current = null; }
  };
  const onMouseLeave = () => {
    if (placement !== 'chin' || !onDismiss || leavingRef.current) return;
    if (!window.matchMedia?.(HOVER_MIN_WIDTH)?.matches) return;
    armTtl(HOVER_GRACE_MS);
  };

  const closeClick = (e: React.MouseEvent) => { e.stopPropagation(); leave('fade'); };
  const actionClick = (e: React.MouseEvent) => { e.stopPropagation(); action?.run(); };
  const bodyClick = () => { if (!onTap) return; leave('fade', () => onTapRef.current?.()); };

  const leaveClass = !leaving ? '' : leaveMode === 'fade' ? styles['leaving-fade'] : placement === 'chin' ? styles['leaving-chin'] : styles.leaving;

  return (
    <div
      className={`${styles.toast} ${placement === 'chin' ? styles.chin : ''} ${leaveClass} ${onTap ? styles.tappable : ''}`}
      role="status" data-toast data-toast-tone={tone} data-toast-placement={placement}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      onClick={onTap ? bodyClick : undefined}>
      <span className={`${styles.dot} ${styles[`dot-${tone}`]}`} aria-hidden="true" />
      <span className={styles.text}>
        {mutedPrefix && <span className={styles.muted}>{mutedPrefix} · </span>}
        {lead && <b className={styles.lead}>{lead}</b>}
        <span className={styles.trail}>{text}</span>
      </span>
      {action && (
        <button type="button" className={styles.action} onClick={actionClick} data-toast-action>
          {action.label}
        </button>
      )}
      {closable && (
        <button type="button" className={styles.close} onClick={closeClick} aria-label="Закрити" data-toast-close>
          <Icon name="sys.close" size={16} inherit decorative />
        </button>
      )}
    </div>
  );
}
