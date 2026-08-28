import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Logo } from '../../components/Logo/Logo';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { useAuth } from '../../store/auth';
import { ApiError } from '../../api';
import styles from './SignIn.module.css';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestMagicLink = useAuth((s) => s.requestMagicLink);
  const navigate = useNavigate();

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
      await requestMagicLink(trimmed);
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

  const content = (
    <>
      <div className={styles.head}>
        <Logo size={40} />
        <MonoLabel className={styles.mono}>Kitchen OS · вхід</MonoLabel>
      </div>
      <div className={styles.hero}>
        <h1 className={styles.title}>Кухня, що памʼятає, що в тебе є</h1>
        <p className={styles.sub}>
          Кажеш, що купив — вона веде комору, рятує продукти від псування й пропонує, що приготувати.
        </p>
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
      </div>
      <p className={styles.foot}>Пароля немає. Лінк діє 15 хвилин, одноразовий.</p>
    </>
  );

  // На десктопі — панель у центрі; на мобайлі — вертикальний стек на екран
  // (.panel має display:contents, тож flex-ланцюг проходить наскрізь).
  return (
    <div className={styles.screen}>
      <div className={styles.panel}>{content}</div>
    </div>
  );
}
