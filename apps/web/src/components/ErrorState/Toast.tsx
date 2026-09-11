// Етап 10 (Errors E3): тост — подія не вдалась (або вдалась і її можна
// скасувати). Крапка роду ліворуч, речення, дія словом праворуч (шавлія, 600).
// Знизу по центру над композитором; 4 с без дії, 8 с з дією — час тримає
// той, хто показує. Без іконки: помилка говорить тим самим голосом, що
// «Скасовано» чи «Збережу в рецептах…».
//
// Живе окремим компонентом, бо Комора й Список свого тоста не мали взагалі —
// невдале завантаження там показувалось порожнім екраном, тобто брехнею.

import styles from './Toast.module.css';

/** Рід крапки (E3): danger — не вдалось; amber — попередження («Тека не піде», «Не збереглось»); sage — вдалось. */
export type ToastTone = 'danger' | 'amber' | 'sage';

interface Props {
  text: string;
  tone?: ToastTone;
  action?: { label: string; run: () => void };
}

export function Toast({ text, tone = 'danger', action }: Props) {
  return (
    <div className={styles.toast} role="status" data-toast data-toast-tone={tone}>
      <span className={`${styles.dot} ${styles[`dot-${tone}`]}`} aria-hidden="true" />
      <span className={styles.text}>{text}</span>
      {action && (
        <button type="button" className={styles.action} onClick={action.run} data-toast-action>
          {action.label}
        </button>
      )}
    </div>
  );
}
