// Типи карток: intake_diff, proposal, shopping, profile, recipe. Кожна — компонент.
// Дизайн зі стрічки брифу: без бордер-колообгортки, тримаємось лініями й розділами
// з mono-мітками. Стан (applied/undone) прикручує клас — картка притлумлюється.

import type { ChatCard, Recipe } from '../../api';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';
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
  // Уточнення до конкретної страви: тап префілить композитор «{title} — » і
  // ставить фокус. Прототипний startRefine: префікс механічно тримає тему
  // розмови — головну промптову болячку QA-3…6 («тема не тримається») він
  // закриває з боку інтерфейсу, а не вмовляннями в промпті.
  onRefine?: (title: string) => void;
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

export function ProposalCard({ card, onOpen, onRefine }: CardProps) {
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
          {(onOpen || onRefine) && (
            <div className={styles['card-actions']}>
              {onOpen && <Button variant="positive" onClick={() => onOpen(i)}>Рецепт →</Button>}
              {onRefine && it.title && (
                <Button variant="secondary" onClick={() => onRefine(it.title!)}>Уточнити</Button>
              )}
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

// ----- Recipe --------------------------------------------------------------

// Рецепт, розібраний із вкладення: сторінка книжки, скрін із телеграму.
// Показуємо, що саме розібрали, до того як людина погодиться зберігати —
// інакше «Так» це кнопка в темряву.
export function RecipeCard({ card, applied, applying, dismissed, undone, undoAvailable, onApply, onDismiss, onUndo }: CardProps) {
  const r = card.recipe as Recipe | undefined;
  if (!r) return null;
  const meta = [
    r.tm ? `${r.tm}ХВ` : null,
    r.sv ? `${r.sv} ПОРЦ` : null,
    r.ing?.length ? `${r.ing.length} ІНГР` : null,
    r.st?.length ? `${r.st.length} КРОК` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={stateClass(applied, undone)}>
      <div className={styles.ops}>
        <div className={styles.op}>
          <span className={styles['op-sign']}>+</span>
          <span className={styles['op-label']}>{r.t}</span>
        </div>
      </div>
      {meta && <MonoLabel>{meta}</MonoLabel>}
      {r.d && (
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.45 }}>
          {r.d}
        </div>
      )}
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={onApply} loading={applying}>У рецепти</Button>
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

// Фото страви → журнал. Мінімальна картка: назва готування і дві кнопки.
export function CookPhotoCard({ card, applied, applying, dismissed, undone, undoAvailable, onApply, onDismiss, onUndo }: CardProps) {
  return (
    <div className={stateClass(applied, undone)}>
      <div className={styles.ops}>
        <div className={styles.op}>
          <span className={styles['op-sign']}>📷</span>
          <span className={styles['op-label']}>{card.recipe_title ?? 'Готування'}</span>
        </div>
      </div>
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={onApply} loading={applying}>У журнал</Button>
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

export function Card(props: CardProps) {
  switch (props.card.type) {
    case 'intake_diff': return <IntakeCard {...props} />;
    case 'proposal':    return <ProposalCard {...props} />;
    case 'shopping':    return <ShoppingCard {...props} />;
    case 'profile':     return <ProfileCard {...props} />;
    case 'recipe':      return <RecipeCard {...props} />;
    case 'cook_photo':  return <CookPhotoCard {...props} />;
    default:            return null;
  }
}

// Текст тосту після «Так». Жив інлайном у Feed і рахував «ops або items»
// з формами «у коморі»/«у списку» — картка рецепта давала «0 позицій у коморі».
export function appliedToast(card: ChatCard): string {
  if (card.type === 'cook_photo') {
    return card.recipe_title ? `Фото до «${card.recipe_title}» — у журналі` : 'Фото в журналі';
  }
  if (card.type === 'recipe') {
    const t = (card.recipe as Recipe | undefined)?.t;
    return t ? `«${t}» — у рецептах` : 'Рецепт збережено';
  }
  const count = card.type === 'shopping' || card.type === 'proposal'
    ? (card.items?.length ?? 0)
    : (card.ops?.length ?? 0);
  const forms: [string, string, string] = card.type === 'shopping'
    ? ['позиція у списку', 'позиції у списку', 'позицій у списку']
    : ['позиція у коморі', 'позиції у коморі', 'позицій у коморі'];
  return `${count} ${plural(count, forms)}`;
}

// Мета-мітка перед карткою, залежно від типу й стану — на кшталт «КОМОРА · ◌ ОЧІКУЄ».
export function labelFor(
  type: ChatCard['type'],
  applied?: boolean,
  undone?: boolean,
  dismissed?: boolean,
): { text: string; tone: 'pending' | 'applied' | 'muted' } {
  if (undone) return { text: '↩ СКАСОВАНО', tone: 'muted' };
  if (applied) return { text: '✓ ЗАСТОСОВАНО', tone: 'applied' };
  // QA5-11: після «Ні» кнопки ховались, але заголовок лишався «◌ ОЧІКУЄ» назавжди.
  if (dismissed) return { text: '✕ ВІДХИЛЕНО', tone: 'muted' };
  const base = type === 'intake_diff' ? 'КОМОРА'
    : type === 'shopping' ? 'СПИСОК'
    : type === 'profile' ? 'ПРОФІЛЬ'
    // Імпорт із книжки — не вигадка моделі, і мітка має це розрізняти.
    : type === 'recipe' ? 'РЕЦЕПТ'
    : type === 'cook_photo' ? 'ЖУРНАЛ'
    : 'ПРОПОЗИЦІЯ';
  return { text: `${base} · ◌ ОЧІКУЄ`, tone: 'pending' };
}
