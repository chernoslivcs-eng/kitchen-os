// Одна логіка входу на дві форми лендингу (картка в hero і фінальний CTA).
// Перенесено з SignIn.tsx без змін у поведінці: валідація, 429, /sent.

import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { ApiError } from '../../api';

export function useMagicLink() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestMagicLink = useAuth((s) => s.requestMagicLink);
  const navigate = useNavigate();
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next');

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

  return { email, setEmail, error, loading, submit };
}
