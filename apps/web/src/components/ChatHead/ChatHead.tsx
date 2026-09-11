// Шапка чату (6b-5) — за Screens «Чат · збірка» (1440), Responsive G1 (пілюля
// розмов) і G3 (390: один чіп «Дім ●●● N» → шторка). Без фону: лежить поверх
// стрічки на градієнті bg → прозорий, стрічка йде під неї у фейд.
//
// Три розкладки за шириною КОНТЕЙНЕРА стрічки, не вʼюпорту (Р38): панель
// артефакта 720 на 1440 лишає стрічці ~440, і там діє правило 390. Пороги —
// ті самі, що у вʼюпортів, мінус рейка: 1024 − 60 = 964, 768 − 64 = 704.
//   ≥1024  пілюля · «+ Нова» · розпірка · чіпи родів · «Дім зараз · ще N»
//   768    пілюля · розпірка · чіпи · «Дім зараз · ще N»
//   <768   panel-left-open · пілюля · розпірка · «Дім ●●● N»
// Чіпи — по одному на рід і лише коли стан є: danger flame «Прострочено N»,
// plum moon «Піст · до 27 вер», sage timer «Готуємо · таймер». Сезони й свої
// події чіпів не мають — вони тихі рядки панелі «Дім зараз».
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon/Icon';
import { CookCountdown } from '../../lib/cook-watch';
import { shortDate } from '../../lib/period';
import type { CookSession } from '../../lib/cook-session';
import type { HomeNow } from '../../store/homeNow';
import { SessionsMenu, type SessionRow } from './SessionsMenu';
import styles from './ChatHead.module.css';

export interface ChatHeadProps {
  title: string | null;
  /** «· сьогодні» / «· 7 вер». */
  when: string;
  home: HomeNow;
  cookLive: CookSession | null;
  sessions: SessionRow[];
  activeSessionId: string | null;
  onPickSession: (id: string) => void;
  onNewSession: () => void;
  /** «Усі розмови» / panel-left-open — розгорнути сайдбар або шухляду. */
  onAllSessions: () => void;
  onCook: () => void;
  onOverdue: () => void;
  /** Чіп «Дім зараз» / «Дім ●●● N». */
  onHome: () => void;
  homeOpen: boolean;
  /** «· ще N» — рядки панелі без свого чіпа (тимчасово, до QUESTIONS §14). */
  quietCount: number;
}

export function ChatHead(p: ChatHeadProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Закриває клік поза, Esc, вибір (G1).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const kinds: ('danger' | 'plum' | 'sage')[] = [];
  if (p.home.overdue > 0) kinds.push('danger');
  if (p.home.strict) kinds.push('plum');
  if (p.cookLive) kinds.push('sage');

  return (
    <header className={styles.head} data-chat-head>
      {/* 390: кнопка «панель» 40 на card — шухляда або сайдбар. */}
      <button type="button" className={styles.burger} onClick={p.onAllSessions} aria-label="Розгорнути панель">
        <Icon name="sys.expand" size={18} inherit decorative />
      </button>

      <div className={styles['pill-wrap']} ref={wrapRef}>
        <button type="button" className={`${styles.pill} ${menuOpen ? styles['pill-on'] : ''}`}
          onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-haspopup="menu" data-session-pill>
          <span className={styles['pill-title']}>{p.title ?? 'Нова розмова'}</span>
          <span className={styles['pill-when']}>· {p.when}</span>
          <Icon name={menuOpen ? 'sys.opened' : 'sys.open'} size={16} inherit decorative />
        </button>
        {menuOpen && (
          <SessionsMenu
            sessions={p.sessions}
            activeId={p.activeSessionId}
            onPick={(id) => { setMenuOpen(false); p.onPickSession(id); }}
            onNew={() => { setMenuOpen(false); p.onNewSession(); }}
            onAll={() => { setMenuOpen(false); p.onAllSessions(); }}
          />
        )}
      </div>

      <button type="button" className={styles.newBtn} onClick={p.onNewSession} data-new-session>
        <Icon name="sys.add" size={16} inherit decorative />Нова
      </button>

      <span className={styles.gap} />

      {p.home.overdue > 0 && (
        <button type="button" className={`${styles.chip} ${styles['chip-danger']}`} onClick={p.onOverdue} data-chip-overdue>
          <Icon name="live.burning" size={16} inherit decorative />Прострочено {p.home.overdue}
        </button>
      )}
      {p.home.strict && (
        <button type="button" className={`${styles.chip} ${styles['chip-plum']}`} onClick={p.onHome} data-chip-strict>
          <Icon name="live.fast" size={16} inherit decorative />{p.home.strict.title} · до {shortDate(p.home.strict.to)}
        </button>
      )}
      {p.cookLive && (
        <button type="button" className={`${styles.chip} ${styles['chip-sage']}`} onClick={p.onCook} data-chip-cooking>
          <Icon name="cook.timer" size={16} inherit decorative />Готуємо · <CookCountdown deadline={p.cookLive.deadline} />
        </button>
      )}

      {/* ≥768: «Дім зараз · ще N»; <768: «Дім ●●● N» — крапки родів активних станів, число — скільки їх. */}
      <button type="button" className={`${styles.chip} ${styles['chip-home']} ${p.homeOpen ? styles['chip-on'] : ''}`} onClick={p.onHome}
        aria-expanded={p.homeOpen} data-chip-home>
        <Icon name="sys.home" size={16} inherit decorative />
        <span className={styles['home-wide']}>Дім зараз{p.quietCount > 0 && <span className={styles['home-more']}> · ще {p.quietCount}</span>}</span>
        <span className={styles['home-narrow']}>
          Дім
          {kinds.length > 0 && (
            <span className={styles.dots} aria-hidden>{kinds.map((k) => <span key={k} className={`${styles.dot} ${styles[`dot-${k}`]}`} />)}</span>
          )}
          {kinds.length > 0 && <span className={styles.count}>{kinds.length}</span>}
        </span>
      </button>
    </header>
  );
}
