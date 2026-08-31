// Моушн-кіт §03: лічильник у шапці/бейджі — цифра прокручується вертикально
// 250ms. Стара з'їжджає вгору, нова заїжджає знизу; reduced motion → миттєво
// (тривалість з токена занулюється).

import { useEffect, useRef, useState } from 'react';
import styles from './RollingNumber.module.css';

export function RollingNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [incoming, setIncoming] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value === shown || incoming !== null) {
      // Друга зміна під час анімації — просто доганяємо без черги.
      if (value !== shown && incoming === null) setShown(value);
      return;
    }
    setIncoming(value);
    timer.current = setTimeout(() => {
      setShown(value);
      setIncoming(null);
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, shown, incoming]);

  return (
    <span className={styles.roll} aria-label={String(value)}>
      <span className={`${styles.digit} ${incoming !== null ? styles.out : ''}`}>{shown}</span>
      {incoming !== null && <span className={`${styles.digit} ${styles.in}`}>{incoming}</span>}
    </span>
  );
}
