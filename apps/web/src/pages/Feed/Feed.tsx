// Стрічка — робочий цикл продукту з тризмісткою карток: intake_diff, proposal,
// shopping, profile. Дизайн ближче до брифу 04 Стрічка: заголовок «Кухня»,
// мета-рядок про стан комори/списку, mono-мітки перед секціями, спокійні
// переходи між станами картки (◌ ОЧІКУЄ → ✓ ЗАСТОСОВАНО → ↩ СКАСОВАНО).

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Logo } from '../../components/Logo/Logo';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { api, type ChatCard, type ChatResponse } from '../../api';
import { useAuth } from '../../store/auth';
import { Card, labelFor } from './cards';
import styles from './Feed.module.css';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  time: string;
  text?: string;
  card?: ChatCard | null;
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
    const el = timelineRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    setSending(true);

    const userTurn: Turn = { id: newId(), role: 'user', time: hhmm(), text };
    setTurns((prev) => [...prev, userTurn]);

    try {
      const res: ChatResponse = await api.chat({ text });
      const turn: Turn = {
        id: newId(),
        role: 'assistant',
        time: hhmm(),
        text: res.reply || undefined,
        card: res.card,
        cardId: res.card_id,
      };
      setTurns((prev) => [...prev, turn]);
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
        ? { ...t, applied: true, undoToken: r.undo_token }
        : t,
      ));
      if (turn.card?.type === 'intake_diff') await refreshPantry();
      const count = turn.card?.type === 'intake_diff'
        ? ((turn.card.ops as unknown[] | undefined)?.length ?? 0)
        : ((turn.card?.items as unknown[] | undefined)?.length ?? 0);
      const noun = turn.card?.type === 'shopping' ? 'позиція у списку' : 'позиція у коморі';
      const nounPl = turn.card?.type === 'shopping' ? 'позицій у списку' : 'позицій у коморі';
      setToast({
        id: Date.now(),
        kind: 'ok',
        text: `${count} ${count === 1 ? noun : nounPl}`,
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
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, undone: true } : t));
      if (turn.card?.type === 'intake_diff') await refreshPantry();
      setToast({ id: Date.now(), kind: 'ok', text: 'Скасовано' });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles['head-left']}>
          <Logo variant="wordmark" size={30} />
        </div>
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
            <h3>Скажи, що купив або що хочеш приготувати</h3>
            <p>
              «купив моцарелу 250 г», «поклав у морозилку лосось», «дай рецепт з
              вершків і фуета», «додай молоко в список», «Оля не їсть лактозу» — все
              одне поле, усе через підтвердження.
            </p>
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className={styles.turn}>
            <MonoLabel tone="muted">
              {t.time} {t.role === 'user' ? 'ТИ' : t.card
                ? labelFor(t.card.type, t.applied, t.undone).text
                : 'АСИСТЕНТ'}
            </MonoLabel>
            {t.text && <div className={styles['turn-text']}>{t.text}</div>}
            {t.card && (
              <Card
                card={t.card}
                applied={t.applied}
                undone={t.undone}
                undoAvailable={!!t.undoToken}
                onApply={() => apply(t.id)}
                onUndo={t.undoToken ? () => undo(t.id, t.undoToken!) : undefined}
                onOpen={t.card.type === 'proposal' ? () => setToast({ id: Date.now(), kind: 'ok', text: 'Екран рецепта — наступний крок' }) : undefined}
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
          <span className={styles['toast-text']}>{toast.text}</span>
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
