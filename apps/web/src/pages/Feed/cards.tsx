// Типи карток: intake_diff, proposal, shopping, profile, recipe. Кожна — компонент.
// Дизайн зі стрічки брифу: без бордер-колообгортки, тримаємось лініями й розділами
// з mono-мітками. Стан (applied/undone) прикручує клас — картка притлумлюється.

import { createContext, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, type ChatCard, type Recipe, type ReceiptLeftover } from '../../api';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { RollingNumber } from '../../components/RollingNumber/RollingNumber';
import { formatQty, formatUnit } from '../../lib/units';
import { renderStepContent, scaleRecipe } from '../../lib/recipe';
import { plural } from '../../lib/plural';
import styles from './Feed.module.css';
import { groupShopping, sourceLabel } from './shopping-groups';
// Псевдонім навмисно: у цьому файлі вже є свій ShoppingItem — позиція
// картки-ДЕЛЬТИ ({op, label, v, u}), яку модель прислала в розмову.
// Рядок живого списку — інша річ: у нього є id, checked і джерело.
import type { ShoppingItem as ListItem } from '../../api';

// Крок 1.2: панель забирає низ картки собі. У трьох зонах (шапка · тіло ·
// закріплений низ) дії не мусять їхати разом із вмістом: «Оформити» і
// «Готуємо» стоять на місці, скільки б не було позицій.
// Картку при цьому НЕ розщеплюємо на два компоненти — весь її стан
// (кількості, заміни, порції) лишається в одному місці, а низ просто
// рендериться в чужий вузол, якщо він заданий. Немає слота — немає й
// змін: у стрічці низ лишається всередині картки, як був.
// Живі позиції: id → партія, яку зараз бачить комора.
//
// «Немає ні чека, ні комори — є позиції; комора і чек це просто місця їх
// відображення» (власник, 02.09). Тому картка чека не малює збережений
// знімок ops, а дивиться на ті самі позиції, що й комора: купив кілограм,
// засмажив шматок — у чеку теж 700 г, без жодної синхронізації.
//
// null у мапі не буває: відсутність ключа і означає «позиції більше немає»
// (зʼїли). Порожня мапа = ще не завантажили, і тоді ми не приховуємо нічого.
export interface LivePosition { label: string; value: number | null; unit: string | null }
export const LivePositions = createContext<Map<string, LivePosition> | null>(null);

export const PanelFootSlot = createContext<HTMLElement | null>(null);
// V7: у смузі максимум ДВІ кнопки. Третя — та, що про навігацію, а не про
// роботу з артефактом («У рецепти», «Поділитись») — переїжджає в шапку
// іконкою. Той самий механізм слота, що й для низу.
export const PanelHeadSlot = createContext<HTMLElement | null>(null);

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
  // M13: cart-swap правиться на сервері за id повідомлення-картки.
  cardId?: string;
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
  // Крок 4.2: назви незакреслених позицій списку покупок. Потрібні, щоб
  // ПЕРЕД застосуванням сказати, скільки рядків чека закриють список.
  // Той самий збіг рахує applyCard (UX9-27) — але вже після натискання,
  // і людина дізнавалась про наслідок постфактум.
  shoppingLabels?: Set<string>;
  // Крок 4.3: «у список» на групі «не для комори». Нехарчове не має де
  // жити в коморі, але має де в списку покупок.
  onNonfoodToList?: (names: string[]) => void;
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

// 01.09 картка v2: невпізнаний рядок чека — «уточнити» розкриває степер +
// одиницю ПРЯМО на місці (без переходу в інший потік). «ок» переносить
// рядок у card.ops тим самим шляхом, що впізнане каталогом — рахується в
// те саме «Застосувати N», не окремий «додати руками».
function ClarifyRow({
  line, cardId, index, onClarified,
}: { line: ReceiptLeftover; cardId?: string; index: number; onClarified: (card: ChatCard) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(Math.max(1, Math.round(line.quantity)));
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <div className={styles.op}>
        <span className={styles['op-sign']} style={{ color: 'var(--fg-dim)' }}>?</span>
        <span className={styles['op-label']} style={{ color: 'var(--fg-dim)' }}>«{line.name}»</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            border: '1px solid var(--border)', background: 'none', borderRadius: 999,
            padding: '4px 10px', color: 'var(--fg-dim)', fontFamily: 'var(--font-body)',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', flex: 'none',
          }}
        >уточнити</button>
      </div>
    );
  }
  return (
    <div className={styles.op} style={{ background: 'var(--accent-bg)', margin: '0 -20px', padding: '11px 20px' }}>
      <span className={styles['op-sign']} style={{ color: 'var(--fg-dim)' }}>?</span>
      <span className={styles['op-label']}>«{line.name}»</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-surface)',
          border: '1px solid var(--accent-border)', borderRadius: 8, padding: '3px 8px',
        }}>
          <button
            type="button" disabled={busy} onClick={() => setValue((v) => Math.max(1, v - 1))}
            style={{ border: 0, background: 'none', color: 'var(--accent)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: '0 2px' }}
          >−</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 14, textAlign: 'center' }}>{value}</span>
          <button
            type="button" disabled={busy} onClick={() => setValue((v) => v + 1)}
            style={{ border: 0, background: 'none', color: 'var(--accent)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: '0 2px' }}
          >+</button>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{formatUnit(line.unit)}</span>
        <button
          type="button"
          disabled={busy || !cardId}
          onClick={async () => {
            if (!cardId) return;
            setBusy(true);
            try {
              const r = await api.cards.clarifyLine(cardId, index, value, line.unit);
              onClarified(r.card);
            } catch { setBusy(false); }
          }}
          style={{
            border: 0, background: 'var(--accent)', color: 'var(--accent-fg-on)', borderRadius: 999,
            padding: '5px 10px', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >ок</button>
      </div>
    </div>
  );
}

// Секція чека: шапка з лічильником і груповою дією, рядки, «ще N ▾».
// Згортання до чотирьох — не економія місця, а мета подання: панель має
// показати СТРУКТУРУ рішення (скільки в комору, скільки в побут, скільки
// не впізнано), а не всі дев'ятнадцять позицій одразу.
function ReceiptGroup({
  tone, glyph, title, count, action, actionLabel, actionDisabled, children, rows, tail,
}: {
  tone: 'accent' | 'amber' | 'muted';
  glyph: string;
  title: string;
  count: number;
  action?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  children?: React.ReactNode;
  rows?: React.ReactNode[];
  /** Тихий рядок під списком — напр. скільки позицій уже зʼїдено. */
  tail?: string;
}) {
  const [all, setAll] = useState(false);
  // null у rows — позиція, якої вже немає (зʼїли). Відсіюємо ДО слайсу,
  // інакше «ЩЕ N» рахував би порожні місця й ховав живі рядки.
  const real = rows?.filter(Boolean);
  const shown = real && !all ? real.slice(0, 4) : real;
  const hidden = real ? real.length - (shown?.length ?? 0) : 0;
  return (
    <div className={styles.rgroup}>
      <div className={styles['rgroup-head']}>
        <span className={`${styles['rgroup-title']} ${styles[`tone-${tone}`]}`}>
          {glyph} {title} · {count}
        </span>
        {action && actionLabel && (
          <button
            type="button"
            className={`${styles['rgroup-act']} ${tone === 'amber' ? styles['tone-amber'] : ''}`}
            onClick={action}
            disabled={actionDisabled}
          >{actionLabel}</button>
        )}
      </div>
      {shown}
      {children}
      {tail && <div className={styles['rgroup-tail']}>{tail}</div>}
      {hidden > 0 && (
        <button type="button" className={styles['rgroup-more']} onClick={() => setAll(true)}>
          ЩЕ {hidden} ▾
        </button>
      )}
    </div>
  );
}

// Нехарчове, відсічене каталогом. Показуємо ЗАВЖДИ, коли воно є: мовчазний
// викид гірший за помилку — людина не дізналась би, що частину покупок
// продукт свідомо не взяв у комору.
function NonfoodGroup({
  rows, onNonfoodToList,
}: { rows: { name: string; qty: string }[]; onNonfoodToList?: (names: string[]) => void }) {
  const [sent, setSent] = useState(false);
  return (
    <ReceiptGroup
      tone="amber"
      glyph="◌"
      title="НЕ ДЛЯ КОМОРИ"
      count={rows.length}
      action={onNonfoodToList && !sent
        ? () => { onNonfoodToList(rows.map((r) => r.name)); setSent(true); }
        : undefined}
      actionLabel={sent ? '✓ У СПИСКУ' : 'У СПИСОК'}
      actionDisabled={sent}
      rows={rows.map((r, i) => (
        <div key={i} className={styles.rrow} style={{ color: 'var(--fg-muted)' }}>
          <span className={styles.rbox} />
          <span className={styles['rrow-name']}>{r.name}</span>
          {r.qty && <span className={styles['rrow-qty']}>{r.qty}</span>}
        </div>
      ))}
    />
  );
}

export function IntakeCard({ card, cardId, applied, applying, dismissed, undone, undoAvailable, onApply, onDismiss, onUndo, shoppingLabels, onNonfoodToList }: CardProps) {
  // 01.09 картка v2: «уточнити» переносить рядок із source.unmatched у ops
  // на сервері — локальна копія картки віддзеркалює це без переходу в
  // інший потік (той самий принцип, що RetailCartCard тримає для кошика).
  const [liveCard, setLiveCard] = useState(card);
  // UX9-17: rename/correct ФІЛЬТРУВАЛИСЬ — картка перейменування стояла без
  // жодного предметного рядка, людина тиснула «Застосувати» наосліп.
  const rawOps = (liveCard.ops as IntakeOp[] | undefined ?? []);
  // Позиції, а не знімок. Кожен застосований op несе batch_id (сервер
  // проставив на apply), тож рядок показує ЖИВУ кількість і назву. Порядок і
  // довжина масиву незмінні — індекси тримають чекбокси й `inList`, — тому
  // зʼїдене не викидається зі списку, а позначається `gone` і ховається вже
  // на рендері.
  const live = useContext(LivePositions);
  const ops = rawOps.map((op) => {
    const id = (op as { batch_id?: string }).batch_id;
    if (!id || !live || live.size === 0) return op;
    const now = live.get(id);
    // Ключа немає — позицію зʼїли. Це не помилка й не втрата: чекова книжка
    // показує лише те, що лишилось.
    if (!now) return { ...op, gone: true } as IntakeOp & { gone?: boolean };
    return { ...op, label: now.label, value: now.value ?? undefined, unit: (now.unit ?? undefined) as IntakeOp['unit'] };
  }) as (IntakeOp & { gone?: boolean })[];
  const goneCount = ops.filter((o) => o.gone).length;
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
  // M13: intake з чека — шапка-джерело, сірі «додати руками», згорнуте
  // «не для комори». apply/undo — той самий шлях, що у всіх intake.
  // Два роди чека: у мережевого є магазин, сума і розкладка каталогу;
  // у показаного в чаті — тільки те, що розібрала модель.
  const receipt = liveCard.source?.kind === 'retail_receipt' ? liveCard.source : null;
  const anyReceipt = liveCard.source?.kind === 'retail_receipt' || liveCard.source?.kind === 'chat_receipt';
  // Нехарчове двома шляхами: у чека мережі його розклав каталог при
  // розборі чека, у решти — вето каталогу над відповіддю моделі. Для
  // людини це одне й те саме, тож і група одна.
  const nonfoodRows: { name: string; qty: string }[] = [
    ...(receipt?.nonfood ?? []).map((l) => ({ name: l.name, qty: `${l.quantity} ${l.unit}` })),
    ...(liveCard.nonfood ?? []).map((l) => ({
      name: l.label,
      qty: l.value != null && l.unit ? formatQty(l.value, l.unit as never) : '',
    })),
  ];
  // 01.09: чек — не auto-apply, а картка на підтвердження зі стрикаутом.
  // Повний список одразу — «звалище»: чек легко несе 10+ позицій. Згорнуто
  // за замовчуванням, як «не для комори» нижче; для звичайного (короткого)
  // intake_diff з чату список і так короткий — розгорнутий одразу.
  const [showInList, setShowInList] = useState(false);
  // Крок 4.2: які рядки чека закриють позиції списку покупок. Той самий
  // збіг (точний за назвою, trim+lower) рахує applyCard — але вже ПІСЛЯ
  // натискання, і людина дізнавалась про наслідок постфактум. Тут вона
  // бачить його до того, як вирішить.
  const inList = new Set(
    ops.map((op, i) => (
      op.op === 'add' && op.label && shoppingLabels?.has(op.label.trim().toLowerCase()) ? i : -1
    )).filter((i) => i >= 0),
  );
  // Низ чека за законом смуги (крок 2.1): стан ліворуч моно, дії праворуч
  // у порядку «другорядна → головна». Лічильник у кнопці змінюється разом
  // із чекбоксами, тож наслідок дії відомий заздалегідь, а не після.
  const goingIn = ops.length - off.size;
  const footSlot = useContext(PanelFootSlot);
  const intakeFootRaw = anyReceipt && (actionable || (applied && !undone)) ? (
    <div className={styles['card-foot']}>
      <span className={styles['strip-state']}>
        {goingIn} {applied && !undone ? 'у коморі' : 'у комору'}
        {receipt && receipt.nonfood.length > 0 && (
          <span className={styles['strip-state-dim']}> · {receipt.nonfood.length} у побут</span>
        )}
      </span>
      {applied && !undone && undoAvailable && onUndo && (
        <Button size="strip" variant="text" onClick={onUndo}>Скасувати ↩</Button>
      )}
      {actionable && <Button size="strip" variant="text" onClick={onDismiss}>Ні</Button>}
      {actionable && (
        <Button
          size="strip"
          variant="primary"
          onClick={() => onApply!(off.size ? ops.map((_, i) => i).filter((i) => !off.has(i)) : undefined)}
          loading={applying}
          disabled={off.size === ops.length}
        >Застосувати {goingIn}</Button>
      )}
    </div>
  ) : null;
  const intakeFoot = intakeFootRaw && footSlot ? createPortal(intakeFootRaw, footSlot) : intakeFootRaw;

  return (
    <div className={stateClass(applied, undone)}>
      {anyReceipt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.015em' }}>
            {receipt ? 'Чек Сільпо' : 'Чек'}
          </div>
          {/* Мережевий чек знає магазин і суму; чек із чату — ні, і вигадувати
              їх не будемо: підзаголовок чесно коротший. */}
          <MonoLabel>
            {receipt
              ? `${receiptDate(receipt.at)} · ${receipt.shop} · ${Math.round(receipt.total)}₴`
              : receiptDate(liveCard.source!.at)}
          </MonoLabel>
        </div>
      )}
      {/* ── Чек: чотири секції замість суцільного списку ──────────────
          Групи відповідають на питання «як модель зрозуміла чек», і саме
          тому вони є навіть тоді, коли всередині нічого нема: порожня
          секція не малюється, але наявна каже, що розбір відбувся. */}
      {anyReceipt && (
        <>
          <ReceiptGroup
            tone="accent"
            glyph="●"
            title="У КОМОРУ"
            count={ops.length - off.size - goneCount}
            action={actionable && ops.length > 1
              ? () => setOff((prev) => (prev.size === ops.length ? new Set() : new Set(ops.map((_, i) => i))))
              : undefined}
            actionLabel={off.size === ops.length ? 'ПОВЕРНУТИ ВСІ' : 'ЗНЯТИ ВСІ'}
            rows={ops.map((op, i) => op.gone ? null : (
              <div key={i} className={styles.rrow} style={off.has(i) ? { opacity: 0.45 } : undefined}>
                {actionable && ops.length > 1 ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={!off.has(i)}
                    aria-label={op.label ?? 'позиція'}
                    className={`${styles.rbox} ${off.has(i) ? '' : styles['rbox-on']}`}
                    onClick={() => toggle(i)}
                  >{off.has(i) ? '' : '✓'}</button>
                ) : (
                  <span className={`${styles.rbox} ${styles['rbox-on']}`}>✓</span>
                )}
                <span className={styles['rrow-name']}>
                  {op.op === 'rename'
                    ? <>{op.label ?? '—'} → {(op as { to?: string }).to ?? '—'}</>
                    : op.label ?? '—'}
                  {inList.has(i) && (
                    <span className={styles['rrow-qty']} style={{ marginLeft: 8 }}>✓ У СПИСКУ</span>
                  )}
                </span>
                {op.value != null && op.unit && (
                  <span className={styles['rrow-qty']}>{formatQty(op.value, op.unit)}</span>
                )}
              </div>
            ))}
            tail={goneCount > 0
              ? `ще ${goneCount} ${goneCount === 1 ? 'позиція' : 'позицій'} з цього чека вже зʼїдено`
              : undefined}
          />

          {/* «Вже у списку» — НЕ п'ятий кошик рядків, а примітка про перетин.
              Позиція, що є в списку покупок, усе одно їде в комору: винести
              її окремою групою означало б прибрати її з першої. Тому тут
              лічильник і «показати», а самі рядки позначені в секції вище. */}
          {inList.size > 0 && (
            <ReceiptGroup
              tone="muted"
              glyph="✓"
              title="ВЖЕ У СПИСКУ"
              count={inList.size}
              action={() => setShowInList((v) => !v)}
              actionLabel={showInList ? 'СХОВАТИ' : 'ПОКАЗАТИ'}
            >
              {showInList && (
                <div className={styles.rrow} style={{ color: 'var(--fg-dim)' }}>
                  <span className={styles['rrow-name']}>
                    {[...inList].map((i) => ops[i]?.label).filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
            </ReceiptGroup>
          )}

          {nonfoodRows.length > 0 && <NonfoodGroup rows={nonfoodRows} onNonfoodToList={onNonfoodToList} />}

          {receipt && receipt.unmatched.length > 0 && (
            <ReceiptGroup
              tone="amber"
              glyph="◌"
              title="НЕ ВПІЗНАВ"
              count={receipt.unmatched.length}
            >
              {/* Ключ за назвою, не індексом: «ок» вирізає рядок із unmatched
                  і зсуває решту — індексний key чіпляв editing-стан одного
                  товару на назву наступного після зсуву. */}
              {receipt.unmatched.map((l, i) => (
                <ClarifyRow key={l.name} line={l} cardId={cardId} index={i} onClarified={setLiveCard} />
              ))}
            </ReceiptGroup>
          )}
        </>
      )}

      {/* Вето каталогу спрацьовує на будь-якій intake-картці, не тільки на
          чеку: дрова не місце в коморі незалежно від того, звідки про них
          дізнались. Тож група показується і тут. */}
      {!anyReceipt && nonfoodRows.length > 0 && (
        <NonfoodGroup rows={nonfoodRows} onNonfoodToList={onNonfoodToList} />
      )}
      {!anyReceipt && (
        <div className={styles.ops}>
          {ops.map((op, i) => op.gone ? null : (
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
                  className={`${styles.rbox} ${off.has(i) ? '' : styles['rbox-on']}`}
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
          {goneCount > 0 && (
            // Порожній чек виглядав би зламаним, тому кажемо прямо, скільки
            // позицій уже зʼїли. Це не список — числа досить.
            <div className={styles['op-gone-tail']}>
              ще {goneCount} {goneCount === 1 ? 'позиція' : 'позицій'} з цього запису вже зʼїдено
            </div>
          )}
        </div>
      )}
      {intakeFoot}
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


// ----- Список покупок (V5) -------------------------------------------------
// Артефакт іншої природи, ніж решта: це не картка сесії, а стан дому, що
// переживає сесію. Тому він читає живий список, а не card.items, і в нього
// немає «застосувати» — це не рішення, а сховище. Чекбокс тут означає
// «куплено», а не «взяти в роботу», як у чеку.
export function ShoppingListCard({
  items, sessionStartedAt, onToggle, onRemoveBought, onAdd, onBuildCart, buildingCart,
}: {
  items: ListItem[];
  sessionStartedAt: string | null;
  onToggle: (id: string, checked: boolean) => void;
  onRemoveBought: (ids: string[]) => void;
  onAdd: (label: string) => void;
  onBuildCart?: () => void;
  buildingCart?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const g = groupShopping(items, sessionStartedAt);
  const footSlot = useContext(PanelFootSlot);

  const row = (it: ListItem, tone?: 'fresh' | 'bought') => (
    <div
      key={it.id}
      className={`${styles.rrow} ${tone === 'fresh' ? styles['srow-fresh'] : ''}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={it.checked}
        aria-label={it.label}
        className={`${styles.rbox} ${it.checked ? styles['rbox-bought'] : ''}`}
        onClick={() => onToggle(it.id, !it.checked)}
      >{it.checked ? '✓' : ''}</button>
      <span className={`${styles['rrow-name']} ${it.checked ? styles['srow-done'] : ''}`}>{it.label}</span>
      {!it.checked && <span className={styles['srow-src']}>{sourceLabel(it)}</span>}
      {it.value != null && it.unit && (
        <span className={styles['rrow-qty']}>{formatQty(it.value, it.unit)}</span>
      )}
    </div>
  );

  const foot = (
    <div className={styles['slist-foot']}>
      {/* Поле «додати» — єдиний спосіб дописати руками, і воно завжди під
          рукою, а не за кнопкою «додати позицію». */}
      <form
        className={styles['slist-add']}
        onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v) { onAdd(v); setDraft(''); } }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ додати в список…"
          aria-label="Додати в список"
        />
      </form>
      <div className={styles['card-foot']}>
        <span className={styles['strip-state']}>{g.toBuy} до купівлі</span>
        {onBuildCart && (
          /* Шавлієва ТОНОВАНА, не чорнильна: це перехід до збирання кошика,
             а не чекаут. Чорнильна в системі означає остаточну дію. */
          <Button size="strip" variant="soft" onClick={onBuildCart} loading={buildingCart} disabled={!g.toBuy}>
            Зібрати кошик у Сільпо →
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.card}>
      {/* Мета під назвою, а не поруч: на 320 вони ділили рядок, і «Список
          покупок» ламався надвоє. Той самий порядок, що в кошика й чека. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.015em' }}>
          Список покупок
        </div>
        <MonoLabel>
          {items.length} {plural(items.length, ['ПОЗИЦІЯ', 'ПОЗИЦІЇ', 'ПОЗИЦІЙ'])}
          {g.bought.length > 0 ? ` · ${g.bought.length} КУПЛЕНО` : ''}
        </MonoLabel>
      </div>

      {g.fresh.length > 0 && (
        <ReceiptGroup tone="accent" glyph="●" title="ЩОЙНО ДОДАНО" count={g.fresh.length}
          rows={g.fresh.map((it) => row(it, 'fresh'))} />
      )}
      {g.earlier.length > 0 && (
        <ReceiptGroup tone="muted" glyph="·" title="РАНІШЕ" count={g.earlier.length}
          rows={g.earlier.map((it) => row(it))} />
      )}
      {g.bought.length > 0 && (
        <ReceiptGroup
          tone="muted" glyph="✓" title="КУПЛЕНО" count={g.bought.length}
          action={() => onRemoveBought(g.bought.map((i) => i.id))}
          actionLabel="ПРИБРАТИ"
          rows={g.bought.map((it) => row(it, 'bought'))}
        />
      )}
      {items.length === 0 && (
        <div style={{ padding: '10px 0', color: 'var(--fg-muted)', fontFamily: 'var(--font-body)', fontSize: 15 }}>
          Список порожній. Додай позицію нижче або попроси Кухню.
        </div>
      )}
      {footSlot ? createPortal(foot, footSlot) : foot}
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
  const [listed, setListed] = useState<Set<number>>(new Set());
  const pressTimer = useRef<number | null>(null);
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

  // Наявність — тоном, а не гліфом (V2). Те, що вже вдома, іде вниз мутед-
  // сірим: так «БРАКУЄ N» у низу читається просто проти верху списку, і
  // око не мусить вишукувати ○ серед ●. Порядок приготування живе в
  // кроках, не в переліку інгредієнтів, — переставляти тут безпечно.
  const ordered = scaled.ing
    .map((ing, i) => ({ ing, i }))
    .sort((a, b) => Number(!!a.ing.p) - Number(!!b.ing.p));
  const missIdx = scaled.ing.map((ing, i) => (!ing.p && ing.n ? i : -1)).filter((i) => i >= 0);
  const leftToList = missIdx.filter((i) => !listed.has(i));

  function addOne(i: number) {
    const ing = scaled.ing[i];
    if (!ing?.n || !onNeedToList) return;
    onNeedToList(ing.n, ing.v, ing.u, r!.t);
    setListed((prev) => new Set(prev).add(i));
  }
  function pressStart(i: number) {
    pressTimer.current = window.setTimeout(() => { addOne(i); pressTimer.current = null; }, 500);
  }
  function pressEnd() {
    if (pressTimer.current !== null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }
  function addAllMissing() {
    leftToList.forEach(addOne);
  }


  const footSlot = useContext(PanelFootSlot);
  const headSlot = useContext(PanelHeadSlot);

  // V7: у смузі максимум ДВІ кнопки. «У рецепти» і «Поділитись» — про
  // навігацію, а не про роботу з рецептом, тож вони їдуть у шапку
  // артефакта іконками. Слота немає (стрічка) — лишаються в смузі, бо
  // інакше зникли б зовсім.
  const headRaw = (
    <>
      {onSaveRecipe && (
        <button
          type="button"
          disabled={saved}
          onClick={() => onSaveRecipe(rid)}
          className={styles['head-act']}
          title={saved ? 'Уже в рецептах' : 'У рецепти'}
          aria-label={saved ? 'Уже в рецептах' : 'У рецепти'}
        >{saved ? '✓' : '✎'}</button>
      )}
      {onShare && (
        <button
          type="button"
          onClick={() => onShare(scaled, rid)}
          className={styles['head-act']}
          title="Поділитись"
          aria-label="Поділитись"
        >↗</button>
      )}
    </>
  );

  // Смуга: стан ліворуч, дії праворуч у порядку «другорядна → головна».
  // Головна завжди крайня права — місце під великий палець і під очікування.
  const footRaw = (
    <div className={styles['card-foot']}>
      {missIdx.length > 0 && onNeedToList && (
        <span className={`${styles['strip-state']} ${styles['strip-state-warn']}`}>
          ○ БРАКУЄ {missIdx.length}
        </span>
      )}
      {missIdx.length > 0 && onNeedToList && (
        <Button
          size="strip"
          variant="text"
          disabled={!leftToList.length}
          onClick={addAllMissing}
        >{leftToList.length ? 'У список' : '✓ у списку'}</Button>
      )}
      {onCook && (
        <Button size="strip" variant="positive" onClick={() => onCook(scaled, rid)}>
          Готуємо → Cook Mode
        </Button>
      )}
      {!headSlot && <span className={styles['strip-head-fallback']}>{headRaw}</span>}
    </div>
  );
  const recipeFoot = footSlot ? createPortal(footRaw, footSlot) : footRaw;
  const recipeHead = headSlot ? createPortal(headRaw, headSlot) : null;

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
        {/* Підказка — просто абзац мутед-кольору під метаданими. Бурштинова
            риска робила з поради попередження; тон і місце вже кажуть, що
            це репліка Кухні. */}
        {r.rk && (
          <div style={{
            marginTop: 8,
            fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.5,
          }}>{r.rk}</div>
        )}
      </div>

      {/* Секції розділяє відстань, а не заголовок: 20px між блоками проти
          9px між рядками. Нумерація 1-4 і так каже, що це план, а список без
          цифр — що це інгредієнти. Підписи ІНГРЕДІЄНТИ / ПЛАН прибрані. */}
      <div className={styles['recipe-msg-cols']}>
        <div className={styles['recipe-list']}>
          {ordered.map(({ ing, i }) => {
            const missing = !ing.p;
            const added = listed.has(i);
            return (
              <div
                key={i}
                className={styles['recipe-ing']}
                /* Точкове додавання — довгий тап по рядку. Рідкісний випадок
                   не заслуговує на постійну колонку «+» у кожному рядку. */
                title={missing && !added ? 'Довге натискання — додати лише це' : undefined}
                onPointerDown={missing && !added && onNeedToList ? () => pressStart(i) : undefined}
                onPointerUp={pressEnd}
                onPointerLeave={pressEnd}
                style={missing ? undefined : { color: 'var(--fg-dim)' }}
              >
                <span className={styles['recipe-ing-name']}>
                  {ing.n ?? (ing.p && batchLabels?.get(ing.p)) ?? 'з комори'}
                  {added && <span className={styles['recipe-ing-added']}> ✓ у списку</span>}
                </span>
                {ing.v != null && ing.u
                  ? <span className={styles['recipe-ing-qty']}>{formatQty(ing.v, ing.u)}</span>
                  : !missing ? <span className={styles['recipe-ing-qty']}>є вдома</span> : null}
              </div>
            );
          })}
        </div>

        <div className={styles['recipe-list']}>
          {/* Усі кроки одразу. «Показати всі N» прибрано: тіло панелі
              скролиться саме́, і ховати від людини половину плану заради
              економії висоти в скрольованій колонці немає сенсу. */}
          {scaled.st.map((step: typeof scaled.st[number], i: number) => (
            <div key={i} className={styles['recipe-step']}>
              <span className={styles['recipe-step-n']}>{i + 1}</span>
              <span className={styles['recipe-step-t']}>
                {step.t}
                {!!step.s && (
                  <span className={styles['recipe-step-s']}>
                    {' '}▷ {Math.floor(step.s / 60)}:{String(step.s % 60).padStart(2, '0')}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {recipeHead}
      {recipeFoot}
    </div>
  );
}


// ----- Cart (M13, канвас М3) -----------------------------------------------
// Два імені однієї речі: наше — головне (те, що людина писала в список),
// назва Сільпо — другим рядком mono, як «паспортні дані» товару.
// «Немає в цій філії» — бурштин-факт, не error. Кнопка темна з ↗ — вихід
// назовні, не наша шавлієва дія; чекаут цілком на боці мережі.
export function RetailCartCard({ card: initial, cardId }: CardProps) {
  // Заміна правиться на сервері (updateMessageCard) — локальний стан лише
  // віддзеркалює оновлену картку з відповіді.
  const [card, setCard] = useState(initial);
  const [swapping, setSwapping] = useState<number | null>(null);
  // 01.09: «додати окремо» — інша дія, свій індикатор завантаження, щоб
  // не блокувати сусідні кнопки заміни/додавання на тому самому рядку.
  const [adding, setAdding] = useState<number | null>(null);
  // 01.09 картка v2: степер кількості — теж свій індикатор, той самий
  // принцип: одна активна мутація на всю картку одночасно.
  const [qtyBusy, setQtyBusy] = useState<number | null>(null);
  // Кіт: заміна щойно записалась у стан — рядок і футер мусять це показати,
  // не просто перемалюватись мовчки.
  const [justSwapped, setJustSwapped] = useState<number | null>(null);
  // 01.09 рівень 1: альтернативи показують перші кілька, решта — під тапом.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // V3: розкритий список показує три найближчі, решта — під «ще N ▾».
  // Два стани, а не один: «відкрито взагалі» і «відкрито повністю».
  const [showAllAlts, setShowAllAlts] = useState<Set<number>>(new Set());
  const rows = card.rows ?? [];
  const busy = swapping !== null || adding !== null || qtyBusy !== null;
  async function swap(i: number, altIndex: number) {
    if (!cardId || busy) return;
    setSwapping(i);
    try {
      const r = await api.retail.cartSwap(cardId, i, altIndex);
      setCard(r.card);
      setJustSwapped(i);
    } catch { /* рядок лишається з пропозицією */ } finally { setSwapping(null); }
  }
  // 01.09: додає альтернативу ОКРЕМИМ рядком, оригінал не чіпає — «побачив
  // банановий Швепс серед альтернатив, хочу і його теж».
  async function addAlt(i: number, altIndex: number) {
    if (!cardId || busy) return;
    setAdding(i);
    try {
      const r = await api.retail.cartAddAlt(cardId, i, altIndex);
      setCard(r.card);
      setJustSwapped((r.card.rows ?? []).length - 1);
    } catch { /* рядок лишається з пропозицією */ } finally { setAdding(null); }
  }
  // 01.09 картка v2: степер — сервер сам округлює за типом (вагове 0.1,
  // кількісне/обсягове ціле) і перераховує ціну/total.
  async function updateQty(i: number, next: number) {
    if (!cardId || busy || next <= 0) return;
    setQtyBusy(i);
    try {
      const r = await api.retail.cartUpdateQty(cardId, i, next);
      setCard(r.card);
    } catch { /* лишається зі старою кількістю */ } finally { setQtyBusy(null); }
  }
  function toggleExpanded(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }
  const footSlot = useContext(PanelFootSlot);
  // Підвал кошика: сума нерозривна, на вузькому чесно стає двома рядками —
  // сума, під нею кнопка праворуч (раніше без wrap ламалась сама сума,
  // «3 з ⏎ 3»). Геометрію тепер задає клас, а не інлайн: у слоті панелі
  // рамку й відступи малює .rail-foot, і інлайновий стиль її не перебиває.
  const footRaw = (
    <div className={styles['card-foot']}>
      <span className={styles['strip-state']}>
        <RollingNumber value={card.total ?? 0} />₴
        <span className={styles['strip-state-dim']}>
          {' · '}<RollingNumber value={card.found ?? 0} /> з {card.of}
        </span>
      </span>
      {/* Чорнильна: вихід із продукту, чекаут цілком на боці мережі.
          Одна на артефакт — другої дії в кошику немає. */}
      <a
        href={card.cart_url}
        target="_blank"
        rel="noreferrer"
        className={styles['strip-main']}
      >Оформити в Сільпо ↗</a>
    </div>
  );
  const cartFoot = footSlot ? createPortal(footRaw, footSlot) : footRaw;

  return (
    <div className={styles.card}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.015em' }}>
          Кошик у Сільпо
        </div>
        <MonoLabel>ЗІ СПИСКУ ПОКУПОК</MonoLabel>
      </div>
      <div className={styles.ops}>
        {rows.map((r, i) => {
          const alts = r.alternatives ?? [];
          const isExpanded = expanded.has(i);
          const p = r.product;
          const step = p?.weighted ? 0.1 : 1;
          const qtyLabel = p ? (p.weighted ? p.quantity.toLocaleString('uk-UA', { maximumFractionDigits: 2 }) : String(p.quantity)) : '';
          // Обсягове: скільки всього виходить при поточній кількості пляшок.
          const totalMl = p?.package_ml ? p.package_ml * p.quantity : null;
          return (
            <div
              key={i}
              className={`${styles['cart-item']} ${justSwapped === i ? styles['row-changed'] : ''}`}
            >
              {/* Рівень 1: наше імʼя · степер · одиниця · ціна. */}
              <div className={styles['cart-item-top']}>
                <span
                  className={`${styles['cart-name']} ${justSwapped === i ? styles['row-text-in'] : ''}`}
                  style={p ? undefined : { color: 'var(--fg-dim)' }}
                >
                  {r.label}
                </span>
                {p && (
                  <>
                    <div className={styles['cart-stp']}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateQty(i, Math.round((p.quantity - step) * 100) / 100)}
                        aria-label="менше"
                        style={{ opacity: qtyBusy === i ? 0.5 : 1 }}
                      >−</button>
                      <span className={styles['cart-qty']}>{qtyLabel}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateQty(i, Math.round((p.quantity + step) * 100) / 100)}
                        aria-label="більше"
                        style={{ opacity: qtyBusy === i ? 0.5 : 1 }}
                      >+</button>
                    </div>
                    <span className={styles['cart-unit']}>{p.weighted ? 'кг' : 'шт'}</span>
                    <span className={styles['cart-price']}>{Math.round(p.price * p.quantity)}₴</span>
                  </>
                )}
              </div>

              {/* Рівень 2: паспортна назва одним рядком · вхід в альтернативи.
                  Наше імʼя («молоко») не ріжеться ніколи — воно коротке за
                  природою; ріжеться саме паспортна назва, а повна лишається
                  в title і в розкритому списку. */}
              <div className={styles['cart-item-sub']}>
                <span
                  className={styles['cart-passport']}
                  style={p ? undefined : { color: 'var(--amber)' }}
                  title={p ? p.name : undefined}
                >
                  {p ? p.name : 'немає в цій філії'}
                </span>
                {alts.length > 0 && (
                  <button
                    type="button"
                    className={styles['cart-swap-link']}
                    onClick={() => toggleExpanded(i)}
                    aria-expanded={isExpanded}
                  >
                    ЗАМІНИТИ {alts.length} {isExpanded ? '⌄' : '›'}
                  </button>
                )}
              </div>

              {p?.package_ml && totalMl != null && (
                <div className={styles['cart-vol']}>
                  × {(p.package_ml / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} л
                  {' ≈ '}
                  {(totalMl / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} л всього
                </div>
              )}

              {/* Альтернативи розкриваються ВСЕРЕДИНІ позиції, а не окремим
                  екраном. Перші три, решта під «ще N ▾»: у макеті так лише
                  на 480, але поведінка одна на всі ширини — панель тепер
                  тягнеться, і робити її вміст різним за шириною означало б
                  два різні продукти в одному вікні. */}
              {isExpanded && alts.length > 0 && (
                <div className={styles['cart-alts']}>
                  {p && (
                    <div className={styles['cart-alt-warn']}>
                      «⇄» перезапише позицію тут; стара може лишитись у кошику Сільпо — прибери вручну
                    </div>
                  )}
                  {(showAllAlts.has(i) ? alts : alts.slice(0, 3)).map((a, ai) => (
                    <div key={ai} className={styles['cart-alt']}>
                      <span className={styles['cart-alt-name']} title={a.name}>{a.name}</span>
                      <span className={styles['cart-alt-price']}>{Math.round(a.price * a.quantity)}₴</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void swap(i, ai)}
                        className={styles['cart-alt-btn']}
                        title="замінити цією"
                        aria-label={`замінити на ${a.name}`}
                        style={{
                          border: '1px solid var(--accent-border)', background: 'var(--accent-bg)',
                          color: 'var(--accent)', opacity: swapping === i ? 0.5 : 1,
                        }}
                      >⇄</button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addAlt(i, ai)}
                        className={styles['cart-alt-btn']}
                        title="додати окремим рядком"
                        aria-label={`додати ${a.name} окремо`}
                        style={{
                          border: '1px solid var(--border)', background: 'none',
                          color: 'var(--fg-dim)', opacity: adding === i ? 0.5 : 1,
                        }}
                      >+</button>
                    </div>
                  ))}
                  {alts.length > 3 && !showAllAlts.has(i) && (
                    <button
                      type="button"
                      className={styles['cart-alt-more']}
                      onClick={() => setShowAllAlts((prev) => new Set(prev).add(i))}
                    >
                      ЩЕ {alts.length - 3} ▾
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {cartFoot}
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
// appliedCount — 01.09: реальна кількість, яку повернув сервер (applyCard).
// Без цього тост завжди рахував card.ops.length — ПОВНИЙ список, ігноруючи
// стрикаут: «Застосувати 9» тиснеш, а тост і бейдж кажуть «10».
export function appliedToast(card: ChatCard, appliedCount?: number): string {
  if (card.type === 'cook_photo') {
    return card.recipe_title ? `Фото до «${card.recipe_title}» — у журналі` : 'Фото в журналі';
  }
  if (card.type === 'recipe') {
    const t = (card.recipe as Recipe | undefined)?.t;
    return t ? `«${t}» — у рецептах` : 'Рецепт збережено';
  }
  const count = appliedCount ?? (card.type === 'shopping' || card.type === 'proposal'
    ? (card.items?.length ?? 0)
    : (card.ops?.length ?? 0));
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
