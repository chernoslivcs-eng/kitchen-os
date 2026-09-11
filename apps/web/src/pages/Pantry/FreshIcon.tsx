import styles from './Pantry.module.css';
import { FRESHNESS_LABEL, type Freshness } from '@kitchen/domain/shelf-thresholds';

// Одна вісь позначки — час. Чотири стани, не три (рішення Р3):
//
//   Добре          шавлія   — понад 5 днів, або строку немає;
//   Добігає        бурштин  — 5…1 день;
//   Перевірити     danger   — сьогодні або нуль;
//   Термін вийшов  danger   — days < 0.
//
// Крок 1 things-v3 (Components «ROW ANATOMY», Screens «Комора · збірка»):
// позначка — крапка 6 px у слоті часу, «крапка несе колір стану, число —
// зміст». Прострочене кадр теж малює крапкою (danger) — знак тривоги, який
// стояв тут з етапу 2a, знято: слово «−9 дн» уже каже, що це вихід за шкалу.
//
// Слова взяті з домену (FRESHNESS_LABEL), а не написані тут: інакше підпис
// позначки міг би розійтися зі станом, за яким вона малюється. Слова «свіже»
// серед них немає — воно позначає ЗОНУ (рішення Р22).
export function FreshIcon({ fresh }: { fresh: Freshness }) {
  const title = FRESHNESS_LABEL[fresh];
  return <span className={`${styles.mark} ${styles[`fresh-${fresh}`]}`} title={title} aria-label={title} data-fresh={fresh} />;
}
