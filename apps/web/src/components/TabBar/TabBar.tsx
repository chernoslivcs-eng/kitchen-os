import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo/Logo';
import { api } from '../../api';
import { useAuth } from '../../store/auth';
import styles from './TabBar.module.css';

interface TabDef {
  path: string;
  glyph: string;
  label: string;
  badge?: number;
  count?: number;
}

interface Props {
  shoppingCount?: number;
  // Екрани без мобільної навігації (Профіль, Журнал, Рецепт): на телефоні
  // таб-бар не рендериться, на десктопі стає сайдбаром — Д03/Д06 малюють
  // сайдбар усюди, крім Cook Mode.
  desktopOnly?: boolean;
}

// Лічильник комори для сайдбара (Д01). Модульний кеш, щоб чотири екрани не
// смикали /v1/pantry на кожен mount.
let pantryCountCache: { value: number; at: number } | null = null;

export function TabBar({ shoppingCount, desktopOnly }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const meName = useAuth((s) => s.me?.user?.name ?? null);

  const [pantryCount, setPantryCount] = useState<number | null>(pantryCountCache?.value ?? null);
  useEffect(() => {
    if (pantryCountCache && Date.now() - pantryCountCache.at < 60_000) return;
    api.pantry()
      .then(({ count }) => {
        pantryCountCache = { value: count, at: Date.now() };
        setPantryCount(count);
      })
      .catch(() => {/* сайдбар без лічильника — не трагедія */});
  }, [pathname]);

  // На десктопі таб-бар стає sidebar-ом ліворуч. Ставимо клас на <body> щоб
  // головні screens зсунулись праворуч (див. tokens.css). Знімаємо при
  // unmount — Cook/Share/SignIn сайдбара не мають.
  useEffect(() => {
    document.body.classList.add('with-sidebar');
    return () => document.body.classList.remove('with-sidebar');
  }, []);

  // Бриф-2 п.2: чотири таби — канон. Профіль живе аватаром у шапці екранів
  // (на десктопі — блоком унизу сайдбара, Д01), журнал сесій — сегментом
  // «Історія» в Стрічці, журнал готувань — лінком із Рецептів.
  const tabs: TabDef[] = [
    { path: '/app', glyph: '◉', label: 'Стрічка' },
    { path: '/pantry', glyph: '▤', label: 'Комора', count: pantryCount ?? undefined },
    { path: '/recipes', glyph: '❋', label: 'Рецепти' },
    { path: '/list', glyph: '☰', label: 'Список', badge: shoppingCount },
  ];

  const initial = (meName?.trim()[0] ?? '·').toUpperCase();

  return (
    <div className={`${styles.wrap} ${desktopOnly ? styles['desktop-only'] : ''}`}>
      {/* Д01: знак + вордмарк угорі сайдбара. На мобільному приховано. */}
      <div className={styles.brand}>
        <Logo size={26} />
        <span className={styles['brand-name']}>Kitchen OS</span>
      </div>

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
            {t.count != null && <span className={styles.count}>{t.count}</span>}
            {t.badge != null && t.badge > 0 && <span className={styles.badge}>{t.badge}</span>}
          </button>
        );
      })}

      {/* Д01: спейсер + блок користувача внизу; активний, коли відкрито профіль. */}
      <div className={styles.spacer} />
      <button
        className={`${styles.user} ${pathname === '/profile' ? styles.active : ''}`}
        onClick={() => navigate('/profile')}
      >
        <span className={styles['user-avatar']}>{initial}</span>
        <span>{meName ?? 'Профіль'}</span>
      </button>
    </div>
  );
}
