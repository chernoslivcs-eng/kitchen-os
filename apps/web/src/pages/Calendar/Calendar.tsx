// Календар — стрічка днів. Канвас «Календар — інтерфейс» (03.09, рішення
// власника): дати зверху вниз на всіх ширинах, без сітки 7×N і без згортання
// порожніх тижнів; тривалі — рисками в жолобі зліва плюс легенда чіпами
// «що триває зараз»; «сьогодні» — єдиний підсвічений рядок, і його другий
// рядок — вхід у розмову, а не «＋».
//
// Гортається в обидва боки: чотири тижні назад (щоб бачити, що було), рік
// уперед (бо це про планування — «важливіше те, що буде»). На старті
// сьогодні стоїть зверху; пігулка «СЬОГОДНІ» в шапці повертає до нього.
//
// Подія — PeriodEvent (П2): на ≥1200 у правій панелі каркаса, нижче — шторка.
// Системна — читання з «Не показувати», своя — правка на місці. Внизу
// календаря два рядки: «приховані … · повернути» і «свята … · змінити» —
// обидва відкривають підписки (PeriodSubscriptions): традиції чіпами, рядки
// з перемикачами, сезони, вхід у свою подію (PLAN §7).

import { Icon } from '../../components/Icon/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../lib/track';
import { useNavigate } from 'react-router-dom';
import { api, type EventOccurrence, type OccasionSet, type SubscriptionRow, type Tradition } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { toneKey } from '../../lib/tone';
import { buildTimeline, dayStart, mondayOf, DAY, type TimelineWeek } from './days';
import { legendLabel, legendIcon } from './legend';

// Локальна дата в ISO — форма події живе в 'YYYY-MM-DD'.
function isoOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
import {
  splitAxes, coversDay, edgeCaption, moreLabel, VISIBLE_LIMIT, MOBILE_RAILS, assignLanes,
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

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dow = (at: number) => new Date(at).toLocaleDateString('uk-UA', { weekday: 'short' });
const num = (at: number) => new Date(at).getDate();
const monthName = (at: number) => {
  const m = new Date(at).toLocaleDateString('uk-UA', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
};
const shortRange = (a: number, b: number) => {
  const da = new Date(a), db = new Date(b);
  const mb = db.toLocaleDateString('uk-UA', { month: 'long' });
  return da.getMonth() === db.getMonth()
    ? `${da.getDate()} – ${db.getDate()} ${mb}`
    : `${da.getDate()} ${da.toLocaleDateString('uk-UA', { month: 'short' })} – ${db.getDate()} ${mb}`;
};

function toneClass(e: EventOccurrence): string { return styles[`t-${toneKey(e)}`]!; }

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
  // Нова подія: з «＋» — на сьогодні; з календаря — на дні, куди клікнули.
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
    api.events.list(iso(new Date(from)), iso(to))
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

  // Дві осі: тривалі — риски й легенда, точкові — рядки днів.
  const { lasting, point } = useMemo(() => splitAxes(events), [events]);
  const lanes = useMemo(() => assignLanes(lasting), [lasting]);
  const running = useMemo(
    () => lasting.filter((e) => coversDay(e, today)).sort((a, b) => a.start - b.start),
    [lasting, today],
  );
  const weeks = useMemo(() => buildTimeline(point, from, WEEKS), [point, from]);

  // Панель на ≥1200, шторка нижче.
  const panel = usePanelStore();
  const [panelInFlow, setPanelInFlow] = useState(() => window.matchMedia(RAIL_IN_FLOW).matches);
  useEffect(() => {
    const mq = window.matchMedia(RAIL_IN_FLOW);
    const on = () => setPanelInFlow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
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
    panel.publish({
      artifacts: [{ key, kind: 'event', label: openEvent!.title, meta: '' }],
      render: () => (
        <PeriodEvent key={openEvent!.id} event={openEvent!}
          onClose={() => setOpenEvent(null)} onChanged={onEventChanged} />
      ),
    });
    panel.openArtifact(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelInFlow, openEvent, openSeries]);
  useEffect(() => () => panel.clear(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Сьогодні зверху на старті; пігулка повертає до нього.
  const todayRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const scrolledOnce = useRef(false);
  // Липкий блок перекриває верх сторінки — сьогодні має стати ПІД ним, а не
  // під нього.
  const scrollToToday = (behavior: ScrollBehavior) => {
    if (!todayRef.current) return;
    const offset = (stickyRef.current?.offsetHeight ?? 0) + 8;
    const top = todayRef.current.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior });
  };
  useEffect(() => {
    if (loading || scrolledOnce.current || !todayRef.current) return;
    scrolledOnce.current = true;
    scrollToToday('auto');
  }, [loading]);
  const goToday = () => scrollToToday('smooth');

  // Липкий підрядок «місяць · тиждень N» — за верхнім видимим тижнем.
  const weekRefs = useRef(new Map<number, HTMLDivElement>());
  const [topWeek, setTopWeek] = useState<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let best: number | null = null;
        for (const [start, el] of weekRefs.current) {
          if (el.getBoundingClientRect().top <= (stickyRef.current?.offsetHeight ?? 0) + 24) { if (best === null || start > best) best = start; }
        }
        setTopWeek(best ?? weeks[0]?.start ?? null);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); };
  }, [weeks]);
  const top = weeks.find((w) => w.start === topWeek) ?? weeks[0];

  const restrictCoversWeek = (w: TimelineWeek): EventOccurrence | undefined =>
    lasting.find((e) => e.force === 'restrict' && w.days.every((d) => coversDay(e, d.at)));

  return (
    <div className={styles.screen}>
      {loadFailed && (
        <Toast tone="danger" text={CALENDAR_FAILED.text} action={{ label: CALENDAR_FAILED.cta, run: () => setVersion((v) => v + 1) }} />
      )}
      <AppHeader
        title="Календар"
        onMenu={() => openNav(true)}
        action={(
          <button type="button" className={styles.add} onClick={() => setCreating({ date: isoOf(today), dateTo: '' })} aria-label="Нова подія"><Icon name="sys.add" size={20} inherit /></button>
        )}
      />

      <div className={styles.body}>
        {/* Липкий блок: місяць · тиждень · «Сьогодні» і легенда того, що триває.
            Шапка сторінки не липка, а пігулка потрібна саме з глибини скролу —
            тому вона тут. Легенда — теж тут: «що триває зараз» має бути
            видно, куди б не догорнув, як у К2. */}
        <div className={styles.sticky} ref={stickyRef}>
          {top && (
            <div className={styles.monthbar}>
              <span className={styles.month}>{monthName(top.days[3]!.at)}</span>
              <span className={styles['monthbar-right']}>
                <span className={styles.weekno}>тиждень {top.num}</span>
                <button type="button" className={styles['today-pill']} onClick={goToday}>Сьогодні</button>
              </span>
            </div>
          )}
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
        </div>

        {/* Етап 5 (п.4): скелетон тієї ж форми, без чисел — на місці того, що
            вантажиться (чіпи легенди й підписи в днях), а не слово капсом. */}
        {loading && !events.length && <SkeletonRows rows={3} />}

        {weeks.map((w, wi) => {
          const prev = weeks[wi - 1];
          const newMonth = !prev || new Date(prev.days[3]!.at).getMonth() !== new Date(w.days[3]!.at).getMonth();
          const restrict = restrictCoversWeek(w);
          return (
            <div key={w.start} ref={(el) => { if (el) weekRefs.current.set(w.start, el); else weekRefs.current.delete(w.start); }}>
              <div className={styles.week}>
                <span className={styles['week-name']}>
                  Тиждень {w.num}{newMonth ? ` · ${monthName(w.days[3]!.at)}` : ''}
                </span>
                {restrict ? (
                  <span className={`${styles['week-tag']} ${styles['t-restrict']}`}>
                    {restrict.title.toUpperCase()} ТРИВАЄ · {Math.round((dayStart(restrict.end) - w.start) / DAY) + 1} ДНІВ
                  </span>
                ) : (
                  <span className={styles['week-tag']}>{shortRange(w.start, w.days[6]!.at)}</span>
                )}
              </div>
              {w.days.map((d) => {
                const isToday = d.at === today;
                // Риски: фіксовані доріжки, порожня — спейсер, щоб не стрибало.
                const bars = Array.from({ length: MOBILE_RAILS }, (_, lane) =>
                  lasting.find((e) => lanes.get(e.id) === lane && coversDay(e, d.at)) ?? null);
                const captions = bars
                  .filter((e): e is EventOccurrence => e !== null)
                  .map((e) => ({ e, text: edgeCaption(e, d.at) }))
                  .filter((x): x is { e: EventOccurrence; text: string } => x.text !== null);
                const shown = d.events.slice(0, VISIBLE_LIMIT);
                const more = moreLabel(d.events.slice(VISIBLE_LIMIT));
                return (
                  <div key={d.at} ref={isToday ? todayRef : undefined} data-at={d.at}
                    onPointerDown={beginSelect(d.at)}
                    className={`${styles.day} ${isToday ? styles.today : ''} ${inSel(d.at) ? styles.sel : ''} ${sel ? styles.selecting : ''}`}>
                    <div className={styles.gutter}>
                      {bars.map((e, lane) => e && (
                        <span key={e.id} className={`${toneClass(e)} ${e.scope === 'catalog' ? styles.sys : ''}`}>
                          {/* Дві осі знака (Components · легенда календаря): «≈» дати —
                              пунктирна риска; суворо — заливка крапки, мʼяко — контур. */}
                          <span className={`${styles.rail} ${e.approx ? styles['rail-approx'] : ''} ${dayStart(e.start) === d.at ? styles['rail-start'] : ''} ${dayStart(e.end) === d.at ? styles['rail-end'] : ''}`}
                            style={{ left: lane * 8 }} data-approx={e.approx ? '' : undefined} />
                          {dayStart(e.start) === d.at && <span className={`${styles.dot} ${styles['dot-start']} ${e.force === 'restrict' ? '' : styles['dot-soft']}`} style={{ left: lane * 8 }} />}
                          {dayStart(e.end) === d.at && <span className={`${styles.dot} ${styles['dot-end']} ${e.force === 'restrict' ? '' : styles['dot-soft']}`} style={{ left: lane * 8 }} />}
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
                        {shown.map((e) => (
                          <button key={`${e.scope}:${e.id}`} type="button"
                            className={`${styles.ev} ${e.kind === 'constraint' ? styles['ev-constraint'] : ''} ${e.kind === 'editorial' || e.source ? styles['ev-editorial'] : ''} ${evMotion(e.id)}`}
                            onClick={() => setOpenEvent(e)}>
                            {e.title}
                          </button>
                        ))}
                        {more && (
                          <button type="button" className={`${styles.tag} ${styles.more}`} onClick={() => setOpenEvent(d.events[VISIBLE_LIMIT]!)}>{more} ›</button>
                        )}
                        {isToday && (
                          <button type="button" className={styles.ask} onClick={() => navigate('/app')}>
                            Що на вечерю?
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* П2 (2e): внизу — що приховано і які свята увімкнені; обидва рядки
          відкривають картку серії відповідного набору. */}
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
