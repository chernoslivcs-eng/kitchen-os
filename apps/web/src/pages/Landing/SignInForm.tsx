// Вхід на лендінгу (Landing Live: hero і фінал). Google першим — підтверджене
// відхилення (HANDOFF «Аудит 10.09»); логіка — useMagicLink і
// GET /v1/auth/providers без змін, змінено лише вигляд. Кнопка Google і
// зʼявляється тоді, коли провайдер увімкнено на сервері.
//
// AUTH-BRIEF-0915: той самий блок — два режими, перемикач-пілюля зверху,
// без переходу на сторінку/модалку (у продукті їх немає ніде). «Вхід»
// (типово, якщо в браузері вже була сесія — lib/session-flag) — ті самі три
// способи; невідомий ключ → рядок-note замість помилки, «Зареєструватись»
// перемикає режим. mode:'start'|'login' летить у сервер на всіх трьох
// способах (ключі контракту лишаються start/login — на екрані лише текст
// інший).
//
// Бриф 24.09 (Sign-in Compact — виміряно: поле пошти видно без прокрутки на
// 1440×900, 1280×800, 390×664, і з відкритою клавіатурою ≈390×350):
//   · тариф і перелік «як заходитимеш» прибрано з режиму «Реєстрація» — вибір
//     тарифу переїхав у профіль → «Підписка» (сам перелік способів видно
//     з кнопок, підпис над ними зайвий);
//   · роздільник «або лінк на пошту» прибрано;
//   · три способи однакової висоти стовпчиком; підказка в полі коротшає на
//     вузькій ширині (<480), бо повний текст обрізається кнопкою;
//   · підтвердження надсилання — інлайн у картці (зелена пігулка на місці
//     поля), не перехід на /sent (useMagicLink.ts);
//   · рядок згоди — в обох режимах тепер, дрібніше.
//
// Telegram (TELEGRAM-AUTH-PAY-PLAN-0915; хотфікс 15.09 — ЗАМІНА Login
// Widget): на десктопі офіційний віджет мовчав («Запит на вхід» не
// приходив), на мобайлі popup мовчки блокувався iOS Safari. Замість підпису
// від віджета — вхід через самого бота:
//   клік → POST /v1/auth/telegram/begin (challenge без user_id) → відкриваємо
//   t.me/<bot>?start=login_<token> → людина тисне Start у застосунку → бот
//   дописує user_id у challenge (mode 'login' + невідомий telegram_id —
//   відмовляється, AUTH-BRIEF-0915) → лендинг, поки чекає, опитує
//   GET /v1/auth/telegram/poll раз на 2 с → 'ok' ставить cookie-сесію й веде
//   на /app.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, type AuthMode } from '../../api';
import { Icon } from '../../components/Icon/Icon';
import { useMagicLink } from './useMagicLink';
import { SIGNIN, AUTH_MODE } from './copy';
import { hadSession } from '../../lib/session-flag';
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

// Бриф §2.4: підказка в полі коротшає на компактній ширині — повний текст
// обрізається кнопкою «Надіслати лінк» (перевірено programmatично:
// scrollWidth > clientWidth в усіх мобільних кадрах макета).
const COMPACT_QUERY = '(max-width: 479px)';
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}
function useCompact(): boolean {
  const [compact, setCompact] = useState(() => hasMatchMedia() && window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const q = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return compact;
}

// AUTH-BRIEF-0915: Google-колбек (mode:'login' + невідома пошта) веде назад
// на лендинг із ?err=no_account&via=google — читаємо раз (SignInForm
// монтується двічі, hero й фінал) і прибираємо з адреси, той самий патерн,
// що був у Р159 для редирект-гілки Telegram.
let googleNoAccountConsumed = false;
function consumeGoogleNoAccountError(): boolean {
  if (googleNoAccountConsumed) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('err') !== 'no_account' || params.get('via') !== 'google') return false;
  googleNoAccountConsumed = true;
  params.delete('err');
  params.delete('via');
  const qs = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  return true;
}

interface Props {
  id?: string;
  className?: string;
}

type UnknownMethod = 'telegram' | 'email' | 'google' | null;

export function SignInForm({ id, className }: Props) {
  // Дефолт: «Реєстрація» для нових людей; «Вхід», якщо цей браузер уже мав
  // тут сесію (kos-had-session, ставить store/auth.ts на успішному refresh()).
  const [mode, setMode] = useState<AuthMode>(() => (hadSession() ? 'login' : 'start'));
  const { email, setEmail, error, noAccount: emailNoAccount, loading, sent, submit, resend } = useMagicLink(mode);
  const [googleOn, setGoogleOn] = useState(false);
  const [telegramOn, setTelegramOn] = useState(false);
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgUrl, setTgUrl] = useState<string | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const [tgNoAccount, setTgNoAccount] = useState(false);
  const [googleNoAccount, setGoogleNoAccount] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const location = useLocation();
  const compact = useCompact();

  useEffect(() => {
    api.auth.providers()
      .then((p) => { setGoogleOn(p.google); setTelegramOn(p.telegram); })
      .catch(() => { setGoogleOn(false); setTelegramOn(false); });
  }, []);

  useEffect(() => {
    if (consumeGoogleNoAccountError()) { setMode('login'); setGoogleNoAccount(true); }
  }, []);

  useEffect(() => () => { if (pollTimer.current) window.clearInterval(pollTimer.current); }, []);

  function stopPolling() {
    if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  // «Зареєструватись» (у рядку невідомого ключа) — той самий перемикач, що
  // пілюля зверху, лише ще й гасить усі три note-стани заразом.
  function switchMode(next: AuthMode) {
    setMode(next);
    setTgNoAccount(false);
    setGoogleNoAccount(false);
    setTgError(null);
  }

  async function telegramLogin() {
    if (!telegramOn || tgWaiting) return;
    setTgError(null);
    setTgNoAccount(false);
    try {
      const { token, url } = await api.auth.telegramBegin(mode);
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
          } else if (res.status === 'no_account') {
            stopPolling();
            setTgWaiting(false);
            setTgUrl(null);
            setTgNoAccount(true);
          }
          // 'pending' — просто чекаємо далі, наступний тик.
        }).catch(() => { /* транзитний збій мережі — спробуємо на наступному тику */ });
      }, TELEGRAM_POLL_MS);
    } catch {
      setTgError(SIGNIN.telegramError);
    }
  }

  // У режимі «Вхід» — не більше однієї note одночасно; перемикач мод
  // (switchMode) гасить усі три разом, тому тут просто пріоритет показу.
  const unknownMethod: UnknownMethod = mode === 'login'
    ? (tgNoAccount ? 'telegram' : emailNoAccount ? 'email' : googleNoAccount ? 'google' : null)
    : null;

  return (
    <div id={id} className={`${styles.signin} ${className ?? ''}`}>
      <div className={styles.authSwitch} role="tablist" aria-label="Реєстрація або вхід">
        <button
          type="button" role="tab" aria-selected={mode === 'start'}
          className={`${styles.authSeg} ${mode === 'start' ? styles.authSegOn : ''}`}
          onClick={() => switchMode('start')}
        >
          {AUTH_MODE.start}
        </button>
        <button
          type="button" role="tab" aria-selected={mode === 'login'}
          className={`${styles.authSeg} ${mode === 'login' ? styles.authSegOn : ''}`}
          onClick={() => switchMode('login')}
        >
          {AUTH_MODE.login}
        </button>
      </div>

      {googleOn && (
        <button type="button" className={styles.google} onClick={() => { window.location.href = api.auth.googleUrl(mode); }}>
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

      {/* Бриф §2.6: «надіслано» — зелена пігулка на місці поля, не окрема сторінка. */}
      {sent ? (
        <div className={styles.sentPill}>
          <span className={styles.sentText}>
            <span className={styles.sentTitle}>{SIGNIN.sentTo(sent)}</span>
            <span className={styles.sentSub}>{SIGNIN.sentHint}</span>
          </span>
          <button type="button" className={styles.sentRetry} onClick={() => void resend()}>{SIGNIN.retry}</button>
        </div>
      ) : (
        <form className={`${styles.pill} ${error ? styles.pillError : ''}`} onSubmit={submit} noValidate>
          <input
            type="email" inputMode="email" autoComplete="email" enterKeyHint="go" placeholder={compact ? SIGNIN.emailShort : SIGNIN.emailFull} required
            value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email"
          />
          <button type="submit" className={styles.pillBtn} disabled={loading} aria-label={error ? SIGNIN.retry : SIGNIN.send}>
            <span className={styles.pillBtnText}>{loading ? SIGNIN.sending : error ? SIGNIN.retry : SIGNIN.send}</span>
            {/* 390: кнопка колом зі знаком «Надіслати» (бандл малює arrow-right; у словнику «надіслати» — sys.send, Р41). */}
            <span className={styles.pillBtnIcon}><Icon name="sys.send" size={16} inherit decorative /></span>
          </button>
        </form>
      )}
      {error && <div className={styles.formError} role="alert">{error}</div>}

      <span className={styles.note}>{mode === 'start' ? AUTH_MODE.noteStart : AUTH_MODE.noteLogin}</span>
      {unknownMethod && (
        <div className={styles.authNote} role="alert">
          {AUTH_MODE.unknownKey[unknownMethod]}{' '}
          <button type="button" className={styles.authNoteAction} onClick={() => switchMode('start')}>{AUTH_MODE.startNew}</button>{' '}
          {AUTH_MODE.unknownKeySuffix}
        </div>
      )}
      <span className={styles.consent}>
        {AUTH_MODE.consentBefore}{' '}
        <Link to="/terms" state={{ background: location }} className={styles.consentLink}>{AUTH_MODE.consentTerms}</Link>
        {' '}{AUTH_MODE.consentMiddle}{' '}
        <Link to="/privacy" state={{ background: location }} className={styles.consentLink}>{AUTH_MODE.consentPrivacy}</Link>.
      </span>
    </div>
  );
}
