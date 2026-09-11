// Типи карток: intake_diff, proposal, shopping, recipe. Кожна — компонент.
// Дизайн зі стрічки брифу: без бордер-колообгортки, тримаємось лініями й розділами
// з mono-мітками. Стан (applied/undone) прикручує клас — картка притлумлюється.

import { formatModelEstimate } from '../../lib/nutrition';
import { Icon } from '../../components/Icon/Icon';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PanelFootSlot, PanelHeadSlot } from './panel-slots';
import { PeriodEvent, PeriodSeries, periodForm } from '../../components/PeriodArtifact/PeriodArtifact';
import { dedupeTitle, seriesTitle, shortDate, TRADITION_LABEL } from '../../lib/period';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, type ChatCard, type Recipe, type ReceiptLeftover, type EventOccurrence, type ProfileFieldV2 } from '../../api';
import { OnboardingCard } from './OnboardingCard';
// Аудит раунд 3, крок 2: підпис кнопки — з card-modes.ts, не окрема правда
// на фронті. Субпуть, не '@kitchen/domain' — той тягне Repo/node:crypto,
// а веб серверний код не бандлить (той самий принцип, що whenLabel у when.ts).
import { CARD_BUTTON_LABEL, applyMode } from '@kitchen/domain/card-modes';
import { PROFILE_FIELDS } from '@kitchen/domain/profile-fields';
import { formatDuration } from '@kitchen/domain/duration';
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

export { PanelFootSlot, PanelHeadSlot } from './panel-slots';

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
  // Раунд 4 §4: «Нічого такого» на картці поля `ban` — застосування зі status none.
  onNone?: () => void;
  // Крок 7: картка «Про тебе» — стан панелей і зворотні виклики.
  profileFields?: Record<string, ProfileFieldV2> | null;
  onProfilePatched?: () => void;
  onSummary?: () => void;
  onUndo?: () => void;
  onOpen?: (index: number) => void;
  // П2: картка period у стрічці — один кадр із дією «Відкрити», що веде в панель.
  onOpenArtifact?: () => void;
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

// Аудит 04.09 (3.3): confidence з картки ніде не показувався, хоч лендинг
// обіцяє «домислено 60%» як перше правило довіри. Поріг той самий, що в
// [КОМОРА] (isDoubtful у @kitchen/domain): нижче 0.8 або evidence: inference.
/** Позначка групи: залите коло — є/зроблено, кільце — чекає, знак — куплено. */
function GroupMark({ mark }: { mark: 'dot' | 'ring' | 'done' | 'none' }) {
  if (mark === 'none') return null;
  if (mark === 'done') return <Icon name="sys.done" size={12} inherit decorative />;
  return <span className={mark === 'dot' ? styles['gmark'] : styles['gmark-ring']} aria-hidden />;
}

function doubtLabel(op: { confidence?: number; evidence?: string }): string | null {
  const c = op.confidence;
  const doubtful = op.evidence === 'inference' || (typeof c === 'number' && c < 0.8);
  if (!doubtful) return null;
  return typeof c === 'number' ? `домислено ${Math.round(c * 100)}%` : 'домислено';
}
const DOUBT_STYLE = { marginLeft: 8, fontSize: 13, color: 'var(--amber, #96712c)' as const };
/** Паспорт рядка чека — «бренд · тип» із трійки op (Screens: «Сільпо · ковбаса с/в»). */
function passportOf(op: object): string {
  const o = op as { brand?: string; variant?: string };
  return [o.brand, o.variant].filter(Boolean).join(' · ');
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
  // Screens «Чат · збірка» / Components: рядок 40 — пунктирна рамка 20 r6
  // бурштином · «сирий рядок чека» 14 muted · ціна 13 muted; під ним чіпи
  // 32/999 на bg. У бандлі чіпи — здогадки каталогу («шоколад», «солодке») і
  // «✎ своє»; контракт уточнення тут інший — кількість і одиниця
  // (clarifyLine), тож чіп один: «уточнити» → степер, «ок» переносить рядок
  // у ops тим самим шляхом, що впізнане каталогом.
  return (
    <div className={styles['rc-unk']}>
      <div className={styles['rc-unk-row']}>
        <span className={`${styles.rbox} ${styles['rbox-unknown']}`} aria-hidden />
        <span className={styles['rc-unk-name']}>«{line.name}»</span>
        {line.price > 0 && <span className={styles['rrow-qty']}>{Math.round(line.price)} ₴</span>}
      </div>
      <div className={styles['rc-unk-chips']}>
        {!editing ? (
          <button type="button" className={styles['rc-chip']} onClick={() => setEditing(true)}>
            <Icon name="live.byHand" size={12} inherit decorative />уточнити
          </button>
        ) : (
          <>
            <span className={styles['rc-stepper']}>
              <button type="button" disabled={busy} onClick={() => setValue((v) => Math.max(1, v - 1))} aria-label="Менше"><Icon name="live.nothing" size={12} inherit decorative /></button>
              <span className={styles['rc-stepper-n']}>{value}</span>
              <button type="button" disabled={busy} onClick={() => setValue((v) => v + 1)} aria-label="Більше"><Icon name="sys.add" size={12} inherit decorative /></button>
              <span className={styles['rc-stepper-u']}>{formatUnit(line.unit)}</span>
            </span>
            <button
              type="button"
              className={`${styles['rc-chip']} ${styles['rc-chip-ok']}`}
              disabled={busy || !cardId}
              onClick={async () => {
                if (!cardId) return;
                setBusy(true);
                try {
                  const r = await api.cards.clarifyLine(cardId, index, value, line.unit);
                  onClarified(r.card);
                } catch { setBusy(false); }
              }}
            >ок</button>
          </>
        )}
      </div>
    </div>
  );
}

// Секція чека: шапка з лічильником і груповою дією, рядки, «ще N ▾».
// Згортання до чотирьох — не економія місця, а мета подання: панель має
// показати СТРУКТУРУ рішення (скільки в комору, скільки в побут, скільки
// не впізнано), а не всі дев'ятнадцять позицій одразу.
function ReceiptGroup({
  tone, mark, title, count, action, actionLabel, actionTone, actionDisabled, children, rows, tail,
}: {
  tone: 'accent' | 'amber' | 'muted';
  /** Тон дії групи: muted (Screens «зняти всі») · sage («у список побуту») · amber («уточнити»). */
  actionTone?: 'sage' | 'amber';
  /** Стан групи, не символ. Був `glyph: string` із гліфами ◌ ● ✓ прямо в
   *  розмітці — вони пережили етапи 1.5 і 1.6, бо картки чату відкриваються
   *  лише з даними, а прогін аудиту туди не заходить (DEBT §26). */
  mark: 'dot' | 'ring' | 'done' | 'none';
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
  // Screens «Чат · збірка»: шість рядків, далі «Ще N ▾».
  const shown = real && !all ? real.slice(0, 6) : real;
  const hidden = real ? real.length - (shown?.length ?? 0) : 0;
  return (
    <div className={styles.rgroup}>
      <div className={styles['rgroup-head']}>
        <span className={`${styles['rgroup-title']} ${styles[`tone-${tone}`]}`}>
          <GroupMark mark={mark} /> {title} · {count}
        </span>
        {action && actionLabel && (
          <button
            type="button"
            className={`${styles['rgroup-act']} ${actionTone === 'amber' ? styles['tone-amber'] : actionTone === 'sage' ? styles['tone-accent'] : ''}`}
            onClick={action}
            disabled={actionDisabled}
          >{actionLabel}</button>
        )}
      </div>
      {shown}
      {children}
      {tail && <div className={styles['rgroup-tail']}>{tail}</div>}
      {hidden > 0 && (
        /* Screens «Чат · збірка»: «Ще 6 ▾» — 36, 13 muted, шеврон зі словника. */
        <button type="button" className={styles['rgroup-more']} onClick={() => setAll(true)}>
          Ще {hidden}<Icon name="sys.open" size={12} inherit decorative />
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
      tone="muted"
      mark="none"
      actionTone="sage"
      title="Не для комори"
      count={rows.length}
      action={onNonfoodToList && !sent
        ? () => { onNonfoodToList(rows.map((r) => r.name)); setSent(true); }
        : undefined}
      /* Screens: «у список побуту» шавлією в шапці групи; рядки — тихі, без
         чекбокса (бандл ставить знак роду речі — spray-can, shopping-basket —
         яких у словнику нема; замість них порожнє місце). */
      actionLabel={sent ? 'у списку побуту' : 'у список побуту'}
      actionDisabled={sent}
      rows={rows.map((r, i) => (
        <div key={i} className={`${styles.rrow} ${styles['rrow-quiet']}`}>
          <span className={styles['rrow-gap']} aria-hidden />
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
    // Етап 1.6: гліф ✎ знято — знак «рукою» зі словника.
    if (op === 'rename' || op === 'correct') return 'live.byHand';
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
  // Списання — той самий тип картки, але ops не додають. Заголовок мусить це
  // казати: «У КОМОРУ» на картці, що ЗАБИРАЄ з комори, — пряма брехня, і саме
  // вона стояла після готування карбонари (живий репро 02.09).
  const writeOff = ops.length > 0 && !ops.some((o) => o.op === 'add');
  const goingIn = ops.length - off.size;
  const footSlot = useContext(PanelFootSlot);
  // Низ за Screens «Чат · збірка»: «15 додамо додому · 3 уже в списку · 2 не
  // їжа, у список» 13 muted · «Ні» текстом 38 · «Застосувати 15» чорнилом
  // 38 r10 13/600 — число те, яке справді застосує.
  const inListOn = [...inList].filter((i) => !off.has(i)).length;
  const intakeFootRaw = anyReceipt && (actionable || (applied && !undone)) ? (
    <div className={`${styles['card-foot']} ${styles['rc-foot']}`}>
      <span className={styles['rc-sum']}>
        {goingIn} {writeOff
          ? (applied && !undone ? 'є вдома' : 'використаємо')
          : (applied && !undone ? 'уже вдома' : 'додамо додому')}
        {inListOn > 0 && <> · {inListOn} уже в списку</>}
        {nonfoodRows.length > 0 && <> · {nonfoodRows.length} не їжа, у список</>}
      </span>
      {applied && !undone && undoAvailable && onUndo && (
        <button type="button" className={styles['rc-no']} onClick={onUndo}>Скасувати</button>
      )}
      {actionable && <button type="button" className={styles['rc-no']} onClick={onDismiss}>Ні</button>}
      {actionable && (
        <button
          type="button"
          className={styles['rc-apply']}
          onClick={() => onApply!(off.size ? ops.map((_, i) => i).filter((i) => !off.has(i)) : undefined)}
          disabled={applying || off.size === ops.length}
          data-apply
        >{writeOff ? 'Списати' : 'Застосувати'} {goingIn}</button>
      )}
    </div>
  ) : null;
  const intakeFoot = intakeFootRaw && footSlot ? createPortal(intakeFootRaw, footSlot) : intakeFootRaw;

  return (
    <div className={stateClass(applied, undone)}>
      {anyReceipt && (
        /* Шапка документа за Screens: «Чек Сільпо · 07.09» 15/600 · «19 рядків»
           13 dim (сума — з Components «7 вер · 1 284 ₴ · 14»). Мережевий чек
           знає магазин і суму; чек із чату — ні, і вигадувати їх не будемо. */
        <div className={styles['rc-head']}>
          <span className={styles['rc-title']}>{receipt ? `Чек ${receipt.shop}` : 'Чек'} · {receiptDate(liveCard.source!.at)}</span>
          <span className={styles['rc-meta']}>
            {ops.length + nonfoodRows.length + (receipt?.unmatched.length ?? 0)} {plural(ops.length + nonfoodRows.length + (receipt?.unmatched.length ?? 0), ['рядок', 'рядки', 'рядків'])}
            {receipt ? ` · ${String(Math.round(receipt.total)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴` : ''}
          </span>
        </div>
      )}
      {/* ── Чек: чотири секції замість суцільного списку ──────────────
          Групи відповідають на питання «як модель зрозуміла чек», і саме
          тому вони є навіть тоді, коли всередині нічого нема: порожня
          секція не малюється, але наявна каже, що розбір відбувся. */}
      {anyReceipt && (
        <>
          {/* Screens «Чат · збірка»: «У комору · 15» шавлією · «зняти всі»;
              рядок 40 — чекбокс 20 r6, назва 14/500 + паспорт 12 dim (бренд ·
              тип з трійки op), «у списку» 12 шавлією зі знаком списку,
              кількість 13 muted. Увесь рядок — тогл (Prototype), знятий — .5. */}
          <ReceiptGroup
            tone="accent"
            mark="none"
            title={writeOff ? 'З комори' : 'У комору'}
            count={ops.length - off.size - goneCount}
            action={actionable && ops.length > 1
              ? () => setOff((prev) => (prev.size === ops.length ? new Set() : new Set(ops.map((_, i) => i))))
              : undefined}
            actionLabel={off.size === ops.length ? 'повернути всі' : 'зняти всі'}
            rows={ops.map((op, i) => op.gone ? null : (
              <div key={i} className={`${styles.rrow} ${off.has(i) ? styles['rrow-off'] : ''} ${actionable && ops.length > 1 ? styles['rrow-tap'] : ''}`}
                onClick={actionable && ops.length > 1 ? () => toggle(i) : undefined}>
                {actionable && ops.length > 1 ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={!off.has(i)}
                    aria-label={op.label ?? 'позиція'}
                    className={`${styles.rbox} ${off.has(i) ? '' : styles['rbox-on']}`}
                    onClick={(e) => { e.stopPropagation(); toggle(i); }}
                  >{off.has(i) ? null : <Icon name="sys.done" size={12} inherit decorative />}</button>
                ) : (
                  <span className={`${styles.rbox} ${styles['rbox-on']}`}><Icon name="sys.done" size={12} inherit decorative /></span>
                )}
                <span className={styles['rrow-name']}>
                  <span className={styles['rrow-title']}>
                    {op.op === 'rename'
                      ? <>{op.label ?? '—'} <Icon name="sys.next" size={12} inherit decorative /> {(op as { to?: string }).to ?? '—'}</>
                      : op.label ?? '—'}
                    {doubtLabel(op) && <span style={DOUBT_STYLE}>{doubtLabel(op)}</span>}
                  </span>
                  {passportOf(op) && <span className={styles['rrow-sub']}>{passportOf(op)}</span>}
                </span>
                {inList.has(i) && (
                  <span className={styles['rrow-inlist']} data-in-list><Icon name="sys.list" size={12} inherit decorative />у списку</span>
                )}
                {op.value != null && op.unit && (
                  <span className={styles['rrow-qty']}>{formatQty(op.value, op.unit)}</span>
                )}
              </div>
            ))}
            tail={goneCount > 0
              ? `ще ${goneCount} з цього чека вже закінчилось`
              : undefined}
          />

          {nonfoodRows.length > 0 && <NonfoodGroup rows={nonfoodRows} onNonfoodToList={onNonfoodToList} />}

          {receipt && receipt.unmatched.length > 0 && (
            <ReceiptGroup
              tone="amber"
              mark="none"
              title="Не впевнений"
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
                >{off.has(i) ? null : <Icon name="sys.done" size={12} inherit decorative />}</span>
              )}
              <span className={styles['op-sign']}>{signFor(op.op)}</span>
              <span className={styles['op-label']}>
                {op.op === 'rename'
                  ? <>{op.label ?? '—'} <Icon name="sys.next" size={12} inherit decorative /> {(op as { to?: string }).to ?? '—'}</>
                  : op.label ?? '—'}
                {op.op === 'correct' && (op as { zone?: string }).zone && (
                  <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--dim)' }}>
                    <Icon name="sys.next" size={12} inherit decorative /> {ZONE_LABELS[(op as { zone?: string }).zone!] ?? (op as { zone?: string }).zone}
                  </span>
                )}
                {doubtLabel(op) && <span style={DOUBT_STYLE}>{doubtLabel(op)}</span>}
              </span>
              {op.value != null && op.unit && (
                <span className={styles['op-qty']}>{op.op === 'correct' ? <><Icon name="sys.next" size={12} inherit decorative /> </> : null}{formatQty(op.value, op.unit)}</span>
              )}
            </div>
          ))}
          {goneCount > 0 && (
            // Порожній чек виглядав би зламаним, тому кажемо прямо, скільки
            // позицій уже зʼїли. Це не список — числа досить.
            <div className={styles['op-gone-tail']}>
              ще {goneCount} {goneCount === 1 ? 'позиція' : 'позицій'} з цього запису вже закінчилось
            </div>
          )}
        </div>
      )}
      {intakeFoot}
      {!receipt && applied && !undone && undoAvailable && onUndo && (
        <div className={styles['card-actions']}>
          <Button variant="secondary" onClick={onUndo}>Скасувати</Button>
        </div>
      )}
    </div>
  );
}

// ----- Proposal ------------------------------------------------------------

export function ProposalCard({ card, onOpen, onRefine }: CardProps) {
  const items = (card.items as ProposalItem[] | undefined ?? []);
  // 6b-4 — картка пропозицій за Prototype (propDesk): одна картка r16 на
  // тіні, 0 18, пропозиції рядками через волосину; розгорнута — знак 44,
  // назва 18/600, рядок 13 muted, чіпи 26 (бурштин — те, що горить; решта на
  // bg), дії колом 36 (cooking-pot шавлією, reply контуром); згорнута —
  // знак 44 muted, назва 15/600, «бракує …» 12 бурштином, «+» 36. Одна
  // розгорнута за раз — як на кадрі. «8 з 8 удома», час і ккал у пропозиції
  // ще немає (Р37): їх приносить лише згенерований рецепт.
  const [openIdx, setOpenIdx] = useState(0);
  if (items.length === 0) return null;
  return (
    <div className={styles['prop-card']} data-proposals>
      {items.map((it, i) => {
        const title = it.title ?? '—';
        const needs = it.needs ?? [];
        const rescues = it.rescues ?? [];
        if (i !== openIdx) {
          return (
            <div key={i} className={`${styles['prop-row']} ${styles['prop-row-closed']}`} data-proposal="closed">
              <span className={`${styles['prop-ico']} ${styles['prop-ico-muted']}`}><Icon name="cook.type" size={18} inherit decorative /></span>
              <span className={styles['prop-body']}>
                <span className={styles['prop-title-sm']}>{title}</span>
                {needs.length > 0
                  ? <span className={styles['prop-sub-amber']}>бракує: {needs.join(', ')}</span>
                  : it.character ? <span className={styles['prop-sub']}>{it.character}</span> : null}
              </span>
              <button type="button" className={styles['prop-act']} onClick={() => setOpenIdx(i)} aria-label={`Розгорнути «${title}»`} title="Розгорнути">
                <Icon name="sys.add" size={16} inherit decorative />
              </button>
            </div>
          );
        }
        return (
          <div key={i} className={styles['prop-row']} data-proposal="open">
            <span className={styles['prop-ico']}><Icon name="cook.type" size={20} inherit decorative /></span>
            <span className={styles['prop-body']}>
              <span className={styles['prop-title']}>{title}</span>
              {it.character && <span className={styles['prop-meta']}><span>{it.character}</span></span>}
              {it.desc && <span className={styles['prop-desc']}>{it.desc}</span>}
              {it.why && <span className={styles['prop-desc']}>{it.why}</span>}
              {needs.length > 0 && <span className={styles['prop-sub-amber']}>бракує: {needs.join(', ')}</span>}
              {rescues.length > 0 && (
                <span className={styles['prop-chips']}>
                  {rescues.map((r, j) => (
                    <span key={j} className={`${styles['prop-chip']} ${styles['prop-chip-amber']}`}><Icon name="live.burning" size={12} inherit decorative />{r}</span>
                  ))}
                </span>
              )}
            </span>
            {(onOpen || onRefine) && (
              <span className={styles['prop-actions']}>
                {onOpen && (
                  <button type="button" className={`${styles['prop-act']} ${styles['prop-act-sage']}`} onClick={() => onOpen(i)} aria-label={`Готуємо «${title}»`} title="Готуємо" data-proposal-open>
                    <Icon name="cook.go" size={16} inherit decorative />
                  </button>
                )}
                {onRefine && it.title && (
                  <button type="button" className={styles['prop-act']} onClick={() => onRefine(it.title!)} aria-label={`Уточнити «${title}»`} title="Уточнити" data-proposal-refine>
                    <Icon name="sys.reply" size={16} inherit decorative />
                  </button>
                )}
              </span>
            )}
          </div>
        );
      })}
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
          <Button variant="secondary" onClick={onUndo}>Скасувати</Button>
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
      >{it.checked ? <Icon name="sys.done" size={12} inherit decorative /> : null}</button>
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
        <span className={styles['strip-state']}>{g.toBuy} у список покупок</span>
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
        <ReceiptGroup tone="accent" mark="dot" title="ЩОЙНО ДОДАНО" count={g.fresh.length}
          rows={g.fresh.map((it) => row(it, 'fresh'))} />
      )}
      {g.earlier.length > 0 && (
        <ReceiptGroup tone="muted" mark="none" title="РАНІШЕ" count={g.earlier.length}
          rows={g.earlier.map((it) => row(it))} />
      )}
      {g.bought.length > 0 && (
        <ReceiptGroup
          tone="muted" mark="done" title="КУПЛЕНО" count={g.bought.length}
          action={() => onRemoveBought(g.bought.map((i) => i.id))}
          actionLabel="ПРИБРАТИ"
          rows={g.bought.map((it) => row(it, 'bought'))}
        />
      )}
      {items.length === 0 && (
        <div style={{ padding: '10px 0', color: 'var(--muted)', fontFamily: 'var(--font-body)', fontSize: 15 }}>
          Поки нічого не треба купувати. Додай сам або скажи в чаті.
        </div>
      )}
      {footSlot ? createPortal(foot, footSlot) : foot}
    </div>
  );
}

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
    r.tm ? formatDuration(r.tm, 'caps') : null,
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
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
          {r.d}
        </div>
      )}
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={() => onApply?.()} loading={applying}>{CARD_BUTTON_LABEL.recipe!}</Button>
          <Button variant="secondary" onClick={onDismiss}>Ні</Button>
        </div>
      )}
      {applied && !undone && undoAvailable && onUndo && (
        <div className={styles['card-actions']}>
          <Button variant="secondary" onClick={onUndo}>Скасувати</Button>
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
          width: 56, height: 56, borderRadius: 12, background: 'var(--line)',
          overflow: 'hidden', flex: 'none', display: 'grid', placeItems: 'center',
        }}>
          {attId ? (
            <img
              src={`/v1/attachments/${attId}/bytes`}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>IMG</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            {card.recipe_title ?? 'Готування'}
          </div>
          <div style={{ marginTop: 2, fontSize: 13, color: 'var(--dim)' }}>
            Фото до цієї вечері
          </div>
        </div>
      </div>
      {!applied && !undone && !dismissed && onApply && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={() => onApply?.()} loading={applying}>{CARD_BUTTON_LABEL.cook_photo!}</Button>
          <Button variant="secondary" onClick={onDismiss}>Ні</Button>
        </div>
      )}
      {applied && !undone && undoAvailable && onUndo && (
        <div className={styles['card-actions']}>
          <Button variant="secondary" onClick={onUndo}>Скасувати</Button>
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
export function RecipeLinkCard({ card, onCook, onNeedToList, batchLabels, stepLabels }: CardProps) {
  const r = card.recipe as Recipe | undefined;
  const rid = card.recipe_id;
  const [listed, setListed] = useState<Set<number>>(new Set());
  const pressTimer = useRef<number | null>(null);
  if (!rid) return null;

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
        <span style={{ color: 'var(--dim)' }}><Icon name="sys.recipes" size={16} inherit decorative /></span>
        <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--ink)' }}>
          {card.title ?? 'Рецепт'}
        </span>
        <span style={{ fontSize: 13, color: 'var(--sage)' }}>
          Рецепт →
        </span>
      </Link>
    );
  }

  const sv = r.sv ?? 1;
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
  void headSlot;

  // 6b-3 — за артефактом «Рецепт» у Prototype (той, що «можу зараз · 8 з 8»):
  // пілюля 24, назва h2 22/700, рядок 13 «20 хв · ≈ 540 ккал · оцінка моделі ·
  // 2 порції» без степера, «Склад · N» і «Кроки · N» підписами 12/500, рядки
  // 40 із крапкою роду й волосиною, кола кроків 24 контурні, «Готуємо» 48
  // притиснута до низу картки. «У рецепти» / «Поділитись» тут не живуть —
  // це сторінка рецепта й картка в стрічці. Порційник знято разом зі
  // степером: кількості — на sv рецепта (рішення власника 11.09).
  const total = scaled.ing.length;
  const have = total - missIdx.length;
  const status = missIdx.length === 0
    ? { text: `можу зараз · ${have} з ${total}`, tone: styles['pill-sage'] }
    : missIdx.length <= 2
      ? { text: `майже · ${have} з ${total}`, tone: styles['pill-amber'] }
      : { text: `далеко · ${have} з ${total}`, tone: styles['pill-far'] };

  // Низ картки: «Готуємо» головна; «У список · N» текстом — лише коли є що докупити.
  const footRaw = (
    <div className={`${styles['card-foot']} ${styles['recipe-foot']}`}>
      {missIdx.length > 0 && onNeedToList && (
        <button type="button" className={styles['recipe-tolist']} disabled={!leftToList.length} onClick={addAllMissing} data-recipe-tolist>
          {leftToList.length ? `У список · ${leftToList.length}` : 'Уже в списку'}
        </button>
      )}
      {onCook && (
        <button type="button" className={styles['cook-go']} onClick={() => onCook(scaled, rid)} data-cook-go>
          <Icon name="cook.go" size={16} inherit decorative />Готуємо
        </button>
      )}
    </div>
  );
  const recipeFoot = footSlot ? createPortal(footRaw, footSlot) : footRaw;

  return (
    <div className={styles['recipe-msg']} data-recipe-artifact>
      <div className={styles['recipe-head']}>
        <span className={`${styles.pill} ${styles['pill-status']} ${status.tone}`} data-recipe-status><span className={styles['pill-dot']} aria-hidden />{status.text}</span>
        <h2 className={`t-h2 ${styles['recipe-title']}`}>{r.t}</h2>
        <div className={styles['recipe-meta']}>
          {r.tm ? <span>{formatDuration(r.tm)}</span> : null}
          {/* Р12: у чаті — оцінка моделі, і сказано, що оцінка. */}
          {r.nu?.kcal ? <span>{formatModelEstimate(r.nu, 'short')}</span> : null}
          <span data-servings>{sv} {plural(sv, ['порція', 'порції', 'порцій'])}</span>
        </div>
        {/* Примітка моделі до рецепта: у Prototype її в панелі немає (там
            підказки живуть у кроках Cook Mode) — лишаємо рядком 13 muted,
            бо дані є, а Cook Mode ще попереду. */}
        {r.rk && <p className={styles['recipe-note']}>{r.rk}</p>}
      </div>

      <section className={styles['recipe-section']} data-recipe-ings>
        <div className={styles['recipe-section-head']}>Склад · {total}</div>
        {ordered.map(({ ing, i }) => {
          const missing = !ing.p;
          const added = listed.has(i);
          return (
            <div key={i} className={styles['recipe-ing']}
              title={missing && !added ? 'Затисни, щоб додати тільки це' : undefined}
              onPointerDown={missing && !added && onNeedToList ? () => pressStart(i) : undefined}
              onPointerUp={pressEnd} onPointerLeave={pressEnd}
              data-missing={missing ? '' : undefined}>
              <span className={`${styles['ing-dot']} ${missing ? styles['ing-dot-missing'] : ''}`} aria-hidden />
              <span className={styles['recipe-ing-name']}>
                {ing.n ?? (ing.p && batchLabels?.get(ing.p)) ?? 'з комори'}
                {added && <span className={`${styles.pill} ${styles['pill-sage']} ${styles['pill-mini']}`}>у списку</span>}
              </span>
              {ing.v != null && ing.u
                ? <span className={styles['recipe-ing-qty']}>{formatQty(ing.v, ing.u)}</span>
                : !missing ? <span className={styles['recipe-ing-qty']}>є вдома</span> : null}
            </div>
          );
        })}
      </section>

      <section className={styles['recipe-section']} data-recipe-steps>
        <div className={styles['recipe-section-head']}>Кроки · {scaled.st.length}</div>
        {scaled.st.map((step: typeof scaled.st[number], i: number) => (
          <div key={i} className={styles['recipe-step']}>
            <span className={styles['recipe-step-n']}>{i + 1}</span>
            <span className={styles['recipe-step-t']}>
              {step.t}
              {!!step.s && (
                <span className={`${styles.pill} ${styles['pill-sage']} ${styles['pill-mini']}`}>
                  <Icon name="cook.timer" size={12} inherit decorative />{Math.floor(step.s / 60)}:{String(step.s % 60).padStart(2, '0')}
                </span>
              )}
            </span>
          </div>
        ))}
      </section>

      {recipeFoot}
    </div>
  );
}


// ----- Картка рецепта в стрічці (етап 6b, Screens «Чат · збірка» / 4a) ------
// Біла картка: знак страви колом 48, назва h3, рядок «25 хв · 3 порції ·
// ≈ 480 ккал · усе є», опис, чіпи інгредієнтів, дії колом праворуч —
// cooking-pot (відкрити рецепт), reply (уточнити), мінус (згорнути).
// Зелена рамка з капсом «РЕЦЕПТ» зникла разом із формою; слово сліду
// (етап 3) лишилось у службовому рядку над ходом.
export function RecipeStreamCard({ card, active, onOpen, onAsk }: { card: ChatCard; active?: boolean; onOpen: () => void; onAsk?: (title: string) => void }) {
  const r = card.recipe;
  const [collapsed, setCollapsed] = useState(false);
  const title = card.title ?? r?.t ?? 'Рецепт';
  const allHome = !!r?.ing?.length && r.ing.every((i) => !!i.p);
  return (
    <div className={`${styles['rcard']} ${active ? styles['rcard-on'] : ''}`} data-recipe-stream>
      <span className={styles['rcard-icon']}><Icon name="cook.type" size={20} inherit decorative /></span>
      <div className={styles['rcard-body']}>
        <button type="button" className={`t-h3 ${styles['rcard-title']}`} onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed}>{title}</button>
        {r && (
          <div className={`t-caption ${styles['rcard-meta']}`}>
            {r.tm ? <span className={styles['rcard-meta-item']}><Icon name="cook.time" size={12} inherit decorative />{formatDuration(r.tm)}</span> : null}
            {r.sv ? <span>{r.sv} {plural(r.sv, ['порція', 'порції', 'порцій'])}</span> : null}
            {r.nu?.kcal ? <span>≈ {r.nu.kcal} ккал</span> : null}
            {allHome && <span className={`${styles['rcard-meta-item']} ${styles['rcard-ok']}`}><Icon name="sys.done" size={12} inherit decorative />усе є</span>}
          </div>
        )}
        {!collapsed && r?.d && <div className={`t-small ${styles['rcard-desc']}`}>{r.d}</div>}
        {!collapsed && !!r?.ing?.length && (
          <div className={styles['rcard-chips']}>
            {/* Чіпи на bg (Prototype); чого бракує — бурштином зі знаком «бракує». */}
            {r.ing.slice(0, 6).map((ing, i) => (
              <span key={i} className={`${styles['prop-chip']} ${!ing.p ? styles['prop-chip-amber'] : ''}`}>
                {!ing.p && <Icon name="cook.missing" size={12} inherit decorative />}
                {ing.n ?? 'з комори'}{ing.v != null && ing.u ? ` ${formatQty(ing.v, ing.u)}` : ''}
              </span>
            ))}
            {r.ing.length > 6 && <span className={`${styles['prop-chip']} ${styles['prop-chip-dim']}`}>ще {r.ing.length - 6}</span>}
          </div>
        )}
      </div>
      {/* Дії належать рецепту (Prototype propDesk): розгорнута — cooking-pot і
          reply; згорнута — лише «+». Згортає тап по назві. «У рецепти» /
          «Поділитись» у стрічці не малюються — QUESTIONS §13. */}
      <div className={styles['rcard-acts']} data-recipe-actions={collapsed ? 'collapsed' : 'open'}>
        {collapsed ? (
          <button type="button" className={styles['rcard-act']} onClick={() => setCollapsed(false)} aria-label="Розгорнути" title="Розгорнути">
            <Icon name="sys.add" size={16} inherit decorative />
          </button>
        ) : (
          <>
            <button type="button" className={`${styles['rcard-act']} ${styles['rcard-act-sage']}`} onClick={onOpen} aria-label="Готуємо" title="Готуємо">
              <Icon name="cook.go" size={16} inherit decorative />
            </button>
            {onAsk && (
              <button type="button" className={styles['rcard-act']} onClick={() => onAsk(title)} aria-label="Уточнити" title="Уточнити">
                <Icon name="sys.reply" size={16} inherit decorative />
              </button>
            )}
          </>
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
      >Оформити в Сільпо <Icon name="sys.out" size={16} inherit decorative /></a>
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
                  style={p ? undefined : { color: 'var(--dim)' }}
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
                  {(totalMl / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} л разом
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
                      Замінимо позицію тут. У кошику Сільпо стару доведеться прибрати окремо.
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
                          border: '1px solid var(--sage)', background: 'var(--sage-bg)',
                          color: 'var(--sage)', opacity: swapping === i ? 0.5 : 1,
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
                          border: '1px solid var(--line)', background: 'none',
                          color: 'var(--dim)', opacity: adding === i ? 0.5 : 1,
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

// Подія як артефакт (рішення 03.09: «подія і її редагування — одна
// сутність»). У стрічці картка нічого не малює — там слід під реплікою; у
// панелі — повний хребет із правкою на місці. Картка знає лише id події
// (сервер дописує його в ops після applyCard), решту бере з /v1/events/:id.
export function EventCard({ card }: CardProps) {
  const inPanel = useContext(PanelFootSlot) !== null;
  const id = (card.ops as { id?: string }[] | undefined)?.find((o) => o.id)?.id;
  const [ev, setEv] = useState<EventOccurrence | null | 'gone'>(null);
  const load = useCallback(() => {
    if (!id) return;
    api.events.get(id).then(({ event }) => setEv(event)).catch(() => setEv('gone'));
  }, [id]);
  useEffect(() => { if (inPanel) load(); }, [inPanel, load]);
  if (!inPanel) return null;
  if (!id || ev === 'gone') {
    return <div className={styles['card-empty']}>Подію прибрано.</div>;
  }
  if (!ev) return null;
  return <PeriodEvent key={ev.id} event={ev} onChanged={load} />;
}

// П2 (2f): картка period у стрічці — підпис, заголовок, одне речення, дія
// «Відкрити» в панель; у панелі — повна серія або подія. Стани
// «запропоновано / записано / пропущено» — тією ж механікою, що в профілю.
export function PeriodChatCard(props: CardProps) {
  const { card, cardId, applied, applying, dismissed, undone, onApply, onDismiss, onOpenArtifact } = props;
  const inPanel = useContext(PanelFootSlot) !== null;
  const form = periodForm(card);
  const items = ((card.items ?? []) as { occasion_id: string; title: string; from: string; to: string }[]).filter((i) => i && i.occasion_id);
  if (inPanel) {
    return form === 'series'
      ? <PeriodSeries card={card} cardId={cardId} applied={applied} applying={applying} dismissed={dismissed} undone={undone} onApply={onApply} onDismiss={onDismiss} onNone={props.onNone} />
      : <PeriodEvent card={card} cardId={cardId} applied={applied} applying={applying} dismissed={dismissed} undone={undone}
          onApply={onApply as unknown as (selected?: number[]) => Promise<{ event_ids?: string[] } | void>} onDismiss={onDismiss} />;
  }
  const closed = (applied && !undone) || dismissed;
  const kicker = form === 'series'
    ? (card.unsubscribe || card.set === 'seasons' || !card.tradition ? 'СЕЗОНИ' : 'СВЯТА · З ТРАДИЦІЇ')
    : card.kind === 'diet' ? 'ДІЄТА' : 'ПОДІЯ ДОМУ';
  const kickerTone = form === 'series' ? (card.tradition ? 'var(--plum)' : 'var(--amber)') : 'var(--sage)';
  const title = form === 'series'
    ? (card.unsubscribe && items.length === 1 ? `${items[0]!.title} · не показувати`
      : card.set === 'seasons' ? `Сезони · ${items.length}`
      : card.tradition ? `${TRADITION_LABEL[card.tradition][0]!.toUpperCase()}${TRADITION_LABEL[card.tradition].slice(1)} свята · ${items.length} на рік`
      : seriesTitle('seasons'))
    : (dedupeTitle(card.title ?? '', card.rule_text).title ?? card.title ?? 'період');
  const line = form === 'series'
    ? (card.unsubscribe ? 'Зніму з календаря і з підказок.'
      : card.set === 'seasons' ? (card.all ? 'Поверну сезони. Зніми, що не твоє.' : 'Зніму всі сезони з календаря і підказок. Що лишити — познач у картці.')
      : 'Дати з календаря на кілька років уперед. Зніми зайве — і в календар.')
    : [dedupeTitle(card.title ?? '', card.rule_text).rule,
      card.resolved ? (card.resolved.from === card.resolved.to ? shortDate(card.resolved.from) : `з ${shortDate(card.resolved.from)} до ${shortDate(card.resolved.to)}`) : null,
      card.strict ? 'суворо' : null].filter(Boolean).join(' · ');
  const meta = dismissed ? 'Пропущено'
    : applied && !undone ? (form === 'series' ? (card.unsubscribe ? 'Не показую' : card.set === 'seasons' ? 'Записано в календар' : `Записано в календар: ${items.length}`) : 'Записано в календар')
    : undone ? 'Скасовано'
    : form === 'series' ? `→ у календар: ${items.length}` : '→ у календар';
  return (
    <div className={stateClass(applied, undone)} data-testid="period-chat-card">
      <div style={{ fontSize: 10, letterSpacing: 'var(--tracking-caps)', color: kickerTone }}>{kicker}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, lineHeight: 1.25, letterSpacing: '-0.01em', color: 'var(--ink)', marginTop: 6 }}>{title}</div>
      {line && <div style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--muted)', marginTop: 4 }}>{line}</div>}
      <div style={{ fontSize: 12, color: applied && !undone ? 'var(--sage)' : 'var(--dim)', marginTop: 6 }}>{meta}</div>
      {!closed && !undone && (
        <div className={styles['card-actions']}>
          <Button variant="primary" onClick={onOpenArtifact} disabled={applying}>Відкрити</Button>
          <Button variant="secondary" onClick={onDismiss} disabled={applying}>Ні</Button>
        </div>
      )}
    </div>
  );
}

export function Card(props: CardProps) {
  switch (props.card.type) {
    case 'event':       return <EventCard {...props} />;
    case 'period':      return <PeriodChatCard {...props} />;
    case 'intake_diff': return <IntakeCard {...props} />;
    case 'cart':        return <RetailCartCard {...props} />;
    case 'proposal':    return <ProposalCard {...props} />;
    case 'shopping':    return <ShoppingCard {...props} />;
    case 'recipe':      return <RecipeCard {...props} />;
    case 'cook_photo':  return <CookPhotoCard {...props} />;
    case 'recipe_link': return <RecipeLinkCard {...props} />;
    // Крок 7: картка «Про тебе» — сім панелей; стан — з profile_text (props).
    case 'onboarding':  return (
      <OnboardingCard
        card={props.card} cardId={props.cardId}
        profileFields={props.profileFields} onProfilePatched={props.onProfilePatched} onSummary={props.onSummary}
      />
    );
    default:            return null;
  }
}

// Текст тосту після «Так». Жив інлайном у Feed і рахував «ops або items»
// з формами «у коморі»/«у списку» — картка рецепта давала «0 позицій у коморі».
// appliedCount — 01.09: реальна кількість, яку повернув сервер (applyCard).
// Без цього тост завжди рахував card.ops.length — ПОВНИЙ список, ігноруючи
// стрикаут: «Застосувати 9» тиснеш, а тост і бейдж кажуть «10».
export function appliedToast(card: ChatCard, appliedCount?: number): string {
  // П4-Т2: нуль — це новина, а не «Готово». Раніше тост казав «Записано»
  // навіть тоді, коли не записалось нічого: 7 вересня людина побачила
  // підтвердження запису, якого не було. Місце називаємо, бо на екрані
  // буває кілька карток, і «нічого не змінилось» без місця не читається.
  // Причину (з `missed`) поки не показуємо: тамтешні рядки розробницькі, а
  // писати копі під усю матрицю операцій зарано — картка лишається
  // відкритою, і людина бачить у ній самі позиції.
  if (appliedCount === 0) {
    switch (card.type) {
      case 'shopping':    return 'У списку нічого не змінилось';
      case 'intake_diff': return 'У коморі нічого не змінилось';
      case 'event':
      case 'period':      return 'У календарі нічого не змінилось';
      default:            return 'Нічого не змінилось';
    }
  }
  if (card.type === 'cook_photo') {
    return card.recipe_title ? `Фото до «${card.recipe_title}» — у журналі` : 'Фото в журналі';
  }
  if (card.type === 'recipe') {
    const t = (card.recipe as Recipe | undefined)?.t;
    return t ? `«${t}» — у рецептах` : 'Рецепт збережено';
  }
  if (card.type === 'event') {
    const n = appliedCount ?? (card.ops?.length ?? 0);
    return `${n} ${plural(n, ['подія в календарі', 'події в календарі', 'подій у календарі'])}`;
  }
  // П2: серія — скільки рядків у календар; запис — один.
  if (card.type === 'period') {
    const n = appliedCount ?? (card.items?.length ?? 1);
    return card.kind === 'tradition' || card.unsubscribe ? `Записано в календар: ${n}` : 'Записано в календар';
  }
  const count = appliedCount ?? (card.type === 'shopping' || card.type === 'proposal'
    ? (card.items?.length ?? 0)
    : (card.ops?.length ?? 0));
  const forms: [string, string, string] = card.type === 'shopping'
    ? ['позиція у списку', 'позиції у списку', 'позицій у списку']
    : ['позиція у коморі', 'позиції у коморі', 'позицій у коморі'];
  return `${count} ${plural(count, forms)}`;
}

// Мета-мітка перед карткою, залежно від типу й стану — на кшталт «КОМОРА · ОЧІКУЄ».
/**
 * Результат застосування — те, що сервер віддає з першого дня
 * (applied / missed / already_there / truncated), а слід доти викидав.
 * PLAN §4: «частковий успіх — слід „застосовано 9 із 14 · 5 пропущено"».
 */
export interface ApplyOutcome {
  applied: number;
  total: number;
  missed?: string[];
  alreadyThere?: number;
  truncated?: boolean;
}

/** Хвіст мітки для часткового успіху; порожній, коли все влучило. */
function outcomeTail(o?: ApplyOutcome): string {
  if (!o || o.applied >= o.total) return '';
  const parts = [`${o.applied} із ${o.total}`];
  // Три різні причини недобору — три різні слова. «Пропущено» ≠ «уже було»
  // ≠ «не вмістило»: перше — сервер не впізнав, друге — дубль, третє — стеля.
  if (o.missed?.length) parts.push(`${o.missed.length} пропущено`);
  if (o.alreadyThere) parts.push(`${o.alreadyThere} уже було`);
  if (o.truncated) parts.push('решту не вмістило');
  return ' · ' + parts.join(' · ');
}

/** 6b-5: стан сліду комори реченням, без капсу — «чекає рішення · 14»,
 *  «9 із 14 · 5 пропущено», «3 у комору», «скасовано». Той самий M до і після. */
export function traceState(applied?: boolean, undone?: boolean, outcome?: ApplyOutcome, count?: number): { text: string; tone: 'pending' | 'applied' | 'muted' } {
  if (undone) return { text: 'скасовано', tone: 'muted' };
  if (applied) {
    const tail = outcomeTail(outcome);
    return { text: tail ? tail.slice(3) : `${count ?? 0} у комору`, tone: 'applied' };
  }
  return { text: `чекає рішення${count ? ` · ${count}` : ''}`, tone: 'pending' };
}

export function labelFor(
  type: ChatCard['type'],
  applied?: boolean,
  undone?: boolean,
  dismissed?: boolean,
  outcome?: ApplyOutcome,
  /** Скільки рядків чекає рішення — «ОЧІКУЄ · 14». Той самий M, що потім у «9 із 14». */
  pendingCount?: number,
): { text: string; tone: 'pending' | 'applied' | 'muted' } {
  // Слід рецепта — не дія: жодного «ОЧІКУЄ», просто мітка.
  if (type === 'recipe_link') return { text: 'КУХНЯ · РЕЦЕПТ', tone: 'muted' };
  // M13: кошик — теж не дія в нас: він уже зібраний у мережі, CTA веде назовні.
  if (type === 'cart') return { text: 'КОШИК · СІЛЬПО', tone: 'muted' };
  // Крок 7: «Про тебе» — не дія, статусу немає.
  if (type === 'onboarding') return { text: 'ПРО ТЕБЕ', tone: 'muted' };
  if (undone) return { text: 'СКАСОВАНО', tone: 'muted' };
  if (applied) return { text: `ЗАСТОСОВАНО${outcomeTail(outcome)}`, tone: 'applied' };
  // QA5-11: після «Ні» кнопки ховались, але заголовок лишався «ОЧІКУЄ» назавжди.
  if (dismissed) return { text: 'ВІДХИЛЕНО', tone: 'muted' };
  const base = type === 'intake_diff' ? 'КОМОРА'
    : type === 'shopping' ? 'СПИСОК'
    // Імпорт із книжки — не вигадка моделі, і мітка має це розрізняти.
    : type === 'recipe' ? 'РЕЦЕПТ'
    : type === 'cook_photo' ? 'ЖУРНАЛ'
    // П2: період — календар; статус (ОЧІКУЄ) — з режиму confirm.
    : type === 'period' ? 'КАЛЕНДАР'
    : 'ПРОПОЗИЦІЯ';
  // Аудит раунд 3, крок 3: статус — з режиму застосування (card-modes.ts),
  // не захардкожений тут другою правдою. mode === 'none' (proposal тощо) —
  // нічого чекати, лише тип, без «· ОЧІКУЄ».
  // Етап 3: слід ДО застосування несе кількість — бурштином. Після — та сама
  // функція дасть «9 із 14» чорнилом. Один слід, два моменти, одна функція.
  return applyMode(type) === 'none'
    ? { text: base, tone: 'muted' }
    : { text: `${base} · ОЧІКУЄ${pendingCount ? ` · ${pendingCount}` : ''}`, tone: 'pending' };
}
