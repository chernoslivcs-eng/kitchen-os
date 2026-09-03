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
import { buildDays, buildWeeks, splitRunning } from './days';
import {
  splitAxes, weekSpans, coversDay, edgeCaption, edgeDays, moreLabel, VISIBLE_LIMIT,
} from '../../lib/spans';
import { EventSheet } from './EventSheet';
import { NewEventSheet } from './NewEventSheet';
import styles from './Calendar.module.css';

const DAY = 86_400_000;
const HORIZON = 90;

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
function toneOf(e: EventOccurrence): string {
  if (e.force === 'restrict') return styles['t-restrict']!;
  if (e.kind === 'supply') return styles['t-supply']!;
  if (e.kind === 'constraint') return styles['t-quiet']!;
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
  const [creating, setCreating] = useState(false);
  // Правка — та сама форма, що створення, лише з готовими полями.
  const [editing, setEditing] = useState<EventOccurrence | null>(null);
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

  // Мобільна риска: до двох тривалих на день, третя й далі — у підпис.
  // Трьох рисок на телефоні не буває: 8px гутера на них просто немає.
  const MOBILE_RAILS = 2;
  function railsFor(at: number) {
    const on = lasting.filter((e) => coversDay(e, at));
    return { bars: on.slice(0, MOBILE_RAILS), extra: on.length - MOBILE_RAILS };
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
                  <div className={styles.rails}>
                    {r.bars.map((e) => (
                      <span key={e.id} className={`${styles.rail} ${toneOf(e)}`} />
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
          const captions = lasting
            .map((e) => ({ e, text: edgeCaption(e, row.at) }))
            .filter((x): x is { e: EventOccurrence; text: string } => x.text !== null);
          const shown = row.events.slice(0, VISIBLE_LIMIT);
          const more = moreLabel(row.events.slice(VISIBLE_LIMIT));
          return (
            <div key={row.at}>
              {monthHead && (
                <div className={styles.month}>
                  {monthHead}
                  {r.extra > 0 && <span className={styles['month-more']}> · ＋{r.extra} тривалих</span>}
                </div>
              )}
              <div className={`${styles.day} ${isToday ? styles.today : ''}`}>
                <div className={styles.rails}>
                  {r.bars.map((e) => (
                    <span key={e.id} className={`${styles.rail} ${toneOf(e)}`} />
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
                  {more && <span className={styles.more}>{more}</span>}
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
            const spans = weekSpans(lasting, w.start).slice(0, VISIBLE_LIMIT);
            const railMore = weekSpans(lasting, w.start).length - spans.length;
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
                {railMore > 0 && (
                  <div className={styles['rail-more']}>ЩЕ {railMore} ТРИВАЛИХ</div>
                )}
                <div className={styles.week}>
                  {w.days.map((d) => (
                    <div
                      key={d.at}
                      className={`${styles.cell} ${d.at === today.getTime() ? styles['cell-today'] : ''}`}
                    >
                      <div className={styles['cell-date']}>{dayDow(d.at)} {dayNum(d.at)}</div>
                      {/* Порожня клітинка — тиша, не дірка: ні «＋ додати»,
                          ні пунктирної рамки, яка просить себе заповнити.
                          Ліміт три: більше — вже список, а не погляд. */}
                      {d.events.slice(0, VISIBLE_LIMIT).map((e) => (
                        <button
                          key={`${e.scope}:${e.id}`}
                          className={`${styles['cell-slot']} ${toneOf(e)}`}
                          onClick={() => setOpenEvent(e)}
                          title={e.meaning ?? e.title}
                        >
                          {e.kind === 'supply' ? '＋ ' : ''}{e.title}
                        </button>
                      ))}
                      {d.events.length > VISIBLE_LIMIT && (
                        <span className={styles['cell-more']}>
                          {moreLabel(d.events.slice(VISIBLE_LIMIT), false)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {(creating || editing) && (
        <NewEventSheet
          edit={editing ? { id: editing.id, title: editing.title, note: editing.note ?? null } : undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
          onCreated={(id) => {
            setCreating(false);
            setEditing(null);
            openAfterCreate.current = id;
            setVersion((v) => v + 1);
          }}
        />
      )}

      {openEvent && (
        <EventSheet
          event={openEvent}
          onClose={() => setOpenEvent(null)}
          onChanged={() => setVersion((v) => v + 1)}
          onEdit={(ev) => { setOpenEvent(null); setEditing(ev); }}
        />
      )}
    </div>
  );
}
