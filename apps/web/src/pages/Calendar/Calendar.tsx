// Календар v3 (макет 2b, спек 18.09) — переписано цілком.
//
// Три блоки зверху вниз: «Зараз діє» (GET /v1/now — стан, суворі спершу),
// «Попереду» (GET /v1/events — лише майбутнє, до горизонту, «показати
// далі»), і згорнута сітка місяця-довідки (CalendarGrid, лише ≥1024 — К4).
// Готування сьогодні в календар не потрапляє (К3): це «Дім зараз» і чат.
//
// Два входи в шапці (рішення власника 19.09, замість одного «Додати» — К5):
// «Каталог» відкриває PeriodSubscriptions на рівні пакетів; «+ Своя подія»
// веде напряму в PeriodEvent створення, без проходу через каталог. Порожній
// стан — та сама пара кнопок, тим самим стилем.
//
// Клік-і-тягнути по днях і режими Місяць/Тиждень/Список — прибрані разом зі
// старою сіткою-як-екраном (рішення власника, DEVIATIONS Р146): нова сітка —
// лише довідка для очей, не поверхня для створення подій.

import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../lib/track';
import { api, type EventOccurrence, type NowItem, type OccasionSet } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { toneKey } from '../../lib/tone';
import { dayStart } from './days';
import { legendIcon } from './legend';
import { splitAxes } from '../../lib/spans';
import {
  nowProgress, nowWhen, NOW_TONE_ICON, toneOfNow, nowItemToEvent,
  aheadRows, aheadDateLabel, aheadMeta, type AheadRow,
} from './agenda';
import { todayIso } from '../../lib/period';
import { Sheet } from '../../components/Sheet/Sheet';
import { PeriodEvent, type PeriodChange } from '../../components/PeriodArtifact/PeriodArtifact';
import { PeriodSubscriptions } from '../../components/PeriodArtifact/PeriodSubscriptions';
import { Toast } from '../../components/ErrorState/Toast';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { CALENDAR_FAILED } from '../../components/ErrorState/copy';
import { usePanelStore, ARTIFACT_SIDE } from '../../store/panel';
import { CalendarGrid } from './CalendarGrid';
import styles from './Calendar.module.css';

/** Сітка-довідка (К4) — лише ≥1024, як і колишня сітка місяця. */
const GRID = '(min-width: 1024px)';
const NOW_CAP = 4;

const monthStart = (at: number) => { const d = new Date(at); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Кінець місяця, що настане через `months` місяців від `at` (1 = наступний). */
const endOfMonthPlus = (at: number, months: number) => {
  const d = new Date(at); d.setDate(1); d.setMonth(d.getMonth() + months + 1, 0); d.setHours(0, 0, 0, 0);
  return d.getTime();
};

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
  // Нова подія: з кнопки шапки «+ Своя подія» (рішення власника 19.09), на сьогодні.
  const [creating, setCreating] = useState<{ date: string; dateTo: string } | null>(null);
  const openAfterCreate = useRef<string | null>(null);

  useEffect(() => { track('calendar_opened'); }, []);

  const today = useMemo(() => dayStart(Date.now()), []);
  const todayIsoStr = useMemo(() => todayIso(new Date(today)), [today]);
  // Родовий відмінок («18 вересня», не «18 вересень»): Intl дає його лише
  // коли день і місяць форматуються РАЗОМ, тому не можна брати month:'long'
  // окремо від day (той самий урок, що monthGenitive у CalendarGrid.tsx).
  const headerDate = useMemo(() => new Date(today).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }), [today]);

  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    api.events.now()
      .then(({ now: items }) => setNow(items))
      .catch(() => setLoadFailed(true))
      .finally(() => setNowLoaded(true));
  }, [version]);

  // Горизонт «Попереду» — до кінця наступного місяця; «показати далі» додає ще один.
  const [aheadExtra, setAheadExtra] = useState(0);
  const gridFrom = useMemo(() => monthStart(today), [today]);
  const horizon = useMemo(() => endOfMonthPlus(today, 1 + aheadExtra), [today, aheadExtra]);
  useEffect(() => {
    api.events.list(isoOf(gridFrom), isoOf(horizon))
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
  }, [gridFrom, horizon, version]);

  const { lasting, point } = useMemo(() => splitAxes(events), [events]);
  const ahead = useMemo(() => aheadRows(events, today, horizon), [events, today, horizon]);
  const [nowExpanded, setNowExpanded] = useState(false);
  const visibleNow = nowExpanded ? now : now.slice(0, NOW_CAP);
  const isEmpty = !loading && now.length === 0 && ahead.length === 0;

  // ОДИН обробник кліку по події на всю сторінку — «Зараз діє», «Попереду»
  // й сітка ведуть в одне й те саме: власна відкривається на редагування,
  // каталожна — PeriodEvent у режимі читання з «Не показувати» (як системні
  // події в чаті). Каталог (рівень пакетів) — лише з «Додати» (ГОЛОВНИЙ ЧАТ
  // 18.09, п.2, уточнено після живого перегляду власника). «Попереду»/сітка
  // вже мають повний EventOccurrence — showEvent напряму; «Зараз діє» має
  // лише NowItem, тож спершу шукає той самий об'єкт у вже завантаженому
  // events (те, що бачить «Попереду» — гарантує однаковий артефакт з
  // однакового occasion_id), а якщо не знайшла — не мовчить і не падає в
  // каталог, а показує подію, зібрану напряму з NowItem (nowItemToEvent).
  const openNowItem = (it: NowItem) => {
    const key = it.source === 'user' ? it.id : it.occasion_id;
    const found = key ? events.find((e) => e.id === key) : undefined;
    showEvent(found ?? nowItemToEvent(it));
  };

  const grid = useMedia(GRID);

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

  // <1024: рядок 46px однорядковий — назва + дата, meaning геть
  // (компактність, ГОЛОВНИЙ ЧАТ 18.09); прогрес — смужка на нижньому краю,
  // не другий текстовий рядок.
  const nowRow = (it: NowItem) => {
    const tone = toneOfNow(it);
    const p = nowProgress(it, todayIsoStr);
    const id = it.occasion_id ?? it.id ?? it.title;
    return (
      <button key={`${id}:${it.from}`} type="button" className={`${styles['now-row']} ${styles[`t-${tone}`]} ${evMotion(id)}`} data-tap
        onClick={() => openNowItem(it)}>
        <Icon name={NOW_TONE_ICON[tone] as IconName} size={16} inherit decorative className={styles['now-icon']} />
        <span className={styles['now-text']}>{it.title}</span>
        <span className={styles['now-when']}>{nowWhen(it, todayIsoStr)}</span>
        {p && <span className={styles['now-progress']}><i style={{ width: `${p.pct}%` }} /></span>}
      </button>
    );
  };

  // ≥1024: «Зараз діє» — чипи в ряд (структура 1b), назва + дата, без meaning.
  const nowChip = (it: NowItem) => {
    const tone = toneOfNow(it);
    const id = it.occasion_id ?? it.id ?? it.title;
    return (
      <button key={`${id}:${it.from}`} type="button" className={`${styles.chip} ${styles[`t-${tone}`]} ${evMotion(id)}`} data-tap
        onClick={() => openNowItem(it)}>
        <Icon name={NOW_TONE_ICON[tone] as IconName} size={16} inherit decorative />
        <span className={styles['chip-name']}>{it.title}</span>
        <span className={styles['chip-when']}>{nowWhen(it, todayIsoStr)}</span>
      </button>
    );
  };

  // Усі ширини: «Попереду» — рядок 46px однорядковий, назва · мета в
  // одному рядку, дата праворуч.
  const aheadRow = (row: AheadRow) => {
    const e = row.event;
    const meta = aheadMeta(row);
    return (
      <button key={`${e.scope}:${e.id}`} type="button" className={`${styles['ahead-row']} ${styles[`t-${toneKey(e)}`]} ${evMotion(e.id)}`} data-tap
        onClick={() => showEvent(e)}>
        {legendIcon(e) && <Icon name={legendIcon(e)!} size={16} inherit decorative className={styles['now-icon']} />}
        <span className={styles['now-text']}>{e.title}{meta && <span className={styles['now-meta']}> · {meta}</span>}</span>
        <span className={styles['now-when']}>{aheadDateLabel(row)}</span>
      </button>
    );
  };

  const aheadCard = ahead.length > 0 && (
    <section className={styles.card} data-cal-ahead>
      <h2 className={styles['card-h']}>Попереду</h2>
      {ahead.map(aheadRow)}
      <button type="button" className={styles['card-more']} data-tap onClick={() => setAheadExtra((n) => n + 1)} data-cal-ahead-more>
        Показати далі
      </button>
    </section>
  );

  return (
    <div className={styles.screen}>
      {loadFailed && (
        <Toast tone="danger" text={CALENDAR_FAILED.text} action={{ label: CALENDAR_FAILED.cta, run: () => setVersion((v) => v + 1) }} />
      )}
      <AppHeader
        title={`Календар · ${headerDate}`}
        onMenu={() => openNav(true)}
        action={(
          <>
            <button type="button" className={styles['catalog-btn']} data-tap onClick={() => showSeries(undefined)} aria-label="Каталог подій" data-cal-catalog>
              <Icon name="sys.recipes" size={16} inherit decorative />Каталог
            </button>
            <button type="button" className={styles.add} data-tap onClick={() => { closePanel(); setCreating({ date: isoOf(today), dateTo: '' }); }} aria-label="Своя подія" data-cal-add>
              <Icon name="sys.add" size={16} inherit decorative />Своя
            </button>
          </>
        )}
      />
      <div className={styles.body} data-testid="calendar-body">
        {loading && !now.length && !events.length && <SkeletonRows rows={3} />}
        {isEmpty && !loading && (
          <div className={styles.empty} data-cal-empty>
            <button type="button" className={styles['catalog-btn']} data-tap onClick={() => showSeries(undefined)} aria-label="Каталог подій">
              <Icon name="sys.recipes" size={16} inherit decorative />Каталог
            </button>
            <button type="button" className={styles['empty-btn']} data-tap onClick={() => { closePanel(); setCreating({ date: isoOf(today), dateTo: '' }); }} aria-label="Своя подія">
              <Icon name="sys.add" size={18} inherit decorative />Своя подія
            </button>
          </div>
        )}
        {!isEmpty && (
          <>
            {now.length > 0 && (
              <section className={styles.card} data-cal-now>
                <h2 className={styles['card-h']}>Зараз діє</h2>
                {grid ? (
                  <div className={styles.chips}>{now.map(nowChip)}</div>
                ) : (
                  <>
                    {visibleNow.map(nowRow)}
                    {now.length > NOW_CAP && !nowExpanded && (
                      <button type="button" className={styles['card-more']} data-tap onClick={() => setNowExpanded(true)}>
                        Показати всі · {now.length}
                      </button>
                    )}
                  </>
                )}
              </section>
            )}
            {/* ≥1024 (структура 1b): «Попереду» і сітка — колонками поруч,
                сітка розкрита завжди (немає перемикача — К4 деталь прибрана
                на користь компактності). <1024 — сітки нема (К4), «Попереду»
                своєю карткою під «Зараз діє». */}
            {grid ? (
              <div className={styles.columns}>
                {aheadCard}
                <CalendarGrid month={gridFrom} today={today} lasting={lasting} point={point} onOpen={showEvent} evMotion={evMotion} />
              </div>
            ) : aheadCard}
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
