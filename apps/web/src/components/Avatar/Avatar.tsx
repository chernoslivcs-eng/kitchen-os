// Бриф-2 п.2: Профіль = аватар у шапці (34px, ініціал). Замінив шостий таб.
import { useNavigate } from 'react-router-dom';
import styles from './Avatar.module.css';

export function Avatar({ name }: { name?: string | null }) {
  const navigate = useNavigate();
  const initial = (name?.trim()[0] ?? '·').toUpperCase();
  return (
    <button
      type="button"
      className={styles.avatar}
      onClick={() => navigate('/profile')}
      aria-label="Профіль"
      title="Профіль"
    >
      {initial}
    </button>
  );
}
