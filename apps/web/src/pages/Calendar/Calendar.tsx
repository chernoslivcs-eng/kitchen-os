// Календар v3 — рішення власника 19.09, «мінімум» (К9, замінює К2–К5 і
// бриф-3; схема ai 2/project/calendar-minimal-0919.html). Один спосіб
// дивитись на час: картка «Сьогодні» + один список «Далі» + дві кнопки.
// Макет у Claude Design не робився — екран збирається в коді з наявних
// nowItems/aheadRows. Нема: сітки місяця, осі днів, міні-місяця, легенд,
// чипів, «ще N», режимів Тиждень/Список (ці й раніші деталі — DEVIATIONS).
//
// «Сьогодні» — завжди є: число (24px), «субота · сьогодні»; рядки строгі
// періоди → точкові події дня → мʼякі періоди → один рядок «Сезон»
// (розкриття — список сезонів). Обмеження — по тапу на рядок (артефакт
// події), не в самій картці. Порожньо — «Нічого не діє».
//
// «Далі» — один список від завтра до кінця третього місяця (горизонт
// aheadHorizon), роздільники місяців. Сезони — геть повністю, сьогоднішнє
// — геть (воно в «Сьогодні»). Рядок-кінець — окремо, лише для власних
// тривалих періодів.
//
// Клік по будь-якому рядку — той самий артефакт події, що з чату
// (openNowItem/showEvent); «Сезон» — лише розкриває список на місці.
// Кнопки «Каталог»/«+ Своя подія»: ≥768 — у шапці; <768 — панеллю під
// списком (не дублюється в порожньому стані — там уже свої кнопки).

import { Icon } from '../../components/Icon/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../lib/track';
import { api, type EventOccurrence, type NowItem, type OccasionSet } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { toneKey } from '../../lib/tone';
import {
  nowWhen, toneOfNow, nowItemToEvent, todayGroups, todayPointEvents, todayPointMeta,
  seasonSummary, aheadHorizon, aheadRows, aheadRowDate, aheadMeta, dow, type AheadRow,
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

/** Кнопки в шапці від 768; нижче — панеллю під списком. */
const WIDE = '(min-width: 768px)';

function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** Називний («Жовтень») — роздільник місяця в «Далі», не родовий. */
function monthName(at: number): string {
  const m = new Date(at).toLocaleDateString('uk-UA', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
}

// Локальна дата в ISO — форма події живе в 'YYYY-MM-DD'.
function isoOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const todayWeekday = useMemo(() => new Date(today).toLocaleDateString('uk-UA', { weekday: 'long' }), [today]);

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
  const [seasonOpen, setSeasonOpen] = useState(false);
  const todaySummary = seasonSummary(seasons, todayIsoStr);
  const todayEmpty = strict.length === 0 && soft.length === 0 && seasons.length === 0 && todayEvents.length === 0;
  const pageEmpty = todayEmpty && ahead.length === 0;

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

  const wide = useMedia(WIDE);

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

  const periodRow = (it: NowItem) => {
    const tone = toneOfNow(it);
    const id = it.occasion_id ?? it.id ?? it.title;
    return (
      <button key={`${id}:${it.from}`} type="button" className={`${styles['today-row']} ${evMotion(id)}`} data-tap onClick={() => openNowItem(it)}>
        <span className={`${styles.dot} ${styles[`t-${tone}`]}`} aria-hidden />
        <span className={styles['today-name']}>{it.title}</span>
        <span className={styles['today-right']}>{nowWhen(it, todayIsoStr)}</span>
      </button>
    );
  };

  const pointRow = (e: EventOccurrence) => {
    const meta = todayPointMeta(e);
    return (
      <button key={`${e.scope}:${e.id}`} type="button" className={`${styles['today-row']} ${evMotion(e.id)}`} data-tap onClick={() => showEvent(e)}>
        <span className={`${styles.dot} ${styles[`t-${toneKey(e)}`]}`} aria-hidden />
        <span className={styles['today-name']}>{e.title}</span>
        {meta && <span className={styles['today-right']}>{meta}</span>}
      </button>
    );
  };

  const aheadRow = (row: AheadRow) => {
    const e = row.event;
    const meta = aheadMeta(row);
    const at = aheadRowDate(row);
    return (
      <button key={`${row.kind}:${e.scope}:${e.id}`} type="button" className={`${styles.li} ${evMotion(e.id)}`} data-tap onClick={() => showEvent(e)}>
        <span className={styles.dt}>{String(new Date(at).getDate()).padStart(2, '0')}<s>{dow(at)}</s></span>
        <span className={styles.t}>
          <span className={`${styles.dot} ${styles[`t-${toneKey(e)}`]}`} aria-hidden />
          <span className={styles.name}>{e.title}</span>
          {meta && <span className={styles.meta}>{meta}</span>}
        </span>
      </button>
    );
  };

  const daliRows = useMemo(() => {
    const out: { key: string; el: React.ReactNode }[] = [];
    let lastMonth = new Date(today).getMonth();
    for (const row of ahead) {
      const at = aheadRowDate(row);
      const m = new Date(at).getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        out.push({ key: `mon-${at}`, el: <div key={`mon-${at}`} className={styles.mon}>{monthName(at)}</div> });
      }
      out.push({ key: `${row.kind}:${row.event.id}`, el: aheadRow(row) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- aheadRow нова щорендеру — перебудовуємо лише на зміну самих рядків
  }, [ahead, today]);

  const catalogBtn = (
    <button type="button" className={styles['catalog-btn']} data-tap onClick={() => showSeries(undefined)} aria-label="Каталог подій" data-cal-catalog>
      <Icon name="sys.recipes" size={16} inherit decorative />Каталог
    </button>
  );
  const ownBtn = (
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
        title={`Календар · ${headerDate}`}
        onMenu={() => openNav(true)}
        action={wide ? <>{catalogBtn}{ownBtn}</> : undefined}
      />
      <div className={styles.body} data-testid="calendar-body">
        {loading && !now.length && !events.length ? <SkeletonRows rows={3} /> : (
          <>
            <section className={styles.today} data-cal-today>
              <div className={styles['today-head']}>
                <b className={styles['today-num']}>{new Date(today).getDate()}</b>
                <span className={styles['today-sub']}>{todayWeekday} · сьогодні</span>
              </div>
              {todayEmpty ? (
                <div className={`${styles['today-row']} ${styles['today-empty']}`} data-cal-today-empty>Нічого не діє</div>
              ) : (
                <>
                  {strict.map(periodRow)}
                  {todayEvents.map(pointRow)}
                  {soft.map(periodRow)}
                  {seasons.length > 0 && (
                    <div data-cal-season>
                      <button type="button" className={styles['today-row']} data-tap onClick={() => setSeasonOpen((o) => !o)} data-cal-season-toggle>
                        <span className={`${styles.dot} ${styles['dot-outline']}`} aria-hidden />
                        <span className={styles['today-name']}>{seasonOpen ? 'Сезон' : todaySummary}</span>
                        <Icon name={seasonOpen ? 'sys.opened' : 'sys.next'} size={12} inherit decorative className={styles['today-chevron']} />
                      </button>
                      {seasonOpen && seasons.map((s) => (
                        <button key={s.occasion_id ?? s.title} type="button" className={`${styles['today-row']} ${styles['today-row-sub']}`} data-tap onClick={() => openNowItem(s)}>
                          <span className={styles['today-name']}>{s.title}</span>
                          <span className={styles['today-right']}>{nowWhen(s, todayIsoStr)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            {ahead.length > 0 ? (
              <section data-cal-ahead>
                <p className={styles.zone}>Далі</p>
                <div className={styles.list}>{daliRows.map((r) => r.el)}</div>
              </section>
            ) : pageEmpty && (
              <div className={styles['empty-block']} data-cal-empty>
                <p>Підпишись на свята або сезони, або додай свою подію — тут буде видно, що попереду.</p>
                <div className={styles['empty-btns']}>
                  {catalogBtn}
                  {ownBtn}
                </div>
              </div>
            )}

            {!wide && !pageEmpty && (
              <div className={styles['btn-row']} data-cal-btn-row>
                {catalogBtn}
                {ownBtn}
              </div>
            )}
          </>
        )}
      </div>

      {creating && (
        <Sheet onClose={() => setCreating(null)} ariaLabel="Нова подія" kind="event">
          <PeriodEvent initial={creating} onClose={() => setCreating(null)}
            onChanged={(id) => { if (id) openAfterCreate.current = id; setVersion((v) => v + 1); }} />
        </Sheet>
      )}
      {openEvent && !panelInFlow && (
        <Sheet onClose={() => closePanel()} ariaLabel={openEvent.title} kind="event">
          <PeriodEvent key={openEvent.id} event={openEvent}
            onClose={() => closePanel()} onChanged={onEventChanged} />
        </Sheet>
      )}
      {seriesOpen && !panelInFlow && (
        <Sheet onClose={() => closePanel()} ariaLabel="Каталог подій" kind="event">
          <PeriodSubscriptions key={openSeriesSet ?? 'root'} initialSet={openSeriesSet}
            onDone={(c) => onEventChanged(undefined, c)} />
        </Sheet>
      )}
    </div>
  );
}
