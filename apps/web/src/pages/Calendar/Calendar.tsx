// Календар — журнал, а не сітка. Сьогодні зверху, далі вниз; порожні дні
// підряд згортаються в «тиша». Це перший зріз: тижнева сітка на десктопі й
// сторінка події шторкою — наступний крок (Ф2).
//
// Рівень A (рішення 03.09): екран показує, але нічого не рахує. Жодного
// «бракує», жодного «заплановано 2 з 7». Людина дивиться й вирішує сама.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type EventOccurrence } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { whenLabel } from '../../lib/when';
import { toneKey } from '../../lib/tone';
import { buildDays, buildWeeks, splitRunning } from './days';
import {
  splitAxes, weekSpans, coversDay, edgeCaption, edgeDays, moreLabel,
  VISIBLE_LIMIT, MOBILE_RAILS, railable, rank, assignLanes,
} from '../../lib/spans';
import { Sheet } from '../../components/Sheet/Sheet';
import { EventArtifact } from '../../components/EventArtifact/EventArtifact';
import { usePanelStore, RAIL_IN_FLOW } from '../../store/panel';
import styles from './Calendar.module.css';

const DAY = 86_400_000;
// Рік, а не квартал. Макет каже прямо: «"Рік уперед" перестає бути окремим
// блоком — це просто продовження скролу». На 90 днях стрічка обривалась на
// грудні, і далі не було ні способу дійти, ні натяку, що там щось є.
//
// Довжина не б'є по вазі екрана: порожні тижні згортаються в один рядок, тож
// рік дає близько тридцяти рядків, а не трьохсот шістдесяти.
const HORIZON = 365;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dayNum = (at: number) => new Date(at).toLocaleDateString('uk-UA', { day: 'numeric' });
const dayDow = (at: number) => new Date(at).toLocaleDateString('uk-UA', { weekday: 'short' });
const monthOf = (at: number) => new Date(at).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
const shortDate = (at: number) => new Date(at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

// Рід — це КОЛІР ТЕКСТУ, і більше нічого.
//
// Перша версія малювала подію карткою: заливка, скруглення, акцентна смуга
// ліворуч, моно-рядок «коли» під назвою. Усе це я вигадав — ні в макеті, ні
// в кіті такого патерну немає. У макеті слот дня це просто рядок тексту,
// пофарбований родом, а межу дає border-bottom самого дня.
//
// Семантика та сама, що всюди: обмеження — слива («анти»), бо піст це рамка,
// а не помилка; завіз — шавлія, бо це прихід; рамка на день — приглушена, бо
// це не план; решта нейтральна.
// Колір = ЗНАЧЕННЯ, і кольорових родів лише три.
//
// Банк кольорів, який тут стояв, дизайн скасував прямо: «чотири кольорові
// риски поруч читалися б як графік, а не як календар». І це видно було на
// світлій темі — шість темних відтінків поруч розрізняються погано, бо їм і
// не треба розрізнятись: вони мали означати різне, а означали лише «інша
// подія».
//
// Рід і його тон вибирає lib/tone.ts — один вибір на весь застосунок, бо той
// самий тон носить рамка в блоці «ЗАРАЗ».
function toneOf(e: EventOccurrence): string {
  return styles[`t-${toneKey(e)}`]!;
}

// Гліф роду в розкритому дні. Кольору тут майже немає навмисно: у згорнутому
// дні його не було, і розкриття не привід додавати галас — сірий несе рід,
// шавлію тримає лише особиста, бо це єдине, що поставила сама людина.
//
// ▮ дістається і сезону, і обмеженню: обидва — вікно, що триває, а не подія
// дня, і читаються однаково («щось діє зараз»).
function glyphOf(e: EventOccurrence): string {
  if (e.force === 'restrict' || e.kind === 'season') return '▮';
  if (e.kind === 'meal') return '◌';
  if (e.scope === 'household') return '＋';
  if (e.kind === 'editorial' || e.source) return '¶';
  return '☼';
}

export function CalendarPage() {
  const openNav = useNavStore((s) => s.setOpen);
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  // Подія відкривається шторкою: вона довша за модалку, але власного маршруту
  // не заслуговує. На >=1280 їй місце в правій панелі як артефакту — але
  // панель зараз живе всередині Стрічки, не в каркасі, тож це окремий крок.
  const [openEvent, setOpenEvent] = useState<EventOccurrence | null>(null);
  // ≥1200 — подія в правій панелі каркаса як артефакт (канвас: «подія як
  // артефакт із вкладкою "Подія"»); нижче — шторка. Один компонент, різний
  // контейнер.
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
        <EventArtifact
          key={openEvent.id}
          event={openEvent}
          compact
          onClose={() => setOpenEvent(null)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      ),
    });
    panel.openArtifact(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelInFlow, openEvent]);
  useEffect(() => () => panel.clear(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  // Розкриття дня — суто мобільна механіка: на десктопі клітинка має висоту й
  // показує все на ховер, а там, де тап і ховер — одне, показати решту можна
  // тільки розсунувши день.
  const [expanded, setExpanded] = useState<number | null>(null);
  // «Сьогодні ↑» зʼявляється, коли сьогодні пішло за верхній край. Без
  // нижнього бара заголовок шапки — єдиний якір «де я», а в календарі таким
  // якорем є сьогоднішній день; загубити його в скролі означає загубитись.
  const todayRef = useRef<HTMLDivElement | null>(null);
  // Обидва вигляди — стрічка й сітка — живуть у DOM одночасно, перемикає їх
  // CSS. Тому ref мусить чіплятись лише до ВИДИМОГО сьогодні: у схованого
  // всі координати нульові, і спостерігач вирішував би, що воно на екрані.
  const setTodayEl = (el: HTMLDivElement | null) => {
    if (el && el.offsetParent !== null) todayRef.current = el;
  };
  const [todayOff, setTodayOff] = useState(false);
  useEffect(() => {
    const el = todayRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setTodayOff(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  });
  // Правка — та сама форма, що створення, лише з готовими полями.
  // Після «Додати» відкриваємо сторінку створеної події — але входження
  // (start/end) бере СЕРВЕР, тому спершу перечитуємо список і знаходимо її
  // там. Порахувати дати в вебі означало б завести другу копію правил, а одна
  // копія (whenLabel) у нас уже є, і вона того не варта.
  //
  // Ref, а не стан: інакше ефект читав би значення із замикання, не маючи його
  // в залежностях, і працював би лише завдяки тому, що обидва setState
  // потрапляють в один батч. Покладатись на це — значить лишити пастку.
  const openAfterCreate = useRef<string | null>(null);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  useEffect(() => {
    const to = new Date(today.getTime() + HORIZON * DAY);
    api.events.list(iso(today), iso(to))
      .then(({ events }) => {
        setEvents(events);
        if (openAfterCreate.current) {
          const made = events.find((e) => e.id === openAfterCreate.current);
          if (made) setOpenEvent(made);
          openAfterCreate.current = null;
        }
      })
      .catch(() => {/* порожній календар — теж відповідь */})
      .finally(() => setLoading(false));
  }, [today, version]);

  // Те, що вже триває, — окремим блоком і один раз. Інакше сезон, що йде
  // третій тиждень, засмічує кожен день стрічки.
  const { running, stream } = useMemo(
    () => splitRunning(events, today.getTime()), [events, today]);
  // Дві осі, які не змішуються (В5). Тривале не займає рядків у днях —
  // інакше піст на 48 днів дав би сорок вісім рядків «Великий піст». Тривалі
  // йдуть рейкою над сіткою (десктоп) і рискою збоку (мобільний); у днях
  // лишаються самі точкові. Через це нижній блок «Триває» пішов: сезон стояв
  // би у двох місцях, а одна подія ніколи не буває в обох.
  const { lasting, point } = useMemo(() => splitAxes([...running, ...stream]), [running, stream]);

  const keep = useMemo(() => edgeDays(lasting), [lasting]);
  const rows = useMemo(
    () => buildDays(point, today.getTime(), HORIZON, today.getTime(), keep), [point, today, keep]);
  // Той самий потік, зібраний у тижні. Обидва вигляди в DOM, перемикає CSS:
  // на ресайзі JS-перемикач мигав би, а тут просто інший display.
  const weeks = useMemo(
    () => buildWeeks(point, today.getTime(), HORIZON, today.getTime()), [point, today]);

  /**
   * Доріжки закріплюються за подіями на весь видимий період, а не рахуються
   * щодня. Через це лінія тримається однієї колонки всю свою довжину: коли
   * подія починається, вона займає ВІЛЬНУ доріжку, а не зсуває сусідів.
   */
  const lanes = useMemo(() => assignLanes(lasting), [lasting]);

  /**
   * Відступ рахується НА МІСЯЦЬ, не на день: інакше дата стрибала б ліворуч-
   * праворуч від того, скільки тривалих припало на конкретний день. У квітні,
   * коли лишиться сама черемша, дні повертаються самі.
   */
  const railWidthByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of rows) {
      const at = row.type === 'day' ? row.at : row.from;
      const key = monthOf(at);
      const n = lasting
        .filter((e) => coversDay(e, at))
        .reduce((max, e) => {
          const lane = lanes.get(e.id);
          return lane !== undefined && lane < MOBILE_RAILS ? Math.max(max, lane + 1) : max;
        }, 0);
      m.set(key, Math.max(m.get(key) ?? 0, n));
    }
    return m;
  }, [rows, lasting, lanes]);
  const gutter = (at: number) => {
    const n = railWidthByMonth.get(monthOf(at)) ?? 0;
    return n === 0 ? 0 : 6 * n - 3;
  };


  function railsFor(at: number) {
    const on = lasting.filter((e) => coversDay(e, at));
    const bars: (EventOccurrence | null)[] = Array.from({ length: MOBILE_RAILS }, () => null);
    for (const e of on) {
      const lane = lanes.get(e.id);
      if (lane !== undefined && lane < MOBILE_RAILS) bars[lane] = e;
    }
    // Хто без риски — редакційна або з доріжки за межею трьох — іде в
    // лічильник: вони тривають, просто мовчки.
    const shown = bars.filter(Boolean).length;
    return { bars, extra: on.length - shown };
  }

  let lastMonth = '';
  let lastGridMonth = '';

  return (
    <div className={styles.screen}>
      <AppHeader
        title="Календар"
        onMenu={() => openNav(true)}
        action={
          <button className={styles['head-add']} onClick={() => setCreating(true)}>＋ подія</button>
        }
      />
      <div className={styles.body}>
        {loading && <div className={styles.quiet}>—</div>}


        {!loading && events.length === 0 && (
          <div className={styles.empty}>
            <div className={styles['empty-title']}>Попереду тихо</div>
            <p className={styles['empty-text']}>
              Сезони й свята зʼявляються самі. Про своє — скажи Кухні:
              «у суботу гості, шестеро» або «мама привезе цибулю за тиждень».
            </p>
          </div>
        )}

        <div className={styles.list}>
        {rows.map((row) => {
          const at = row.type === 'day' ? row.at : row.from;
          const month = monthOf(at);
          const monthHead = month !== lastMonth ? month : null;
          lastMonth = month;

          if (row.type === 'quiet') {
            const r = railsFor(row.from);
            return (
              <div key={`q${row.from}`}>
                {monthHead && <div className={styles.month}>{monthHead}</div>}
                <div className={styles['quiet-row']}>
                  <div className={styles.rails} style={{ width: gutter(row.from) }}>
                    {r.bars.map((e, i) => (
                      <span
                        key={i}
                        className={`${styles.rail} ${e ? toneOf(e) : styles['rail-empty']}`}
                      />
                    ))}
                  </div>
                  <div className={styles.quiet}>
                    {shortDate(row.from)} – {shortDate(row.to)} · тиша · {row.days} дн.
                  </div>
                </div>
              </div>
            );
          }

          const isToday = row.at === today.getTime();
          const r = railsFor(row.at);
          // Підпис лише в того, хто має риску: інакше на екрані знову зʼявився б
          // кольоровий текст без плашки того ж кольору. Хто без риски — живе
          // в рядку «ще N тривалих», і це його єдине імʼя.
          const captions = r.bars
            .filter((e): e is EventOccurrence => e !== null)
            .map((e) => ({ e, text: edgeCaption(e, row.at) }))
            .filter((x): x is { e: EventOccurrence; text: string } => x.text !== null);
          // Порядок вирішує, хто ховається: редакційна першою, обмеження ніколи.
          const ordered = [...row.events].sort((a, b) => rank(a) - rank(b));
          const shown = ordered.slice(0, VISIBLE_LIMIT);
          const more = moreLabel(ordered.slice(VISIBLE_LIMIT));
          return (
            <div key={row.at}>
              {monthHead && (
                <div className={styles.month}>
                  {monthHead}
                  {r.extra > 0 && <span className={styles['month-more']}> · ＋{r.extra} тривалих</span>}
                </div>
              )}
              <div
                ref={isToday ? setTodayEl : undefined}
                className={`${styles.day} ${isToday ? styles.today : ''}`}
              >
                <div className={styles.rails} style={{ width: gutter(row.at) }}>
                  {r.bars.map((e, i) => (
                    <span
                      key={i}
                      className={`${styles.rail} ${e ? toneOf(e) : styles['rail-empty']}`}
                    />
                  ))}
                </div>
                <div className={styles.date}>
                  <span className={styles['date-dow']}>{dayDow(row.at)}</span>
                  <span className={styles['date-num']}>{dayNum(row.at)}</span>
                </div>
                <div className={styles.slots}>
                  {/* Підпис тривалої — лише на краях. У середині смуга вже все
                      сказала, а повторений щодня підпис і є те, чого уникаємо. */}
                  {captions.map(({ e, text }) => (
                    <button
                      key={`c${e.id}`}
                      className={`${styles.caption} ${toneOf(e)}`}
                      onClick={() => setOpenEvent(e)}
                    >{text}</button>
                  ))}
                  {row.events.length === 0 && !captions.length
                    ? <div className={styles.silence} />
                    : shown.map((e) => (
                      <button
                        key={`${e.scope}:${e.id}`}
                        className={`${styles.slot} ${toneOf(e)}`}
                        onClick={() => setOpenEvent(e)}
                      >
                        {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                        {e.approx && <span className={styles.approx}> · орієнтовно</span>}
                      </button>
                    ))}
                  {more && (
                    <button
                      className={styles.more}
                      aria-expanded={expanded === row.at}
                      onClick={() => setExpanded(expanded === row.at ? null : row.at)}
                    >{expanded === row.at ? 'ЗГОРНУТИ' : more}</button>
                  )}
                  {/* Розкриття міняє висоту, а не показ: сусідні дні лишаються
                      на місці й лише розсуваються. 0fr → 1fr анімує саме
                      висоту вмісту, тож ліміт у пікселях вгадувати не треба. */}
                  <div className={`${styles.expand} ${expanded === row.at ? styles['expand-open'] : ''}`}>
                    <div className={styles['expand-inner']}>
                      {ordered.map((e) => (
                        <button
                          key={`x${e.scope}:${e.id}`}
                          className={`${styles['expand-row']} ${toneOf(e)}`}
                          onClick={() => setOpenEvent(e)}
                        >
                          <span className={styles['expand-glyph']}>{glyphOf(e)}</span>
                          <span className={styles['expand-title']}>
                            {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                          </span>
                          <span className={styles['expand-chev']}>›</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>

        <div className={styles.grid}>
          <div className={styles['grid-head']}>
            {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map((d) => (
              <div key={d} className={styles['grid-dow']}>{d}</div>
            ))}
          </div>
          {weeks.map((w) => {
            if (w.type === 'quiet-weeks') {
              return (
                <div key={`qw${w.from}`} className={styles.quiet}>
                  {shortDate(w.from)} – {shortDate(w.to)} · тиша · {w.weeks}{' '}
                  {w.weeks === 1 ? 'тиждень' : w.weeks < 5 ? 'тижні' : 'тижнів'}
                </div>
              );
            }
            const month = monthOf(w.start);
            const monthHead = month !== lastGridMonth ? month : null;
            lastGridMonth = month;
            const allSpans = weekSpans(lasting, w.start);
            const spans = allSpans.slice(0, VISIBLE_LIMIT);
            const hiddenSpans = allSpans.slice(VISIBLE_LIMIT);
            return (
              <div key={w.start}>
                {monthHead && <div className={styles.month}>{monthHead}</div>}
                {/* Рейка: одна смуга на тривалу подію, обрізана по краях тижня.
                    Відкритий край каже, що подія триває далі. */}
                {spans.map((sp) => (
                  <div key={`s${sp.event.id}`} className={styles['rail-row']}>
                    <button
                      className={`${styles.span} ${toneOf(sp.event)} ${sp.openLeft ? styles['span-openl'] : ''} ${sp.openRight ? styles['span-openr'] : ''}`}
                      style={{ gridColumn: `${sp.from} / ${sp.to}` }}
                      onClick={() => setOpenEvent(sp.event)}
                    >
                      {sp.event.kind === 'supply' ? '＋ ' : ''}{sp.event.title.toUpperCase()}
                      {' · '}{whenLabel(sp.event.start, sp.event.end).toUpperCase()}
                    </button>
                  </div>
                ))}
                {hiddenSpans.length > 0 && (
                  <button
                    className={styles['rail-more']}
                    onClick={() => setOpenEvent(hiddenSpans[0]!.event)}
                  >
                    ЩЕ {hiddenSpans.length} ТРИВАЛА · {hiddenSpans[0]!.event.title.toUpperCase()} ›
                  </button>
                )}
                <div className={styles.week}>
                  {w.days.map((d) => (
                    <div
                      key={d.at}
                      ref={d.at === today.getTime() ? setTodayEl : undefined}
                      className={`${styles.cell} ${d.at === today.getTime() ? styles['cell-today'] : ''}`}
                    >
                      <div className={styles['cell-date']}>{dayDow(d.at)} {dayNum(d.at)}</div>
                      {/* Порожня клітинка — тиша, не дірка: ні «＋ додати»,
                          ні пунктирної рамки, яка просить себе заповнити.
                          Ліміт три: більше — вже список, а не погляд.

                          Приховані рендеряться одразу, а не по кліку: на
                          десктопі ховер показує всі, і робити це станом
                          означало б тримати вибір там, де достатньо CSS. */}
                      {(() => {
                        const all = [...d.events].sort((a, b) => rank(a) - rank(b));
                        return (
                          <div className={styles['cell-stack']}>
                            {all.map((e, i) => (
                              <button
                                key={`${e.scope}:${e.id}`}
                                className={`${styles['cell-slot']} ${toneOf(e)} ${i >= VISIBLE_LIMIT ? styles['cell-extra'] : ''}`}
                                onClick={() => setOpenEvent(e)}
                                title={e.meaning ?? e.title}
                              >
                                {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                              </button>
                            ))}
                            {all.length > VISIBLE_LIMIT && (
                              <span className={styles['cell-more']}>
                                {moreLabel(all.slice(VISIBLE_LIMIT), false)}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {todayOff && (
        <button
          className={styles['to-today']}
          onClick={() => todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        >Сьогодні ↑</button>
      )}

      {/* Одна сутність, один компонент: перегляд, правка на місці й створення
          — той самий EventArtifact, що живе в панелі стрічки. Шторка тут лише
          контейнер (<1280); на ≥1280 їй місце в правій панелі каркаса — коли
          панель підніметься з Feed у Shell. */}
      {creating && (
        <Sheet onClose={() => setCreating(false)} ariaLabel="Нова подія">
          <EventArtifact
            mode="new"
            onClose={() => setCreating(false)}
            onChanged={(id) => { if (id) openAfterCreate.current = id; setVersion((v) => v + 1); }}
          />
        </Sheet>
      )}

      {openEvent && !panelInFlow && (
        <Sheet onClose={() => setOpenEvent(null)} ariaLabel={openEvent.title}>
          <EventArtifact
            key={openEvent.id}
            event={openEvent}
            onClose={() => setOpenEvent(null)}
            onChanged={() => setVersion((v) => v + 1)}
          />
        </Sheet>
      )}
    </div>
  );
}
