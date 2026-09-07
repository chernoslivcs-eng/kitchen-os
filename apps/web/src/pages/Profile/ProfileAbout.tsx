// Крок П3 (2): «ПРО ТЕБЕ» і «НОТАТКИ» — ОДИН компонент на два місця:
// сторінку /profile і панель артефактів поруч із чатом. Не копія й не
// «компактна версія»: той самий код, той самий PATCH /v1/profile/:key, ті самі
// ліміти, лічильник і збереження по виходу з рядка. Саме тому їх і винесли —
// друга реалізація розійшлася б із першою першою ж правкою.
//
// `ДІМ`, `МЕРЕЖІ`, `АКАУНТ` сюди не переїхали: це налаштування, і поруч із
// чатом їм нема чого робити.
//
// Крок П3 (4): під полями `no` і `ban` — тихий рядок покриття: які слова
// продукт упізнав (тобто зможе застосувати), а які лише запамʼятав. Джерело —
// наявний veto_index із GET /v1/profile, нічого нового не збираємо.

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { api, type ProfileV2Response, type ProfileNoteV2, type VetoRowInfo } from '../../api';
import { PROFILE_ROWS, HINT_IDLE, SECTION, type ProfileRowCopy } from '../../lib/profile-copy';
import type { ProfileFieldKey } from '@kitchen/domain/profile-fields';
import styles from './ProfileV2.module.css';

type Fields = ProfileV2Response['fields'];

const SAVE_DEBOUNCE_MS = 800;
const TYPING_HOLD_MS = 1000;
const NOTE_TOAST_MS = 5000;
const RETRY_MS = 1500;

const len = (s: string) => Array.from(s).length;
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export interface ProfileAboutProps {
  initial: ProfileV2Response;
  /**
   * Крок П3 (3): рядок, у який поставити курсор одразу після монтування —
   * приходить від моделі як `profile_focus`. Продукт нічого не вписує:
   * курсор стає в КІНЕЦЬ того, що людина написала раніше.
   */
  focusKey?: ProfileFieldKey | null;
  /** Панель повідомляє, що фокус відпрацював — щоб не смикати рядок удруге. */
  onFocusHandled?: () => void;
  /** Нотатки, які людина ще не бачила: підсвічуються, поки не гляне. */
  freshNoteIds?: string[];
}

export function ProfileAbout({ initial, focusKey = null, onFocusHandled, freshNoteIds = [] }: ProfileAboutProps) {
  // ----- Про тебе ---------------------------------------------------------
  const [fields, setFields] = useState<Fields>(initial.fields);
  const [focus, setFocus] = useState<ProfileFieldKey | null>(null);
  const [hover, setHover] = useState<ProfileFieldKey | null>(null);
  const [typing, setTyping] = useState<ProfileFieldKey | null>(null);
  const [lens, setLens] = useState<Record<ProfileFieldKey, number>>(() =>
    Object.fromEntries(PROFILE_ROWS.map((r) => [r.k, len(initial.fields[r.k].text)])) as Record<ProfileFieldKey, number>);
  const [hintKey, setHintKey] = useState(0);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  // Крок П3 (4): межа продукту. Оновлюється тим самим PATCH, що й поле —
  // сервер повертає перебудований індекс поля у відповіді.
  const [veto, setVeto] = useState<VetoRowInfo[] | undefined>(initial.veto);
  const edits = useRef<Partial<Record<ProfileFieldKey, HTMLSpanElement | null>>>({});
  const lastSaved = useRef<Record<ProfileFieldKey, string>>(
    Object.fromEntries(PROFILE_ROWS.map((r) => [r.k, initial.fields[r.k].text])) as Record<ProfileFieldKey, string>,
  );
  const timers = useRef<Record<string, number>>({});

  // Текст у contenteditable живе в DOM, а не в стейті: перерендер стейтом
  // скидав би курсор. Заповнюємо один раз на монтуванні.
  useEffect(() => {
    for (const r of PROFILE_ROWS) {
      const el = edits.current[r.k];
      if (el && el.textContent !== initial.fields[r.k].text) el.textContent = initial.fields[r.k].text;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { for (const t of Object.values(timers.current)) window.clearTimeout(t); }, []);

  const textOf = (k: ProfileFieldKey) => (edits.current[k]?.textContent ?? '').trim();

  async function persist(k: ProfileFieldKey, attempt = 0) {
    const text = textOf(k);
    if (text === lastSaved.current[k]) return;
    try {
      const r = await api.profileV2.patchField(k, { text });
      lastSaved.current[k] = r.field.text;
      setFields((f) => ({ ...f, [k]: r.field }));
      // Індекс поля перебудований сервером — забираємо його замість того, щоб
      // здогадуватись про покриття на клієнті.
      setVeto((prev) => [
        ...(prev ?? []).filter((row) => row.field !== k),
        ...((r.veto_index as VetoRowInfo[] | undefined) ?? []),
      ]);
      setSaveToast(null);
    } catch {
      setSaveToast(SECTION.saveFailed);
      if (attempt === 0) timers.current[`retry-${k}`] = window.setTimeout(() => void persist(k, 1), RETRY_MS);
    }
  }

  function onInput(k: ProfileFieldKey) {
    setLens((l) => ({ ...l, [k]: len(textOf(k)) }));
    setTyping(k);
    window.clearTimeout(timers.current[`typing-${k}`]);
    timers.current[`typing-${k}`] = window.setTimeout(() => setTyping((t) => (t === k ? null : t)), TYPING_HOLD_MS);
    window.clearTimeout(timers.current[`save-${k}`]);
    timers.current[`save-${k}`] = window.setTimeout(() => void persist(k), SAVE_DEBOUNCE_MS);
  }
  function onBlur(k: ProfileFieldKey) {
    setFocus((f) => (f === k ? null : f));
    setHintKey((n) => n + 1);
    window.clearTimeout(timers.current[`save-${k}`]);
    void persist(k);
  }
  function onFocus(k: ProfileFieldKey) { setFocus(k); setHintKey((n) => n + 1); }
  function onKeyDown(k: ProfileFieldKey, row: ProfileRowCopy, e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); return; }
    // Ліміт: набір блокується, лічильник лишається з текстом ліміту.
    if (len(e.currentTarget.textContent ?? '') >= row.max && e.key.length === 1 && !e.metaKey && !e.ctrlKey) e.preventDefault();
  }
  function onPaste(k: ProfileFieldKey, row: ProfileRowCopy, e: ClipboardEvent<HTMLSpanElement>) {
    e.preventDefault();
    const room = row.max - len(e.currentTarget.textContent ?? '');
    if (room <= 0) return;
    const chunk = Array.from(e.clipboardData.getData('text/plain').replace(/\s+/g, ' ')).slice(0, room).join('');
    if (typeof document.execCommand === 'function') document.execCommand('insertText', false, chunk);
    else e.currentTarget.textContent = (e.currentTarget.textContent ?? '') + chunk;
    onInput(k);
  }

  const firstDay = PROFILE_ROWS.every((r) => fields[r.k].status === 'empty');
  const hintRow = PROFILE_ROWS.find((r) => r.k === focus) ?? null;

  const counter = (row: ProfileRowCopy) => {
    const n = lens[row.k];
    const atLimit = n >= row.max;
    const active = focus === row.k;
    return {
      text: atLimit ? row.lim : `${n}/${row.max}`,
      // Видно тільки під час набору (зникає ~1 с після останнього символа);
      // при вичерпанні — текст ліміту тримається, поки рядок у фокусі.
      visible: active && (typing === row.k || atLimit),
      atLimit,
    };
  };

  // ----- Нотатки ---------------------------------------------------------
  const [notes, setNotes] = useState<ProfileNoteV2[]>(initial.notes);
  const [noteToast, setNoteToast] = useState<{ note: ProfileNoteV2; index: number } | null>(null);
  async function removeNote(n: ProfileNoteV2) {
    const index = notes.findIndex((x) => x.id === n.id);
    setNotes((ns) => ns.filter((x) => x.id !== n.id));
    window.clearTimeout(timers.current['note-toast']);
    setNoteToast({ note: n, index });
    timers.current['note-toast'] = window.setTimeout(() => setNoteToast(null), NOTE_TOAST_MS);
    try { await api.profileV2.removeNote(n.id); } catch {
      // Сервер не прийняв — повертаємо як було, без окремого тосту.
      setNotes((ns) => { const arr = [...ns]; arr.splice(index, 0, n); return arr; });
      setNoteToast(null);
    }
  }
  async function restoreNote() {
    const t = noteToast;
    if (!t) return;
    window.clearTimeout(timers.current['note-toast']);
    setNoteToast(null);
    setNotes((ns) => { const arr = [...ns]; arr.splice(Math.min(t.index, arr.length), 0, t.note); return arr; });
    try { await api.profileV2.restoreNote(t.note.id); } catch { /* рядок уже на місці; повторний DELETE поверне все назад */ }
  }

  // Крок П3 (3): курсор у КІНЕЦЬ наявного тексту — людина дописує до своїх
  // слів, а не переписує їх. Продукт при цьому не вписує нічого.
  useEffect(() => {
    if (!focusKey) return;
    const el = edits.current[focusKey];
    if (!el) return;
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch { /* jsdom — фокус і так стоїть */ }
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  /**
   * Крок П3 (4): що з написаного продукт упізнав. Рядок `free` (ref: null)
   * лежить у veto_index, але matchVeto його не читає — тобто вберегти від
   * цього слова продукт не зможе. З екрана це не було видно ніяк.
   */
  const coverage = (k: ProfileFieldKey): { known: string[]; unknown: string[] } | null => {
    // Окремого списку «під якими полями показувати» тут немає навмисно: у
    // veto_index за визначенням лежать лише `no` і `ban` (profile-fields.ts,
    // indexed), тож порожній фільтр і є та сама відповідь. Другий список
    // розійшовся б із першим першою ж правкою.
    if (!veto) return null;
    const rows = veto.filter((r) => r.field === k);
    if (!rows.length) return null;
    const known: string[] = [];
    const unknown: string[] = [];
    for (const r of rows) {
      const bucket = r.kind === 'free' || !r.ref ? unknown : known;
      if (!bucket.includes(r.label)) bucket.push(r.label);
    }
    return known.length || unknown.length ? { known, unknown } : null;
  };

  return (
    <>
      {/* ----- Про тебе ----- */}
      <div className={styles.sectionLabel}>
        <span>{SECTION.about}</span>
        <span className={styles.sectionSubDesktop}>{SECTION.aboutDesktop}</span>
      </div>
      <p className={styles.sectionSubMobile}>{firstDay ? SECTION.aboutFirstDay : SECTION.aboutMobile}</p>
      <div className={styles.card}>
        <div className={styles.rows}>
          {PROFILE_ROWS.map((row) => {
            const active = focus === row.k;
            const c = counter(row);
            return (
              <div key={row.k} className={styles.rowWrap}>
                <div
                  data-row={row.k}
                  className={[styles.row, active ? styles.rowActive : '', hover === row.k && !active ? styles.rowHover : ''].filter(Boolean).join(' ')}
                  onMouseEnter={() => setHover(row.k)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => { if (e.target === e.currentTarget) edits.current[row.k]?.focus(); }}
                >
                  <span className={row.danger ? styles.startDanger : styles.start}>{row.start}</span>{' '}
                  <span
                    ref={(el) => { edits.current[row.k] = el; }}
                    className={styles.edit}
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-label={row.start}
                    data-ph={row.ph}
                    spellCheck={false}
                    onInput={() => onInput(row.k)}
                    onFocus={() => onFocus(row.k)}
                    onBlur={() => onBlur(row.k)}
                    onKeyDown={(e) => onKeyDown(row.k, row, e)}
                    onPaste={(e) => onPaste(row.k, row, e)}
                  />
                  <span
                    className={[styles.counter, c.atLimit ? styles.counterLimit : ''].filter(Boolean).join(' ')}
                    style={{ opacity: c.visible ? 1 : 0 }}
                    aria-hidden={!c.visible}
                    data-counter={row.k}
                  >{c.text}</span>
                </div>
                {(() => {
                  // Крок П3 (4): не червоним і не як помилка людини — це межа
                  // продукту, і сказана вона тихо.
                  const cov = coverage(row.k);
                  if (!cov) return null;
                  return (
                    <div className={styles.coverage} data-coverage={row.k}>
                      {cov.known.length > 0 && <span>{SECTION.coverKnown} {cov.known.join(' · ')}</span>}
                      {cov.unknown.length > 0 && (
                        <span className={styles.coverageUnknown} data-coverage-unknown>
                          {SECTION.coverUnknown} {cov.unknown.join(' · ')}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {active && (
                  <div className={styles.hintMobile} key={hintKey}>
                    <p className={styles.hintText}>{row.hint}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <aside className={styles.hintAside} key={hintKey}>
          <span className={styles.hintLabel}>{hintRow ? hintRow.start : HINT_IDLE.label}</span>
          {/* 9а(5): приклади (`ex`) з копі не рендеряться — лишається текст підказки. */}
          <p className={styles.hintText}>{hintRow ? hintRow.hint : HINT_IDLE.text}</p>
        </aside>
      </div>

      {/* ----- Нотатки ----- */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          <span>{SECTION.notes}</span>
          <span className={styles.sectionSubDesktop}>{SECTION.notesDesktop}</span>
        </div>
        {notes.length === 0 && <span className={styles.empty}>{SECTION.notesEmpty}</span>}
        {notes.map((n) => (
          <div
            key={n.id}
            className={`${styles.note} ${freshNoteIds.includes(n.id) ? styles.noteFresh : ''}`}
            data-note={n.id}
            data-fresh={freshNoteIds.includes(n.id) ? '' : undefined}
          >
            <span className={styles.noteDate}>{fmtDate(n.created_at)}</span>
            <span className={styles.noteText}>{n.text}</span>
            <button type="button" className={styles.noteRemove} onClick={() => void removeNote(n)}>{SECTION.noteRemove}</button>
            <button type="button" className={styles.noteX} aria-label={SECTION.noteRemove} onClick={() => void removeNote(n)}>×</button>
          </div>
        ))}
        {noteToast && (
          <div className={styles.toast} role="status">
            {SECTION.removed}
            <button type="button" className={styles.toastAction} onClick={() => void restoreNote()}>{SECTION.restore}</button>
          </div>
        )}
      </div>

      {/* Тост збереження належить рядкам, а не сторінці: він і в панелі
          мусить бути там, де редагують. */}
      {saveToast && <div className={`${styles.toast} ${styles.toastFixed}`} role="status">{saveToast}</div>}
    </>
  );
}
