// Одна логіка входу на дві форми лендингу (картка в hero і фінальний CTA).
// Валідація, 429, пошта запамʼятовується для LinkGone (kos-last-email).
//
// Бриф 24.09 (Sign-in Compact §2.6): підтвердження — інлайн у самій картці
// (зелена пігулка «Лист на … надіслано» на місці поля), не перехід на /sent.
// Сторінка /sent і її маршрут лишаються — на них ведуть інші входи (лінк із
// листа після невдалої спроби тощо), просто ЦЯ форма більше туди не штовхає.

import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { ApiError, type AuthMode } from '../../api';
import { rememberEmail } from '../LinkGone/LinkGone';
import { SIGNIN } from './copy';

/** AUTH-BRIEF-0915: mode — «Реєстрація» (типово) шле лист і для невідомої пошти;
 * «Вхід» на невідому пошту отримує {error:'no_account'} замість листа —
 * noAccount піднімає це в SignInForm для рядка-note замість підтвердження. */
export function useMagicLink(mode: AuthMode = 'start') {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  // Адреса, на яку лист щойно пішов — null, поки не надіслано. Тримає саме
  // адресу (не boolean): «Ще раз» на підтвердженні шле на неї ж, без нового вводу.
  const [sent, setSent] = useState<string | null>(null);
  const requestMagicLink = useAuth((s) => s.requestMagicLink);
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next');

  async function send(trimmed: string) {
    setError(null);
    setNoAccount(false);
    setLoading(true);
    try {
      const result = await requestMagicLink(trimmed, next, mode);
      if ('error' in result) { setNoAccount(true); return; }
      rememberEmail(trimmed);
      setSent(trimmed);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Забагато спроб. Спробуй через 15 хвилин.');
      } else {
        // Бриф §2.6: людині не потрібна причина збою поштового провайдера
        // (сирий err.message), лише що робити далі.
        setError(SIGNIN.sendFailed);
      }
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError('Схоже, це не email');
      return;
    }
    await send(trimmed);
  }

  async function resend() {
    if (sent) await send(sent);
  }

  return { email, setEmail, error, noAccount, loading, sent, submit, resend };
}
