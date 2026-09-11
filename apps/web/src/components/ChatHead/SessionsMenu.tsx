// Меню розмов із пілюлі (Responsive G1): 340 на card r14 --sh2, 6 всередині;
// «Нова розмова ⌘N» шавлією, волосина, групи по днях (11 dim), рядки 44 r10 —
// назва 14 + стан 12 другим рядком, активна — на bg із check; волосина,
// «Усі розмови» 40 muted → розгортає сайдбар. Один компонент на всіх ширинах.
import { Icon } from '../Icon/Icon';
import styles from './ChatHead.module.css';

export interface SessionRow {
  id: string;
  title: string;
  /** ISO-день сесії (YYYY-MM-DD). */
  day: string;
  created_at: string;
  /** Другий рядок: «чекає рішення» бурштином або «14:37» dim. */
  state?: { text: string; tone: 'amber' | 'dim' };
}

const WEEKDAY = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** «Сьогодні» · «Вчора» · «Пн · 7 вер». */
export function dayLabel(day: string, today = new Date()): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (day === iso(today)) return 'Сьогодні';
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (day === iso(y)) return 'Вчора';
  const d = new Date(day + 'T00:00:00');
  const mon = d.toLocaleDateString('uk-UA', { month: 'short' }).replace('.', '');
  return `${WEEKDAY[d.getDay()]} · ${d.getDate()} ${mon}`;
}

export function SessionsMenu({ sessions, activeId, onPick, onNew, onAll }: {
  sessions: SessionRow[]; activeId: string | null;
  onPick: (id: string) => void; onNew: () => void; onAll: () => void;
}) {
  const groups: { day: string; rows: SessionRow[] }[] = [];
  for (const s of sessions.slice(0, 5)) {
    const g = groups.find((x) => x.day === s.day);
    if (g) g.rows.push(s); else groups.push({ day: s.day, rows: [s] });
  }
  return (
    <div className={styles.menu} role="menu" data-sessions-menu>
      <button type="button" role="menuitem" className={styles['menu-new']} onClick={onNew}>
        <Icon name="sys.add" size={16} inherit decorative />Нова розмова<span className={styles['menu-kbd']}>⌘N</span>
      </button>
      <span className={styles['menu-line']} />
      {groups.map((g) => (
        <div key={g.day} className={styles['menu-group']}>
          <span className={styles['menu-day']}>{dayLabel(g.day)}</span>
          {g.rows.map((s) => {
            const active = s.id === activeId;
            return (
              <button key={s.id} type="button" role="menuitem" className={`${styles['menu-row']} ${active ? styles['menu-row-on'] : ''}`} onClick={() => onPick(s.id)} aria-current={active || undefined}>
                <span className={styles['menu-row-text']}>
                  <span className={styles['menu-row-title']}>{s.title}</span>
                  {s.state && <span className={`${styles['menu-row-state']} ${s.state.tone === 'amber' ? styles['menu-row-amber'] : ''}`}>{s.state.text}</span>}
                </span>
                {active && <Icon name="sys.done" size={16} inherit decorative />}
              </button>
            );
          })}
        </div>
      ))}
      <span className={styles['menu-line']} />
      <button type="button" role="menuitem" className={styles['menu-all']} onClick={onAll}>
        <Icon name="sys.expand" size={16} inherit decorative />Усі розмови<span className={styles['menu-kbd']}>розгорнути меню</span>
      </button>
    </div>
  );
}
