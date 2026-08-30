// Типи карток: intake_diff, proposal, shopping, profile, recipe. Кожна — компонент.
// Дизайн зі стрічки брифу: без бордер-колообгортки, тримаємось лініями й розділами
// з mono-мітками. Стан (applied/undone) прикручує клас — картка притлумлюється.

import { Link } from 'react-router-dom';
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

// DA2-24: сирий kind («NOTE») світився латиницею серед кириличних лейблів.
const KIND_LABELS: Record<string, string> = {
  allergy: 'АЛЕРГІЯ',
  wish: 'ЛЮБИТЬ',
  anti: 'АНТИ',
  equip: 'ТЕХНІКА',
  note: 'НОТАТКА',
  member: 'ДОМАШНІ',
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
  // recipe_link: рецепт живе в розмові — готуємо і зберігаємо прямо звідси.
  onCook?: (recipe: Recipe) => void;
  onSaveRecipe?: (recipe_id: string) => void;
  savedRecipeIds?: Set<string>;
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
              <span className={styles['op-qty']}>{KIND_LABELS[it.kind] ?? it.kind.toUpperCase()}</span>
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
  // Канон Бриф-2 5б: «5 КРОКІВ · 25ХВ · 2 ПОРЦІЇ» — кроки першими, без прев'ю.
  const meta = [
    r.st?.length ? `${r.st.length} КРОКІВ` : null,
    r.tm ? `${r.tm}ХВ` : null,
    r.sv ? `${r.sv} ПОРЦІЇ` : null,
    r.ing?.length ? `${r.ing.length} ІНГР` : null,
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
  const attId = (card as { attachment_id?: string }).attachment_id;
  return (
    <div className={stateClass(applied, undone)}>
      {/* Канон Бриф-2 5б: мініатюра 56px + здогад назви, без емодзі. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 12, background: 'var(--bg-hover)',
          overflow: 'hidden', flex: 'none', display: 'grid', placeItems: 'center',
        }}>
          {attId ? (
            <img
              src={`/v1/attachments/${attId}/bytes`}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-dim)' }}>IMG</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>
            {card.recipe_title ?? 'Готування'}
          </div>
          <div style={{ marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>
            Фото до запису в журналі
          </div>
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

// ----- Recipe link ----------------------------------------------------------

// Рішення Пилипа: рецепт — це хід розмови, а не екран. Повна страва
// рендериться в стрічці «гілкою» (лівий бордюр 2px — патерн Бриф-2 1а):
// інгредієнти, кроки, «Готуємо» і «На потім» — усе тут. Тап «Рецепт»
// нікуди не веде; окремий екран лишився бібліотеці й шерингу.
export function RecipeLinkCard({ card, onCook, onSaveRecipe, savedRecipeIds }: CardProps) {
  const r = card.recipe as Recipe | undefined;
  const rid = card.recipe_id;
  if (!rid) return null;
  const saved = savedRecipeIds?.has(rid) ?? false;

  // Старі повідомлення (до цього рішення) мають тільки посилання — для них
  // лишаємо рядок-слід.
  if (!r) {
    return (
      <Link
        to={`/recipe/${rid}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
          color: 'inherit', textDecoration: 'none',
        }}
      >
        <span style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>◇</span>
        <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--fg)' }}>
          {card.title ?? 'Рецепт'}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          Рецепт →
        </span>
      </Link>
    );
  }

  const summary = [
    r.tm ? `${r.tm}ХВ` : null,
    r.sv ? `${r.sv} ПОРЦ` : null,
    r.nu?.kcal ? `${r.nu.kcal}ККАЛ` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ borderLeft: '2px solid var(--border-strong)', paddingLeft: 14, marginLeft: 2 }}>
      <div style={{ fontFamily: 'var(--font-display, var(--font-body))', fontSize: 19, fontWeight: 700, letterSpacing: '-0.015em', color: 'var(--fg-strong)', lineHeight: 1.25 }}>
        {r.t}
      </div>
      {summary && (
        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)' }}>{summary}</div>
      )}
      {r.d && (
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.45 }}>{r.d}</div>
      )}
      {r.rk && (
        <div style={{
          marginTop: 8, paddingLeft: 10, borderLeft: '2px solid var(--amber)',
          fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.45,
        }}>{r.rk}</div>
      )}

      <div style={{ marginTop: 12 }}>
        <MonoLabel>ІНГРЕДІЄНТИ</MonoLabel>
        <div style={{ marginTop: 4 }}>
          {r.ing.map((ing, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              padding: '7px 0', borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-body)', fontSize: 14,
            }}>
              <span style={{ color: ing.p ? 'var(--accent)' : 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {ing.p ? '●' : '○'}
              </span>
              <span style={{ flex: 1, color: 'var(--fg)' }}>{ing.n ?? 'з комори'}</span>
              {ing.v != null && ing.u && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-dim)' }}>{formatQty(ing.v, ing.u)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <MonoLabel>КРОКИ</MonoLabel>
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {r.st.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.5 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flex: 'none',
                border: '1px solid var(--border-strong)', color: 'var(--fg-dim)',
                display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11,
              }}>{i + 1}</span>
              <span style={{ color: 'var(--fg)' }}>
                {step.t}. {renderStepInline(step.c, r.ing)}
                {!!step.s && (
                  <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--amber)' }}>
                    ▷ {Math.floor(step.s / 60)}:{String(step.s % 60).padStart(2, '0')}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        {onCook && <Button variant="primary" onClick={() => onCook(r)}>Готуємо</Button>}
        {onSaveRecipe && (
          <Button variant="secondary" onClick={() => onSaveRecipe(rid)} disabled={saved}>
            {saved ? '✓ Збережено' : '☆ На потім'}
          </Button>
        )}
        <Link
          to={`/recipe/${rid}`}
          style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-dim)', textDecoration: 'none' }}
        >
          Відкрити →
        </Link>
      </div>
    </div>
  );
}

// Плейсхолдери {N} у тексті кроку → назви інгредієнтів.
function renderStepInline(content: string, ing: Recipe['ing']): string {
  return content.replace(/\{(\d+)\}/g, (_, n) => ing[Number(n)]?.n ?? 'інгредієнт');
}

export function Card(props: CardProps) {
  switch (props.card.type) {
    case 'intake_diff': return <IntakeCard {...props} />;
    case 'proposal':    return <ProposalCard {...props} />;
    case 'shopping':    return <ShoppingCard {...props} />;
    case 'profile':     return <ProfileCard {...props} />;
    case 'recipe':      return <RecipeCard {...props} />;
    case 'cook_photo':  return <CookPhotoCard {...props} />;
    case 'recipe_link': return <RecipeLinkCard {...props} />;
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
  // Слід рецепта — не дія: жодного «ОЧІКУЄ», просто мітка.
  if (type === 'recipe_link') return { text: 'РЕЦЕПТ', tone: 'muted' };
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
