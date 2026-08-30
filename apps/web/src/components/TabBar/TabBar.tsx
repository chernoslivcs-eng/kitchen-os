import { useEffect } from 'react';
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

  // На десктопі таб-бар стає sidebar-ом ліворуч. Ставимо клас на <body> щоб
  // головні screens зсунулись праворуч на 200px (див. tokens.css). Знімаємо
  // клас при unmount — SignIn/Recipe/Cook/Share не мають TabBar, і сайдбара
  // теж не буде.
  useEffect(() => {
    document.body.classList.add('with-sidebar');
    return () => document.body.classList.remove('with-sidebar');
  }, []);

  // Бриф-2 п.2: чотири таби — канон. Профіль живе аватаром у шапці екранів,
  // журнал сесій — сегментом «Історія» в Стрічці, журнал готувань — лінком
  // із Рецептів. Порядок і глифи — з хендофа (❋ Рецепти третій).
  const tabs: TabDef[] = [
    { path: '/app', glyph: '◉', label: 'Стрічка' },
    { path: '/pantry', glyph: '▤', label: 'Комора' },
    { path: '/recipes', glyph: '❋', label: 'Рецепти' },
    { path: '/list', glyph: '☰', label: 'Список', badge: shoppingCount },
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
