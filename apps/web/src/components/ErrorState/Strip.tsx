// Крок Е1: смуга зверху колонки.
//
// Дві форми, і різниця між ними — не оформлення, а обіцянка:
//   з дією   — «Треба зайти знову»: людина мусить щось зробити, кнопка праворуч;
//   без дії  — «Забагато за раз»: людина не мусить нічого, замість кнопки тихе
//              «мине саме», а внизу смужка, що стікає до нуля і забирає смугу
//              з собою.
//
// Хрестика немає ніде. Закривати те, що мине саме, означає просити людину
// прибрати за нами.

import { useEffect, useState } from 'react';
import { track } from '../../lib/track';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import styles from './Strip.module.css';

export type StripTone = 'plum' | 'amber' | 'card';

interface Props {
  /** Етап 3: вид ліміту для смуги 429 — лише як позначка в розмітці. */
  kind?: string;
  /**
   * Етап 5 (п.7), Errors E2 — рід кольором: plum — треба дія людини (увійти,
   * повторити); amber — почекати (429, денний ліміт); card — офлайн, нічого не
   * робити. Знак зліва — з бандла: log-in · hourglass · wifi-off.
   */
  tone?: StripTone;
  icon?: IconName;
  kicker: string;
  h1a: string;
  h1b: string;
  body: string;
  /** Є дія — кнопка; немає — «мине саме» і смужка. */
  cta?: string;
  onCta?: () => void;
  /**
   * Скільки секунд лишилось. Береться з `Retry-After` рейт-лімітера, не з
   * константи: смужка, що доїхала до нуля раніше за ліміт, — це збрехати.
   */
  seconds?: number;
  onDone?: () => void;
}

export function Strip({ kicker, h1a, h1b, body, cta, onCta, seconds, onDone, kind, tone = 'card', icon }: Props) {
  const timed = !cta && typeof seconds === 'number' && seconds > 0;
  // Смуга — теж показана помилка, і без неї стрічка дня була б неповною.
  //
  // Крок А2: негайного зливу тут свідомо НЕМАЄ, на відміну від ErrorScreen.
  // Правило одне й те саме — «зливай там, де черга може не пережити наступний
  // тік», — і різні наслідки в нього тому, що ситуації різні. На екрані
  // падіння каркас уже мертвий і зливати нікому. Тут каркас живий, інтервал
  // працює, і подія доїде за десять секунд сама. А стани, які показує ця
  // смуга, — це 401, 429 і ЗНИКЛА МЕРЕЖА: гнати запит саме в ту мить означало б
  // додати звернень рівно тоді, коли мережа вже не працює, і нічого цим не
  // виграти.
  useEffect(() => { track('error_shown', { state: kicker }); }, [kicker]);
  const [left, setLeft] = useState(seconds ?? 0);

  useEffect(() => {
    if (!timed) return;
    setLeft(seconds!);
    const started = Date.now();
    const id = window.setInterval(() => {
      const rest = seconds! - (Date.now() - started) / 1000;
      if (rest <= 0) {
        window.clearInterval(id);
        setLeft(0);
        onDone?.();
        return;
      }
      setLeft(rest);
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, seconds]);

  return (
    <div className={`${styles.strip} ${styles[`tone-${tone}`]}`} data-strip role="status" data-strip-kind={kind} data-strip-tone={tone}>
      {icon && <span className={styles.icon}><Icon name={icon} size={16} inherit decorative /></span>}
      <div className={styles.text}>
        <div className={styles.mono}>
          <span>{kicker}</span>
        </div>
        <span className={styles.title}>
          {h1a} <span className={styles.h1b}>{h1b}</span>
        </span>
        <span className={styles.body}>{body}</span>
      </div>
      {cta
        ? <div className={styles.action}><Button variant="secondary" onClick={onCta}>{cta}</Button></div>
        : <span className={styles.passes} data-strip-passes>мине саме</span>}
      {timed && (
        <span
          className={styles.drain}
          data-strip-drain
          // Частка, а не css-анімація з фіксованою тривалістю: смужка мусить
          // показувати РЕАЛЬНИЙ залишок, і після перемонтування теж.
          style={{ transform: `scaleX(${Math.max(0, left / seconds!)})` }}
        />
      )}
    </div>
  );
}
