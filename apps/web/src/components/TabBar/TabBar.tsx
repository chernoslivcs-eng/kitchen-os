import { useLocation, useNavigate } from 'react-router-dom';
import styles from './TabBar.module.css';

interface TabDef {
  path: string;
  glyph: string;
  label: string;
  badge?: number;
}

interface Props {
  shoppingCount?: number;
}

export function TabBar({ shoppingCount }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const tabs: TabDef[] = [
    { path: '/app', glyph: '◉', label: 'Стрічка' },
    { path: '/pantry', glyph: '▤', label: 'Комора' },
    { path: '/list', glyph: '☰', label: 'Список', badge: shoppingCount },
    { path: '/cooklog', glyph: '✎', label: 'Журнал' },
    { path: '/profile', glyph: '⚙', label: 'Профіль' },
  ];

  return (
    <div className={styles.wrap}>
      {tabs.map((t) => {
        const active = pathname === t.path;
        return (
          <button
            key={t.path}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            onClick={() => navigate(t.path)}
          >
            <span className={styles.glyph}>{t.glyph}</span>
            <span>{t.label}</span>
            {t.badge != null && t.badge > 0 && <span className={styles.badge}>{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
