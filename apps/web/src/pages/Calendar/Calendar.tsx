// Календар v3 — приведення до каркасу Комори (рішення власника 19.09, після
// К9 «мінімум»). Той самий зміст (картка «Сьогодні» + список «Далі» + дві
// дії), тепер у словнику Pantry.tsx/Pantry.module.css: шапка з лічильником
// і двома компактними діями (як «Фільтр»/«Додати»), zone-card + section-label
// (замість голого блоку), рядки 48 ROW ANATOMY зі знаком замість крапки-тону,
// один стовпчик до 720px, як «Список» (рішення власника 20.09), «Далі» —
// ОДНА картка з роздільниками місяців усередині (рішення власника 20.09,
// раніше — картка на місяць). Нічого нового не вигадуємо — усі числа
// й розмітка звідти. «Сьогодні» показує наслідок для кухні (rule_text/
// restricts/meaning) другим рядком уже в картці (рішення власника 20.09,
// todayConsequence); «Далі» — тип/правило (aheadMeta), не наслідок, свідомо
// інша мета. Клік по будь-якому рядку — той самий артефакт, що з чату
// (openNowItem/showEvent, той самий обробник з Р174/Р175).

import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/icons';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { track } from '../../lib/track';
import { api, type EventOccurrence, type NowItem, type OccasionSet } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import {
  nowWhen, nowIcon, eventIcon, nowItemToEvent, todayGroups, todayPointEvents, todayPointMeta, todayPointRight,
  todayPeriodRange, todayPeriodDays, todayConsequence,
  seasonNames, aheadHorizon, aheadRows, aheadRowDate, aheadMeta, aheadPeriod, aheadRight, aheadRightIsDays, aheadMonthGroups, dow, type AheadRow,
} from './agenda';
import { todayIso } from '../../lib/period';
import { Sheet } from '../../components/Sheet/Sheet';
import { PeriodEvent, type PeriodChange } from '../../components/PeriodArtifact/PeriodArtifact';
import { PeriodSubscriptions } from '../../components/PeriodArtifact/PeriodSubscriptions';
import { Toast } from '../../components/ErrorState/Toast';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { CALENDAR_FAILED } from '../../components/ErrorState/copy';
import { usePanelStore, ARTIFACT_SIDE } from '../../store/panel';
import styles from './Calendar.module.css';

function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Локальна дата в ISO — форма події живе в 'YYYY-MM-DD'.
function isoOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Що відкрито праворуч (панель ≥1200 / картка 600–1199 / шторка <600): подія або каталог — одне з двох.
 *  `set` без значення — каталог на рівні пакетів (К5: «Додати» веде в корінь, не в конкретний набір). */
type OpenPanel = { kind: 'event'; event: EventOccurrence } | { kind: 'series'; set?: OccasionSet } | null;

export function CalendarPage() {
  const openNav = useNavStore((s) => s.setOpen);
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [now, setNow] = useState<NowItem[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [nowLoaded, setNowLoaded] = useState(false);
  const loading = !eventsLoaded || !nowLoaded;

  // Хотфікс 13.09 (баг власника на проді): «що відкрито праворуч» — ОДИН стан,
  // а не два: з двома клік по події після «Каталогу» не перемикав панель.
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const openEvent = openPanel?.kind === 'event' ? openPanel.event : null;
  const seriesOpen = openPanel?.kind === 'series';
  const openSeriesSet = openPanel?.kind === 'series' ? openPanel.set : undefined;
  const showEvent = (e: EventOccurrence) => setOpenPanel({ kind: 'event', event: e });
  const showSeries = (set?: OccasionSet) => setOpenPanel({ kind: 'series', set });
  const closePanel = () => setOpenPanel(null);
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
  // Моушн-пас 20.09 (еталон — Комора Pantry.tsx `freshIds`/`snapshotReady`):
  // перший рендер списку — без входів, «список просто зʼявляється»; рядок
  // «вʼїжджає» (`.row-fresh`, `cal-in`) лише коли його `motionId` щойно
  // з'явився в ОДНОМУ з наступних знімків (не в першому). Один спільний
  // Set на «Сьогодні» й «Далі» — той самий `motionId`, що вже несе
  // `evMotion`, тож нова подія отримує cal-in (тут) + ev-flash (створення
  // нижче) без окремого поля.
  const snapshotReady = useRef(false);
  const seenMotionIds = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  // Нова подія: з кнопки «+ Своя подія» (рішення власника 19.09), на сьогодні.
  const [creating, setCreating] = useState<{ date: string; dateTo: string } | null>(null);
  const openAfterCreate = useRef<string | null>(null);
  const startOwn = () => { closePanel(); setCreating({ date: isoOf(today), dateTo: '' }); };

  useEffect(() => { track('calendar_opened'); }, []);

  const today = useMemo(() => dayStart(Date.now()), []);
  const todayIsoStr = useMemo(() => todayIso(new Date(today)), [today]);
  // Родовий відмінок («19 вересня», не «19 вересень»): Intl дає його лише
  // коли день і місяць форматуються РАЗОМ.
  const headerDate = useMemo(() => new Date(today).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }), [today]);

  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    api.events.now()
      .then(({ now: items }) => setNow(items))
      .catch(() => setLoadFailed(true))
      .finally(() => setNowLoaded(true));
  }, [version]);

  // Горизонт «Далі» (К9) — кінець третього місяця після поточного, фіксовано.
  const horizon = useMemo(() => aheadHorizon(today), [today]);
  useEffect(() => {
    api.events.list(isoOf(today), isoOf(horizon))
      .then(({ events: list }) => {
        setEvents(list);
        if (openAfterCreate.current) {
          const made = list.find((e) => e.id === openAfterCreate.current);
          openAfterCreate.current = null;
          if (made) showEvent(made);
        }
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setEventsLoaded(true));
  }, [today, horizon, version]);

  const { strict, soft, seasons } = useMemo(() => todayGroups(now), [now]);
  const todayEvents = useMemo(() => todayPointEvents(events, today), [events, today]);
  const ahead = useMemo(() => aheadRows(events, today, horizon), [events, today, horizon]);
  const monthGroups = useMemo(() => aheadMonthGroups(ahead), [ahead]);
  // Моушн-пас 20.09: знімок `motionId` після кожного повного завантаження —
  // перший прохід лише запамʼятовує (без входів), кожен наступний рахує
  // різницю й на 300ms позначає нові `.row-fresh`.
  useEffect(() => {
    if (loading) return;
    const ids = new Set<string>();
    for (const it of [...strict, ...soft]) ids.add(it.occasion_id ?? it.id ?? it.title);
    for (const e of todayEvents) ids.add(e.id);
    for (const r of ahead) ids.add(r.event.id);
    if (snapshotReady.current) {
      const fresh = [...ids].filter((id) => !seenMotionIds.current.has(id));
      if (fresh.length > 0) {
        setFreshIds((prev) => new Set([...prev, ...fresh]));
        window.setTimeout(() => {
          setFreshIds((prev) => { const next = new Set(prev); fresh.forEach((id) => next.delete(id)); return next; });
        }, 300);
      }
    } else {
      snapshotReady.current = true;
    }
    seenMotionIds.current = ids;
  }, [strict, soft, todayEvents, ahead, loading]);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const todayEmpty = strict.length === 0 && soft.length === 0 && seasons.length === 0 && todayEvents.length === 0;
  const pageEmpty = todayEmpty && ahead.length === 0;
  // Лічильник шапки (приведення до Комори, як pantry «N позицій»): «діє» —
  // рядки «Сьогодні» без сезону (сезон — один згорнутий рядок, не лічиться
  // окремо); «попереду» — рядки «Далі» (старт+кінець рахуються окремо,
  // так само, як їх бачить список).
  const todayCount = strict.length + soft.length + todayEvents.length;
  const counterText = pageEmpty ? 'нічого не діє' : `${todayCount} діє · ${ahead.length} попереду`;

  // ОДИН обробник кліку по події для «Сьогодні» й «Далі»: власна відкривається
  // на редагування, каталожна — PeriodEvent у режимі читання з «Не показувати»
  // (як системні події в чаті). Каталог (рівень пакетів) — лише з «Каталог»/
  // «+ Своя подія» в шапці. «Далі» вже має повний EventOccurrence — showEvent
  // напряму; «Сьогодні» має лише NowItem для періодів, тож спершу шукає той
  // самий об'єкт у вже завантаженому events, а якщо не знайшла — показує
  // подію, зібрану напряму з NowItem (nowItemToEvent) — клік ніколи не мовчить
  // і ніколи не падає в каталог.
  const openNowItem = (it: NowItem) => {
    const key = it.source === 'user' ? it.id : it.occasion_id;
    const found = key ? events.find((e) => e.id === key) : undefined;
    showEvent(found ?? nowItemToEvent(it));
  };

  // №34: праворуч (панель ≥1200, плавуча картка 600–1199), шторка лише < 600.
  const panel = usePanelStore();
  const panelInFlow = useMedia(ARTIFACT_SIDE);
  useEffect(() => {
    if (!panelInFlow || !openPanel) { panel.clear(); return; }
    if (openPanel.kind === 'series') {
      const key = 'catalog';
      panel.publish({
        artifacts: [{ key, kind: 'event', label: 'Каталог подій', meta: '' }],
        render: () => (
          <PeriodSubscriptions key={openPanel.set ?? 'root'} initialSet={openPanel.set}
            onDone={(c) => onEventChanged(undefined, c)} />
        ),
      });
      panel.openArtifact(key);
      return;
    }
    const key = `event:${openPanel.event.id}`;
    panel.publish({
      artifacts: [{ key, kind: 'event', label: 'Подія', meta: '' }],
      render: () => (
        <PeriodEvent key={openPanel.event.id} event={openPanel.event}
          onClose={() => closePanel()} onChanged={onEventChanged} />
      ),
    });
    panel.openArtifact(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- колбеки картки нові щорендеру — публікуємо лише на зміну відкритої події/каталогу
  }, [panelInFlow, openPanel]);
  useEffect(() => () => panel.clear(), []); // eslint-disable-line react-hooks/exhaustive-deps -- clear лише при розмонтуванні; panel — стабільний стор

  // Рядок ROW ANATOMY (Pantry «Комора», п. 2 живої перевірки на стенді
  // 19.09: мета — ДРУГИМ РЯДКОМ під назвою, як `.meta-line` у рядках
  // партій, не в один рядок із назвою). Рядок 1: знак · назва · права
  // колонка (усі — на одному рівні, вирівняні по центру блока), далі —
  // «період» (тривалі: «30.09 – 30.10», muted, tabular; одноденні —
  // порожня, без рисок, тієї самої фіксованої ширини) і «дні» (тривалі —
  // ink, кількість; інакше — те, що й раніше: «6 осіб»/«кінець»/нічого).
  // Рядок 2 (лише коли є period і/або meta): на <768 колонка «період» не
  // вміщується — вона йде ПЕРШОЮ в мету («30.09 – 30.10 · калорійніше»);
  // на ≥768 у мету йде лише meta (правило, без дати — дата у своїй колонці).
  // Висота рядка (48/56) — за `data-meta-wide`/`data-meta-mobile`, кожен
  // прапорець рахує «чи покаже якийсь рядок другу лінію», а брейкпоінт
  // (CSS) вирішує, який з двох.
  const row = (opts: {
    key: string; icon: IconName; name: string;
    meta?: string | null; period?: string | null; right?: string | null; daysTone?: 'days' | 'plain';
    date?: ReactNode; onClick: () => void; motionId: string;
  }) => {
    const metaMobile = [opts.period, opts.meta].filter(Boolean).join(' · ') || null;
    const fresh = freshIds.has(opts.motionId) ? styles['row-fresh'] : '';
    return (
      <button key={opts.key} type="button" className={`${styles.row} ${fresh} ${evMotion(opts.motionId)}`} data-tap onClick={opts.onClick}
        data-meta-wide={opts.meta ? '' : undefined} data-meta-mobile={metaMobile ? '' : undefined}>
        {opts.date}
        {/* Без `inherit`: рядок не задає свій колір, а бездоганний спокійний
            muted — це якраз дефолт самого Icon (Icon.module.css `.icon`), без
            гри в специфічність двох модулів на тому самому вузлі. */}
        <Icon name={opts.icon} size={16} decorative />
        <span className={styles.content}>
          <span className={styles.name}>{opts.name}</span>
          {opts.meta && <span className={`${styles.rmeta} ${styles['rmeta-wide']}`}>{opts.meta}</span>}
          {metaMobile && <span className={`${styles.rmeta} ${styles['rmeta-m']}`}>{metaMobile}</span>}
        </span>
        <span className={styles.period}>{opts.period ?? ''}</span>
        {opts.right && <span className={`${styles.rval} ${opts.daysTone === 'days' ? styles['rval-days'] : ''}`}>{opts.right}</span>}
      </button>
    );
  };

  const periodRow = (it: NowItem) => {
    const id = it.occasion_id ?? it.id ?? it.title;
    return row({
      key: `${id}:${it.from}`, icon: nowIcon(it), name: it.title, meta: todayConsequence(it),
      period: todayPeriodRange(it), right: todayPeriodDays(it, todayIsoStr), daysTone: 'days',
      onClick: () => openNowItem(it), motionId: id,
    });
  };

  const pointRow = (e: EventOccurrence) => row({
    key: `${e.scope}:${e.id}`, icon: eventIcon(e), name: e.title,
    meta: todayPointMeta(e), right: todayPointRight(e), onClick: () => showEvent(e), motionId: e.id,
  });

  const aheadRow = (r: AheadRow) => {
    const e = r.event;
    const at = aheadRowDate(r);
    const date = (
      <span className={styles.dcol}>
        {String(new Date(at).getDate()).padStart(2, '0')}<s>{dow(at)}</s>
      </span>
    );
    return row({
      key: `${r.kind}:${e.scope}:${e.id}`, icon: eventIcon(e), name: e.title,
      meta: aheadMeta(r), period: aheadPeriod(r), right: aheadRight(r), daysTone: aheadRightIsDays(r) ? 'days' : 'plain',
      date, onClick: () => showEvent(e), motionId: e.id,
    });
  };

  const catalogBtn = (
    <button type="button" className={styles['head-icon']} data-tap onClick={() => showSeries(undefined)} aria-label="Каталог подій" title="Каталог" data-cal-catalog>
      <Icon name="sys.recipes" size={16} inherit decorative />
    </button>
  );
  const ownBtn = (
    <button type="button" className={styles['head-add']} data-tap onClick={startOwn} aria-label="Своя подія" data-cal-add>
      <Icon name="sys.add" size={16} inherit decorative /><span className={styles['head-add-text']}>Своя подія</span>
    </button>
  );
  // Порожній стан (К9, той самий пункт, лише СТИЛЬ zone-card/Комора): своя
  // пара повновидних кнопок із підписом — той самий приклад, що в Комори
  // («Додати, що є вдома» в порожній коморі поруч зі знаком «Додати» в
  // шапці): шапка несе дію завжди, порожній блок називає її словами.
  const ctaCatalogBtn = (
    <button type="button" className={styles['catalog-btn']} data-tap onClick={() => showSeries(undefined)} aria-label="Каталог подій" data-cal-catalog>
      <Icon name="sys.recipes" size={16} inherit decorative />Каталог
    </button>
  );
  const ctaOwnBtn = (
    <button type="button" className={styles.add} data-tap onClick={startOwn} aria-label="Своя подія" data-cal-add>
      <Icon name="sys.add" size={16} inherit decorative />Своя подія
    </button>
  );

  return (
    <div className={styles.screen}>
      {loadFailed && (
        <Toast tone="danger" text={CALENDAR_FAILED.text} action={{ label: CALENDAR_FAILED.cta, run: () => setVersion((v) => v + 1) }} />
      )}
      <AppHeader
        title="Календар"
        onMenu={() => openNav(true)}
        fill
        action={<>
          <div className={styles.meta} data-testid="calendar-meta">{counterText}</div>
          <span className={styles['head-gap']} />
          {catalogBtn}
          {ownBtn}
        </>}
      />
      <div className={styles.body} data-testid="calendar-body">
        {loading && !now.length && !events.length ? <SkeletonRows rows={3} /> : (
          <>
            <div className={styles.layout}>
              <div className={styles['col-today']}>
                <section className={styles['zone-card']} data-cal-today>
                  <div className={styles['section-label']}>
                    <Icon name="sys.calendar" size={16} inherit decorative />
                    <span className={styles['section-name']}>Сьогодні</span>
                  </div>
                  {/* Живий стенд 20.09: дата дублювалась («20» + «неділя · 20
                      вересня») — тепер одне число+місяць крупно, короткий
                      день тижня поруч на базовій лінії (той самий скорочений
                      підпис, що в .dcol «23 ср»). */}
                  <div className={styles['today-date']}>
                    <b className={styles['today-num']}>{headerDate}</b>
                    <span className={styles['today-sub']}>{dow(today)}</span>
                  </div>
                  {todayEmpty ? (
                    <div className={`${styles.row} ${styles['row-empty']}`} data-cal-today-empty>Нічого не діє</div>
                  ) : (
                    <>
                      {strict.map(periodRow)}
                      {todayEvents.map(pointRow)}
                      {soft.map(periodRow)}
                      {seasons.length > 0 && (
                        <div data-cal-season>
                          {/* Назва — завжди «Сезон» (не зведення): зведення без дат тепер
                              живе в меті другим рядком, дати — лише в розкритих підрядках.
                              Розгорнуто — мета ховається, підрядки вже все кажуть. */}
                          <button type="button" className={`${styles.row} ${!seasonOpen ? styles['row-tall'] : ''}`} data-tap onClick={() => setSeasonOpen((o) => !o)} data-cal-season-toggle aria-expanded={seasonOpen}>
                            <Icon name="live.season" size={16} decorative />
                            <span className={styles.content}>
                              <span className={styles.line1}>
                                <span className={styles.name}>Сезон</span>
                                {/* Моушн-пас 20.09: один знак (sys.next), що повертається на 90°
                                    замість заміни на інший (sys.opened) — той самий глиф, той
                                    самий кут, що ChevronUp, лише анімовано. Прецеденту рухомого
                                    шеврона ніде в застосунку нема — токени стандартні (fast/standard). */}
                                <span className={`${styles.chev} ${seasonOpen ? styles['chev-open'] : ''}`}><Icon name="sys.next" size={12} inherit decorative /></span>
                              </span>
                              {!seasonOpen && <span className={styles.rmeta}>{seasonNames(seasons)}</span>}
                            </span>
                          </button>
                          {seasonOpen && seasons.map((s, i) => (
                            <button key={s.occasion_id ?? s.title} type="button" className={`${styles.subrow} ${styles['subrow-in']}`}
                              style={{ '--i': Math.min(i, 8) } as CSSProperties} data-tap onClick={() => openNowItem(s)}>
                              <span className={styles.name}>{s.title}</span>
                              <span className={styles.rval}>{nowWhen(s, todayIsoStr)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>

              {ahead.length > 0 && (
                <div className={styles['col-ahead']} data-cal-ahead>
                  <section className={styles['zone-card']}>
                    <div className={styles['section-label']}>
                      <Icon name="sys.calendar" size={16} inherit decorative />
                      <span className={styles['section-name']}>Далі</span>
                      <span className={styles['section-count']}>{ahead.length}</span>
                    </div>
                    {monthGroups.map((g) => (
                      <div key={g.key} data-cal-month={g.key}>
                        <div className={styles['month-sep']}>{g.label}</div>
                        {g.rows.map(aheadRow)}
                      </div>
                    ))}
                  </section>
                </div>
              )}
            </div>

            {pageEmpty && (
              <div className={styles.empty} data-cal-empty>
                <p>Підпишись на свята або сезони, або додай свою подію — тут буде видно, що попереду.</p>
                <div className={styles['empty-btns']}>
                  {ctaCatalogBtn}
                  {ctaOwnBtn}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {creating && (
        <Sheet onClose={() => setCreating(null)} ariaLabel="Нова подія" kind="event">
          <PeriodEvent initial={creating} onClose={() => setCreating(null)}
            onChanged={(id) => {
              // Моушн-пас 20.09: новий рядок і так вʼїжджає (freshIds
              // бачить невідомий id), тут лише ev-flash поверх — «поява
              // нового рядка → cal-in + ev-flash» з постановки.
              if (id) { openAfterCreate.current = id; setFlashEvent(id); window.setTimeout(() => setFlashEvent(null), 900); }
              setVersion((v) => v + 1);
            }} />
        </Sheet>
      )}
      {openEvent && !panelInFlow && (
        <Sheet onClose={() => closePanel()} ariaLabel={openEvent.title} kind="event">
          <PeriodEvent key={openEvent.id} event={openEvent}
            onClose={() => closePanel()} onChanged={onEventChanged} />
        </Sheet>
      )}
      {seriesOpen && !panelInFlow && (
        <Sheet onClose={() => closePanel()} ariaLabel="Каталог подій" title="Каталог подій" kind="event">
          <PeriodSubscriptions key={openSeriesSet ?? 'root'} initialSet={openSeriesSet}
            onDone={(c) => onEventChanged(undefined, c)} />
        </Sheet>
      )}
    </div>
  );
}

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
