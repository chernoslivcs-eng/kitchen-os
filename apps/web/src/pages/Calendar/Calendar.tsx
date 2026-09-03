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
import { buildDays, buildWeeks, splitRunning } from './days';
import { EventSheet } from './EventSheet';
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
  // Подія відкривається шторкою: вона довша за модалку, але власного маршруту
  // не заслуговує. На >=1280 їй місце в правій панелі як артефакту — але
  // панель зараз живе всередині Стрічки, не в каркасі, тож це окремий крок.
  const [openEvent, setOpenEvent] = useState<EventOccurrence | null>(null);
  const [version, setVersion] = useState(0);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  useEffect(() => {
    const to = new Date(today.getTime() + HORIZON * DAY);
    api.events.list(iso(today), iso(to))
      .then(({ events }) => setEvents(events))
      .catch(() => {/* порожній календар — теж відповідь */})
      .finally(() => setLoading(false));
  }, [today, version]);

  // Те, що вже триває, — окремим блоком і один раз. Інакше сезон, що йде
  // третій тиждень, засмічує кожен день стрічки.
  const { running, stream } = useMemo(
    () => splitRunning(events, today.getTime()), [events, today]);
  const rows = useMemo(
    () => buildDays(stream, today.getTime(), HORIZON, today.getTime()), [stream, today]);
  // Той самий потік, зібраний у тижні. Обидва вигляди в DOM, перемикає CSS:
  // на ресайзі JS-перемикач мигав би, а тут просто інший display.
  const weeks = useMemo(
    () => buildWeeks(stream, today.getTime(), HORIZON, today.getTime()), [stream, today]);

  let lastMonth = '';
  let lastGridMonth = '';

  return (
    <div className={styles.screen}>
      <AppHeader title="Календар" onMenu={() => openNav(true)} />
      <div className={styles.body}>
        {loading && <div className={styles.quiet}>—</div>}

        {running.length > 0 && (
          <div className={styles.running}>
            <div className={styles['running-label']}>ТРИВАЄ</div>
            {running.map((e) => (
              <button
                key={`${e.scope}:${e.id}`}
                className={`${styles.slot} ${toneOf(e)}`}
                onClick={() => setOpenEvent(e)}
              >
                <span className={styles['slot-title']}>{e.title}</span>
                <span className={styles['slot-when']}>{whenLabel(e.start, e.end)}</span>
              </button>
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

        <div className={styles.list}>
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
                      <button
                        key={`${e.scope}:${e.id}`}
                        className={`${styles.slot} ${toneOf(e)}`}
                        onClick={() => setOpenEvent(e)}
                      >
                        <span className={styles['slot-title']}>
                          {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                        </span>
                        <span className={styles['slot-when']}>
                          {whenLabel(e.start, e.end)}{e.approx ? ' · орієнтовно' : ''}
                        </span>
                      </button>
                    ))}
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
            return (
              <div key={w.start}>
                {monthHead && <div className={styles.month}>{monthHead}</div>}
                <div className={styles.week}>
                  {w.days.map((d) => (
                    <div
                      key={d.at}
                      className={`${styles.cell} ${d.at === today.getTime() ? styles['cell-today'] : ''}`}
                    >
                      <div className={styles['cell-date']}>{dayNum(d.at)}</div>
                      {/* Порожня клітинка — тиша, не дірка: ні «＋ додати»,
                          ні пунктирної рамки, яка просить себе заповнити. */}
                      {d.events.map((e) => (
                        <button
                          key={`${e.scope}:${e.id}`}
                          className={`${styles['cell-slot']} ${toneOf(e)}`}
                          onClick={() => setOpenEvent(e)}
                          title={e.meaning ?? e.title}
                        >
                          {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openEvent && (
        <EventSheet
          event={openEvent}
          onClose={() => setOpenEvent(null)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
