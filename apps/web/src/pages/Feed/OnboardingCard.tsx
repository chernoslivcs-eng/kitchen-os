// Раунд 4, крок 7: онбординг «Про тебе» у стрічці — одна картка, сім панелей
// із ← →, восьма «Готово». Стан панелей — з profile_text (props.profileFields),
// пропуски — у самій картці (card.skipped); «Записати» іде тим самим
// PATCH /v1/profile/:key, що сторінка. Ілюстрації — /onboarding/profile-<key>.png;
// без файлу місце лишається порожнім (без зламаного img).

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

  const row: ProfileRowCopy | undefined = PROFILE_ROWS[index];
  const done = index >= PROFILE_ROWS.length;
  const state = row ? panelState(row.k, profileFields, skipped) : 'empty';

  // Текст панелі — з profile_text; contenteditable заповнюємо при зміні панелі.
  useEffect(() => {
    if (!row) return;
    const text = profileFields?.[row.k]?.status === 'filled' ? profileFields[row.k]!.text : '';
    setDraft(text);
    if (editRef.current) editRef.current.textContent = text;
  }, [index, row, profileFields]);

  const filledCount = PROFILE_ROWS.filter((r) => panelState(r.k, profileFields, skipped) === 'filled').length;

  function advance(from: number) {
    // Далі — наступна незаповнена після поточної; якщо таких нема — «Готово».
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
  async function none() {
    if (!row || busy) return;
    setBusy(true);
    try {
      await api.profileV2.patchField(row.k, { status: 'none' });
      onProfilePatched?.();
      advance(index);
    } catch { /* nop */ } finally { setBusy(false); }
  }
  async function skip() {
    if (!row || busy) return;
    setBusy(true);
    const next = [...new Set([...skipped, row.k])];
    setSkipped(next);
    try { if (cardId) await api.onboarding.skip(cardId, row.k); } catch { /* пропуск лишається локально до перезавантаження */ } finally { setBusy(false); }
    advance(index);
  }
  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (!row) return;
    if (e.key === 'Enter') { e.preventDefault(); void save(); return; }
    if (len(e.currentTarget.textContent ?? '') >= row.max && e.key.length === 1 && !e.metaKey && !e.ctrlKey) e.preventDefault();
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
            <span className={row.danger ? styles.titleDanger : styles.title}>{row.card}</span>
            <span className={styles.text}>{row.body}</span>
            <div className={styles.row}>
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
                onInput={(e) => setDraft(e.currentTarget.textContent ?? '')}
                onKeyDown={onKeyDown}
              />
              <span className={`${styles.counter} ${atLimit ? styles.counterLimit : ''}`} data-counter>{atLimit ? row.lim : `${n}/${row.max}`}</span>
            </div>
            {state !== 'empty' && <span className={styles.meta} data-meta>{META[state]}</span>}
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void save()} disabled={!draft.trim() || busy} loading={busy}>Записати</Button>
              {row.k === 'ban'
                ? <Button variant="secondary" onClick={() => void none()} disabled={busy}>Нічого такого</Button>
                : <Button variant="secondary" onClick={() => void skip()} disabled={busy}>Пропустити</Button>}
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
            <span className={styles.title}>{filledCount === 7 ? 'Усі сім записав.' : filledCount === 0 ? 'Нічого не записав — теж варіант, зʼясуємо по ходу.' : `Записав ${filledCount} із семи. Решта зʼясується по ходу.`}</span>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onSummary}>Показати, що вийшло</Button>
            </div>
          </div>
        </div>
      )}
      <div className={styles.nav}>
        <button type="button" className={styles.arrow} aria-label="Назад" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>←</button>
        <span className={styles.progress}>{done ? `${PROFILE_ROWS.length} / ${PROFILE_ROWS.length}` : `${index + 1} / ${PROFILE_ROWS.length}`}</span>
        <button type="button" className={styles.arrow} aria-label="Далі" disabled={done} onClick={() => setIndex((i) => Math.min(PROFILE_ROWS.length, i + 1))}>→</button>
      </div>
    </div>
  );
}
