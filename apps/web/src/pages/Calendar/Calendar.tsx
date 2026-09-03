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
// Подія — той самий EventArtifact: на ≥1200 у правій панелі каркаса, нижче —
// шторка. Один компонент, різний контейнер.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type EventOccurrence } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { toneKey } from '../../lib/tone';
import { buildTimeline, dayStart, mondayOf, DAY, type TimelineWeek } from './days';
import {
  splitAxes, coversDay, edgeCaption, moreLabel, VISIBLE_LIMIT, MOBILE_RAILS, assignLanes,
} from '../../lib/spans';
import { Sheet } from '../../components/Sheet/Sheet';
import { EventArtifact } from '../../components/EventArtifact/EventArtifact';
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

// Підпис чіпа легенди (канвас): «ПІСТ · 12 З 48», «ЧЕРЕМША · З ВТ 3 · ДО ≈ 20.03»,
// «ОЛЕНА · ЧТ 5 – НД 8». День тижня має сенс лише поки старт близько — сезон,
// що почався півтора місяця тому, називає лише кінець: «ДО 20.09».
function legendLabel(e: EventOccurrence, today: number): string {
  const days = Math.round((dayStart(e.end) - dayStart(e.start)) / DAY) + 1;
  const dayN = Math.round((today - dayStart(e.start)) / DAY) + 1;
  const t = e.title.toUpperCase();
  if (e.force === 'restrict') return `${t} · ${dayN} З ${days}`;
  const d = (at: number) => `${dow(at).toUpperCase()} ${num(at)}`;
  const until = `ДО ${e.approx ? '≈ ' : ''}${new Date(e.end).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}`;
  if (days <= 14) return `${t} · ${d(e.start)} – ${d(e.end)}`;
  return dayN <= 7 ? `${t} · З ${d(e.start)} · ${until}` : `${t} · ${until}`;
}

export function CalendarPage() {
  const navigate = useNavigate();
  const openNav = useNavStore((s) => s.setOpen);
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [openEvent, setOpenEvent] = useState<EventOccurrence | null>(null);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const openAfterCreate = useRef<string | null>(null);

  const today = useMemo(() => dayStart(Date.now()), []);
  const from = useMemo(() => mondayOf(today - PAST_WEEKS * 7 * DAY), [today]);

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
      .catch(() => {/* порожній календар — теж відповідь */})
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
    if (!panelInFlow || !openEvent) { panel.clear(); return; }
    const key = `event:${openEvent.id}`;
    panel.publish({
      artifacts: [{ key, kind: 'event', label: openEvent.title, meta: '' }],
      render: () => (
        <EventArtifact key={openEvent.id} event={openEvent} compact
          onClose={() => setOpenEvent(null)} onChanged={() => setVersion((v) => v + 1)} />
      ),
    });
    panel.openArtifact(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelInFlow, openEvent]);
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
      <AppHeader
        title="Календар"
        onMenu={() => openNav(true)}
        action={(
          <button type="button" className={styles.add} onClick={() => setCreating(true)} aria-label="Нова подія">＋</button>
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
                  className={`${styles.chip} ${toneClass(e)}`} onClick={() => setOpenEvent(e)}>
                  {legendLabel(e, today)}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading && !events.length && <div className={styles.loading}>ЗАВАНТАЖУЮ…</div>}

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
                const empty = !captions.length && !d.events.length;
                return (
                  <div key={d.at} ref={isToday ? todayRef : undefined}
                    className={`${styles.day} ${isToday ? styles.today : ''}`}>
                    <div className={styles.gutter}>
                      {bars.map((e, lane) => e && (
                        <span key={e.id} className={toneClass(e)}>
                          <span className={`${styles.rail} ${dayStart(e.start) === d.at ? styles['rail-start'] : ''} ${dayStart(e.end) === d.at ? styles['rail-end'] : ''}`}
                            style={{ left: lane * 8 }} />
                          {dayStart(e.start) === d.at && <span className={`${styles.dot} ${styles['dot-start']}`} style={{ left: lane * 8 }} />}
                          {dayStart(e.end) === d.at && <span className={`${styles.dot} ${styles['dot-end']}`} style={{ left: lane * 8 }} />}
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
                          <button key={`c${e.id}`} type="button" className={`${styles.tag} ${toneClass(e)}`} onClick={() => setOpenEvent(e)}>{text}</button>
                        ))}
                        {shown.map((e) => (
                          <button key={`${e.scope}:${e.id}`} type="button"
                            className={`${styles.ev} ${e.kind === 'constraint' ? styles['ev-constraint'] : ''} ${e.kind === 'editorial' || e.source ? styles['ev-editorial'] : ''}`}
                            onClick={() => setOpenEvent(e)}>
                            {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                          </button>
                        ))}
                        {more && (
                          <button type="button" className={`${styles.tag} ${styles.more}`} onClick={() => setOpenEvent(d.events[VISIBLE_LIMIT]!)}>{more} ›</button>
                        )}
                        {isToday && (
                          <button type="button" className={styles.ask} onClick={() => navigate('/app')}>
                            {empty ? 'Що на вечерю? — спитати Кухню' : '＋ Що на вечерю?'}
                          </button>
                        )}
                        {!isToday && empty && <span className={styles.empty}>Нічого не заплановано</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {creating && (
        <Sheet onClose={() => setCreating(false)} ariaLabel="Нова подія">
          <EventArtifact mode="new" onClose={() => setCreating(false)}
            onChanged={(id) => { if (id) openAfterCreate.current = id; setVersion((v) => v + 1); }} />
        </Sheet>
      )}
      {openEvent && !panelInFlow && (
        <Sheet onClose={() => setOpenEvent(null)} ariaLabel={openEvent.title}>
          <EventArtifact key={openEvent.id} event={openEvent}
            onClose={() => setOpenEvent(null)} onChanged={() => setVersion((v) => v + 1)} />
        </Sheet>
      )}
    </div>
  );
}
