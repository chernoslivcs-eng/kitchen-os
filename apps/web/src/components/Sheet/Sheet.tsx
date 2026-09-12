// Bottom-sheet модалка з правильною доступністю: Escape закриває, click
// по backdrop закриває, всередині — фокус-трап (Tab циклиться між
// інтерактивними), aria-modal, роль dialog.
//
// Моушн-2 №1: панель справді «знизу підіймається» — translateY 105%→0
// 400ms enter, бекдроп fade 250ms; вихід дзеркальний 250ms exit (onClose
// летить ПІСЛЯ анімації); драг вниз більш ніж на чверть висоти — закрити,
// менше — панель пружинить назад.
//
// v3 (11.09, зауваження власника): шторка і права панель — одна колода.
// Бандл малює їх однією карткою з тим самим рядком шапки (Screens D3a
// aside · D3c шторка: кікер + ✕, у шторці ще ручка). У коді рядок шапки
// панелі — це .rail-tabs: знак панелі ліворуч, вкладка-знак артефакта
// праворуч. Шторка бере той самий рядок і ту саму геометрію (.rail-open:
// 560, радіус 16, відступи 16), а `kind` каже, який знак у вкладці.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Sheet.module.css';
import { keepFieldInView } from '../../lib/keepFieldInView';
import { useSheetDrag } from '../../lib/useSheetDrag';
import { holdBodyFlag } from '../../lib/body-flags';
import panel from '../ArtifactPanel/ArtifactPanel.module.css';
import { PanelIcon } from '../ArtifactPanel/ArtifactPanel';
import { ARTIFACT_ICON, type ArtifactKey } from '../../pages/Feed/artifacts';
import { Icon } from '../Icon/Icon';

interface Props {
  onClose: () => void;
  ariaLabel: string;
  /** Рід артефакта — знак у вкладці шапки, як у панелі. Без нього — лише «закрити». */
  kind?: ArtifactKey;
  children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const EXIT_MS = 250;

export function Sheet({ onClose, ariaLabel, kind, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Етап 6a: поки шторка відкрита, нижній бар (<768) ховається (HANDOFF).
  // №21: через лічильник — інша шторка поруч клас не зніме.
  useEffect(() => holdBodyFlag('sheet-open'), []);
  const [closing, setClosing] = useState(false);

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

  // №35: змах униз по граберу/шапці закриває (один механізм на всі шторки —
  // lib/useSheetDrag); скрол усередині не перехоплюється, бо обробники
  // стоять лише на граберi й шапці.
  const drag = useSheetDrag(close, !closing);

  return (
    <div
      onClick={close}
      role="presentation"
      className={`${styles.backdrop} ${closing ? styles['backdrop-out'] : ''}`}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onFocusCapture={keepFieldInView}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`${styles.panel} ${closing ? styles['panel-out'] : ''}`}
        style={closing ? undefined : drag.panelStyle}
        data-sheet
      >
        <div className={styles.grab} {...drag.handleProps} data-sheet-grab>
          <div className={styles.handle} aria-hidden />
        </div>
        <div className={`${panel['rail-tabs']} ${styles.head}`} {...drag.handleProps} data-sheet-head>
          <button type="button" className={styles.close} onClick={close} title="Закрити" aria-label="Закрити"><PanelIcon /></button>
          {kind && (
            <span className={`${panel['rail-tab']} ${panel['rail-tab-on']} ${styles.tab}`} aria-hidden>
              <span className={panel['rail-tab-glyph']}><Icon name={ARTIFACT_ICON[kind]} size={16} inherit decorative /></span>
            </span>
          )}
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
