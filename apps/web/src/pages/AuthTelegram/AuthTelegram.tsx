// Хотфікс (15.09, PR 2-веб, прод): на дотикових екранах Telegram Login Widget
// не відкриває popup (SignInForm.tsx/telegram-widget.ts — isTouchOrNarrow),
// а редиректить прямо на oauth.telegram.org з return_to сюди. Telegram
// повертає ті самі поля, що й popup-колбек (id, first_name, …, hash), але в
// query замість аргументу функції — читаємо їх і б'ємо в той самий
// POST /v1/auth/telegram/widget. Маршрут без сесії: людина ще не увійшла.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useLightOnly } from '../../lib/useLightOnly';

export function AuthTelegramPage() {
  useLightOnly();
  const navigate = useNavigate();
  const location = useLocation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(location.search);
    const id = Number(params.get('id'));
    const first_name = params.get('first_name');
    const auth_date = Number(params.get('auth_date'));
    const hash = params.get('hash');
    if (!id || !first_name || !auth_date || !hash) {
      void navigate('/?tgError=1', { replace: true });
      return;
    }
    void api.auth.telegramWidget({
      id,
      first_name,
      last_name: params.get('last_name') ?? undefined,
      username: params.get('username') ?? undefined,
      photo_url: params.get('photo_url') ?? undefined,
      auth_date,
      hash,
    })
      .then(({ next }) => { window.location.href = next; })
      .catch(() => void navigate('/?tgError=1', { replace: true }));
  }, [navigate, location.search]);

  // Той самий тихий каркас, що RequireAuth/Suspense — переходить у /app за
  // мілісекунди, окремий екран під нього не потрібен.
  return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />;
}
