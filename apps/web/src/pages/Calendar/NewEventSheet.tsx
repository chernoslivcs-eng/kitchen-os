// Створення події руками. Три поля і все.
//
// Це ДРУГИЙ шлях, не основний. Перший — сказати Кухні: «у суботу гості,
// шестеро». Форма існує для тих, хто хоче натиснути, і тому в ній немає ні
// часу, ні категорій, ні нагадувань, ні конструктора правил: періодичність
// лише тижнева, бо «щовівторка мало часу» покриває реальні випадки, а решту
// людина напише словами в нотатці.
//
// Рід події тут не питається навмисно. Три поля — це три поля; завіз і слот
// сітки приходять розмовою, де вони зрозумілі з контексту.

import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Sheet } from '../../components/Sheet/Sheet';
import styles from './EventSheet.module.css';
import own from './NewEventSheet.module.css';

interface Props {
  onClose: () => void;
  /** Викликається з id створеної події: календар перечитується, і сторінка
   *  події відкривається вже з розрахованим сервером входженням. */
  onCreated: (id: string) => void;
}

const DOW = [
  { v: 1, l: 'пн' }, { v: 2, l: 'вт' }, { v: 3, l: 'ср' }, { v: 4, l: 'чт' },
  { v: 5, l: 'пт' }, { v: 6, l: 'сб' }, { v: 0, l: 'нд' },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function NewEventSheet({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'date' | 'weekly'>('date');
  const [date, setDate] = useState(todayIso());
  const [dow, setDow] = useState(2);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) { setErr('Скажи, що це'); return; }
    setBusy(true);
    setErr(null);
    try {
      const rule = mode === 'date' ? { t: 'once', at: date } : { t: 'weekly', dow };
      const res = await api.events.add({
        title: t, kind: 'custom', rule, note: note.trim() || null,
      }) as { event?: { id?: string } };
      const id = res.event?.id;
      if (id) onCreated(id);
      else onClose();
    } catch {
      setErr('Не вийшло записати. Спробуй ще раз');
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Нова подія">
      <form className={styles.body} onSubmit={submit}>
        <div className={`${styles.kicker} ${styles.muted}`}>НОВА ПОДІЯ</div>

        <label className={own.label} htmlFor="ev-title">Що</label>
        <input
          id="ev-title"
          className={own.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="гості, шестеро"
          autoFocus
        />

        <div className={own.label}>Коли</div>
        <div className={own.segments}>
          <button
            type="button"
            className={`${own.seg} ${mode === 'date' ? own['seg-on'] : ''}`}
            onClick={() => setMode('date')}
          >Дата</button>
          <button
            type="button"
            className={`${own.seg} ${mode === 'weekly' ? own['seg-on'] : ''}`}
            onClick={() => setMode('weekly')}
          >Щотижня</button>
        </div>

        {mode === 'date' ? (
          <input
            type="date"
            className={own.input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        ) : (
          <div className={own.dows}>
            {DOW.map((d) => (
              <button
                key={d.v}
                type="button"
                className={`${own.dow} ${dow === d.v ? own['dow-on'] : ''}`}
                onClick={() => setDow(d.v)}
              >{d.l}</button>
            ))}
          </div>
        )}

        <label className={own.label} htmlFor="ev-note">Нотатка</label>
        <textarea
          id="ev-note"
          className={`${own.input} ${own.area}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="необовʼязково"
          rows={2}
        />

        {err && <div className={own.err}>{err}</div>}

        <div className={styles.actions}>
          <button type="submit" className={own.submit} disabled={busy}>
            {busy ? 'Записую…' : 'Додати'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
