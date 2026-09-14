// Вхід на лендінгу (Landing Live: hero і фінал). Google першим — підтверджене
// відхилення (HANDOFF «Аудит 10.09»); логіка — useMagicLink і
// GET /v1/auth/providers без змін, змінено лише вигляд. Кнопка Google і
// роздільник з'являються тоді, коли провайдер увімкнено на сервері.
//
// PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915): поруч із Google — «Продовжити з
// Telegram», тим самим рядом і стилем, теж лише коли провайдер увімкнено
// (є TELEGRAM_BOT_TOKEN на сервері). Офіційний віджет не вбудовується як
// видима кнопка — telegram-widget.ts тягне лише скрипт заради
// Telegram.Login.auth(...), кнопка тут своя.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Icon } from '../../components/Icon/Icon';
import { useMagicLink } from './useMagicLink';
import { telegramLoginAuth } from './telegram-widget';
import { SIGNIN } from './copy';
import styles from './Landing.module.css';

// Кольоровий «G» — офіційна чотириколірна марка Google (брендгайд).
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// Офіційний знак Telegram — паперовий літак у колі, фірмовий блакитний.
function TelegramMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#29A9EB" />
      <path fill="#fff" d="M35.6 14.2 30.9 35.9c-.35 1.57-1.28 1.96-2.6 1.22l-7.2-5.31-3.47 3.34c-.38.38-.71.71-1.45.71l.52-7.35L29.8 17.2c.63-.56-.14-.87-.98-.31L14.2 26.4l-7.1-2.22c-1.54-.48-1.57-1.54.32-2.28L33.7 12c1.28-.48 2.4.31 1.9 2.2z" />
    </svg>
  );
}

interface Props {
  id?: string;
  /** Роздільник «або лінк на пошту»: у hero всюди; у фіналі — лише на 1920 (кадри 1024/390 його не мають). */
  or?: boolean;
  className?: string;
}

export function SignInForm({ id, or = true, className }: Props) {
  const { email, setEmail, error, loading, submit } = useMagicLink();
  const [googleOn, setGoogleOn] = useState(false);
  const [telegramBotId, setTelegramBotId] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);
  useEffect(() => {
    api.auth.providers()
      .then((p) => { setGoogleOn(p.google); setTelegramBotId(p.telegram ? p.telegramBotId : null); })
      .catch(() => { setGoogleOn(false); setTelegramBotId(null); });
  }, []);
  async function telegramLogin() {
    if (!telegramBotId || tgBusy) return;
    setTgBusy(true);
    setTgError(null);
    try {
      const user = await telegramLoginAuth(telegramBotId);
      if (!user) { setTgBusy(false); return; } // людина закрила вікно — не помилка
      const { next } = await api.auth.telegramWidget(user);
      window.location.href = next;
    } catch {
      setTgError(SIGNIN.telegramError);
      setTgBusy(false);
    }
  }
  const anyProviderOn = googleOn || !!telegramBotId;
  return (
    <div id={id} className={`${styles.signin} ${className ?? ''}`}>
      {googleOn && (
        <button type="button" className={styles.google} onClick={() => { window.location.href = '/v1/auth/google'; }}>
          <GoogleMark />{SIGNIN.google}
        </button>
      )}
      {telegramBotId && (
        <button type="button" className={styles.google} onClick={() => void telegramLogin()} disabled={tgBusy}>
          <TelegramMark />{tgBusy ? SIGNIN.telegramBusy : SIGNIN.telegram}
        </button>
      )}
      {tgError && <div className={styles.formError} role="alert">{tgError}</div>}
      {anyProviderOn && or && <div className={styles.or}><span />{SIGNIN.or}<span /></div>}
      <form className={styles.pill} onSubmit={submit} noValidate>
        <input
          type="email" inputMode="email" autoComplete="email" enterKeyHint="go" placeholder={SIGNIN.email} required
          value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email"
        />
        <button type="submit" className={styles.pillBtn} disabled={loading} aria-label={SIGNIN.send}>
          <span className={styles.pillBtnText}>{loading ? SIGNIN.sending : SIGNIN.send}</span>
          {/* 390: кнопка колом зі знаком «Надіслати» (бандл малює arrow-right; у словнику «надіслати» — sys.send, Р41). */}
          <span className={styles.pillBtnIcon}><Icon name="sys.send" size={16} inherit decorative /></span>
        </button>
      </form>
      {error && <div className={styles.formError} role="alert">{error}</div>}
      <span className={styles.note}>{SIGNIN.note}</span>
    </div>
  );
}
