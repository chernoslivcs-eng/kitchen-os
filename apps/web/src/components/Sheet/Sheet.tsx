// Bottom-sheet модалка з правильною доступністю: Escape закриває, click
// по backdrop закриває, всередині — фокус-трап (Tab циклиться між
// інтерактивними), aria-modal, роль dialog.
//
// Моушн-2 №1: панель справді «знизу підіймається» — translateY 105%→0
// 400ms enter, бекдроп fade 250ms; вихід дзеркальний 250ms exit (onClose
// летить ПІСЛЯ анімації); драг вниз більш ніж на чверть висоти — закрити,
// менше — панель пружинить назад.

import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import styles from './Sheet.module.css';

interface Props {
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const EXIT_MS = 250;

export function Sheet({ onClose, ariaLabel, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const startY = useRef(0);

  const close = useCallback(() => {
    setClosing((was) => {
      if (was) return was;
      const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(onClose, instant ? 0 : EXIT_MS);
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    // Автофокус на першому інтерактивному, щоб клавіатурник міг одразу
    // працювати (і Escape).
    const focusables = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables[0]?.focus();

    // Escape → close. Tab-цикл між focusables у межах панелі.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((n) => !n.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);

    // Заблокуємо скрол body поки модалка відкрита.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  // Драг-закриття: тягнути можна тільки коли вміст панелі не проскролений —
  // інакше жест конфліктує зі скролом усередині.
  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    const el = panelRef.current;
    if (!el || el.scrollTop > 0 || closing) return;
    dragging.current = true;
    startY.current = e.touches[0]!.clientY;
  }
  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dy = e.touches[0]!.clientY - startY.current;
    setDragY(Math.max(0, dy));
  }
  function onTouchEnd() {
    if (!dragging.current) return;
    dragging.current = false;
    const h = panelRef.current?.offsetHeight ?? 400;
    if (dragY > h * 0.25) close();
    else setDragY(0);   // пружинимо назад transition-ом
  }

  return (
    <div
      onClick={close}
      role="presentation"
      className={`${styles.backdrop} ${closing ? styles['backdrop-out'] : ''}`}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`${styles.panel} ${closing ? styles['panel-out'] : ''}`}
        style={dragY > 0 && !closing
          ? { transform: `translateY(${dragY}px)`, transition: dragging.current ? 'none' : undefined }
          : undefined}
      >
        {children}
      </div>
    </div>
  );
}
