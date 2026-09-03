// Календар — журнал, а не сітка. Сьогодні зверху, далі вниз; порожні дні
// підряд згортаються в «тиша». Це перший зріз: тижнева сітка на десктопі й
// сторінка події шторкою — наступний крок (Ф2).
//
// Рівень A (рішення 03.09): екран показує, але нічого не рахує. Жодного
// «бракує», жодного «заплановано 2 з 7». Людина дивиться й вирішує сама.

import { useEffect, useMemo, useState } from 'react';
import { api, type EventOccurrence } from '../../api';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { whenLabel } from '../../lib/when';
import { buildDays, splitRunning } from './days';
import styles from './Calendar.module.css';

const DAY = 86_400_000;
const HORIZON = 90;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dayNum = (at: number) => new Date(at).toLocaleDateString('uk-UA', { day: 'numeric' });
const dayDow = (at: number) => new Date(at).toLocaleDateString('uk-UA', { weekday: 'short' });
const monthOf = (at: number) => new Date(at).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
const shortDate = (at: number) => new Date(at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

// Рід події видно кольором, а не міткою. Семантика вже зайнята й нового
// кольору календар не отримує: обмеження — слива («анти»), бо піст це рамка,
// а не помилка; завіз — шавлія, бо це прихід; решта нейтральна.
function toneOf(e: EventOccurrence): string {
  if (e.force === 'restrict') return styles['t-restrict']!;
  if (e.kind === 'supply') return styles['t-supply']!;
  if (e.kind === 'season') return styles['t-season']!;
  return styles['t-plain']!;
}

export function CalendarPage() {
  const openNav = useNavStore((s) => s.setOpen);
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  useEffect(() => {
    const to = new Date(today.getTime() + HORIZON * DAY);
    api.events.list(iso(today), iso(to))
      .then(({ events }) => setEvents(events))
      .catch(() => {/* порожній календар — теж відповідь */})
      .finally(() => setLoading(false));
  }, [today]);

  // Те, що вже триває, — окремим блоком і один раз. Інакше сезон, що йде
  // третій тиждень, засмічує кожен день стрічки.
  const { running, stream } = useMemo(
    () => splitRunning(events, today.getTime()), [events, today]);
  const rows = useMemo(() => buildDays(stream, today.getTime(), HORIZON), [stream, today]);

  let lastMonth = '';

  return (
    <div className={styles.screen}>
      <AppHeader title="Календар" onMenu={() => openNav(true)} />
      <div className={styles.body}>
        {loading && <div className={styles.quiet}>—</div>}

        {running.length > 0 && (
          <div className={styles.running}>
            <div className={styles['running-label']}>ТРИВАЄ</div>
            {running.map((e) => (
              <div key={`${e.scope}:${e.id}`} className={`${styles.slot} ${toneOf(e)}`}>
                <span className={styles['slot-title']}>{e.title}</span>
                <span className={styles['slot-when']}>{whenLabel(e.start, e.end)}</span>
              </div>
            ))}
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className={styles.empty}>
            <div className={styles['empty-title']}>Попереду тихо</div>
            <p className={styles['empty-text']}>
              Сезони й свята зʼявляються самі. Про своє — скажи Кухні:
              «у суботу гості, шестеро» або «мама привезе цибулю за тиждень».
            </p>
          </div>
        )}

        {rows.map((row) => {
          const at = row.type === 'day' ? row.at : row.from;
          const month = monthOf(at);
          const monthHead = month !== lastMonth ? month : null;
          lastMonth = month;

          if (row.type === 'quiet') {
            return (
              <div key={`q${row.from}`}>
                {monthHead && <div className={styles.month}>{monthHead}</div>}
                <div className={styles.quiet}>
                  {shortDate(row.from)} – {shortDate(row.to)} · тиша · {row.days} дн.
                </div>
              </div>
            );
          }

          const isToday = row.at === today.getTime();
          return (
            <div key={row.at}>
              {monthHead && <div className={styles.month}>{monthHead}</div>}
              <div className={`${styles.day} ${isToday ? styles.today : ''}`}>
                <div className={styles.date}>
                  <span className={styles['date-num']}>{dayNum(row.at)}</span>
                  <span className={styles['date-dow']}>{dayDow(row.at)}</span>
                </div>
                <div className={styles.slots}>
                  {row.events.length === 0
                    ? <div className={styles.silence} />
                    : row.events.map((e) => (
                      <div key={`${e.scope}:${e.id}`} className={`${styles.slot} ${toneOf(e)}`}>
                        <span className={styles['slot-title']}>
                          {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                        </span>
                        <span className={styles['slot-when']}>
                          {whenLabel(e.start, e.end)}{e.approx ? ' · орієнтовно' : ''}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
