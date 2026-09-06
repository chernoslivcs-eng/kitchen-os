import styles from './Pantry.module.css';
import type { Freshness } from './filter';

// Крок Ф2: одна вісь іконок — свіжість. Повне коло (accent) — свіже або без
// терміну; півколо (amber) — добігає (5…1 день); тонке кільце (danger) —
// перевірити: сьогодні або термін вийшов. Через токени, обидві теми.
const FRESH_TITLE: Record<Freshness, string> = { fresh: 'Свіже', soon: 'Добігає', check: 'Перевірити' };
export function FreshIcon({ fresh }: { fresh: Freshness }) {
  return (
    <span className={`${styles.mark} ${styles[`fresh-${fresh}`]}`} title={FRESH_TITLE[fresh]} aria-label={FRESH_TITLE[fresh]} data-fresh={fresh}>
      <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">
        {fresh === 'fresh' && <circle cx="7" cy="7" r="5.5" fill="currentColor" />}
        {fresh === 'soon' && <><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 1.5A5.5 5.5 0 0 1 7 12.5Z" fill="currentColor" /></>}
        {fresh === 'check' && <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />}
      </svg>
    </span>
  );
}
