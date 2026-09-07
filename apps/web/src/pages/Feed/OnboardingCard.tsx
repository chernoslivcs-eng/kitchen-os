// Раунд 4, крок 7: онбординг «Про тебе» у стрічці — одна картка, сім панелей,
// восьма «Готово». Стан панелей — з profile_text (props.profileFields),
// пропуски — у самій картці (card.skipped); «Записати» іде тим самим
// PATCH /v1/profile/:key, що сторінка. Ілюстрації — /onboarding/profile-<key>.png;
// без файлу місце лишається порожнім (без зламаного img).
//
// Крок О2: стрілок ← → більше немає — їхню роботу забрав «Назад» у ряду кнопок.
// Ряд читається як речення: Назад · Далі · Записати, головне праворуч.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, type ChatCard, type ProfileFieldV2 } from '../../api';
import { PROFILE_ROWS, type ProfileRowCopy } from '../../lib/profile-copy';
import type { ProfileFieldKey } from '@kitchen/domain/profile-fields';
import { Button } from '../../components/Button/Button';
import styles from './OnboardingCard.module.css';

export interface OnboardingCardProps {
  card: ChatCard;
  cardId?: string | null;
  profileFields?: Record<string, ProfileFieldV2> | null;
  /** Після PATCH — стрічка перечитує profile_text. */
  onProfilePatched?: () => void;
  onSummary?: () => void;
}

type PanelState = 'filled' | 'none' | 'skipped' | 'empty';
const len = (s: string) => Array.from(s).length;

export function panelState(key: ProfileFieldKey, fields: Record<string, ProfileFieldV2> | null | undefined, skipped: string[]): PanelState {
  const f = fields?.[key];
  if (f?.status === 'filled') return 'filled';
  if (f?.status === 'none') return 'none';
  if (skipped.includes(key)) return 'skipped';
  return 'empty';
}

export function firstOpenPanel(fields: Record<string, ProfileFieldV2> | null | undefined, skipped: string[]): number {
  const i = PROFILE_ROWS.findIndex((r) => panelState(r.k, fields, skipped) === 'empty');
  return i < 0 ? PROFILE_ROWS.length : i;
}

const META: Record<Exclude<PanelState, 'empty'>, string> = { filled: 'ЗАПИСАНО', none: 'НІЧОГО ТАКОГО', skipped: 'ПРОПУЩЕНО' };

export function OnboardingCard({ card, cardId, profileFields, onProfilePatched, onSummary }: OnboardingCardProps) {
  const [skipped, setSkipped] = useState<string[]>(card.skipped ?? []);
  const [index, setIndex] = useState(() => firstOpenPanel(profileFields, card.skipped ?? []));
  const [busy, setBusy] = useState(false);
  const [imgOk, setImgOk] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const editRef = useRef<HTMLSpanElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // О2 (2.3): стрічка тягне profile_text асинхронно, і на першому рендері полів
  // ще немає — тому початкова панель порахована по порожнечі й завершена
  // картка відкривалась на 1/7. Перераховуємо, коли поля приїхали, і рівно
  // один раз: далі людина гортає сама, і перебивати її ми не маємо права.
  const settled = useRef(!!profileFields);
  const paged = useRef(false);
  useEffect(() => {
    if (settled.current || paged.current || !profileFields) return;
    settled.current = true;
    setIndex(firstOpenPanel(profileFields, card.skipped ?? []));
  }, [profileFields, card.skipped]);

  const row: ProfileRowCopy | undefined = PROFILE_ROWS[index];
  const done = index >= PROFILE_ROWS.length;
  const state = row ? panelState(row.k, profileFields, skipped) : 'empty';

  // Текст панелі — з profile_text; contenteditable заповнюємо при зміні панелі.
  useEffect(() => {
    if (!row) return;
    const text = profileFields?.[row.k]?.status === 'filled' ? profileFields[row.k]!.text : '';
    setDraft(text);
    if (editRef.current) editRef.current.textContent = text;
    // Текст росте вгору: показуємо його кінець, а не початок.
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [index, row, profileFields]);

  const filledCount = PROFILE_ROWS.filter((r) => panelState(r.k, profileFields, skipped) === 'filled').length;

  /** Ручне гортання: після нього перерахунок початкової панелі мовчить. */
  function goTo(i: number) {
    paged.current = true;
    setIndex(Math.max(0, Math.min(PROFILE_ROWS.length, i)));
  }

  function advance(from: number) {
    // «Записати» веде на наступну НЕЗАПОВНЕНУ; якщо таких нема — «Готово».
    paged.current = true;
    const next = PROFILE_ROWS.findIndex((r, i) => i > from && panelState(r.k, profileFields, skipped) === 'empty' && r.k !== row?.k);
    setIndex(next < 0 ? PROFILE_ROWS.length : next);
  }

  async function save() {
    if (!row || busy) return;
    const text = (editRef.current?.textContent ?? '').trim();
    if (!text) return;
    setBusy(true);
    try {
      await api.profileV2.patchField(row.k, { text });
      onProfilePatched?.();
      advance(index);
    } catch { /* лишаємось на панелі — людина повторить */ } finally { setBusy(false); }
  }

  /**
   * О2 (2.1): «Далі» веде себе за станом панелі.
   * Порожня — це пропуск, він пишеться і панель отримує підпис. Уже
   * заповнена — просто перехід, нічого не пишеться: інакше людина, яка
   * вирішила перечитати свої відповіді, понапропускала б їх дорогою.
   */
  async function next() {
    if (!row || busy) return;
    if (state !== 'empty') { goTo(index + 1); return; }
    setBusy(true);
    if (row.k === 'ban') {
      // Панель алергій: «Нічого такого» — це відповідь, а не пропуск.
      try { await api.profileV2.patchField(row.k, { status: 'none' }); onProfilePatched?.(); } catch { /* nop */ }
    } else {
      setSkipped((s) => [...new Set([...s, row.k])]);
      try { if (cardId) await api.onboarding.skip(cardId, row.k); } catch { /* пропуск лишається локально до перезавантаження */ }
    }
    setBusy(false);
    goTo(index + 1);
  }

  // 9а(1): клікабельний увесь рядок — фокус у закінчення, курсор у кінець.
  function focusEdit() {
    const el = editRef.current;
    if (!el) return;
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch { /* jsdom/старі браузери — фокус і так стоїть */ }
  }
  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (!row) return;
    if (e.key === 'Enter') { e.preventDefault(); void save(); return; }
    if (len(e.currentTarget.textContent ?? '') >= row.max && e.key.length === 1 && !e.metaKey && !e.ctrlKey) e.preventDefault();
  }
  function onInput(e: { currentTarget: HTMLSpanElement }) {
    setDraft(e.currentTarget.textContent ?? '');
    // Каретка лишається в полі зору, коли текст переріс вільне місце.
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }

  const n = len(draft);
  const atLimit = !!row && n >= row.max;

  return (
    <div className={styles.card} data-onboarding-card>
      {row ? (
        <div className={styles.panel} key={row.k} data-panel={row.k} data-state={state}>
          <div className={styles.illustration}>
            {imgOk[row.k] !== false && (
              <img
                src={`/onboarding/profile-${row.k}.png`}
                alt=""
                onError={() => setImgOk((m) => ({ ...m, [row.k]: false }))}
                onLoad={() => setImgOk((m) => ({ ...m, [row.k]: true }))}
              />
            )}
          </div>
          <div className={styles.body}>
            <span className={styles.step}>{index + 1} / {PROFILE_ROWS.length}</span>
            {/* 9а(4): текстовий блок фіксованої мінімальної висоти — панелі однакові. */}
            <div className={styles.copy}>
              <span className={row.danger ? styles.titleDanger : styles.title}>{row.card}</span>
              <span className={styles.text}>{row.body}</span>
            </div>
            {/* О2 (1.6): рядок стоїть унизу вільного місця; лінія — низ самого
                рядка, тому вона завжди під текстом, а не крізь нього. */}
            <div className={styles.field} data-row-click onClick={(e) => { if (e.target !== editRef.current) focusEdit(); }}>
              <div className={styles.fieldText} ref={boxRef} data-field-text>
                <span className={row.danger ? styles.startDanger : styles.start}>{row.start}</span>{' '}
                <span
                  ref={editRef}
                  className={styles.edit}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label={row.start}
                  data-ph={row.ph}
                  spellCheck={false}
                  onInput={onInput}
                  onKeyDown={onKeyDown}
                />
              </div>
              <div className={styles.fieldMeta}>
                <span className={`${styles.counter} ${atLimit ? styles.counterLimit : ''}`} data-counter>{atLimit ? row.lim : `${n}/${row.max}`}</span>
              </div>
            </div>
            {/* 9а(4): рядок мети завжди в потоці — кнопки не стрибають між панелями. */}
            <span className={styles.meta} data-meta={state !== 'empty' ? '' : undefined}>{state !== 'empty' ? META[state] : ' '}</span>
            <div className={styles.actions}>
              <Button variant="text" onClick={() => goTo(index - 1)} disabled={index === 0 || busy} data-back>Назад</Button>
              <Button variant="secondary" onClick={() => void next()} disabled={busy} data-next>
                {row.k === 'ban' ? 'Нічого такого' : 'Далі'}
              </Button>
              <Button variant="primary" onClick={() => void save()} disabled={!draft.trim() || busy} loading={busy} data-save>Записати</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.panel} data-panel="done">
          <div className={styles.illustration}>
            {imgOk.done !== false && (
              <img src="/onboarding/profile-empty.png" alt="" onError={() => setImgOk((m) => ({ ...m, done: false }))} />
            )}
          </div>
          <div className={styles.body}>
            <span className={styles.step}>Готово</span>
            <div className={styles.copy}>
            <span className={styles.title}>{filledCount === 7 ? 'Усі сім записав.' : filledCount === 0 ? 'Нічого не записав — теж варіант, зʼясуємо по ходу.' : `Записав ${filledCount} із семи. Решта зʼясується по ходу.`}</span>
            </div>
            {/* Те саме вільне місце, що на решті панелей — кнопки не їздять. */}
            <div className={styles.spacer} />
            <span className={styles.meta}>{' '}</span>
            <div className={styles.actions}>
              <Button variant="text" onClick={() => goTo(PROFILE_ROWS.length - 1)} data-back>Назад</Button>
              <Button variant="primary" onClick={onSummary} data-summary>Показати, що вийшло</Button>
            </div>
          </div>
        </div>
      )}
      {/* О2 (1.4): лічильник лишився там, де й був, — тільки без стрілок обабіч. */}
      <div className={styles.nav}>
        <span className={styles.progress}>{done ? `${PROFILE_ROWS.length} / ${PROFILE_ROWS.length}` : `${index + 1} / ${PROFILE_ROWS.length}`}</span>
      </div>
    </div>
  );
}
