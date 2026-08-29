// 404 — окремий екран. Vercel rewrite повертає index.html на будь-що, тому
// React Router бере на себе роль «показати щось осмислене». До цього був
// silent Navigate('/'), який приховував помилку.

import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Logo } from '../../components/Logo/Logo';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { useAuth } from '../../store/auth';

export function NotFoundPage() {
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg-body)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 22,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <Logo size={54} />
        <MonoLabel style={{ marginTop: 18, display: 'block' }}>ПОМИЛКА · 404</MonoLabel>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 28,
          marginTop: 12,
          color: 'var(--fg)',
          lineHeight: 1.15,
        }}>
          Такої сторінки нема
        </h1>
        <p style={{
          marginTop: 12,
          color: 'var(--fg-muted)',
          fontSize: 15,
          lineHeight: 1.55,
        }}>
          Можливо, лінк застарів або в адресі описка. Стрічка чекає на тебе.
        </p>
        <div style={{ marginTop: 22 }}>
          <Button onClick={() => navigate(status === 'signed_in' ? '/app' : '/')}>
            ← У стрічку
          </Button>
        </div>
      </div>
    </div>
  );
}
