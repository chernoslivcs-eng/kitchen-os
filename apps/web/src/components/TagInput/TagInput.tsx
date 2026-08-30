// Редагований список чіпів: показує наявне, дає прибрати кожен і додати новий.
//
// До цього профіль був доступний тільки для читання, а правити його можна було
// лише розмовою. Тобто якщо модель записала «не люблю кінзу» як алергію,
// виправлення коштувало ще однієї розмови — і надії, що цього разу вона
// зрозуміє. Найдорожча помилка була в найдорожчому полі.
//
// Головне правило продукту тут не порушується: воно про те, що в стан не пише
// МОДЕЛЬ. Людина у власному профілі пише сама — це і є «дія — інтерфейс».

import { useState, useRef } from 'react';
import styles from './TagInput.module.css';

interface Props {
  values: string[];
  tone: 'allergy' | 'wish' | 'anti' | 'neutral';
  placeholder: string;
  emptyLabel?: string;
  prefix?: string;                       // «⚠» перед алергією
  disabled?: boolean;
  onAdd: (label: string) => Promise<void> | void;
  onRemove: (label: string) => Promise<void> | void;
}

export function TagInput({
  values, tone, placeholder, emptyLabel = 'ще жодного', prefix,
  disabled, onAdd, onRemove,
}: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function commit() {
    const label = draft.trim();
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
      inputRef.current?.focus();
    } finally { setBusy(false); }
  }

  async function drop(label: string) {
    if (busy) return;
    setBusy(true);
    try { await onRemove(label); } finally { setBusy(false); }
  }

  // Канон Бриф-2 5а: чипи живуть УСЕРЕДИНІ поля, курсор «додати…» — поруч
  // із ними. Один контейнер, а не «список + окреме поле».
  return (
    <div
      className={styles.field}
      onClick={() => inputRef.current?.focus()}
    >
      {values.length === 0 && !draft && (
        <span className={styles.empty}>{emptyLabel}</span>
      )}
      {values.map((v) => (
        <span key={v} className={`${styles.chip} ${styles[tone]}`}>
          {prefix ? `${prefix} ` : ''}{v}
          <button
            type="button"
            className={styles.x}
            onClick={(e) => { e.stopPropagation(); void drop(v); }}
            disabled={disabled || busy}
            aria-label={`Прибрати «${v}»`}
            title="Прибрати"
          >×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className={styles.inline}
        value={draft}
        placeholder={placeholder}
        disabled={disabled || busy}
        size={Math.max(placeholder.length, draft.length, 8)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') setDraft('');
          // Backspace на порожньому полі прибирає останній чіп — звичка з тег-редакторів.
          if (e.key === 'Backspace' && !draft && values.length) {
            void drop(values[values.length - 1]!);
          }
        }}
        maxLength={200}
      />
    </div>
  );
}
