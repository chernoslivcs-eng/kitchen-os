// Крок А4: гроші розрізами й прогноз. Блок Зведення, над списком домів.
//
// Питання власника не «скільки», а НА ЩО. Тому головний розріз тут — за типом
// виклику, і головна колонка в ньому не сума, а ціна ОДНОГО виклику: один
// розбір чека коштує як десять питань про олію, і поки це не розділено,
// «$0.12 за день» просто число.
//
// Дві форми, які тут тримаються навмисно:
//
//   «≈» — прогноз і будь-яка оцінка. Та сама форма, що в пульсі для ціни хода
//   (точна ціна без значка, зшита за часом — зі значком). Одна мова на всю
//   адмінку, а не «приблизно» через рядок.
//
//   «5 з 6» замість «83%» на малих числах. На пілоті відсоток бреше: за ним
//   не видно, що подій було шість.
//
// КОПІ: тексти нижче робочі, не остаточні. Місця позначені «копі:».

import { useEffect, useState } from 'react';
import { api, type AdminMoney, type MoneySlice } from '../../api';
import styles from './Money.module.css';

/** Долари з чотирма знаками: хід коштує центи, два знаки все обнулили б. */
const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${n.toFixed(4)}`);
const usd2 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString('uk-UA');

/**
 * Частка словом. Нижче стелі показуємо «5 з 6», а не «83%»: на малих числах
 * відсоток створює враження точності, якої за ним немає.
 */
export function shareWord(part: number, whole: number, floor: number): string {
  if (whole === 0) return '—';
  if (whole < floor) return `${num(part)} з ${num(whole)}`;
  return `${Math.round((part / whole) * 100)}%`;
}

/** Зміна проти попереднього періоду. Саме вона каже, куди все йде. */
function Delta({ now, was }: { now: number; was: number }) {
  if (was === 0 && now === 0) return null;
  if (was === 0) return <span className={styles.deltaNew}>вперше</span>;
  const pct = Math.round(((now - was) / was) * 100);
  const cls = pct > 0 ? styles.deltaUp : pct < 0 ? styles.deltaDown : styles.deltaFlat;
  return <span className={cls}>{pct > 0 ? '+' : ''}{pct}% · було {usd2(was)}</span>;
}

const PERIOD_WORD = { day: 'ДЕНЬ', week: 'ТИЖДЕНЬ', month: 'МІСЯЦЬ' } as const;

function shiftDay(day: string, period: 'day' | 'week' | 'month', by: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  if (period === 'day') dt.setDate(dt.getDate() + by);
  else if (period === 'week') dt.setDate(dt.getDate() + by * 7);
  else dt.setMonth(dt.getMonth() + by);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function MoneyBlock({ technical }: { technical: boolean }) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [day, setDay] = useState(localToday());
  const [data, setData] = useState<AdminMoney | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.admin.money(period, day, technical)
      .then((m) => { if (alive) { setData(m); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, day, technical]);

  // Період, який почався РАНІШЕ за перший облічений виклик, — це не «нуль
  // витрат», це «стільки ще не збирали». Нуль читався б як «нічого не
  // витратили», а це інша новина.
  const notCollected = !!data && data.totals.calls === 0
    && (!data.collected_since || new Date(data.collected_since) >= new Date(data.to));

  return (
    <section className={styles.block} data-money>
      <div className={styles.head}>
        <span className={styles.blockTitle}>ГРОШІ</span>
        <div className={styles.period}>
          <button type="button" className={styles.arrow} data-prev
            onClick={() => setDay(shiftDay(day, period, -1))}>←</button>
          <div className={styles.tabs}>
            {(['day', 'week', 'month'] as const).map((p) => (
              <button key={p} type="button" data-period={p}
                className={p === period ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                onClick={() => { setPeriod(p); setDay(localToday()); }}>
                {PERIOD_WORD[p]}
              </button>
            ))}
          </div>
          <button type="button" className={styles.arrow} data-next
            disabled={day >= localToday()}
            onClick={() => setDay(shiftDay(day, period, 1))}>→</button>
        </div>
      </div>

      {loading && <div className={styles.dim}>…</div>}

      {data && !loading && notCollected && (
        // копі: порожній період. Головне — не сказати «нуль».
        <div className={styles.empty} data-not-collected>
          <b>Стільки ще не збирали</b>
          <p>
            {data.collected_since
              ? `Облік почався ${new Date(data.collected_since).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}. За цей період даних просто немає — це не «нічого не витратили».`
              : 'Жодного облікованого виклику ще немає. Це не «нічого не витратили» — це «нема чого показати».'}
          </p>
        </div>
      )}

      {data && !loading && !notCollected && (
        <>
          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>Заплачено</div>
              <div className={styles.big}>{usd2(data.totals.usd)}</div>
              <div className={styles.sub}><Delta now={data.totals.usd} was={data.previous.usd} /></div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardTitle}>Викликів</div>
              <div className={styles.big}>{num(data.totals.calls)}</div>
              <div className={styles.sub}>
                {/* Стаб у гроші не входить — але зникати не має. */}
                {data.totals.stub_calls > 0 && `з них стабових ${num(data.totals.stub_calls)} · поза грішми`}
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardTitle}>Токени</div>
              <div className={styles.big}>{num(data.totals.input_tokens)}</div>
              <div className={styles.sub}>
                вхідних · {num(data.totals.output_tokens)} вихідних
                {data.totals.cached_share !== null && (
                  <> · з кешу {shareWord(data.totals.cached_tokens, data.totals.input_tokens, data.percent_floor)}</>
                )}
              </div>
            </div>
          </div>

          <Slices
            title="НА ЩО"
            note="ГОЛОВНА КОЛОНКА — ЦІНА ОДНОГО ВИКЛИКУ"
            slices={data.byCall}
            floor={data.percent_floor}
            total={data.totals.calls}
          />
          <Slices title="ЗА МОДЕЛЛЮ" slices={data.byModel} floor={data.percent_floor} total={data.totals.calls} />
          <Slices title="ЗА ДОМОМ" slices={data.byHousehold} floor={data.percent_floor} total={data.totals.calls} />
          <Slices title="ЗА ЛЮДИНОЮ" slices={data.byPerson} floor={data.percent_floor} total={data.totals.calls} />

          {data.totals.unpriced_calls > 0 && (
            // копі: рядок про моделі поза прайсом.
            <div className={styles.unpriced} data-unpriced>
              {num(data.totals.unpriced_calls)} викликів, ціни яких прайс не знає. Це не нуль і не «безкоштовно» —
              їх немає в сумі вище, і поки модель не додано в прайс, вартість цих викликів невідома.
            </div>
          )}

          <div className={styles.avgWrap}>
            <span className={styles.blockTitle}>СЕРЕДНІ</span>
            {data.avg.turns < data.percent_floor && (
              <span className={styles.dim}>{num(data.avg.turns)} ходів — вибірка мала, читати обережно</span>
            )}
          </div>
          <div className={styles.rows}>
            <Row label="Хід коштує" value={data.avg.usd_per_turn === null ? '—' : `≈ ${usd(data.avg.usd_per_turn)}`}
              note={`сума викликів одного ходу · ${num(data.avg.turns)} ходів`} />
            <Row label="Модель відповідала"
              value={data.avg.latency_avg_ms === null ? '—' : `${(data.avg.latency_avg_ms / 1000).toFixed(1)} с`}
              note={data.avg.latency_p95_ms === null ? '' : `довгий хвіст ${(data.avg.latency_p95_ms / 1000).toFixed(1)} с`} />
            {/* копі: рядок про те, чого ми не міряємо. Прибирати не можна — без
                нього латентність моделі читається як час очікування людини. */}
            <Row label="Людина чекала" value="не міряємо"
              note="заливка фото, розбір і малювання картки поза виміром — це інше число, і воно більше" dim />
            <Row label="Ходів на людину за день"
              value={data.avg.turns_per_person_day === null ? '—' : String(data.avg.turns_per_person_day)}
              note={`рахуючи тільки дні, коли писали · таких днів ${num(data.avg.person_days)}`} />
          </div>

          <div className={styles.avgWrap}>
            <span className={styles.blockTitle}>ПРОГНОЗ</span>
            {/* копі: підпис до прогнозу. Має сказати, що це оцінка. */}
            <span className={styles.dim}>
              ЗА ПОТОЧНИМ ТЕМПОМ · МІСЯЦЬ ПРОЙДЕНО НА {Math.round(data.forecast.month_elapsed * 100)}%
            </span>
          </div>
          <div className={styles.rows} data-forecast>
            <Row label="Вийде на кінець місяця" value={`≈ ${usd2(data.forecast.month_usd)}`}
              note="оцінка за темпом вибраного періоду, не факт" />
            <Row label="Один дім за місяць"
              value={data.forecast.per_household_usd === null ? '—' : `≈ ${usd2(data.forecast.per_household_usd)}`}
              note={`${num(data.forecast.households)} ${data.forecast.households === 1 ? 'дім' : 'домів'} із витратами`} />
            <Row label="Одна людина за місяць"
              value={data.forecast.per_person_usd === null ? '—' : `≈ ${usd2(data.forecast.per_person_usd)}`}
              note={`${num(data.forecast.people)} ${data.forecast.people === 1 ? 'людина' : 'людей'} із витратами`} />
            <Row label="Чутливо до"
              value={[
                data.forecast.sensitive_to.cached_share !== null
                  && `кеш ${Math.round(data.forecast.sensitive_to.cached_share * 100)}%`,
                data.forecast.sensitive_to.parse_share !== null
                  && `розбори чеків ${Math.round(data.forecast.sensitive_to.parse_share * 100)}%`,
                data.forecast.sensitive_to.long_tail_ms !== null
                  && `довгі ходи ${(data.forecast.sensitive_to.long_tail_ms / 1000).toFixed(1)} с`,
              ].filter(Boolean).join(' · ') || '—'}
              note="зміниться щось із цього — зміниться й число" dim />
          </div>
        </>
      )}
    </section>
  );
}

function Row({ label, value, note, dim }: { label: string; value: string; note?: string; dim?: boolean }) {
  return (
    <div className={styles.row} data-row={label}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={dim ? `${styles.rowValue} ${styles.dim}` : styles.rowValue}>{value}</span>
      <span className={styles.rowNote}>{note}</span>
    </div>
  );
}

function Slices({ title, note, slices, floor, total }: {
  title: string; note?: string; slices: MoneySlice[]; floor: number; total: number;
}) {
  if (slices.length === 0) return null;
  return (
    <div className={styles.slice} data-slice={title}>
      <div className={styles.sliceHead}>
        <span className={styles.blockTitle}>{title}</span>
        {note && <span className={styles.dim}>{note}</span>}
      </div>
      <div className={styles.table}>
        <div className={styles.rowHead}>
          <span>ЩО</span><span>ВИКЛИКІВ</span><span>ЧАСТКА</span><span>РАЗОМ</span><span>ОДИН ВИКЛИК</span>
        </div>
        {slices.map((s) => (
          <div key={s.key} className={styles.tableRow} data-key={s.key}>
            <span className={styles.name}>{s.label}</span>
            <span className={styles.mono}>{num(s.calls)}</span>
            <span className={`${styles.mono} ${styles.dim}`}>{shareWord(s.calls, total, floor)}</span>
            <span className={styles.mono}>{usd(s.usd)}</span>
            <span className={styles.mono} data-per-call>
              {s.usd_per_call === null ? <span className={styles.dim}>ціни не знаємо</span> : usd(s.usd_per_call)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
