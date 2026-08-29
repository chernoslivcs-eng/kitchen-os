// Bottom-sheet модалка з правильною доступністю: Escape закриває, click
// по backdrop закриває, всередині — фокус-трап (Tab циклиться між
// інтерактивними), aria-modal, роль dialog. Стиль — фіксований під бриф:
// закруглене зверху вікно, знизу підіймається.

import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({ onClose, ariaLabel, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    // Автофокус на першому інтерактивному, щоб клавіатурник міг одразу
    // працювати (і Escape).
    const focusables = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables[0]?.focus();

    // Escape → close. Tab-цикл між focusables у межах панелі.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
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
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--bg-surface)',
          borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
          padding: '22px 22px calc(22px + env(safe-area-inset-bottom))',
          display: 'flex', flexDirection: 'column', gap: 14,
          maxHeight: '90dvh', overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
