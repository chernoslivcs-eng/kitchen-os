// Етап 10 (Errors E1): повний екран, коли щось пішло не так — за
// «Kitchen OS - Errors.dc.html». Анатомія одна на всі пʼять станів: розірване
// кільце з крапкою роду · кікер · заголовок у два тони · тіло · одна кнопка.
// Код інциденту — лише коли він є (CRASH), лише внизу, лише dim.
//
// Заголовок — два поля, а не один рядок із крапкою. Це механізм, не оформлення:
// «Комора на місці.» чорнилом, «Цей екран — ні.» приглушеним, перенос між
// ними. Спершу заспокоїли, потім сказали проблему; збережене одним рядком, це
// розсиплеться за першої ж правки чи перекладу.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { track, flushNow } from '../../lib/track';
import styles from './ErrorScreen.module.css';

/** Рід крапки в кільці (Errors E1): danger — впав екран; amber — сервер/лінк,
 *  почекати; sage — «все добре» (лінк уже спрацював — не помилка); dim — 404. */
export type ErrorTone = 'danger' | 'amber' | 'sage' | 'dim';

export interface ErrorScreenProps {
  /** Кікер ГОВОРИТЬ: «екран здався», не «ПОМИЛКА · 500». Маленький, muted, без капсу. */
  kicker: string;
  /**
   * Код інциденту — рядок унизу екрана, копіюється кліком. Немає коду — немає
   * рядка: порожній рядок гірший за його відсутність.
   */
  code?: string | null;
  tone?: ErrorTone;
  h1a: string;
  h1b: string;
  body: string;
  cta: string;
  onCta: () => void;
  /** Те, що стоїть між тілом і дією (поле пошти на «надіслати новий»). */
  children?: ReactNode;
}

const COPIED_MS = 1600;

export function ErrorScreen({ kicker, code, tone = 'amber', h1a, h1b, body, cta, onCta, children }: ErrorScreenProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Крок О1а: поки Sentry немає, це єдиний слід того, що людина побачила
  // помилку. Кікер, а не текст: він і є ім'я стану.
  //
  // Крок А2: і одразу зливаємо. Цей екран малює ErrorBoundary, який стоїть НАД
  // каркасом: до моменту, коли ми сюди дійшли, Shell уже розмонтований, його
  // інтервал зупинений, а слухач visibilitychange знятий — чекати наступного
  // тіку немає кому. Тому подія йде в мережу тут, а не за розкладом.
  useEffect(() => {
    track('error_shown', { state: kicker });
    flushNow();
  }, [kicker]);

  function copy() {
    if (!code) return;
    // Буфер може бути недоступний (http, відмова в дозволі) — тоді просто не
    // копіюємо. Казати «скопійовано», коли не скопійовано, не можна.
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div className={styles.screen} data-error-screen data-error-tone={tone}>
      <div className={styles.inner}>
        {/* Розірване кільце з логотипа, розімкнуте більше звичного; крапка несе рід. */}
        <span className={styles.ring} aria-hidden="true"><span className={styles.ringGap} /><span className={`${styles.dot} ${styles[`dot-${tone}`]}`} /></span>
        <div className={styles.text}>
          <span className={styles.kicker} data-error-kicker>{kicker}</span>
          <h1 className={styles.h1}>
            <span>{h1a}</span>
            {/* Другий рядок буває порожній (404 має заголовок в один рядок) — тоді ні спана, ні паузи. */}
            {h1b && <span className={styles.h1b}>{h1b}</span>}
          </h1>
          <p className={styles.body}>{body}</p>
        </div>
        {children}
        <div className={styles.action}>
          {/* Errors E1: одна кнопка, чорнило 44/10 — тіло вже сказало, що робити. */}
          <button type="button" className={styles.cta} onClick={onCta}>{cta}</button>
        </div>
      </div>
      {code && (
        <span className={styles.code}>
          інцидент · <button type="button" className={styles.codeBtn} onClick={copy} title="Скопіювати код" data-error-code>{copied ? 'скопійовано' : code}</button>
        </span>
      )}
    </div>
  );
}
