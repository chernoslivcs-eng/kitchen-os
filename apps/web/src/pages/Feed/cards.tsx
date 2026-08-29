// Три типи карток: intake_diff, proposal, shopping, profile. Кожна — компонент.
// Дизайн зі стрічки брифу: без бордер-колообгортки, тримаємось лініями й розділами
// з mono-мітками. Стан (applied/undone) прикручує клас — картка притлумлюється.

import type { ChatCard } from '../../api';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { formatQty } from '../../lib/units';
import styles from './Feed.module.css';

// ----- Спільні типи op/item, які модель кладе в картку -------------------

type IntakeOp = {
  op?: 'add' | 'deplete' | 'open' | 'rename' | 'correct';
  label?: string;
  value?: number;
  unit?: string;
  zone?: string;
  confidence?: number;
  evidence?: string;
};

type ProposalItem = {
  title?: string;
  desc?: string;
  why?: string;
  character?: string;
  rescues?: string[];
  needs?: string[];
};

type ShoppingItem = {
  op?: 'add' | 'remove';
  label?: string;
  note?: string;
  v?: number;
  u?: string;
};

type ProfileItem = {
  op?: 'add' | 'remove';
  kind?: 'allergy' | 'wish' | 'anti' | 'equip' | 'note' | 'member';
  label?: string;
};

export interface CardProps {
  card: ChatCard;
  applied?: boolean;
  applying?: boolean;
  dismissed?: boolean;
  undone?: boolean;
  undoAvailable?: boolean;
  onApply?: () => void;
  onDismiss?: () => void;
  onUndo?: () => void;
  onOpen?: (index: number) => void;
}

function stateClass(applied?: boolean, undone?: boolean): string {
  return [
    styles.card,
    applied ? styles.applied : '',
    undone ? styles.undone : '',
  ].filter(Boolean).join(' ');
}

// ----- Intake --------------------------------------------------------------

export function IntakeCard({ card, applied, applying, dismissed, undone, undoAvailable, onApply, onDismiss, onUndo }: CardProps) {
  const ops = (card.ops as IntakeOp[] | undefined ?? []).filter(
    (o) => !o.op || o.op === 'add' || o.op === 'open' || o.op === 'deplete',
  );
  const signFor = (op?: IntakeOp['op']) => {
    if (op === 'deplete') return '−';
    if (op === 'open') return '◔';
    return '+';
  };
  return (
    <div className={stateClass(applied, undone)}>
      <div className={styles.ops}>
        {ops.map((op, i) => (
          <div key={i} className={styles.op}>
            <span className={styles['op-sign']}>{signFor(op.op)}</span>
            <span className={styles['op-label']}>{op.label ?? '—'}</span>
            {op.value != null && op.unit && (
              <span className={styles['op-qty']}>{formatQty(op.value, op.unit)}</span>
            )}
          </div>
        ))}
      </div>
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={onApply} loading={applying}>Застосувати</Button>
          <Button variant="secondary" onClick={onDismiss}>Ні</Button>
        </div>
      )}
      {applied && !undone && undoAvailable && onUndo && (
        <div className={styles['card-actions']}>
          <Button variant="secondary" onClick={onUndo}>↩ Скасувати</Button>
        </div>
      )}
    </div>
  );
}

// ----- Proposal ------------------------------------------------------------

export function ProposalCard({ card, onOpen }: CardProps) {
  const items = (card.items as ProposalItem[] | undefined ?? []);
  return (
    <div className={styles.card}>
      {items.map((it, i) => (
        <div key={i} className={styles['proposal-item']}>
          <div className={styles['proposal-title']}>{it.title ?? '—'}</div>
          {it.desc && <div className={styles['proposal-desc']}>{it.desc}</div>}
          {it.character && (
            <MonoLabel className={styles['proposal-meta']}>{it.character}</MonoLabel>
          )}
          {(it.rescues?.length ?? 0) > 0 && (
            <div className={styles.section}>
              <MonoLabel>РЯТУЄ</MonoLabel>
              <div className={styles.chips}>
                {it.rescues!.map((r, j) => (
                  <span key={j} className={styles.chip}>● {r}</span>
                ))}
              </div>
            </div>
          )}
          {(it.needs?.length ?? 0) > 0 && (
            <div className={styles.section}>
              <MonoLabel>БРАКУЄ</MonoLabel>
              <div className={styles.chips}>
                {it.needs!.map((n, j) => (
                  <span key={j} className={`${styles.chip} ${styles['chip-need']}`}>{n}</span>
                ))}
              </div>
            </div>
          )}
          {it.why && (
            <div className={styles.section}>
              <MonoLabel>ЧОМУ ЗАРАЗ</MonoLabel>
              <div className={styles['proposal-desc']}>{it.why}</div>
            </div>
          )}
          {onOpen && (
            <div className={styles['card-actions']}>
              <Button variant="positive" onClick={() => onOpen(i)}>Рецепт →</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ----- Shopping ------------------------------------------------------------

export function ShoppingCard({ card, applied, applying, dismissed, undone, undoAvailable, onApply, onDismiss, onUndo }: CardProps) {
  const items = (card.items as ShoppingItem[] | undefined ?? []);
  return (
    <div className={stateClass(applied, undone)}>
      <div className={styles.ops}>
        {items.map((it, i) => (
          <div key={i} className={styles.op}>
            <span className={styles['op-sign']}>{it.op === 'remove' ? '−' : '+'}</span>
            <span className={styles['op-label']}>{it.label ?? '—'}</span>
            {it.v != null && it.u && (
              <span className={styles['op-qty']}>{formatQty(it.v, it.u)}</span>
            )}
          </div>
        ))}
      </div>
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={onApply} loading={applying}>У список</Button>
          <Button variant="secondary" onClick={onDismiss}>Ні</Button>
        </div>
      )}
      {applied && !undone && undoAvailable && onUndo && (
        <div className={styles['card-actions']}>
          <Button variant="secondary" onClick={onUndo}>↩ Скасувати</Button>
        </div>
      )}
    </div>
  );
}

// ----- Profile -------------------------------------------------------------

export function ProfileCard({ card, applied, applying, dismissed, undone, onApply, onDismiss }: CardProps) {
  const items = (card.ops as ProfileItem[] | undefined ?? []);
  return (
    <div className={stateClass(applied, undone)}>
      <div className={styles.ops}>
        {items.map((it, i) => (
          <div key={i} className={styles.op}>
            <span className={styles['op-sign']}>{it.op === 'remove' ? '−' : '+'}</span>
            <span className={styles['op-label']}>{it.label ?? '—'}</span>
            {it.kind && (
              <span className={styles['op-qty']}>{it.kind.toUpperCase()}</span>
            )}
          </div>
        ))}
      </div>
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={onApply} loading={applying}>Запам'ятати</Button>
          <Button variant="secondary" onClick={onDismiss}>Ні</Button>
        </div>
      )}
    </div>
  );
}

// ----- Диспатчер за типом --------------------------------------------------

export function Card(props: CardProps) {
  switch (props.card.type) {
    case 'intake_diff': return <IntakeCard {...props} />;
    case 'proposal':    return <ProposalCard {...props} />;
    case 'shopping':    return <ShoppingCard {...props} />;
    case 'profile':     return <ProfileCard {...props} />;
    default:            return null;
  }
}

// Мета-мітка перед карткою, залежно від типу й стану — на кшталт «КОМОРА · ◌ ОЧІКУЄ».
export function labelFor(type: ChatCard['type'], applied?: boolean, undone?: boolean): { text: string; tone: 'pending' | 'applied' | 'muted' } {
  if (undone) return { text: '↩ СКАСОВАНО', tone: 'muted' };
  if (applied) return { text: '✓ ЗАСТОСОВАНО', tone: 'applied' };
  const base = type === 'intake_diff' ? 'КОМОРА'
    : type === 'shopping' ? 'СПИСОК'
    : type === 'profile' ? 'ПРОФІЛЬ'
    : 'ПРОПОЗИЦІЯ';
  return { text: `${base} · ◌ ОЧІКУЄ`, tone: 'pending' };
}
