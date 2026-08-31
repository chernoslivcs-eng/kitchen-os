// Редагований список тегів: канон v3 «поле + полиця» (пул-7 №4).
//
// Поле — ЗАВЖДИ порожній один рядок із плейсхолдером: теги в нього не
// вкладаються (усередині поля вони розпухали його в стовпчик і ховали ввід).
// Enter/кома — тег падає на полицю ПІД полем (tag-in 250ms), поле очищається
// і тримає фокус — серію набирати легко. Порожня полиця не рендериться.
//
// Головне правило продукту не порушується: в стан не пише МОДЕЛЬ. Людина у
// власному профілі пише сама — це і є «дія — інтерфейс».

import { useState, useRef } from 'react';
import styles from './TagInput.module.css';

interface Props {
  values: string[];
  tone: 'allergy' | 'wish' | 'anti' | 'neutral';
  placeholder: string;
  prefix?: string;                       // «⚠» перед алергією
  disabled?: boolean;
  onAdd: (label: string) => Promise<void> | void;
  onRemove: (label: string) => Promise<void> | void;
  // Пул-7 №4: полиця «не їм» фарбується семантикою формулювання — але
  // ЗБЕРІГАЄТЬСЯ рядок як є, розбір тільки візуальний.
  hidden?: (label: string) => boolean;   // тег живе деінде (дієти — у своєму ряду)
}

// «не їм свинину» — принцип (слива), «не люблю кінзу» — смак (сірий).
// Відображаємо суть без префікса; сховище не чіпаємо.
function antiParts(label: string): { text: string; taste: boolean } {
  const lower = label.toLowerCase();
  if (lower.startsWith('не люблю ')) return { text: `${label.slice(9)} · не люблю`, taste: true };
  if (lower.startsWith('не їм ')) return { text: label.slice(6), taste: false };
  return { text: label, taste: false };
}

export function TagInput({
  values, tone, placeholder, prefix,
  disabled, onAdd, onRemove, hidden,
}: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // tag-out: тег спершу програє вихід (200ms), потім їде на сервер.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = hidden ? values.filter((v) => !hidden(v)) : values;

  async function commit() {
    const label = draft.trim().replace(/,+$/, '');
    if (!label || busy) return;
    // Дубль — не помилка, просто нічого не робимо й чистимо поле.
    if (values.some((v) => v.toLowerCase() === label.toLowerCase())) {
      setDraft('');
      return;
    }
    setBusy(true);
    try {
      await onAdd(label);
      setDraft('');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function drop(label: string) {
    if (busy || leaving.has(label)) return;
    setLeaving((prev) => new Set(prev).add(label));
    // Анімація виходу — потім факт. Якщо сервер відмовить, тег повернеться
    // з відповіді (values — джерело істини), leaving-мітка знімається завжди.
    window.setTimeout(async () => {
      try { await onRemove(label); } finally {
        setLeaving((prev) => { const next = new Set(prev); next.delete(label); return next; });
      }
    }, 180);
  }

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        className={styles.input}
        value={draft}
        placeholder={placeholder}
        disabled={disabled || busy}
        onChange={(e) => {
          // Кома — той самий «падає на полицю», що й Enter.
          if (e.target.value.endsWith(',')) { setDraft(e.target.value.slice(0, -1)); void commit(); return; }
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') setDraft('');
          // Backspace на порожньому полі прибирає останній тег — звичка з тег-редакторів.
          if (e.key === 'Backspace' && !draft && shown.length) {
            void drop(shown[shown.length - 1]!);
          }
        }}
        maxLength={200}
      />
      {shown.length > 0 && (
        <div className={styles.shelf}>
          {shown.map((v) => {
            const anti = tone === 'anti' ? antiParts(v) : null;
            const toneClass = anti?.taste ? styles['anti-taste'] : styles[tone];
            return (
              <span
                key={v}
                className={`${styles.chip} ${toneClass} ${leaving.has(v) ? styles['chip-out'] : styles['chip-in']}`}
              >
                {prefix ? `${prefix} ` : ''}{anti ? anti.text : v}
                <button
                  type="button"
                  className={styles.x}
                  onClick={() => void drop(v)}
                  disabled={disabled}
                  aria-label={`Прибрати «${v}»`}
                  title="Прибрати"
                >×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
