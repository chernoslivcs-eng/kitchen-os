// Крок Е1: тост за анатомією макета — речення і дія словом праворуч.
//
// Значка статусу немає: ні ✓, ні ✕, ні кольорової крапки. Це той самий
// службовий шар, від якого відмовились у моно-рядках, і речення все каже саме.
//
// Живе окремим компонентом, бо Комора й Список свого тоста не мали взагалі —
// невдале завантаження там показувалось порожнім екраном, тобто брехнею.

import styles from './Toast.module.css';

interface Props {
  text: string;
  action?: { label: string; run: () => void };
}

export function Toast({ text, action }: Props) {
  return (
    <div className={styles.toast} role="status" data-toast>
      <span className={styles.text}>{text}</span>
      {action && (
        <button type="button" className={styles.action} onClick={action.run} data-toast-action>
          {action.label}
        </button>
      )}
    </div>
  );
}
