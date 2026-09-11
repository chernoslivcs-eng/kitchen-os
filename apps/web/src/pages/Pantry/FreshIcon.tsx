import styles from './Pantry.module.css';
import { FRESHNESS_LABEL, type Freshness } from '@kitchen/domain/shelf-thresholds';
import { Icon } from '../../components/Icon/Icon';

// Одна вісь позначки — час. Чотири стани, не три (рішення Р3):
//
//   Добре        повне коло (шавлія) — понад 5 днів, або строку немає;
//   Добігає      півколо (бурштин)   — 5…1 день;
//   Перевірити   тонке кільце (danger) — сьогодні або нуль;
//   Термін вийшов  знак тривоги (danger) — days < 0.
//
// Прострочене подано ЗНАКОМ, а не четвертим виглядом кола: воно не «ще одна
// поділка шкали», а вихід за неї. Раніше його не існувало взагалі — `days<=0`
// зводилось у «сьогодні», і девʼятиденне прострочення виглядало сьогоднішнім.
//
// Слова взяті з домену (FRESHNESS_LABEL), а не написані тут: інакше підпис
// позначки міг би розійтися зі станом, за яким вона малюється. Слова «свіже»
// серед них немає — воно позначає ЗОНУ (рішення Р22).
export function FreshIcon({ fresh }: { fresh: Freshness }) {
  const title = FRESHNESS_LABEL[fresh];
  if (fresh === 'overdue') {
    return (
      <span className={`${styles.mark} ${styles['fresh-overdue']}`} data-fresh={fresh}>
        <Icon name="live.overdue" size={12} inherit />
      </span>
    );
  }
  return (
    <span className={`${styles.mark} ${styles[`fresh-${fresh}`]}`} title={title} aria-label={title} data-fresh={fresh}>
      <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">
        {fresh === 'good' && <circle cx="7" cy="7" r="5.5" fill="currentColor" />}
        {fresh === 'soon' && <><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 1.5A5.5 5.5 0 0 1 7 12.5Z" fill="currentColor" /></>}
        {fresh === 'check' && <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />}
      </svg>
    </span>
  );
}
