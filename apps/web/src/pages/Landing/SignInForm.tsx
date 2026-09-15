// Вхід на лендінгу (Landing Live: hero і фінал). Google першим — підтверджене
// відхилення (HANDOFF «Аудит 10.09»); логіка — useMagicLink і
// GET /v1/auth/providers без змін, змінено лише вигляд. Кнопка Google і
// роздільник з'являються тоді, коли провайдер увімкнено на сервері.
//
// Telegram (TELEGRAM-AUTH-PAY-PLAN-0915; хотфікс 15.09 — ЗАМІНА Login
// Widget): на десктопі офіційний віджет мовчав («Запит на вхід» не
// приходив), на мобайлі popup мовчки блокувався iOS Safari. Замість підпису
// від віджета — вхід через самого бота:
//   клік → POST /v1/auth/telegram/begin (challenge без user_id) → відкриваємо
//   t.me/<bot>?start=login_<token> → людина тисне Start у застосунку → бот
//   дописує user_id у challenge → лендинг, поки чекає, опитує
//   GET /v1/auth/telegram/poll раз на 2 с → 'ok' ставить cookie-сесію й веде
//   на /app.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Icon } from '../../components/Icon/Icon';
import { useMagicLink } from './useMagicLink';
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

// Дотик/вузький екран: t.me відкриваємо в поточній вкладці (deep-link у
// застосунок Telegram перехоплює навігацію без реального переходу). Десктоп
// — нова вкладка, щоб лендинг лишався живим і продовжував опитувати poll.
function isTouchOrNarrow(): boolean {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || window.innerWidth < 768;
}

function openTelegram(url: string): void {
  if (isTouchOrNarrow()) { window.location.href = url; return; }
  const win = window.open(url, '_blank', 'noopener');
  if (!win) window.location.href = url; // блокувальник попапів — та сама вкладка
}

const TELEGRAM_POLL_MS = 2_000;

interface Props {
  id?: string;
  /** Роздільник «або лінк на пошту»: у hero всюди; у фіналі — лише на 1920 (кадри 1024/390 його не мають). */
  or?: boolean;
  className?: string;
}

export function SignInForm({ id, or = true, className }: Props) {
  const { email, setEmail, error, loading, submit } = useMagicLink();
  const [googleOn, setGoogleOn] = useState(false);
  const [telegramOn, setTelegramOn] = useState(false);
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgUrl, setTgUrl] = useState<string | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    api.auth.providers()
      .then((p) => { setGoogleOn(p.google); setTelegramOn(p.telegram); })
      .catch(() => { setGoogleOn(false); setTelegramOn(false); });
  }, []);

  useEffect(() => () => { if (pollTimer.current) window.clearInterval(pollTimer.current); }, []);

  function stopPolling() {
    if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  async function telegramLogin() {
    if (!telegramOn || tgWaiting) return;
    setTgError(null);
    try {
      const { token, url } = await api.auth.telegramBegin();
      setTgUrl(url);
      setTgWaiting(true);
      openTelegram(url);
      pollTimer.current = window.setInterval(() => {
        void api.auth.telegramPoll(token).then((res) => {
          if (res.status === 'ok') {
            stopPolling();
            window.location.href = '/app';
          } else if (res.status === 'expired') {
            stopPolling();
            setTgWaiting(false);
            setTgUrl(null);
            setTgError(SIGNIN.telegramExpired);
          }
          // 'pending' — просто чекаємо далі, наступний тик.
        }).catch(() => { /* транзитний збій мережі — спробуємо на наступному тику */ });
      }, TELEGRAM_POLL_MS);
    } catch {
      setTgError(SIGNIN.telegramError);
    }
  }

  const anyProviderOn = googleOn || telegramOn;
  return (
    <div id={id} className={`${styles.signin} ${className ?? ''}`}>
      {googleOn && (
        <button type="button" className={styles.google} onClick={() => { window.location.href = '/v1/auth/google'; }}>
          <GoogleMark />{SIGNIN.google}
        </button>
      )}
      {telegramOn && !tgWaiting && (
        <button type="button" className={styles.google} onClick={() => void telegramLogin()}>
          <TelegramMark />{SIGNIN.telegram}
        </button>
      )}
      {tgWaiting && (
        <>
          <span className={styles.note}>{SIGNIN.telegramWaitTitle}</span>
          {tgUrl && (
            <a className={styles.tgRetry} href={tgUrl} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openTelegram(tgUrl); }}>
              {SIGNIN.telegramRetry}
            </a>
          )}
        </>
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
