// Календар v3 (спек 18.09, К4): сітка — згорнута довідка, не головний екран.
// «Сітка <місяця> — якщо треба глянути дати» розкриває поточний місяць:
// лише власні події (крапка) і межі ПІДПИСАНИХ періодів (смуга, тримає свою
// доріжку через тижні — weekBands). Сезони в клітинках — ні (К4), тому реальних
// доріжок 1–2: пости й власні періоди. Немає ні кліку-протягу, ні режимів —
// це довідка, не інструмент створення подій (К4: «сітка як згорнута довідка»).
import { useMemo, useState } from 'react';
import type { EventOccurrence } from '../../api';
import { Icon } from '../../components/Icon/Icon';
import { toneKey } from '../../lib/tone';
import {
  assignLanes, weekBands, GRID_LANES, coversDay, VISIBLE_LIMIT, moreLabel,
} from '../../lib/spans';
import { buildTimeline, monthWeeks, type TimelineWeek } from './days';
import { pointIcon } from './legend';
import { bandLabel } from './agenda';
import styles from './Calendar.module.css';

interface Props {
  month: number;
  today: number;
  lasting: EventOccurrence[];
  point: EventOccurrence[];
  onOpen: (e: EventOccurrence) => void;
  evMotion: (id: string) => string;
}

/** Родовий відмінок («вересня», не «вересень») — як у спеку К4 («Сітка
 *  вересня»): Intl дає родовий лише в парі з числом дня, тому день 1 і зрізаємо. */
const monthGenitive = (at: number) => {
  const d = new Date(at); d.setDate(1);
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }).replace(/^\d+\s+/, '');
};

export function CalendarGrid({ month, today, lasting, point, onOpen, evMotion }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleDay = (at: number) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(at)) n.delete(at); else n.add(at);
    return n;
  });

  // К4: сезони в сітці не малюємо — лише обмеження й власні періоди.
  const gridLasting = useMemo(() => lasting.filter((e) => e.kind !== 'season' && e.kind !== 'editorial'), [lasting]);
  const gridPoint = useMemo(() => point.filter((e) => e.scope === 'household'), [point]);
  const lanes = useMemo(() => assignLanes(gridLasting), [gridLasting]);

  const { from, weeks: n } = monthWeeks(month);
  const weeks: TimelineWeek[] = useMemo(() => buildTimeline(gridPoint, from, n), [gridPoint, from, n]);
  const m = new Date(month).getMonth();

  if (!open) {
    return (
      <button type="button" className={styles['grid-toggle']} data-tap onClick={() => setOpen(true)} data-cal-grid-toggle>
        <Icon name="sys.calendar" size={16} inherit decorative />
        <span className={styles['grid-toggle-text']}>Сітка {monthGenitive(month)} — якщо треба глянути дати</span>
        <Icon name="sys.next" size={12} inherit decorative />
      </button>
    );
  }

  return (
    <div data-cal-grid>
      <button type="button" className={styles['grid-toggle']} data-tap onClick={() => setOpen(false)} data-cal-grid-toggle>
        <Icon name="sys.calendar" size={16} inherit decorative />
        <span className={styles['grid-toggle-text']}>Сітка {monthGenitive(month)}</span>
        <Icon name="sys.opened" size={12} inherit decorative />
      </button>
      <div className={styles.mcard} data-month-grid>
        <div className={styles.mdow}>{['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map((d) => <span key={d}>{d}</span>)}</div>
        {weeks.map((w, wi) => {
          const { bands, overflow } = weekBands(gridLasting, lanes, w.start);
          return (
            <div key={w.start} className={`${styles.mweek} ${wi === weeks.length - 1 ? styles['mweek-last'] : ''}`} data-month-week={w.num}>
              {bands.length > 0 && (
                <div className={styles.mbars}>
                  {bands.map((b) => (
                    <button key={b.event.id} type="button"
                      className={`${styles.mband} ${styles[`t-${toneKey(b.event)}`]} ${evMotion(b.event.id)}`} data-tap
                      style={{ gridColumn: `${b.from} / ${b.to}`, gridRow: b.lane + 1 }}
                      title={b.event.title} aria-label={b.event.title}
                      onClick={() => onOpen(b.event)}>
                      <span className={styles['mband-text']}>{bandLabel(b.event, b.to - b.from, today)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className={styles.mdays}>
                {w.days.map((d) => {
                  const isToday = d.at === today;
                  const other = new Date(d.at).getMonth() !== m;
                  const shown = d.events.slice(0, VISIBLE_LIMIT);
                  const more = moreLabel(d.events.slice(VISIBLE_LIMIT));
                  const hidden = overflow.get(d.at) ?? 0;
                  const isExpanded = expanded.has(d.at);
                  const hiddenBands = hidden > 0
                    ? gridLasting.filter((e) => coversDay(e, d.at) && (lanes.get(e.id) ?? 0) >= GRID_LANES)
                    : [];
                  return (
                    <div key={d.at} data-at={d.at}
                      className={`${styles.mcell} ${isToday ? styles['mcell-today'] : ''} ${other ? styles['mcell-other'] : ''}`}>
                      <span className={styles.mnum}>{new Date(d.at).getDate()}</span>
                      {shown.map((e) => {
                        const pi = pointIcon(e);
                        return (
                          <button key={`${e.scope}:${e.id}`} type="button"
                            className={`${styles.mev} ${styles[`ev-${pi.tone}`]} ${e.done_at ? styles['ev-done'] : ''} ${evMotion(e.id)}`}
                            onClick={() => onOpen(e)} title={e.title}>
                            {pi.icon && <Icon name={pi.icon} size={12} inherit decorative />}
                            <span className={styles['ev-text']}>{e.title}</span>
                          </button>
                        );
                      })}
                      {more && <button type="button" className={styles.more} data-tap onClick={() => onOpen(d.events[VISIBLE_LIMIT]!)}>{more}</button>}
                      {hidden > 0 && (
                        <button type="button" className={styles['mbar-more']} data-tap data-cal-overflow onClick={() => toggleDay(d.at)}>
                          +{hidden}
                        </button>
                      )}
                      {isExpanded && hiddenBands.map((e) => (
                        <button key={`h:${e.id}`} type="button"
                          className={`${styles.mev} ${styles[`t-${toneKey(e)}`]}`}
                          onClick={() => onOpen(e)} title={e.title}>
                          <span className={styles['ev-text']}>{e.title}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
