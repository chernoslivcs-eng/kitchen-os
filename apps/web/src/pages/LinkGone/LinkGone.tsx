// Крок Е1: два екрани на 410 з /v1/auth/verify.
//
// Розділені навмисно. «Лінк застарів» — це справді промах, і людина мусить
// попросити новий. «Лінк уже спрацював» — узагалі не помилка: так і задумано,
// і текст цього не приховує. Один екран на обидва випадки змусив би другий
// вибачатись за те, що все правильно.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorScreen } from '../../components/ErrorState/ErrorScreen';
import { LINK_EXPIRED, LINK_CONSUMED, type ErrorCopy } from '../../components/ErrorState/copy';
import { useAuth } from '../../store/auth';
import styles from './LinkGone.module.css';
import { useLightOnly } from '../../lib/useLightOnly';

/** Пошта з попереднього кроку: useMagicLink (лендінг) кладе її сюди, щоб не питати вдруге; /sent читає її ж після перезавантаження. */
const LAST_EMAIL_KEY = 'kos-last-email';
export const rememberEmail = (email: string) => {
  try { localStorage.setItem(LAST_EMAIL_KEY, email); } catch { /* приватний режим */ }
};
export const lastEmail = (): string => {
  try { return localStorage.getItem(LAST_EMAIL_KEY) ?? ''; } catch { return ''; }
};

function LinkGone({ copy, tone }: { copy: ErrorCopy; tone: 'amber' | 'sage' }) {
  // №2: недійсний лінк — екран поза входом, світлий, як лендінг і /sent.
  useLightOnly();
  const navigate = useNavigate();
  const [email, setEmail] = useState(lastEmail);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await useAuth.getState().requestMagicLink(email.trim());
      rememberEmail(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <ErrorScreen
        tone="sage"
        kicker="лист пішов"
        h1a="Новий лінк у дорозі."
        h1b="Він теж живе 15 хвилин."
        body={`Надіслав на ${email.trim()}. Якщо не видно — зазирни в теку зі спамом.`}
        cta="На головну"
        onCta={() => navigate('/')}
      />
    );
  }

  return (
    <ErrorScreen
      tone={tone}
      kicker={copy.kicker}
      h1a={copy.h1a}
      h1b={copy.h1b}
      body={copy.body}
      cta={busy ? 'Надсилаю…' : copy.cta}
      onCta={() => void send()}
    >
      {/* Адресу знаємо з попереднього кроку — підставляємо, а не питаємо вдруге.
          Поле у <form> (FIXES-V3 №1): Enter у полі надсилає лінк так само, як
          кнопка знизу — одне поле без кнопки submit усередині, тож неявна
          відправка форми за Enter працює за специфікацією. */}
      <form className={styles.field} onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate data-link-form>
        <input
          type="email"
          inputMode="email"
          className={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Твій email"
          autoComplete="email"
          aria-label="Email"
          data-link-email
        />
      </form>
      {error && <span className={styles.error}>{error}</span>}
    </ErrorScreen>
  );
}

export const LinkExpiredPage = () => <LinkGone copy={LINK_EXPIRED} tone="amber" />;
export const LinkConsumedPage = () => <LinkGone copy={LINK_CONSUMED} tone="sage" />;
