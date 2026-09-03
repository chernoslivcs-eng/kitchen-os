// Пул-6 №8: вхід «кільце замикається». Зліва — шавлієве інтерактивне поле
// (RingField: курсор з'єднує три інгредієнти — кільця замикаються в страву),
// справа — панель входу. Мобайл: поле — статичний кадр-шапка 220px без
// анімації; reduced motion вимикає анімацію і на десктопі.

import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { useAuth } from '../../store/auth';
import { api, ApiError } from '../../api';
import { RingField } from './RingField';
import styles from './SignIn.module.css';

// Кольоровий «G» — офіційна чотириколірна марка Google, обов'язкова для
// кнопок «Sign in with Google» за їхніми брендгайдами.
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

export function Mark({ size = 30, color = '#f2f4f0' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray="104 15" transform="rotate(-58 24 24)" />
      <circle cx="24" cy="24" r="6" fill={color} />
    </svg>
  );
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);
  const requestMagicLink = useAuth((s) => s.requestMagicLink);
  const navigate = useNavigate();
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next');

  useEffect(() => {
    api.auth.providers().then((p) => setGoogleOn(p.google)).catch(() => setGoogleOn(false));
  }, []);

  // Анімація поля — тільки десктоп без reduced motion (бриф: мобайл —
  // статичний кадр). Резайз через межу — рідкість, не відстежуємо.
  const [animateField] = useState(() =>
    typeof window !== 'undefined'
    && window.matchMedia('(min-width: 1024px)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError('Схоже, це не email');
      return;
    }
    setLoading(true);
    try {
      await requestMagicLink(trimmed, next);
      navigate('/sent', { state: { email: trimmed } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Забагато спроб. Спробуй через 15 хвилин.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

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
              Знає, що в тебе відкрите — тому радить це першим.
            </p>
          </div>
          <div className={styles['field-foot']}>◌ ОЧІКУЄ · КУРСОР З'ЄДНУЄ ТРИ — КІЛЬЦЯ ЗАМИКАЮТЬСЯ В СТРАВУ</div>
        </div>
      </div>

      <div className={styles['form-panel']}>
        <div className={styles['form-head']}>
          <span className={styles.mono}>ВХІД · БЕЗ ПАРОЛЯ</span>
          <h2 className={styles['form-title']}>Почнімо з комори</h2>
          <p className={styles['form-sub']}>Лінк прийде на пошту. Один клік — і ти всередині.</p>
        </div>
        <form className={styles.form} onSubmit={submit} noValidate>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Твій email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            required
          />
          <Button type="submit" size="lg" block loading={loading}>
            Надіслати лінк
          </Button>
        </form>
        {googleOn && (
          <>
            <div className={styles.divider}><span>АБО</span></div>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              block
              onClick={() => { window.location.href = '/v1/auth/google'; }}
            >
              <span className={styles['google-btn']}><GoogleMark /> Увійти через Google</span>
            </Button>
          </>
        )}
        <div className={styles['form-foot']}>
          <span>Пароля немає. Лінк діє 15 хвилин, одноразовий.</span>
          <span className={styles['foot-mono']}>V1.0 · ПРАЦЮЄ ОФЛАЙН ПІСЛЯ ВХОДУ</span>
        </div>
      </div>
    </div>
  );
}
