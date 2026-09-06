// Крок Е1: смуги живуть у каркасі, а не в екранах.
//
// Причина та сама, що в панелі артефактів: 401 і 429 приходять із будь-якого
// запиту з будь-якого екрана, і тримати обробку в кожному означало б сорок
// копій. Тут одне місце, яке слухає стор і малює смугу над колонкою.
//
// Ширина — та сама 720, що в композитора й повідомлень (пул-9 це вже
// полагодив). Смуга стоїть НАД колонкою й не зсуває стрічку стрибком: у неї
// власна обгортка, а поява — 220 мс.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerIncidentSink } from '../../api';
import { useIncidentStore } from '../../store/incident';
import { useAuth } from '../../store/auth';
import { Strip } from './Strip';
import { AUTH_STRIP, THROTTLED_STRIP, OFFLINE_STRIP } from './copy';
import styles from './IncidentStrips.module.css';

/** Реєструє стор як приймач подій із api.req. Кличеться раз, у каркасі. */
export function useIncidentSink() {
  useEffect(() => {
    const s = useIncidentStore.getState();
    registerIncidentSink({
      setAuthExpired: s.setAuthExpired,
      setThrottled: s.setThrottled,
      setOffline: s.setOffline,
    });
    // Мережа може повернутись і без запиту — браузер скаже сам.
    const online = () => useIncidentStore.getState().setOffline(false);
    const offline = () => useIncidentStore.getState().setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      registerIncidentSink(null);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
}

export function IncidentStrips() {
  const navigate = useNavigate();
  const authExpired = useIncidentStore((s) => s.authExpired);
  const throttledUntil = useIncidentStore((s) => s.throttledUntil);
  const throttledFor = useIncidentStore((s) => s.throttledFor);
  const offline = useIncidentStore((s) => s.offline);
  const clearThrottled = useIncidentStore((s) => s.clearThrottled);
  const setAuthExpired = useIncidentStore((s) => s.setAuthExpired);

  const throttled = throttledUntil !== null && throttledUntil > Date.now();
  if (!authExpired && !throttled && !offline) return null;

  return (
    <div className={styles.host} data-incident-strips>
      <div className={styles.column}>
        {authExpired && (
          <Strip
            kicker={AUTH_STRIP.kicker}
            h1a={AUTH_STRIP.h1a}
            h1b={AUTH_STRIP.h1b}
            body={AUTH_STRIP.body}
            cta={AUTH_STRIP.cta}
            onCta={() => {
              // Написане в полі вводу не чіпаємо — це головна обіцянка стану.
              // Тому не перезавантаження і не редирект: просто ведемо на вхід.
              setAuthExpired(false);
              void useAuth.getState().logout();
              navigate('/');
            }}
          />
        )}
        {throttled && (
          <Strip
            kicker={THROTTLED_STRIP.kicker}
            h1a={THROTTLED_STRIP.h1a}
            h1b={THROTTLED_STRIP.h1b}
            body={THROTTLED_STRIP.body}
            seconds={throttledFor}
            onDone={clearThrottled}
          />
        )}
        {offline && (
          <Strip
            kicker={OFFLINE_STRIP.kicker}
            h1a={OFFLINE_STRIP.h1a}
            h1b={OFFLINE_STRIP.h1b}
            body={OFFLINE_STRIP.body}
          />
        )}
      </div>
    </div>
  );
}
