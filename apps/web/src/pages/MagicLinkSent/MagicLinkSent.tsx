import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Logo } from '../../components/Logo/Logo';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import styles from './MagicLinkSent.module.css';

interface LinkState { email?: string }

export function MagicLinkSent() {
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state as LinkState | null)?.email ?? null;

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <Logo size={40} />
          <MonoLabel tone="pending">◌ ЛІНК ЛЕТИТЬ</MonoLabel>
        </div>
        <div className={styles.hero}>
          <h1 className={styles.title}>Перевір пошту</h1>
          {email && <p className={styles.mail}>{email}</p>}
          <p className={styles.sub}>
            Ми надіслали одноразовий лінк. Клік по ньому відкриє Кухню — паролів немає.
            Лінк діє 15 хвилин.
          </p>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="lg"
              block
              onClick={() => navigate('/', { replace: true })}
            >
              Змінити email
            </Button>
          </div>
        </div>
        <p className={styles.foot}>
          Лист не приходить? Перевір «Промоакції» або спам. Можна повторити через 15 хвилин.
        </p>
      </div>
    </div>
  );
}
