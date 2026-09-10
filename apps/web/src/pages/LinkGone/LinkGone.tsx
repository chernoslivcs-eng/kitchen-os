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

/** Пошта з попереднього кроку: SignIn кладе її сюди, щоб не питати вдруге. */
const LAST_EMAIL_KEY = 'kos-last-email';
export const rememberEmail = (email: string) => {
  try { localStorage.setItem(LAST_EMAIL_KEY, email); } catch { /* приватний режим */ }
};
const lastEmail = (): string => {
  try { return localStorage.getItem(LAST_EMAIL_KEY) ?? ''; } catch { return ''; }
};

function LinkGone({ copy }: { copy: ErrorCopy }) {
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
      kicker={copy.kicker}
      h1a={copy.h1a}
      h1b={copy.h1b}
      body={copy.body}
      cta={busy ? 'Надсилаю…' : copy.cta}
      onCta={() => void send()}
    >
      {/* Адресу знаємо з попереднього кроку — підставляємо, а не питаємо вдруге. */}
      <label className={styles.field}>
        <input
          type="email"
          className={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Твій email"
          autoComplete="email"
          data-link-email
        />
      </label>
      {error && <span className={styles.error}>{error}</span>}
    </ErrorScreen>
  );
}

export const LinkExpiredPage = () => <LinkGone copy={LINK_EXPIRED} />;
export const LinkConsumedPage = () => <LinkGone copy={LINK_CONSUMED} />;
