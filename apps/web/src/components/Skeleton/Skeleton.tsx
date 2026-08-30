// DA-11: скелетон завантаження з UI-кіта — «шимер 1.4с linear ∞, тільки перше
// завантаження». До нього екрани з loading показували порожнечу або, гірше,
// порожній СТАН («ще жодної» на місці восьми алергій — QA6-08).

import styles from './Skeleton.module.css';

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.wrap} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.row}>
          <div className={styles.line} style={{ width: `${68 - (i % 3) * 14}%` }} />
          <div className={`${styles.line} ${styles.short}`} />
        </div>
      ))}
    </div>
  );
}
