// Період — один компонент у двох формах (П2, бриф BRIEF-DESIGN-PERIOD.md).
//
// СЕРІЯ (1a, 2a): набір із довідника — свята однієї традиції або сезони.
// Рядки з датами з таблиці (не редагуються), одним словом — що робить,
// галочка. Підтвердження — PUT /v1/occasions/subscriptions батчем усіх
// рядків картки, і для картки з чату — POST /v1/cards/:id/apply, щоб
// «записано» лягло в стрічку так само, як у профілю. «Не показуй кавуни» —
// та сама форма з одним рядком і знятою галочкою.
//
// ПОДІЯ (1b, 2b, 2c, 2d): один запис. Своє (дієта · своє свято · подія дому)
// редагується повністю — і це одночасно створення з чату й правка з
// календаря. Системне (сезон, свято з довідника) — та сама картка в режимі
// читання, єдина дія «Не показувати» (підписка enabled:false, тост із
// «Повернути»).
//
// Замінює EventArtifact: подія дому, «завіз» і рамка дня — теж ця форма,
// просто без перемикача роду. Третьої картки нема.
//
// v3 (крок 2, 11.09): форма за Components A1 (серія: галочки 22 r6 чорнилом,
// рядки 52, «готую · нагадую · обмежую» словом, «N з M · Ні · Записати в
// календар»), A2 (своє: рід сегментом угорі, дати чіпами 36 r8 на bg,
// правило в рамці bg, мʼяко/суворо пігулкою — суворе фарбує в сливу лише
// перемикач) і A3 (системне: кікер зі знаком роду, «ще N днів» кольором
// роду, «що з цим приготувати» рядками 44 в чат, «варто докупити» чіпами,
// «Не показувати · Додати в список»). Aside дня з Prototype дає «Що прийде»
// рядками 40 зі знаком і «Прибрати» текстом danger. Каркас панелі — не тут.

import { useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, type ChatCard, type EventOccurrence, type OccasionItem, type OccasionSet, type PeriodItem } from '../../api';
import { PanelFootSlot } from '../../pages/Feed/panel-slots';
import {
  dedupeTitle, leftLabel, shortDate, seriesRange, seriesTitle, seriesKicker, SERIES_TEXT,
  STRICT_HINT, SOFT_HINT, OWN_KIND_LABEL, ownKindOf, todayIso, daysBetween, plural, type OwnKind,
} from '../../lib/period';
import styles from './PeriodArtifact.module.css';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';

export type PeriodChange = 'add' | 'edit' | 'remove' | 'mute' | 'subscribe';

// ── Серія ───────────────────────────────────────────────────────────────────

export interface SeriesProps {
  /** З чату: картка period (items добудував сервер) і її id для apply. */
  card?: ChatCard;
  cardId?: string;
  /** З календаря: набір довідника, рядки підтягнуться самі. */
  set?: OccasionSet;
  applied?: boolean;
  applying?: boolean;
  dismissed?: boolean;
  undone?: boolean;
  /** Чат: після PUT підписок — apply картки (індекси увімкнених рядків). */
  onApply?: (selected?: number[]) => void | Promise<unknown>;
  onDismiss?: () => void;
  /** Чат: жодної галочки — apply зі status none (усе знято), не «Пропущено». */
  onNone?: () => void | Promise<unknown>;
  /** Календар: підписки записано. */
  onDone?: (change: PeriodChange) => void;
  onClose?: () => void;
}

function itemsOfCard(card: ChatCard): PeriodItem[] {
  return ((card.items ?? []) as PeriodItem[]).filter((i) => i && typeof i.occasion_id === 'string');
}

function setOfCard(card: ChatCard, items: PeriodItem[]): OccasionSet {
  if (card.tradition) return card.tradition;
  // Відписка: набір за родом рядка — сезон/редакційне чи свято.
  return items.length && items.every((i) => i.what === 'сезон' || i.what === 'докупити' && !card.tradition) ? 'seasons' : 'seasons';
}

export function PeriodSeries({ card, cardId, set: setProp, applied, applying, dismissed, undone, onApply, onDismiss, onNone, onDone, onClose }: SeriesProps) {
  const footSlot = useContext(PanelFootSlot);
  const fromCard = card ? itemsOfCard(card) : null;
  const set: OccasionSet = card ? (card.unsubscribe || card.set === 'seasons' ? 'seasons' : setOfCard(card, fromCard ?? [])) : (setProp ?? 'seasons');
  // П2a: масова відписка — серія сезонів з усіма знятими (all:false) або
  // всіма увімкненими (all:true); відписка одного — один рядок без галочки.
  const single = !!card?.unsubscribe;
  const [items, setItems] = useState<PeriodItem[] | null>(fromCard);
  // З чату «хочу святкувати юдейські» — усе увімкнене, знімають зайве (1a);
  // відписка — той один рядок знятий; з календаря — як є в підписці.
  const [checked, setChecked] = useState<Set<string>>(() => new Set(
    (fromCard ?? []).filter((i) => card?.set === 'seasons' ? !!card.all : (card?.kind === 'tradition' && !card.unsubscribe) || i.enabled).map((i) => i.occasion_id),
  ));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    if (card || !setProp) return;
    let alive = true;
    api.occasions.set(setProp)
      .then(({ items: rows }) => {
        if (!alive) return;
        const list: PeriodItem[] = rows.map((r: OccasionItem) => ({
          occasion_id: r.occasion_id, title: r.title, from: r.from ?? '', to: r.to ?? '',
          ...(r.approx ? { approx: true } : {}), enabled: r.enabled, what: r.what, strict: r.strict,
        }));
        setItems(list);
        // Традиція, на яку ще не підписані («Свята: не обрано → католицькі»),
        // відкривається з усім увімкненим — людина знімає зайве, як із чату.
        // Уже підписана — як є в підписці. Сезони — завжди як є.
        const anyOn = list.some((i) => i.enabled);
        const allOn = setProp !== 'seasons' && !anyOn;
        setChecked(new Set(list.filter((i) => allOn || i.enabled).map((i) => i.occasion_id)));
      })
      .catch(() => { if (alive) setErr('Не вдалось прочитати довідник'); });
    return () => { alive = false; };
  }, [card, setProp]);

  const closed = (applied && !undone) || dismissed;
  const k = seriesKicker(set);
  const title = single && items?.length === 1 ? items[0]!.title : seriesTitle(set);
  const text = single ? SERIES_TEXT.unsubscribe
    : card?.set === 'seasons' ? (card.all ? 'Поверну сезони в календар і підказки. Зніми, що не твоє.' : 'Зніму всі сезони з календаря і підказок. Що лишити — познач.')
    : set === 'seasons' ? SERIES_TEXT.seasons : SERIES_TEXT.tradition;
  const range = items ? seriesRange(items) : '';
  const count = checked.size;
  const total = items?.length ?? 0;

  function toggle(id: string) {
    if (closed || busy) return;
    setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function save() {
    if (!items) return;
    setBusy(true); setErr(null);
    try {
      // Батч усіх рядків картки — і увімкнених, і знятих: збіг із дефолтом
      // сервер прибере сам.
      await api.occasions.setSubscriptions(items.map((i) => ({ occasion_id: i.occasion_id, enabled: checked.has(i.occasion_id) })));
      if (card && onApply) {
        const selected = items.map((i, idx) => (checked.has(i.occasion_id) ? idx : -1)).filter((x) => x >= 0);
        // Відписка: apply без вибору — сервер зніме той один рядок. Жодної
        // галочки — картка не застосовується (порожній вибір сервер читає як
        // «усі»), а йде в «Пропущено»: PUT уже записав нулі.
        if (card.unsubscribe) await onApply(undefined);
        else if (selected.length) await onApply(selected);
        // Жодної галочки — «усе знято»: apply зі status none (сервер знімає всі
        // рядки картки), а не «Пропущено».
        else if (onNone) await onNone();
        else onDismiss?.();
      }
      setSaved(count);
      onDone?.('subscribe');
      onClose?.();
    } catch {
      setErr('Не вийшло записати. Спробуй ще раз');
    } finally { setBusy(false); }
  }

  const meta = dismissed ? 'Пропущено'
    : (applied && !undone) || saved !== null ? (single ? 'Не показую' : `Записано в календар: ${saved ?? count}`)
    : undone ? 'Скасовано'
    : single ? '' : items ? `${count} з ${total}` : '';

  const actions = (
    <div className={styles.actions}>
      <span className={`${styles.meta} ${(applied && !undone) || saved !== null ? styles['meta-on'] : ''}`}>{meta}</span>
      {!closed && saved === null && (
        <>
          {card && onDismiss && (
            <button type="button" className={styles.ghost} onClick={onDismiss} disabled={busy || applying}>Ні</button>
          )}
          <button type="button" className={styles.primary} onClick={() => void save()} disabled={busy || applying || !items}>
            {busy || applying ? 'Записую…' : single ? 'Не показувати' : 'Записати в календар'}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className={styles.body} data-testid="period-series">
      <div className={`${styles.kicker} ${styles[k.tone]}`}>
        <Icon name={set === 'seasons' ? 'live.season' : 'live.tradition'} size={12} inherit decorative />{k.text}
      </div>
      <h2 className={styles.title}>{title}</h2>
      {range && <div className={styles.sub}>{range}</div>}
      <p className={styles.text}>{text}</p>
      {!items && !err && <div className={styles.loading}>Читаю довідник…</div>}
      {items && (
        <div className={styles.list} role="list">
          {items.map((i) => {
            const on = checked.has(i.occasion_id);
            return (
              <button key={i.occasion_id} type="button" role="listitem" aria-pressed={on}
                className={`${styles.item} ${on ? '' : styles['item-off']} ${closed ? styles['item-static'] : ''}`}
                onClick={() => toggle(i.occasion_id)} data-occasion={i.occasion_id}>
                <span className={`${styles.mark} ${on ? styles['mark-on'] : ''}`}>{on && <Icon name="sys.done" size={12} inherit decorative />}</span>
                <span className={styles['item-body']}>
                  <span className={styles['item-name']}>{i.title}</span>
                  <span className={styles['item-when']}>
                    {i.from ? `${i.approx ? '≈ ' : ''}${shortDate(i.from)}${i.to && i.to !== i.from ? ` – ${shortDate(i.to)}` : ''}` : ''}
                  </span>
                </span>
                <span className={`${styles.does} ${i.strict ? styles['does-strict'] : ''}`}>{i.what}</span>
              </button>
            );
          })}
        </div>
      )}
      {err && <div className={styles.err}>{err}</div>}
      {footSlot ? createPortal(actions, footSlot) : actions}
      {cardId && null}
    </div>
  );
}

// ── Подія ───────────────────────────────────────────────────────────────────

export interface EventProps {
  /** Запис із календаря (свій або системний). */
  event?: EventOccurrence;
  /** З чату: картка period diet/custom з датами від сервера (resolved). */
  card?: ChatCard;
  cardId?: string;
  /** Нова подія з календаря — дні, куди клікнули. */
  initial?: { date: string; dateTo?: string };
  applied?: boolean;
  applying?: boolean;
  dismissed?: boolean;
  undone?: boolean;
  onApply?: (selected?: number[]) => void | Promise<{ event_ids?: string[] } | void>;
  onDismiss?: () => void;
  onChanged?: (id?: string, change?: PeriodChange) => void;
  onClose?: () => void;
}

const DOW_LONG = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
const DOW_EVERY = ['щонеділі', 'щопонеділка', 'щовівторка', 'щосереди', 'щочетверга', 'щопʼятниці', 'щосуботи'];

function dowOf(iso: string): string {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return DOW_LONG[new Date(y, m - 1, d).getDay()]!;
}
function isoOf(at: number): string { return todayIso(new Date(at)); }

function windowOf(e?: EventOccurrence, card?: ChatCard, initial?: EventProps['initial']): { from: string; to: string } {
  if (card?.resolved) return { from: card.resolved.from, to: card.resolved.to };
  if (e) {
    if (e.from) return { from: e.from, to: e.to ?? e.from };
    return { from: isoOf(e.start), to: isoOf(e.end) };
  }
  if (initial) return { from: initial.date, to: initial.dateTo || initial.date };
  const t = todayIso();
  return { from: t, to: t };
}

// Кікер (A3, Prototype): знак роду + слово тоном роду — сезон sun/amber,
// традиція church/plum, завіз truck/sage, подія дому users/sage, рамка дня
// без знака muted.
function kickerOf(e: EventOccurrence): { text: string; tone: 'amber' | 'plum' | 'sage' | 'muted'; icon: IconName | null } {
  if (e.kind === 'season') return { text: 'сезон · з довідника', tone: 'amber', icon: 'live.season' };
  if (e.kind === 'editorial' || e.source) return { text: `від ${e.source ?? 'редакції'}`, tone: 'amber', icon: 'live.season' };
  if (e.kind === 'tradition' || (e.scope === 'catalog' && e.force === 'restrict')) return { text: 'свято · з традиції', tone: 'plum', icon: 'live.tradition' };
  if (e.kind === 'supply') return { text: 'завіз', tone: 'sage', icon: 'live.supply' };
  if (e.kind === 'meal') return { text: 'страва на день', tone: 'sage', icon: 'cook.type' };
  if (e.kind === 'constraint') return { text: 'рамка дня', tone: 'muted', icon: null };
  return { text: 'подія дому · своє', tone: 'sage', icon: 'live.household' };
}

export function PeriodEvent({ event, card, cardId, initial, applied, applying, dismissed, undone, onApply, onDismiss, onChanged, onClose }: EventProps) {
  const navigate = useNavigate();
  const footSlot = useContext(PanelFootSlot);
  const system = event?.scope === 'catalog';
  const isNew = !event;
  // Своє з перемикачем роду — дієта, своє свято, подія дому. Завіз, страва
  // на день і рамка дня — теж свої й теж правляться, але рід у них один.
  const switchable = !system && (isNew || event?.kind === 'diet' || event?.kind === 'custom');
  const weekly = event?.rule?.t === 'weekly';

  const init = useMemo(() => windowOf(event, card, initial), [event, card, initial]);
  const [ownKind, setOwnKind] = useState<OwnKind>(() => ownKindOf(card?.kind ?? event?.kind, card?.servings ?? event?.servings));
  const [title, setTitle] = useState(event?.title ?? card?.title ?? '');
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [rule, setRule] = useState(card?.rule_text ?? event?.rule_text ?? event?.note ?? '');
  const [strict, setStrict] = useState(!!(card?.strict ?? (event?.strict || event?.force === 'restrict')));
  const servings = card?.servings ?? event?.servings ?? null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [added, setAdded] = useState(false);

  const closed = (applied && !undone) || dismissed;
  const readOnly = system || closed;
  // A2: «свято · своє» лишає один чіп («коли»); дієта й подія дому — два.
  const oneDay = ownKind === 'holiday' && switchable;
  const effFrom = from;
  const effTo = oneDay ? from : (to < from ? from : to);
  // A2/Prototype: своє показує тривалість («15 днів», «4 дні»); A3: системне —
  // «ще N днів» від кінця, кольором роду.
  const span = daysBetween(effFrom, effTo) + 1;
  const left = system ? leftLabel(effFrom, effTo) : `${span} ${plural(span, ['день', 'дні', 'днів'])}`;

  const kicker = event && !switchable ? kickerOf(event) : null;
  const shown = dedupeTitle(title, system ? (event?.restricts ?? null) : rule);

  async function hide() {
    if (!event) return;
    setBusy(true); setErr(null);
    try {
      await api.occasions.setSubscriptions([{ occasion_id: event.id, enabled: false }]);
      setHidden(true);
      onChanged?.(event.id, 'mute');
    } catch { setErr('Не вийшло приховати'); }
    finally { setBusy(false); }
  }
  async function unhide() {
    if (!event) return;
    setBusy(true);
    try {
      await api.occasions.setSubscriptions([{ occasion_id: event.id, enabled: true }]);
      setHidden(false);
      onChanged?.(event.id, 'subscribe');
    } catch { /* тихо */ }
    finally { setBusy(false); }
  }
  async function addAllToList() {
    if (!event?.buy?.length) return;
    setBusy(true);
    try {
      for (const label of event.buy) await api.shopping.add(label, undefined, undefined, event.title);
      setAdded(true);
    } catch { /* кнопка лишається */ }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!event) return;
    setBusy(true);
    try { await api.events.remove(event.id); onChanged?.(event.id, 'remove'); onClose?.(); } catch { setBusy(false); }
  }

  function body() {
    const t = title.trim();
    const kind = switchable ? (ownKind === 'diet' ? 'diet' : 'custom') : (event?.kind ?? 'custom');
    return {
      title: t, kind, from: effFrom, to: effTo,
      rule_text: rule.trim() || null, strict,
      servings: ownKind === 'custom' ? servings : null,
    };
  }
  const dirty = !!card && (
    title.trim() !== (card.title ?? '').trim() || effFrom !== init.from || effTo !== init.to
    || (rule.trim() || null) !== (card.rule_text ?? null) || strict !== !!card.strict
    || (ownKind === 'diet' ? 'diet' : 'custom') !== (card.kind ?? 'custom')
  );

  async function save() {
    const b = body();
    if (!b.title) { setErr('Що це за період?'); return; }
    if (b.strict && !b.rule_text) { setErr('Суворо — тільки з правилом'); return; }
    setBusy(true); setErr(null);
    try {
      if (card) {
        // Чат: apply створює запис із дат сервера; правки людини — PATCH-ем услід.
        const r = await onApply?.();
        const id = (r as { event_ids?: string[] } | void)?.event_ids?.[0];
        if (dirty && id) await api.events.patch(id, b);
        onClose?.();
        return;
      }
      if (isNew) {
        const res = await api.events.add(b);
        onChanged?.(res.event?.id, 'add');
        onClose?.();
        return;
      }
      await api.events.patch(event!.id, weekly ? { title: b.title, rule_text: b.rule_text, strict: b.strict } : b);
      onChanged?.(event!.id, 'edit');
      onClose?.();
    } catch {
      setErr('Не вийшло записати. Спробуй ще раз');
    } finally { setBusy(false); }
  }

  // Дата чіпом (A2): текст «11 вер» + шеврон, а сам <input type="date"> лежить
  // поверх прозорим — клік відкриває нативний вибір, форма лишається бандла.
  const dateChip = (value: string, label: string, min: string | undefined, onChange: (v: string) => void) => (
    <span className={styles['date-chip']}>
      {shortDate(value)}<Icon name="sys.open" size={12} inherit decorative />
      <input type="date" className={styles['date-input']} value={value} min={min} onChange={(ev) => onChange(ev.target.value)} aria-label={label} />
    </span>
  );

  const actions = (
    <div className={styles.actions}>
      {closed ? (
        <span className={`${styles.meta} ${applied && !undone ? styles['meta-on'] : ''}`}>
          {dismissed ? 'Пропущено' : undone ? 'Скасовано' : 'Записано в календар'}
        </span>
      ) : <span className={styles.spacer} />}
      {system ? (
        <>
          {!hidden && (
            <button type="button" className={styles.ghost} onClick={() => void hide()} disabled={busy}>Не показувати</button>
          )}
          {(event?.buy?.length ?? 0) > 0 ? (
            <button type="button" className={styles.primary} onClick={() => void addAllToList()} disabled={busy || added}>
              {added ? 'У списку' : 'Додати в список'}
            </button>
          ) : (
            <button type="button" className={styles.primary} onClick={() => navigate('/app', { state: { composePrefix: `${event?.title} — ` } })}>
              Обговорити в чаті
            </button>
          )}
        </>
      ) : !closed && (
        <>
          {card
            ? <button type="button" className={styles.ghost} onClick={onDismiss} disabled={busy || applying}>Ні</button>
            : isNew
              ? <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>Ні</button>
              : <button type="button" className={styles.remove} onClick={() => void remove()} disabled={busy}>Прибрати</button>}
          <button type="button" className={styles.primary} onClick={() => void save()} disabled={busy || applying}>
            {busy || applying ? 'Записую…' : 'Записати'}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className={styles.body} data-testid="period-event">
      {switchable && !readOnly ? (
        // A2: рід — сегмент угорі, не кікер.
        <div className={styles.kinds} role="tablist" aria-label="Рід">
          {(Object.keys(OWN_KIND_LABEL) as OwnKind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={ownKind === k}
              className={`${styles.kind} ${ownKind === k ? styles['kind-on'] : ''}`} onClick={() => setOwnKind(k)}>
              {OWN_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      ) : (
        <div className={`${styles.kicker} ${styles[kicker?.tone ?? 'sage']}`}>
          {kicker ? (
            <>{kicker.icon && <Icon name={kicker.icon} size={12} inherit decorative />}{kicker.text}</>
          ) : (
            <><Icon name="live.household" size={12} inherit decorative />{OWN_KIND_LABEL[ownKind]}</>
          )}
        </div>
      )}

      {readOnly ? (
        shown.title && <h2 className={styles.title}>{shown.title}</h2>
      ) : (
        <input className={styles['title-input']} value={title} onChange={(ev) => setTitle(ev.target.value)}
          placeholder={ownKind === 'diet' ? 'білкова' : ownKind === 'holiday' ? 'день народження мами' : 'гості'} aria-label="Назва" />
      )}

      {/* Дати (A2/A3): «з 10 вер до 24 вер · 15 днів»; системне — «ще N днів» тоном роду. */}
      <div className={styles.range}>
        {readOnly ? (
          weekly ? (
            <b>{DOW_EVERY[(event!.rule as { dow: number }).dow] ?? 'щотижня'}</b>
          ) : effFrom === effTo ? (
            <><span>коли</span><b>{shortDate(effFrom)}</b><span>{dowOf(effFrom)}</span>{left && <span className={`${styles.left} ${system ? styles[kicker?.tone ?? 'muted'] : ''}`}>{left}</span>}</>
          ) : (
            <>
              <span>з</span><b>{shortDate(effFrom)}</b><span>до</span><b>{event?.approx ? '≈ ' : ''}{shortDate(effTo)}</b>
              {left && <span className={`${styles.left} ${system ? styles[kicker?.tone ?? 'muted'] : ''}`}>{left}</span>}
            </>
          )
        ) : weekly ? (
          <b>{DOW_EVERY[(event!.rule as { dow: number }).dow] ?? 'щотижня'}</b>
        ) : oneDay ? (
          <>
            <span>коли</span>
            {dateChip(from, 'Коли', undefined, (v) => setFrom(v))}
            <span>{dowOf(from)}</span>
            {left && <span className={styles.left}>{left}</span>}
          </>
        ) : (
          <>
            <span>з</span>
            {dateChip(from, 'Від', undefined, (v) => { setFrom(v); if (to < v) setTo(v); })}
            <span>до</span>
            {dateChip(effTo, 'До', from, (v) => setTo(v))}
            <span className={styles.left}>{left}</span>
          </>
        )}
      </div>

      {system && event?.meaning && <p className={styles.meaning}>{event.meaning}</p>}

      {(!readOnly || shown.rule || (system && event?.restricts)) && (
        <div className={styles.block}>
          <span className={styles.label}>Правило</span>
          {readOnly ? (
            shown.rule ? <p className={styles.rule}>{shown.rule}</p> : null
          ) : (
            <input className={styles['rule-input']} value={rule} onChange={(ev) => setRule(ev.target.value)}
              placeholder="правило одним рядком" aria-label="Правило" />
          )}
          {/* Мʼяко / суворо — пігулка-перемикач (A2): активне суворе — слива,
              активне мʼяке — card з тінню; підказка поруч 12 muted. */}
          <div className={styles['strict-row']}>
            <div className={`${styles.strict} ${readOnly ? styles['strict-static'] : ''}`} role="group" aria-label="Суворість">
              <button type="button" className={`${styles['strict-opt']} ${!strict ? styles['strict-soft-on'] : ''}`}
                onClick={() => { if (!readOnly) setStrict(false); }} aria-pressed={!strict} disabled={readOnly}>мʼяко</button>
              <button type="button" className={`${styles['strict-opt']} ${strict ? styles['strict-hard-on'] : ''}`}
                onClick={() => { if (!readOnly) setStrict(true); }} aria-pressed={strict} disabled={readOnly}>суворо</button>
            </div>
            <span className={styles.hint}>{strict ? STRICT_HINT : SOFT_HINT}</span>
          </div>
        </div>
      )}

      {!system && servings != null && ownKind === 'custom' && (
        <p className={styles.meaning}>на {servings}</p>
      )}

      {/* A3: «що з цим приготувати» — рядки 44, кожен веде в чат із префіксом. */}
      {system && (event?.seeds?.length ?? 0) > 0 && (
        <div className={styles.block}>
          <span className={styles.label}>Що з цим приготувати</span>
          <div className={styles.rows}>
            {event!.seeds!.map((s) => (
              <button key={s} type="button" className={styles.row} onClick={() => navigate('/app', { state: { composePrefix: `${s} — ` } })}>
                <span className={styles['row-name']}>{s}</span>
                <Icon name="sys.next" size={12} inherit decorative />
              </button>
            ))}
          </div>
        </div>
      )}
      {system && (event?.buy?.length ?? 0) > 0 && (
        <div className={styles.block}>
          <span className={styles.label}>Варто докупити</span>
          <div className={styles.chips}>{event!.buy!.map((b) => <span key={b} className={styles.chip}>{b}</span>)}</div>
        </div>
      )}
      {/* Prototype aside: «Що прийде» — рядки 40 зі знаком роду. */}
      {!system && (event?.supply?.length ?? 0) > 0 && (
        <div className={styles.block}>
          <span className={styles.label}>Що прийде</span>
          <div className={styles.rows}>
            {event!.supply!.map((s) => (
              <span key={s.label} className={`${styles.row} ${styles['row-static']}`}>
                <Icon name="live.supply" size={12} inherit decorative className={styles['row-icon']} />
                <span className={styles['row-name']}>{s.label}{s.v ? ` · ${s.v}${s.u ?? ''}` : ''}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {hidden && (
        <div className={styles.toast} role="status">
          Приховано.
          <button type="button" onClick={() => void unhide()} disabled={busy}>Повернути</button>
        </div>
      )}
      {err && <div className={styles.err}>{err}</div>}
      {footSlot ? createPortal(actions, footSlot) : actions}
      {cardId && null}
    </div>
  );
}

/** Одна назва на дві форми: серія або подія — вибір за тим, що прийшло. */
export function PeriodArtifact(props: ({ form: 'series' } & SeriesProps) | ({ form: 'event' } & EventProps)) {
  if (props.form === 'series') { const { form: _f, ...rest } = props; return <PeriodSeries {...rest} />; }
  const { form: _f, ...rest } = props;
  return <PeriodEvent {...rest} />;
}

/** Картка period із чату — серія чи подія? */
export function periodForm(card: ChatCard): 'series' | 'event' {
  return card.kind === 'tradition' || !!card.unsubscribe ? 'series' : 'event';
}
