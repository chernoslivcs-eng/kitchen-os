// 404 — окремий екран. Vercel rewrite повертає index.html на будь-що, тому
// React Router бере на себе роль «показати щось осмислене». До цього був
// silent Navigate('/'), який приховував помилку.
//
// Крок Е1: анатомія переїхала в спільний ErrorScreen, тіло копі лишилось
// дослівно. Змінився тільки моно-рядок: «ПОМИЛКА · 404» був службовим
// підписом, «тут нічого не готують» говорить тим самим голосом, що решта
// продукту. Етап 10 (Errors E1): коду немає — він лише на CRASH; крапка в кільці dim.

import { useNavigate } from 'react-router-dom';
import { ErrorScreen } from '../../components/ErrorState/ErrorScreen';
import { NOT_FOUND } from '../../components/ErrorState/copy';
import { useAuth } from '../../store/auth';

export function NotFoundPage() {
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  return (
    <ErrorScreen
      kicker={NOT_FOUND.kicker}
      tone="dim"
      h1a={NOT_FOUND.h1a}
      h1b={NOT_FOUND.h1b}
      body={NOT_FOUND.body}
      cta={NOT_FOUND.cta}
      onCta={() => navigate(status === 'signed_in' ? '/app' : '/')}
    />
  );
}
