// Типи карток: intake_diff, proposal, shopping, profile, recipe. Кожна — компонент.
// Дизайн зі стрічки брифу: без бордер-колообгортки, тримаємось лініями й розділами
// з mono-мітками. Стан (applied/undone) прикручує клас — картка притлумлюється.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ChatCard, type Recipe, type ReceiptLeftover } from '../../api';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { formatQty } from '../../lib/units';
import { renderStepContent, scaleRecipe } from '../../lib/recipe';
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
// UX9-17: correct із зоною показує, КУДИ переїде партія.
const ZONE_LABELS: Record<string, string> = {
  fresh: 'Свіже', fridge: 'Холодильник', freezer: 'Морозилка',
  dry: 'Суха шафа', spices: 'Спеції', drinks: 'Напої',
};

const KIND_LABELS: Record<string, string> = {
  allergy: 'АЛЕРГІЯ',
  wish: 'ЛЮБИТЬ',
  anti: 'АНТИ',
  equip: 'ТЕХНІКА',
  note: 'НОТАТКА',
  intent: 'НАМІР',
  member: 'ДОМАШНІ',
};

type ProfileItem = {
  op?: 'add' | 'remove';
  kind?: 'allergy' | 'wish' | 'anti' | 'equip' | 'note' | 'member' | 'intent';
  label?: string;
  // UX9-32: обмеження member-опа мають бути ВИДИМІ до підтвердження.
  diet?: string;
  allergies?: string[];
  antipatterns?: string[];
  wishes?: string[];
};

export interface CardProps {
  card: ChatCard;
  applied?: boolean;
  applying?: boolean;
  dismissed?: boolean;
  undone?: boolean;
  undoAvailable?: boolean;
  // intake_diff може прислати вибіркове застосування (індекси ops) — бекенд
  // PendingCard.selected[] це вміє давно, UI зʼявився з пост-кук списанням (№6).
  onApply?: (selected?: number[]) => void;
  onDismiss?: () => void;
  onUndo?: () => void;
  onOpen?: (index: number) => void;
  // Уточнення до конкретної страви: тап префілить композитор «{title} — » і
  // ставить фокус. Прототипний startRefine: префікс механічно тримає тему
  // розмови — головну промптову болячку QA-3…6 («тема не тримається») він
  // закриває з боку інтерфейсу, а не вмовляннями в промпті.
  onRefine?: (title: string) => void;
  // recipe_link: рецепт живе в розмові — готуємо і зберігаємо прямо звідси.
  // UX9-11: recipeId — id чернетки, cook-run реюзає її рядок замість дубля.
  onCook?: (recipe: Recipe, recipeId?: string) => void;
  // №6: шеринг живе на картці рецепта (фініш Cook Mode помер).
  onShare?: (recipe: Recipe, recipeId?: string) => void;
  onSaveRecipe?: (recipe_id: string) => void;
  savedRecipeIds?: Set<string>;
  onNeedToList?: (label: string, v: number | undefined, u: string | undefined, forDish: string) => void;
  batchLabels?: Map<string, string>;
  // №4а: базові назви (product) для кроків.
  stepLabels?: Map<string, string>;
}

function stateClass(applied?: boolean, undone?: boolean): string {
  return [
    styles.card,
    applied ? styles.applied : '',
    undone ? styles.undone : '',
  ].filter(Boolean).join(' ');
}

// ----- Intake --------------------------------------------------------------

// M13, канон М2: шапка-джерело чека. Дати як у канвасі — «23.08».
function receiptDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Сірий рядок «додати руками»: назва в лапках ЯК У ЧЕКУ (не вгадуємо, чим це
// є) + один тап кладе в комору штучну партію. Після додавання — тихий ✓.
function UnmatchedRow({ line }: { line: ReceiptLeftover }) {
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle');
  return (
    <div className={styles.op} style={{ color: 'var(--fg-dim)' }}>
      <span className={styles['op-sign']} style={{ color: 'var(--fg-dim)' }}>?</span>
      <span className={styles['op-label']} style={{ color: 'var(--fg-dim)' }}>«{line.name}»</span>
      {state === 'added' ? (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', flex: 'none' }}>✓ У КОМОРІ</span>
      ) : (
        <button
          type="button"
          disabled={state === 'busy'}
          onClick={async () => {
            setState('busy');
            try {
              await api.batches.create({ label: line.name });
              setState('added');
            } catch { setState('idle'); }
          }}
          style={{
            border: 0, background: 'transparent', cursor: 'pointer', padding: '2px 4px',
            color: 'var(--accent)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
            textDecoration: 'underline', textUnderlineOffset: 3, flex: 'none',
            opacity: state === 'busy' ? 0.5 : 1,
          }}
        >додати руками</button>
      )}
    </div>
  );
}

export function IntakeCard({ card, applied, applying, dismissed, undone, undoAvailable, onApply, onDismiss, onUndo }: CardProps) {
  // UX9-17: rename/correct ФІЛЬТРУВАЛИСЬ — картка перейменування стояла без
  // жодного предметного рядка, людина тиснула «Застосувати» наосліп.
  const ops = (card.ops as IntakeOp[] | undefined ?? []);
  // №6: чекбокси позицій — «щось лишилось» знімається галочкою, решта
  // застосовується. Дефолт — усе увімкнено; актуально насамперед для
  // пост-кук списання, але працює на будь-якій intake-картці.
  const [off, setOff] = useState<Set<number>>(new Set());
  const actionable = !applied && !undone && !dismissed && !!onApply;
  const toggle = (i: number) => setOff((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const signFor = (op?: IntakeOp['op']) => {
    if (op === 'deplete') return '−';
    if (op === 'open') return '◔';
    if (op === 'rename') return '✎';
    if (op === 'correct') return '✎';
    return '+';
  };
  // M13: intake з чека мережі — шапка-джерело, сірі «додати руками»,
  // згорнуте «не для комори». apply/undo — той самий шлях, що у всіх intake.
  const receipt = card.source?.kind === 'retail_receipt' ? card.source : null;
  const [nonfoodOpen, setNonfoodOpen] = useState(false);
  return (
    <div className={stateClass(applied, undone)}>
      {receipt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.015em' }}>
            Чек Сільпо
          </div>
          <MonoLabel>
            {receiptDate(receipt.at)} · {receipt.shop} · {Math.round(receipt.total)}₴
          </MonoLabel>
        </div>
      )}
      <div className={styles.ops}>
        {ops.map((op, i) => (
          <div
            key={i}
            className={styles.op}
            onClick={actionable && ops.length > 1 ? () => toggle(i) : undefined}
            style={actionable && ops.length > 1
              ? { cursor: 'pointer', opacity: off.has(i) ? 0.45 : 1 }
              : undefined}
          >
            {actionable && ops.length > 1 && (
              <span
                role="checkbox"
                aria-checked={!off.has(i)}
                style={{
                  width: 18, height: 18, borderRadius: 6, flex: 'none',
                  display: 'inline-grid', placeItems: 'center',
                  background: off.has(i) ? 'transparent' : 'var(--accent)',
                  border: off.has(i) ? '1px solid var(--border-strong)' : '1px solid var(--accent)',
                  color: 'var(--accent-fg-on)', fontWeight: 700, fontSize: 11,
                }}
              >{off.has(i) ? '' : '✓'}</span>
            )}
            <span className={styles['op-sign']}>{signFor(op.op)}</span>
            <span className={styles['op-label']}>
              {op.op === 'rename'
                ? <>{op.label ?? '—'} → {(op as { to?: string }).to ?? '—'}</>
                : op.label ?? '—'}
              {op.op === 'correct' && (op as { zone?: string }).zone && (
                <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  → {ZONE_LABELS[(op as { zone?: string }).zone!] ?? (op as { zone?: string }).zone}
                </span>
              )}
            </span>
            {op.value != null && op.unit && (
              <span className={styles['op-qty']}>{op.op === 'correct' ? '→ ' : ''}{formatQty(op.value, op.unit)}</span>
            )}
          </div>
        ))}
        {receipt && receipt.unmatched.map((l, i) => <UnmatchedRow key={`u${i}`} line={l} />)}
      </div>
      {receipt && receipt.nonfood.length > 0 && (
        <div style={{ marginTop: 2 }}>
          <button
            type="button"
            onClick={() => setNonfoodOpen((v) => !v)}
            style={{
              border: 0, background: 'transparent', cursor: 'pointer', padding: '6px 0',
              color: 'var(--fg-dim)', fontFamily: 'var(--font-body)', fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ width: 18, textAlign: 'center' }}>{nonfoodOpen ? '⌄' : '›'}</span>
            ще {receipt.nonfood.length} не для комори
          </button>
          {nonfoodOpen && receipt.nonfood.map((l, i) => (
            <div key={i} className={styles.op} style={{ color: 'var(--fg-dim)' }}>
              <span className={styles['op-sign']} style={{ color: 'var(--fg-dim)' }}>·</span>
              <span className={styles['op-label']} style={{ color: 'var(--fg-dim)' }}>{l.name}</span>
            </div>
          ))}
        </div>
      )}
      {receipt && applied && !undone && ops.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 8,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--accent)' }}>
            ● {ops.length} {plural(ops.length, ['ПОЗИЦІЯ', 'ПОЗИЦІЇ', 'ПОЗИЦІЙ'])} У КОМОРІ
          </span>
          {undoAvailable && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              style={{
                border: 0, background: 'transparent', cursor: 'pointer', padding: '2px 4px',
                color: 'var(--fg-muted)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                textDecoration: 'underline', textUnderlineOffset: 3,
              }}
            >Скасувати ↩</button>
          )}
        </div>
      )}
      {actionable && (
        <div className={styles['card-actions']}>
          <Button
            variant="primary"
            onClick={() => onApply!(off.size ? ops.map((_, i) => i).filter((i) => !off.has(i)) : undefined)}
            loading={applying}
            disabled={off.size === ops.length}
          >
            {off.size ? `Застосувати ${ops.length - off.size}` : 'Застосувати'}
          </Button>
          <Button variant="secondary" onClick={onDismiss}>Ні</Button>
        </div>
      )}
      {!receipt && applied && !undone && undoAvailable && onUndo && (
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
          <Button variant="primary" onClick={() => onApply?.()} loading={applying}>У список</Button>
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
        {items.map((it, i) => {
          // UX9-32: «+ Оля / ДОМАШНІ» без самого обмеження — підтвердження
          // наосліп. Показуємо, що саме запишеться.
          const details = [
            it.diet,
            it.allergies?.length ? `алергії: ${it.allergies.join(', ')}` : null,
            it.antipatterns?.length ? it.antipatterns.join(' · ') : null,
            it.wishes?.length ? it.wishes.join(' · ') : null,
          ].filter(Boolean);
          return (
            <div key={i} className={styles.op} style={details.length ? { alignItems: 'flex-start' } : undefined}>
              <span className={styles['op-sign']}>{it.op === 'remove' ? '−' : '+'}</span>
              <span className={styles['op-label']}>
                {it.label ?? '—'}
                {details.length > 0 && (
                  <span style={{ display: 'block', marginTop: 2, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.45 }}>
                    {details.join(' · ')}
                  </span>
                )}
              </span>
              {it.kind && (
                <span className={styles['op-qty']}>{KIND_LABELS[it.kind] ?? it.kind.toUpperCase()}</span>
              )}
            </div>
          );
        })}
      </div>
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={() => onApply?.()} loading={applying}>Запам'ятати</Button>
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
    r.sv ? `${r.sv} ${plural(r.sv, ['ПОРЦІЯ', 'ПОРЦІЇ', 'ПОРЦІЙ'])}` : null,
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
          <Button variant="primary" onClick={() => onApply?.()} loading={applying}>У рецепти</Button>
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
          <Button variant="primary" onClick={() => onApply?.()} loading={applying}>У журнал</Button>
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

// Канон Бриф-3 п.8: рецепт — звичайне повідомлення КУХНІ в журнальному
// ритмі, без рамок і бордюрів-гілок. Інгредієнти списком (○ бракує →
// «+ у список» інлайн), кроки з номерами, довгі згорнуті до трьох із
// «Показати всі N». «Готуємо» веде тільки в Cook Mode; /recipe/:id
// лишається адресою для «У рецепти» і шерингу.
export function RecipeLinkCard({ card, onCook, onShare, onSaveRecipe, savedRecipeIds, onNeedToList, batchLabels, stepLabels }: CardProps) {
  const r = card.recipe as Recipe | undefined;
  const rid = card.recipe_id;
  const [allSteps, setAllSteps] = useState(false);
  const [listed, setListed] = useState<Set<number>>(new Set());
  // Порційник: детерміноване множення кількостей, 0 токенів. Складне
  // («на чотирьох, але соусу більше») — як і раніше, через чат.
  const [servings, setServings] = useState<number | null>(null);
  // Канон B: «2 порції ▾» у мета-рядку відкриває ряд чіпів 1/2/3/4/6/8.
  const [pickServings, setPickServings] = useState(false);
  if (!rid) return null;
  const saved = savedRecipeIds?.has(rid) ?? false;

  // Старі повідомлення (до рецепта-в-розмові) мають тільки посилання.
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

  const sv = servings ?? r.sv ?? 1;
  const scaled = scaleRecipe(r, sv);

  // Моушн-2 №8: рендеримо ВСІ кроки завжди; хвіст живе в контейнері з
  // анімованою висотою — розгортка/згортання їдуть, а не стрибають.
  const firstSteps = scaled.st.slice(0, 3);
  const restSteps = scaled.st.slice(3);


  return (
    <div className={styles['recipe-msg']}>
      <div>
        {/* Канон B: назва 22/Onest, мета людською мовою, порції — «N порцій ▾». */}
        <div style={{ fontFamily: 'var(--font-display, var(--font-body))', fontSize: 22, fontWeight: 700, letterSpacing: '-0.015em', color: 'var(--fg-strong)', lineHeight: 1.2 }}>
          {r.t}
        </div>
        <div style={{ marginTop: 5, display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg-muted)' }}>
          {r.tm ? <span>{r.tm} хв</span> : null}
          {r.nu?.kcal ? <span>{r.nu.kcal} ккал</span> : null}
          <button
            type="button"
            onClick={() => setPickServings((v) => !v)}
            style={{
              border: 0, background: 'none', padding: '0 0 1px', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg)',
              borderBottom: '1px dashed var(--border-strong)',
            }}
          >
            {sv} {plural(sv, ['порція', 'порції', 'порцій'])} ▾
          </button>
        </div>
        {pickServings && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { setServings(n); setPickServings(false); }}
                style={{
                  height: 32, padding: '0 13px', borderRadius: 999, cursor: 'pointer',
                  border: n === sv ? '1px solid var(--fg)' : '1px solid var(--border-strong)',
                  background: n === sv ? 'var(--fg)' : 'transparent',
                  color: n === sv ? 'var(--bg-surface)' : 'var(--fg-muted)',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                }}
              >{n}</button>
            ))}
            {sv !== (r.sv ?? 1) && (
              <span style={{ alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-dim)' }}>база {r.sv}</span>
            )}
          </div>
        )}
        {r.rk && (
          <div style={{
            marginTop: 8, paddingLeft: 10, borderLeft: '2px solid var(--amber)',
            fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.45,
          }}>{r.rk}</div>
        )}
      </div>

      <div className={styles['recipe-msg-cols']}>
        <div>
          <MonoLabel>ІНГРЕДІЄНТИ · ● З КОМОРИ</MonoLabel>
          <div style={{ marginTop: 2 }}>
            {scaled.ing.map((ing, i) => {
              const missing = !ing.p;
              const added = listed.has(i);
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'baseline', gap: 10,
                  padding: '7px 0', borderBottom: '1px solid var(--border)',
                  fontFamily: 'var(--font-body)', fontSize: 15,
                }}>
                  <span style={{ color: missing ? 'var(--fg-dim)' : 'var(--accent)', fontSize: 11 }}>
                    {missing ? '○' : '●'}
                  </span>
                  <span style={{ flex: 1, color: 'var(--fg)' }}>
                    {ing.n ?? (ing.p && batchLabels?.get(ing.p)) ?? 'з комори'}
                    {missing && ing.n && onNeedToList && (
                      /* Канон п.8: бракує → «+ у список» просто тут. */
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => { onNeedToList(ing.n!, ing.v, ing.u, r.t); setListed((prev) => new Set(prev).add(i)); }}
                        style={{
                          border: 0, background: 'none', padding: 0, marginLeft: 8,
                          color: added ? 'var(--fg-dim)' : 'var(--accent)',
                          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                          textDecoration: added ? 'none' : 'underline', textUnderlineOffset: 3,
                          cursor: added ? 'default' : 'pointer',
                        }}
                      >
                        {added ? '✓ у списку' : '+ у список'}
                      </button>
                    )}
                  </span>
                  {ing.v != null && ing.u && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-dim)' }}>{formatQty(ing.v, ing.u)}</span>
                  )}
                </div>
              );
            })}
            {(() => {
              // Канон B: підсумковий рядок браку + «+ усі в список» разом.
              const missIdx = scaled.ing.map((ing, i) => (!ing.p && ing.n ? i : -1)).filter((i) => i >= 0);
              const left = missIdx.filter((i) => !listed.has(i));
              if (!missIdx.length || !onNeedToList) return null;
              return (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0 0' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--amber)' }}>
                    ○ БРАКУЄ {missIdx.length}
                  </span>
                  <button
                    type="button"
                    disabled={!left.length}
                    onClick={() => {
                      left.forEach((i) => {
                        const ing = scaled.ing[i]!;
                        onNeedToList(ing.n!, ing.v, ing.u, r.t);
                      });
                      setListed((prev) => new Set([...prev, ...left]));
                    }}
                    style={{
                      border: 0, background: 'none', padding: 0, cursor: left.length ? 'pointer' : 'default',
                      color: left.length ? 'var(--accent)' : 'var(--fg-dim)',
                      fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                      textDecoration: left.length ? 'underline' : 'none', textUnderlineOffset: 3,
                    }}
                  >
                    {left.length ? '+ усі в список' : '✓ усі в списку'}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>

        <div>
          <MonoLabel>ПЛАН</MonoLabel>
          <div style={{ marginTop: 2 }}>
            {firstSteps.map((step: typeof scaled.st[number], i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.5 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-dim)', flex: 'none', width: 14 }}>{i + 1}</span>
                <span style={{ flex: 1, color: 'var(--fg)' }}>
                  {step.t}
                  {!!step.s && (
                    <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                      ▷ {Math.floor(step.s / 60)}:{String(step.s % 60).padStart(2, '0')}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {restSteps.length > 0 && (
              <>
                <div className={`${styles['steps-rest']} ${allSteps ? styles['steps-rest-open'] : ''}`}>
                  {restSteps.map((step, i) => (
                    <div key={i + 3} style={{ display: 'flex', gap: 12, padding: '6px 0', fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.5 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-dim)', flex: 'none', width: 14 }}>{i + 4}</span>
                      <span style={{ flex: 1, color: 'var(--fg)' }}>
                        {step.t}
                        {!!step.s && (
                          <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                            ▷ {Math.floor(step.s / 60)}:{String(step.s % 60).padStart(2, '0')}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setAllSteps((v) => !v)}
                  style={{
                    border: 0, background: 'none', padding: '6px 0 0',
                    color: 'var(--accent)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                    textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {allSteps ? 'Згорнути кроки' : `Показати всі ${r.st.length} кроків`}
                  <span className={`${styles.chev} ${allSteps ? styles['chev-open'] : ''}`}>▾</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Правка №4б: «Готуємо» — на всю ширину, як «Рецепт →» у пропозиції;
          «У рецепти» і «Поділитись» — вузькі другорядні (№6: шеринг тепер
          живе тут, а не на фініші Cook Mode). */}
      <div className={styles['recipe-actions']} style={{ alignItems: 'center', gap: 16 }}>
        {onCook && <Button variant="positive" onClick={() => onCook(scaled, rid)}>Готуємо → Cook Mode</Button>}
        {onSaveRecipe && (
          <button
            type="button"
            disabled={saved}
            onClick={() => onSaveRecipe(rid)}
            style={{
              border: 0, background: 'none', padding: 0, cursor: saved ? 'default' : 'pointer',
              color: saved ? 'var(--fg-dim)' : 'var(--fg-muted)', fontFamily: 'var(--font-body)',
              fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            {saved ? '✓ У рецептах' : 'У рецепти'}
          </button>
        )}
        {onShare && (
          <button
            type="button"
            onClick={() => onShare(scaled, rid)}
            title="Поділитись"
            style={{
              border: 0, background: 'none', padding: 0, cursor: 'pointer',
              color: 'var(--fg-muted)', fontSize: 17, lineHeight: 1,
            }}
          >↗</button>
        )}
      </div>
    </div>
  );
}


// ----- Cart (M13, канвас М3) -----------------------------------------------
// Два імені однієї речі: наше — головне (те, що людина писала в список),
// назва Сільпо — другим рядком mono, як «паспортні дані» товару.
// «Немає в цій філії» — бурштин-факт, не error. Кнопка темна з ↗ — вихід
// назовні, не наша шавлієва дія; чекаут цілком на боці мережі.
export function RetailCartCard({ card }: CardProps) {
  const rows = card.rows ?? [];
  return (
    <div className={styles.card}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.015em' }}>
          Кошик у Сільпо
        </div>
        <MonoLabel>ЗІ СПИСКУ ПОКУПОК</MonoLabel>
      </div>
      <div className={styles.ops}>
        {rows.map((r, i) => (
          <div key={i} className={styles.op} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span className={styles['op-label']} style={r.product ? undefined : { color: 'var(--fg-dim)' }}>
                {r.label}
              </span>
              {r.product ? (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-dim)' }}>
                  {r.product.name}{r.product.weighted ? ` · ${r.product.quantity} кг` : ''}
                </span>
              ) : (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--amber)' }}>
                  немає в цій філії
                </span>
              )}
            </div>
            {r.product && (
              <span className={styles['op-qty']} style={{ color: 'var(--fg)' }}>
                {Math.round(r.product.price * (r.product.weighted ? r.product.quantity : 1))}₴
              </span>
            )}
          </div>
        ))}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 6,
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>
          {card.total}₴ · {card.found} з {card.of}
        </span>
        <a
          href={card.cart_url}
          target="_blank"
          rel="noreferrer"
          style={{
            marginLeft: 'auto', height: 44, padding: '0 18px', borderRadius: 12,
            background: 'var(--fg)', color: 'var(--bg-body)', textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
          }}
        >Оформити в Сільпо ↗</a>
      </div>
    </div>
  );
}

export function Card(props: CardProps) {
  switch (props.card.type) {
    case 'intake_diff': return <IntakeCard {...props} />;
    case 'cart':        return <RetailCartCard {...props} />;
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
  if (type === 'recipe_link') return { text: 'КУХНЯ · РЕЦЕПТ', tone: 'muted' };
  // M13: кошик — теж не дія в нас: він уже зібраний у мережі, CTA веде назовні.
  if (type === 'cart') return { text: 'КОШИК · СІЛЬПО', tone: 'muted' };
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
