import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { api } from '../../api';
import { RingField } from '../SignIn/RingField';
import { Mark } from '../SignIn/SignIn';
import styles from '../SignIn/SignIn.module.css';
import own from './MagicLinkSent.module.css';

interface LinkState { email?: string }

// DA-22: маскування адреси — єдиний спосіб помітити одруківку в email до того,
// як даремно чекати листа. p***@gmail.com, як у хендофі №02.
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user[0]}***@${domain}`;
}

// Пул-8: верстка — канон входу «кільце замикається» (як /invite). Стара
// власна колонка розсипалась після редизайну пул-6 №8.
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

  const [animateField] = useState(() =>
    typeof window !== 'undefined'
    && window.matchMedia('(min-width: 1024px)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  return (
    <div className={styles.screen}>
      <div className={styles['field-panel']}>
        <RingField animate={animateField} />
        <div className={styles['field-shade']} />
        <div className={styles['field-content']}>
          <div className={styles['field-logo']}>
            <Mark />
            <span>Kitchen OS</span>
          </div>
          <div className={styles['field-hero']}>
            <h1 className={styles['field-title']}>Не «що б поїсти».<br />А «що приготувати з того, що є».</h1>
            <p className={styles['field-sub']}>
              Вона бачить твою комору і збирає вечерю з того, що є — і того, що скоро зіпсується.
            </p>
          </div>
          <div className={styles['field-foot']}>◌ ОЧІКУЄ · КУРСОР З'ЄДНУЄ ТРИ — КІЛЬЦЯ ЗАМИКАЮТЬСЯ В СТРАВУ</div>
        </div>
      </div>

      <div className={styles['form-panel']}>
        <div className={styles['form-head']}>
          <span className={styles.mono}>◌ ЛІНК ЛЕТИТЬ</span>
          <h2 className={styles['form-title']}>Перевір пошту</h2>
          {email && <p className={own.mail}>{maskEmail(email)}</p>}
          <p className={styles['form-sub']}>Посилання діє 15 хвилин і працює один раз.</p>
        </div>
        <div className={styles.form}>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => navigate('/', { replace: true })}
          >
            Змінити email
          </Button>
        </div>
        <div className={styles['form-foot']}>
          <span>
            {resent && 'Надіслали ще раз. '}
            Не прийшло?{' '}
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
          </span>
        </div>
      </div>
    </div>
  );
}
