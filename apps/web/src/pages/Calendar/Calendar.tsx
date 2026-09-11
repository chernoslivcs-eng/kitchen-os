// Календар — за Screens D3 (v3, 11.09) і Prototype.
//
// Дві осі з коду лишаються: тривалі — окремо від точкових (lib/spans). На
// ≥1024 — тижні картками по 7 колонок (D3a): тривале лежить смугами над
// днями, рід кольором (піст слива · сезон бурштин · подія дому шавлія · рамка
// muted), підпис лише в першому тижні; точкове — рядками в дні. Картка тижня
// без чорнильного хедера — лише dim-підпис «8 – 14 вересня · тиждень 37».
// Нижче 1024 — стрічка днів (D3b, рішення 03.09): дати зверху вниз, тривале —
// рисками 3 px у жолобі зліва (до трьох доріжок), підпис-чіп лише в день
// початку; липкий підрядок «Вересень · тиждень 37 · 8 – 14».
//
// Шапка й легенда «що триває зараз» стоять на місці, гортається сама стрічка
// (Prototype: main → overflow:auto). «Сьогодні» повертає до сьогодні; на
// старті сьогодні стоїть зверху. Гортається чотири тижні назад і рік уперед.
//
// Сьогодні — єдиний день на bg-підкладці з кільцем чорнилом; «Що на вечерю?»
// в ньому веде в чат. Порожній день — просто порожній.
//
// Подія — PeriodEvent: на ≥1200 у правій панелі каркаса, нижче — шторка.
// Клік по дню — нова подія на цей день; клік-і-тягнути мишею — на кілька
// днів. Внизу два рядки: «приховані … · повернути» і «свята … · змінити» —
// обидва відкривають підписки (PeriodSubscriptions).

import { Icon } from '../../components/Icon/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../lib/track';
import { useNavigate } from 'react-router-dom';
import { api, type EventOccurrence, type OccasionSet, type SubscriptionRow, type Tradition } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { toneKey } from '../../lib/tone';
import { buildTimeline, dayStart, mondayOf, DAY, type TimelineWeek } from './days';
import { legendLabel, legendIcon, barLabel, pointIcon } from './legend';
import {
  splitAxes, coversDay, edgeCaption, moreLabel, VISIBLE_LIMIT, MOBILE_RAILS, assignLanes, weekSpans,
} from '../../lib/spans';
import { Sheet } from '../../components/Sheet/Sheet';
import { PeriodEvent, type PeriodChange } from '../../components/PeriodArtifact/PeriodArtifact';
import { PeriodSubscriptions } from '../../components/PeriodArtifact/PeriodSubscriptions';
import { Toast } from '../../components/ErrorState/Toast';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { CALENDAR_FAILED } from '../../components/ErrorState/copy';
import { TRADITION_LABEL } from '../../lib/period';
import { usePanelStore, RAIL_IN_FLOW } from '../../store/panel';
import styles from './Calendar.module.css';

const PAST_WEEKS = 4;
const WEEKS = PAST_WEEKS + 53;
/** Сітка тижнів — від 1024 (рейка 60, колонки ≥ 110); нижче — стрічка днів. */
const GRID = '(min-width: 1024px)';

// Локальна дата в ISO — форма події живе в 'YYYY-MM-DD'.
function isoOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dow = (at: number) => new Date(at).toLocaleDateString('uk-UA', { weekday: 'short' });
const num = (at: number) => new Date(at).getDate();
const monthName = (at: number) => {
  const m = new Date(at).toLocaleDateString('uk-UA', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
};
/** «8 – 14 вересня» · «29 вер. – 5 жовтня» — підпис тижня (D3a). */
const weekRange = (a: number, b: number) => {
  const da = new Date(a), db = new Date(b);
  const end = db.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
  return da.getMonth() === db.getMonth()
    ? `${da.getDate()} – ${end}`
    : `${da.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} – ${end}`;
};
const isWeekend = (at: number) => { const d = new Date(at).getDay(); return d === 0 || d === 6; };

function toneClass(e: EventOccurrence): string { return styles[`t-${toneKey(e)}`]!; }

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return on;
}

export function CalendarPage() {
  const navigate = useNavigate();
  const openNav = useNavStore((s) => s.setOpen);
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [openEvent, setOpenEvent] = useState<EventOccurrence | null>(null);
  const [version, setVersion] = useState(0);
  // Моушн-кіт §03: прибрана чи вимкнена подія згортається 250ms exit до
  // перечитування; правлена — після перечитування флешить тінтом 700ms.
  const [leavingEvent, setLeavingEvent] = useState<string | null>(null);
  const [flashEvent, setFlashEvent] = useState<string | null>(null);
  const onEventChanged = (id?: string, change?: PeriodChange) => {
    if (change === 'subscribe') { setVersion((v) => v + 1); return; }
    if ((change === 'remove' || change === 'mute') && id) {
      setLeavingEvent(id);
      window.setTimeout(() => { setVersion((v) => v + 1); setLeavingEvent(null); }, 250);
      return;
    }
    if (change === 'edit' && id) {
      setFlashEvent(id);
      window.setTimeout(() => setFlashEvent(null), 900);
    }
    setVersion((v) => v + 1);
  };
  const evMotion = (id: string) => `${leavingEvent === id ? styles['ev-leave'] : ''} ${flashEvent === id ? styles['ev-flash'] : ''}`;
  // Нова подія: з «Подія» — на сьогодні; з календаря — на дні, куди клікнули.
  const [creating, setCreating] = useState<{ date: string; dateTo: string } | null>(null);

  // Клік по дню — подія на день; клік-і-тягнути мишею — на кілька днів.
  // Це той самий артефакт події, просто ще один вхід у нього, з уже
  // вибраними датами. На дотику протягу немає (палець тягне — сторінка
  // скролить, і pointercancel скидає вибір), тільки тап = один день.
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const selRef = useRef<{ a: number; b: number } | null>(null);
  const beginSelect = (at: number) => (ev: React.PointerEvent) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('button, a')) return;
    selRef.current = { a: at, b: at };
    setSel({ a: at, b: at });
  };
  useEffect(() => { track('calendar_opened'); }, []);
  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const s = selRef.current;
      if (!s || ev.pointerType === 'touch') return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-at]');
      const at = el ? Number(el.getAttribute('data-at')) : NaN;
      if (!Number.isFinite(at) || at === s.b) return;
      s.b = at;
      setSel({ a: s.a, b: at });
    };
    const up = () => {
      const s = selRef.current;
      if (!s) return;
      selRef.current = null;
      setSel(null);
      const lo = Math.min(s.a, s.b);
      const hi = Math.max(s.a, s.b);
      setCreating({ date: isoOf(lo), dateTo: hi > lo ? isoOf(hi) : '' });
    };
    const cancel = () => { selRef.current = null; setSel(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);
  const inSel = (at: number) => !!sel && at >= Math.min(sel.a, sel.b) && at <= Math.max(sel.a, sel.b);
  const openAfterCreate = useRef<string | null>(null);

  const today = useMemo(() => dayStart(Date.now()), []);
  const from = useMemo(() => mondayOf(today - PAST_WEEKS * 7 * DAY), [today]);

  // П2: підписки дому — для рядків «Приховані» і «Свята» внизу.
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  useEffect(() => {
    api.occasions.subscriptions().then(({ subscriptions }) => setSubs(subscriptions)).catch(() => {/* тихо */});
  }, [version]);
  const hidden = subs.filter((r) => !r.enabled && r.type !== 'tradition');
  const traditions = [...new Set(subs.filter((r) => r.enabled && r.tradition).map((r) => r.tradition!))] as Tradition[];
  const [openSeries, setOpenSeries] = useState<OccasionSet | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    const to = new Date(from + WEEKS * 7 * DAY);
    api.events.list(isoOf(from), isoOf(to.getTime()))
      .then(({ events }) => {
        setEvents(events);
        if (openAfterCreate.current) {
          const made = events.find((e) => e.id === openAfterCreate.current);
          openAfterCreate.current = null;
          if (made) setOpenEvent(made);
        }
      })
      // Етап 5 (п.2): не принести ≠ «нічого не триває». Дні є завжди, тому
      // без тосту збій читався б як спокійний тиждень.
      .then(() => setLoadFailed(false))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [from, version]);

  // Дві осі: тривалі — смуги/риски й легенда, точкові — рядки днів.
  const { lasting, point } = useMemo(() => splitAxes(events), [events]);
  const lanes = useMemo(() => assignLanes(lasting), [lasting]);
  const running = useMemo(
    () => lasting.filter((e) => coversDay(e, today)).sort((a, b) => a.start - b.start),
    [lasting, today],
  );
  const weeks = useMemo(() => buildTimeline(point, from, WEEKS), [point, from]);
  const grid = useMedia(GRID);

  // Панель на ≥1200, шторка нижче.
  const panel = usePanelStore();
  const panelInFlow = useMedia(RAIL_IN_FLOW);
  useEffect(() => {
    if (!panelInFlow || (!openEvent && !openSeries)) { panel.clear(); return; }
    if (openSeries) {
      const key = 'subscriptions';
      panel.publish({
        artifacts: [{ key, kind: 'event', label: 'Підписки', meta: '' }],
        render: () => (
          <PeriodSubscriptions key={openSeries} initialSet={openSeries}
            onClose={() => setOpenSeries(null)} onDone={(c) => onEventChanged(undefined, c)}
            onAddOwn={() => setCreating({ date: isoOf(today), dateTo: '' })} />
        ),
      });
      panel.openArtifact(key);
      return;
    }
    const key = `event:${openEvent!.id}`;
    // Кікер панелі — назва ТИПУ (як «Рецепт» у 6b-3); рід і назва події — у вмісті.
    panel.publish({
      artifacts: [{ key, kind: 'event', label: 'Подія', meta: '' }],
      render: () => (
        <PeriodEvent key={openEvent!.id} event={openEvent!}
          onClose={() => setOpenEvent(null)} onChanged={onEventChanged} />
      ),
    });
    panel.openArtifact(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelInFlow, openEvent, openSeries]);
  useEffect(() => () => panel.clear(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Сьогодні зверху на старті; пігулка повертає до нього. Гортається сама
  // стрічка (.list), не вікно — шапка й легенда стоять.
  const listRef = useRef<HTMLDivElement | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const weekRefs = useRef(new Map<number, HTMLDivElement>());
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const scrolledOnce = useRef(false);
  const scrollToToday = (behavior: ScrollBehavior) => {
    const list = listRef.current;
    // У сітці — картка тижня з сьогодні цілком; у стрічці — рядок дня.
    const el = grid ? weekRefs.current.get(mondayOf(today)) ?? todayRef.current : todayRef.current;
    if (!list || !el) return;
    const offset = (stickyRef.current?.offsetHeight ?? 0) + 8;
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - offset;
    // jsdom не має scrollTo на елементі — у тесті просто ставимо scrollTop.
    if (typeof list.scrollTo === 'function') list.scrollTo({ top: Math.max(0, top), behavior });
    else list.scrollTop = Math.max(0, top);
  };
  useEffect(() => {
    if (loading || scrolledOnce.current || !todayRef.current) return;
    scrolledOnce.current = true;
    scrollToToday('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  const goToday = () => scrollToToday('smooth');

  // «Місяць · тиждень N» — за верхнім видимим тижнем: у шапці на 1440, у
  // липкому підрядку на 390.
  const [topWeek, setTopWeek] = useState<number | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const edge = list.getBoundingClientRect().top + (stickyRef.current?.offsetHeight ?? 0) + 24;
        let best: number | null = null;
        for (const [start, el] of weekRefs.current) {
          if (el.getBoundingClientRect().top <= edge) { if (best === null || start > best) best = start; }
        }
        setTopWeek(best ?? weeks[0]?.start ?? null);
      });
    };
    onScroll();
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); list.removeEventListener('scroll', onScroll); };
  }, [weeks, grid]);
  const top = weeks.find((w) => w.start === topWeek) ?? weeks[0];
  const setWeekRef = (start: number) => (el: HTMLDivElement | null) => {
    if (el) weekRefs.current.set(start, el); else weekRefs.current.delete(start);
  };

  const openDay = (d: { at: number; events: EventOccurrence[] }) => {
    const shown = d.events.slice(0, VISIBLE_LIMIT);
    const more = moreLabel(d.events.slice(VISIBLE_LIMIT));
    return { shown, more };
  };

  const eventRow = (e: EventOccurrence, cls: string) => (
    <button key={`${e.scope}:${e.id}`} type="button"
      className={`${cls} ${styles[`ev-${pointIcon(e).tone}`]} ${e.done_at ? styles['ev-done'] : ''} ${evMotion(e.id)}`}
      onClick={() => setOpenEvent(e)}>
      {pointIcon(e).icon && <Icon name={pointIcon(e).icon!} size={12} inherit decorative />}
      <span className={styles['ev-text']}>{e.title}</span>
    </button>
  );

  // ── 1440: тиждень карткою, 7 колонок (D3a) ───────────────────────────────
  const weekCard = (w: TimelineWeek, wi: number) => {
    const spans = weekSpans(lasting, w.start);
    return (
      <div key={w.start} ref={setWeekRef(w.start)} className={styles.week}>
        <div className={styles['week-cap']}>
          <span className={styles['week-range']}>{weekRange(w.start, w.days[6]!.at)}</span>
          <span>· тиждень {w.num}</span>
        </div>
        {spans.length > 0 && (
          <div className={styles.bars}>
            {spans.map((s) => (
              <div key={s.event.id} className={styles['bar-row']}>
                <button type="button"
                  className={`${styles.bar} ${toneClass(s.event)} ${s.openLeft ? styles['bar-open-l'] : ''} ${s.openRight ? styles['bar-open-r'] : ''} ${s.event.approx ? styles['bar-approx'] : ''} ${evMotion(s.event.id)}`}
                  style={{ gridColumn: `${s.from} / ${s.to}` }}
                  onClick={() => setOpenEvent(s.event)}>
                  {barLabel(s.event, w.start, today, s.openLeft && wi > 0)}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.days}>
          {w.days.map((d) => {
            const isToday = d.at === today;
            const { shown, more } = openDay(d);
            return (
              <div key={d.at} ref={isToday ? todayRef : undefined} data-at={d.at}
                onPointerDown={beginSelect(d.at)}
                className={`${styles.cell} ${isToday ? styles.today : ''} ${inSel(d.at) ? styles.sel : ''} ${sel ? styles.selecting : ''} ${isWeekend(d.at) ? styles.we : ''}`}>
                <div className={styles.dn}>
                  <span className={styles.dow}>{dow(d.at)}</span>
                  <span className={styles.num}>{num(d.at)}</span>
                </div>
                {shown.map((e) => eventRow(e, styles.ev!))}
                {more && (
                  <button type="button" className={styles.more} onClick={() => setOpenEvent(d.events[VISIBLE_LIMIT]!)}>{more}</button>
                )}
                {isToday && (
                  <button type="button" className={styles.ask} onClick={() => navigate('/app')}>
                    Що на вечерю?<Icon name="sys.next" size={12} inherit decorative />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── 390: стрічка днів, риски в жолобі (D3b) ──────────────────────────────
  const dayRow = (d: TimelineWeek['days'][number]) => {
    const isToday = d.at === today;
    // Риски: фіксовані доріжки, порожня — спейсер, щоб не стрибало.
    const bars = Array.from({ length: MOBILE_RAILS }, (_, lane) =>
      lasting.find((e) => lanes.get(e.id) === lane && coversDay(e, d.at)) ?? null);
    const captions = bars
      .filter((e): e is EventOccurrence => e !== null)
      .map((e) => ({ e, text: edgeCaption(e, d.at) }))
      .filter((x): x is { e: EventOccurrence; text: string } => x.text !== null);
    const { shown, more } = openDay(d);
    const quiet = !isToday && !captions.length && !shown.length;
    return (
      <div key={d.at} ref={isToday ? todayRef : undefined} data-at={d.at}
        onPointerDown={beginSelect(d.at)}
        className={`${styles.day} ${isToday ? styles.today : ''} ${quiet ? styles.quiet : ''} ${inSel(d.at) ? styles.sel : ''} ${sel ? styles.selecting : ''} ${isWeekend(d.at) ? styles.we : ''}`}>
        <div className={styles.gutter}>
          {bars.map((e, lane) => e && (
            <span key={e.id} className={toneClass(e)}>
              {/* Дві осі знака (Components · легенда календаря): «≈» дати —
                  пунктирна риска; суворо — заливка крапки, мʼяко — контур. */}
              <span className={`${styles.rail} ${e.approx ? styles['rail-approx'] : ''} ${dayStart(e.start) === d.at ? styles['rail-start'] : ''} ${dayStart(e.end) === d.at ? styles['rail-end'] : ''}`}
                style={{ left: lane * 5 }} data-approx={e.approx ? '' : undefined} />
              {dayStart(e.start) === d.at && <span className={`${styles.dot} ${styles['dot-start']} ${e.force === 'restrict' ? '' : styles['dot-soft']}`} style={{ left: lane * 5 }} />}
              {dayStart(e.end) === d.at && <span className={`${styles.dot} ${styles['dot-end']} ${e.force === 'restrict' ? '' : styles['dot-soft']}`} style={{ left: lane * 5 }} />}
            </span>
          ))}
        </div>
        <div className={styles['day-inner']}>
          <div className={styles.dn}>
            <span className={styles.dow}>{dow(d.at)}</span>
            <span className={styles.num}>{num(d.at)}</span>
          </div>
          <div className={styles.content}>
            {captions.map(({ e, text }) => (
              <button key={`c${e.id}`} type="button" className={`${styles.tag} ${toneClass(e)} ${evMotion(e.id)}`} onClick={() => setOpenEvent(e)}>
                {legendIcon(e) && <Icon name={legendIcon(e)!} size={12} inherit decorative />}
                <span className={styles['tag-text']}>{text}</span>
              </button>
            ))}
            {shown.map((e) => eventRow(e, styles['ev-m']!))}
            {more && (
              <button type="button" className={styles.more} onClick={() => setOpenEvent(d.events[VISIBLE_LIMIT]!)}>{more}</button>
            )}
            {isToday && (
              <button type="button" className={styles.ask} onClick={() => navigate('/app')}>
                Що на вечерю?<Icon name="sys.next" size={12} inherit decorative />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const foot = (
    // П2 (2e): внизу — що приховано і які свята увімкнені; обидва рядки
    // відкривають картку підписок відповідного набору.
    <div className={styles.foot} data-testid="calendar-foot">
      <div className={styles['foot-row']}>
        <span className={styles['foot-label']}>приховані</span>
        <span className={styles['foot-value']}>{hidden.length ? hidden.map((h) => h.title).join(', ') : 'нічого'}</span>
        <button type="button" className={styles['foot-link']} onClick={() => { setOpenEvent(null); setOpenSeries('seasons'); }}>
          {hidden.length ? 'повернути' : 'сезони'}
        </button>
      </div>
      <div className={styles['foot-row']}>
        <span className={styles['foot-label']}>свята</span>
        <span className={styles['foot-value']}>{traditions.length ? traditions.map((t) => TRADITION_LABEL[t]).join(', ') : 'не обрано'}</span>
        <button type="button" className={styles['foot-link']} onClick={() => { setOpenEvent(null); setOpenSeries(traditions[0] ?? 'orthodox'); }}>
          {traditions.length ? 'змінити' : 'підключити'}
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.screen}>
      {loadFailed && (
        <Toast tone="danger" text={CALENDAR_FAILED.text} action={{ label: CALENDAR_FAILED.cta, run: () => setVersion((v) => v + 1) }} />
      )}
      {/* Шапка (D3a/D3b): h1 · «Вересень · тиждень 37» · розпірка · «Сьогодні»
          пігулкою на card · «Подія» чорнилом (на 390 — коло зі знаком). */}
      <AppHeader
        title="Календар"
        onMenu={() => openNav(true)}
        fill
        action={(
          <>
            {top && <span className={styles.sub}>{monthName(top.days[3]!.at)} · тиждень {top.num}</span>}
            <span className={styles['head-gap']} />
            <button type="button" className={styles['today-pill']} onClick={goToday}>Сьогодні</button>
            <button type="button" className={styles.add} onClick={() => setCreating({ date: isoOf(today), dateTo: '' })} aria-label="Нова подія">
              <Icon name="sys.add" size={16} inherit decorative /><span className={styles['add-text']}>Подія</span>
            </button>
          </>
        )}
      />

      {/* Легенда «що триває зараз» — чіпи тоном роду зі знаком роду; на 390 —
          один ряд зі скролом. */}
      {running.length > 0 && (
        <div className={styles.legend}>
          {running.map((e) => (
            <button key={`${e.scope}:${e.id}`} type="button"
              className={`${styles.chip} ${toneClass(e)} ${evMotion(e.id)}`} onClick={() => setOpenEvent(e)}>
              {legendIcon(e) && <Icon name={legendIcon(e)!} size={12} inherit decorative />}
              {legendLabel(e, today)}
            </button>
          ))}
        </div>
      )}

      <div className={`${styles.list} ${grid ? styles['list-grid'] : styles['list-ribbon']}`} ref={listRef}>
        {/* Етап 5 (п.4): скелетон тієї ж форми, без чисел. */}
        {loading && !events.length && <SkeletonRows rows={3} />}

        {grid ? weeks.map(weekCard) : (
          <>
            {top && (
              <div className={styles.monthbar} ref={stickyRef}>
                <span className={styles.month}>{monthName(top.days[3]!.at)}</span>
                <span>· тиждень {top.num} · {num(top.start)} – {num(top.days[6]!.at)}</span>
              </div>
            )}
            {weeks.map((w) => (
              <div key={w.start} ref={setWeekRef(w.start)}>{w.days.map(dayRow)}</div>
            ))}
          </>
        )}
        {foot}
      </div>

      {creating && (
        <Sheet onClose={() => setCreating(null)} ariaLabel="Нова подія" kind="event">
          <PeriodEvent initial={creating} onClose={() => setCreating(null)}
            onChanged={(id) => { if (id) openAfterCreate.current = id; setVersion((v) => v + 1); }} />
        </Sheet>
      )}
      {openEvent && !panelInFlow && (
        <Sheet onClose={() => setOpenEvent(null)} ariaLabel={openEvent.title} kind="event">
          <PeriodEvent key={openEvent.id} event={openEvent}
            onClose={() => setOpenEvent(null)} onChanged={onEventChanged} />
        </Sheet>
      )}
      {openSeries && !panelInFlow && (
        <Sheet onClose={() => setOpenSeries(null)} ariaLabel="Підписки" kind="event">
          <PeriodSubscriptions key={openSeries} initialSet={openSeries}
            onClose={() => setOpenSeries(null)} onDone={(c) => onEventChanged(undefined, c)}
            onAddOwn={() => setCreating({ date: isoOf(today), dateTo: '' })} />
        </Sheet>
      )}
    </div>
  );
}
