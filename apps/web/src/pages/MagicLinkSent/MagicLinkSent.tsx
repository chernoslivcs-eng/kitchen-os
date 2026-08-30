import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Logo } from '../../components/Logo/Logo';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { api } from '../../api';
import styles from './MagicLinkSent.module.css';

interface LinkState { email?: string }

// DA-22: маскування адреси — єдиний спосіб помітити одруківку в email до того,
// як даремно чекати листа. p***@gmail.com, як у хендофі №02.
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user[0]}***@${domain}`;
}

export function MagicLinkSent() {
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state as LinkState | null)?.email ?? null;

  // DA-22: таймер зворотного відліку до повторної відправки. Без нього людина
  // не знає, коли кнопка оживе, і «через 15 хвилин» читається як «іди звідси».
  const [left, setLeft] = useState(60);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft((v) => v - 1), 1000);
    return () => clearInterval(t);
  }, [left > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resend() {
    if (!email || left > 0) return;
    try {
      await api.auth.request(email);
      setResent(true);
      setLeft(60);
    } catch {/* rate-limit тощо — тихо, таймер і так стримує */}
  }

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <Logo size={40} />
          <MonoLabel tone="pending">◌ ЛІНК ЛЕТИТЬ</MonoLabel>
        </div>
        <div className={styles.hero}>
          <h1 className={styles.title}>Перевір пошту</h1>
          {email && <p className={styles.mail}>{maskEmail(email)}</p>}
          <p className={styles.sub}>
            Посилання діє 15 хвилин і працює один раз.
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
          {resent && 'Надіслали ще раз. '}
          НЕ ПРИЙШЛО?{' '}
          {left > 0 ? (
            <span>Надіслати ще раз · {mm}:{ss}</span>
          ) : (
            <button
              onClick={() => void resend()}
              style={{
                background: 'none', border: 0, padding: 0, cursor: 'pointer',
                color: 'var(--accent)', font: 'inherit', textDecoration: 'underline',
              }}
            >
              Надіслати ще раз
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
