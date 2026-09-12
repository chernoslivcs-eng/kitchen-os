// FIXES-V3-2 №25 (рішення власника): календар 1440 — за Redesign «v3 ·
// Календар · сітка» (6c), поверх Screens D3a. Місяць сіткою: рядок днів
// тижня 12/500 dim, тижні рядами — смуги тривалого 5 r3 над датами
// (слива .55 · бурштин .4 · шавлія), клітинки: число 14 muted (чужий місяць
// — faint), сьогодні — коло 26 чорнилом на bg-підкладці r12; точкове —
// рядками 12 зі знаком 11; «кінець сезону» 12 бурштином в останній день.
// Ті самі дані, що в тижнях D3a: тривале — weekSpans, точкове — buildTimeline.
import type { EventOccurrence } from '../../api';
import { Icon } from '../../components/Icon/Icon';
import { toneKey } from '../../lib/tone';
import { weekSpans, VISIBLE_LIMIT, moreLabel, capLasting, tailLabel } from '../../lib/spans';
import { buildTimeline, dayStart, DAY, type TimelineWeek } from './days';
import { pointIcon } from './legend';
import styles from './Calendar.module.css';

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

/** Понеділок першого тижня місяця й кількість тижнів, що покривають місяць (5–6). */
export function monthWeeks(month: number): { from: number; weeks: number } {
  const first = new Date(month); first.setDate(1); first.setHours(0, 0, 0, 0);
  const dow = (first.getDay() + 6) % 7;
  const from = first.getTime() - dow * DAY;
  const last = new Date(first); last.setMonth(last.getMonth() + 1); last.setDate(0);
  const span = Math.round((dayStart(last.getTime()) - dayStart(from)) / DAY) + 1;
  return { from: dayStart(from), weeks: Math.ceil(span / 7) };
}

interface Props {
  month: number;
  today: number;
  lasting: EventOccurrence[];
  point: EventOccurrence[];
  onOpen: (e: EventOccurrence) => void;
  /** Клік по дню / протяг — нова подія (той самий вхід, що в D3a). */
  beginSelect: (at: number) => (ev: React.PointerEvent) => void;
  inSel: (at: number) => boolean;
  selecting: boolean;
  evMotion: (id: string) => string;
  todayRef?: React.Ref<HTMLDivElement>;
  /** Хвіст «ще N сезони» веде в підписки — там повний список (B4). */
  onTail: () => void;
}

export function MonthView({ month, today, lasting, point, onOpen, beginSelect, inSel, selecting, evMotion, todayRef, onTail }: Props) {
  const { from, weeks: n } = monthWeeks(month);
  const weeks: TimelineWeek[] = buildTimeline(point, from, n);
  const m = new Date(month).getMonth();
  // «кінець сезону» — сезон, що закінчується цього дня (не в сьогодні: там і так чіп).
  const seasonEnd = (at: number) => lasting.find((e) => (e.kind === 'season' || e.kind === 'editorial') && dayStart(e.end) === at);

  return (
    <div className={styles.mcard} data-month-grid>
      <div className={styles.mdow}>{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      {weeks.map((w, wi) => {
        // 12.09 (ANSWERS B4): смуг над датами — ≤ 3 за рангом (обмеження → своє →
        // сезон: починається цього тижня → закінчується найближче); решта — рядок
        // «ще N сезони» muted з бурштиновою крапкою, тап — у підписки.
        const all = weekSpans(lasting, w.start);
        const cap = capLasting(all.map((s) => s.event), w.start);
        const spans = all.filter((s) => cap.shown.includes(s.event));
        const tail = tailLabel(cap.hidden);
        return (
          <div key={w.start} className={`${styles.mweek} ${wi === weeks.length - 1 ? styles['mweek-last'] : ''}`} data-month-week={w.num}>
            {spans.length > 0 && (
              <div className={styles.mbars}>
                {spans.map((s) => (
                  <button key={s.event.id} type="button"
                    className={`${styles.mbar} ${styles[`t-${toneKey(s.event)}`]} ${s.event.approx ? styles['mbar-approx'] : ''} ${evMotion(s.event.id)}`}
                    style={{ gridColumn: `${s.from} / ${s.to}` }}
                    title={s.event.title} aria-label={s.event.title}
                    onClick={() => onOpen(s.event)} />
                ))}
                {tail && <button type="button" className={styles['mbar-more']} style={{ gridColumn: '1 / 8' }} onClick={onTail} data-bars-tail><span className={styles['tail-dot']} aria-hidden />{tail}</button>}
              </div>
            )}
            <div className={styles.mdays}>
              {w.days.map((d) => {
                const isToday = d.at === today;
                const other = new Date(d.at).getMonth() !== m;
                const shown = d.events.slice(0, VISIBLE_LIMIT);
                const more = moreLabel(d.events.slice(VISIBLE_LIMIT));
                const end = !isToday ? seasonEnd(d.at) : undefined;
                return (
                  <div key={d.at} ref={isToday ? todayRef : undefined} data-at={d.at}
                    onPointerDown={beginSelect(d.at)}
                    className={`${styles.mcell} ${isToday ? styles['mcell-today'] : ''} ${other ? styles['mcell-other'] : ''} ${inSel(d.at) ? styles.sel : ''} ${selecting ? styles.selecting : ''}`}>
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
                    {more && <button type="button" className={styles.more} onClick={() => onOpen(d.events[VISIBLE_LIMIT]!)}>{more}</button>}
                    {end && <button type="button" className={`${styles.mev} ${styles['ev-amber']}`} onClick={() => onOpen(end)}>кінець сезону</button>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
