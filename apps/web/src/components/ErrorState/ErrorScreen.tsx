// Крок Е1: повний екран, коли щось пішло не так.
//
// Анатомія — та сама, що в наявній 404, і це навмисно: логотип, моно-рядок,
// заголовок, тіло, ОДНА дія. Нової форми для помилок не вигадуємо.
//
// Заголовок — два поля, а не один рядок із крапкою. Це механізм, не оформлення:
// «Комора на місці.» основним кольором, «Цей екран — ні.» приглушеним, перенос
// між ними. Спершу заспокоїли, потім сказали проблему; збережене одним рядком,
// це розсиплеться за першої ж правки чи перекладу.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { track } from '../../lib/track';
import { Button } from '../Button/Button';
import { Logo } from '../Logo/Logo';
import styles from './ErrorScreen.module.css';

export interface ErrorScreenProps {
  /** Моно-рядок ГОВОРИТЬ: «екран здався», не «ПОМИЛКА · 500». Малими — регістр робить CSS. */
  kicker: string;
  /**
   * Код інциденту — хвіст моно-рядка, копіюється кліком. Немає коду — немає
   * чипа: порожній чип гірший за його відсутність.
   */
  code?: string | null;
  h1a: string;
  h1b: string;
  body: string;
  cta: string;
  onCta: () => void;
  /** Те, що стоїть між тілом і дією (поле пошти на «надіслати новий»). */
  children?: ReactNode;
}

const COPIED_MS = 1600;

export function ErrorScreen({ kicker, code, h1a, h1b, body, cta, onCta, children }: ErrorScreenProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Крок О1а: поки Sentry немає, це єдиний слід того, що людина побачила
  // помилку. Кікер, а не текст: він і є ім'я стану.
  useEffect(() => { track('error_shown', { state: kicker }); }, [kicker]);

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
    <div className={styles.screen} data-error-screen>
      <div className={styles.inner}>
        <Logo size={54} />
        <div className={styles.mono}>
          <span data-error-kicker>{kicker}</span>
          {code && (
            <button type="button" className={styles.code} onClick={copy} title="Скопіювати код" data-error-code>
              {copied ? 'скопійовано' : code}
            </button>
          )}
        </div>
        <h1 className={styles.h1}>
          {h1a}
          {/* Другий рядок буває порожній (404 має заголовок в один рядок) —
              тоді ні переносу, ні порожнього спана. */}
          {h1b && <><br /><span className={styles.h1b}>{h1b}</span></>}
        </h1>
        <p className={styles.body}>{body}</p>
        {children}
        <div className={styles.action}>
          {/* positive, не primary: за V7 це «шавлієва заливка — головний
              перехід усередині продукту», і саме ним є «У стрічку» чи
              «Надіслати новий». Чорнильна primary означає незворотну дію або
              вихід із продукту — тут не те й не те. Макет зелений. */}
          <Button variant="positive" onClick={onCta}>{cta}</Button>
        </div>
      </div>
    </div>
  );
}
