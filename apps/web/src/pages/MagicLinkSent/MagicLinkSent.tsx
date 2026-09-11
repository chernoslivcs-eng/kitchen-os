// «Перевір пошту» — сторінка лендінгу, не окремий застосунок (Auth.dc.html,
// пакет C3): каркас AuthShell, замість форми — той самий email-піл, але вже
// «відправлений»: mail-check шавлією, маска адреси, «Змінити» на місці кнопки,
// таймер повтору — в реченні під ним. Поведінка (маска, 60 с, повтор) — як була.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Icon } from '../../components/Icon/Icon';
import { lastEmail } from '../LinkGone/LinkGone';
import { AuthShell } from '../Auth/AuthShell';
import styles from '../Auth/Auth.module.css';

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
  // Пошта — зі стану переходу; без нього (перезавантаження, прямий захід) — з
  // тієї ж комірки, куди її кладе useMagicLink для LinkGone.
  const email = (location.state as LinkState | null)?.email ?? (lastEmail() || null);

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
    <AuthShell tone="sage" kickIcon="auth.sent" kick="Лінк летить" h1a="Перевір пошту." h1b="Один клік — і ти всередині."
      sub="Посилання діє 15 хвилин і працює один раз." foot="Пароля немає. Лінк одноразовий.">
      <div className={styles.sentPill}>
        <span className={styles.sentIcon}><Icon name="auth.delivered" size={20} inherit decorative /></span>
        <span className={styles.sentText}>
          {email && <span className={styles.sentMail}>{maskEmail(email)}</span>}
          <span className={styles.sentNote}>лист летить<span className={styles.deskOnly}> · відкрий на цьому пристрої</span></span>
        </span>
        <button type="button" className={styles.change} onClick={() => navigate('/', { replace: true })}>Змінити</button>
      </div>
      <span className={styles.resend}>
        {resent && 'Надіслали ще раз. '}
        Лист не прийшов?{' '}
        {left > 0
          ? <span className={styles.resendWait}>Надіслати ще раз · {mm}:{ss}</span>
          : <button type="button" className={styles.resendBtn} onClick={() => void resend()}>Надіслати ще раз</button>}
      </span>
    </AuthShell>
  );
}
