// Мінімально робочий чат. Не повний 04 Стрічка з брифу — це його кістяк:
// шапка → таймлайн → композитор → тост про застосоване з можливістю undo.
//
// Стрічка тримається на лініях і повітрі: mono-мітки в брифі — це маркери часу
// й типу події (18:42 КОМОРА · ◌ ОЧІКУЄ). Тут вони теж — щоб при переході на повну
// версію нічого не переверстовувати.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Logo } from '../../components/Logo/Logo';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { api, type ChatResponse } from '../../api';
import { useAuth } from '../../store/auth';
import styles from './Feed.module.css';

type Op = { op?: string; label?: string; value?: number; unit?: string; zone?: string; confidence?: number; evidence?: string };

interface Turn {
  id: string;                    // локальний, для React key
  meta: string;                  // «HH:MM ТИ» / «HH:MM КОМОРА · ◌ ОЧІКУЄ»
  metaTone?: 'default' | 'pending' | 'applied' | 'muted';
  role: 'user' | 'assistant';
  text?: string;
  card?: ChatResponse['card'];
  cardId?: string | null;
  applied?: boolean;
  undoToken?: string;
  undone?: boolean;
}

interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
  onUndo?: () => void;
}

function hhmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let nextId = 1;
const newId = () => `t${nextId++}`;

export function Feed() {
  const me = useAuth((s) => s.me);
  const logout = useAuth((s) => s.logout);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pantryCount, setPantryCount] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  async function refreshPantry() {
    try {
      const p = await api.pantry();
      setPantryCount(p.count);
    } catch { /* offline: лишаємо старе значення */ }
  }

  useEffect(() => { void refreshPantry(); }, []);

  useEffect(() => {
    // Автоскрол униз при новій репліці
    const el = timelineRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    setSending(true);

    const userTurn: Turn = { id: newId(), meta: `${hhmm()} ТИ`, role: 'user', text };
    setTurns((prev) => [...prev, userTurn]);

    try {
      const res = await api.chat({ text });
      const nowMeta = hhmm();
      const assistantTurn: Turn = res.card
        ? {
            id: newId(),
            meta: `${nowMeta} КОМОРА · ◌ ОЧІКУЄ`,
            metaTone: 'pending',
            role: 'assistant',
            text: res.reply,
            card: res.card,
            cardId: res.card_id,
          }
        : {
            id: newId(),
            meta: `${nowMeta} АСИСТЕНТ`,
            role: 'assistant',
            text: res.reply,
          };
      setTurns((prev) => [...prev, assistantTurn]);
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  async function apply(turnId: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId) return;
    try {
      const r = await api.cards.apply(turn.cardId);
      setTurns((prev) => prev.map((t) => t.id === turnId
        ? { ...t, applied: true, undoToken: r.undo_token, meta: t.meta.replace(/◌ ОЧІКУЄ/, '✓ ЗАСТОСОВАНО'), metaTone: 'applied' }
        : t,
      ));
      await refreshPantry();
      const ops = (turn.card?.ops ?? []) as Op[];
      setToast({
        id: Date.now(),
        kind: 'ok',
        text: `${ops.length} ${ops.length === 1 ? 'позиція' : 'позицій'} у коморі`,
        onUndo: () => undo(turnId, r.undo_token),
      });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  async function undo(turnId: string, undoToken: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId) return;
    try {
      await api.cards.undo(turn.cardId, undoToken);
      setTurns((prev) => prev.map((t) => t.id === turnId
        ? { ...t, undone: true, meta: t.meta.replace(/✓ ЗАСТОСОВАНО/, '↩ СКАСОВАНО'), metaTone: 'muted' }
        : t,
      ));
      await refreshPantry();
      setToast({ id: Date.now(), kind: 'ok', text: 'Скасовано' });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <Logo variant="wordmark" size={36} />
        <div className={styles['head-actions']}>
          {pantryCount !== null && (
            <MonoLabel className={styles['head-meta']}>КОМОРА {pantryCount}</MonoLabel>
          )}
          <Button variant="secondary" onClick={() => logout()}>Вийти</Button>
        </div>
      </div>

      <div className={styles.timeline} ref={timelineRef}>
        {turns.length === 0 && (
          <div className={styles.empty}>
            <h3>Скажи, що купив</h3>
            <p>Спробуй: «купив моцарелу 250 г» або «поклав у морозилку лосось 400 г». Я запропоную додати в комору — ти підтвердиш.</p>
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className={styles.turn}>
            <MonoLabel tone={t.metaTone === 'muted' ? 'muted' : t.metaTone === 'applied' ? 'applied' : t.metaTone === 'pending' ? 'pending' : 'default'}>
              {t.meta}
            </MonoLabel>
            {t.text && <div className={styles['turn-text']}>{t.text}</div>}
            {t.card?.type === 'intake_diff' && (
              <IntakeCard
                turn={t}
                onApply={() => apply(t.id)}
                onUndo={t.applied && !t.undone && t.undoToken ? () => undo(t.id, t.undoToken!) : undefined}
              />
            )}
          </div>
        ))}
      </div>

      <form className={styles.composer} onSubmit={send}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Записати в журнал…"
          disabled={sending}
          autoFocus
        />
        <button type="submit" disabled={sending || !input.trim()} aria-label="Надіслати">↑</button>
      </form>

      {toast && (
        <div className={styles.toast}>
          <span className={toast.kind === 'ok' ? styles.ok : styles.err}>
            {toast.kind === 'ok' ? '✓' : '✕'}
          </span>
          <span style={{ flex: 1 }}>{toast.text}</span>
          {toast.onUndo && (
            <button
              className={styles.undo}
              onClick={() => { toast.onUndo?.(); setToast(null); }}
            >
              ↩ Скасувати
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface IntakeProps {
  turn: Turn;
  onApply: () => void;
  onUndo?: () => void;
}

function IntakeCard({ turn, onApply, onUndo }: IntakeProps) {
  const ops = ((turn.card?.ops ?? []) as Op[]).filter((o) => o?.op === 'add' || o?.op === undefined);
  const cls = [
    styles.card,
    turn.applied ? styles.applied : '',
    turn.undone ? styles.undone : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className={styles.ops}>
        {ops.map((op, i) => (
          <div key={i} className={styles.op}>
            <span className={styles['op-sign']}>+</span>
            <span className={styles['op-label']}>{op.label ?? '—'}</span>
            {op.value != null && op.unit && (
              <span className={styles['op-qty']}>{op.value}{op.unit}</span>
            )}
          </div>
        ))}
      </div>
      {!turn.applied && !turn.undone && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={onApply}>Застосувати</Button>
          <Button variant="secondary" onClick={() => {/* залишаємо в стрічці як пропущену */}}>Ні</Button>
        </div>
      )}
      {turn.applied && !turn.undone && onUndo && (
        <div className={styles['card-actions']}>
          <Button variant="secondary" onClick={onUndo}>↩ Скасувати</Button>
        </div>
      )}
    </div>
  );
}
