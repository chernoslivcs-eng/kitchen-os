// Крок О1: /admin/pulse — те, що власник відкриває ввечері.
//
// Питання, на яке ця сторінка відповідає: «що сьогодні сталось у людини і
// скільки це коштувало». Не «скільки DAU» — на одному користувачі когорти й
// графіки не означають нічого, а один прожитий день означає все.
//
// Три блоки, і порядок не випадковий:
//   1. Розмови — що людина сказала і що продукт відповів. Головне.
//   2. Гроші — чи має цей день право повторитись тисячу разів.
//   3. Події — те, чого в розмові не видно: куди ходила, де кинула,
//      що зламалось (інциденти лежать тут же, під `incident:*`).
//
// Немає в TabBar і в шухляді навмисно, як і адмінка приводів: сервер віддає
// 404 всім, крім пошти з ADMIN_EMAILS.

import { useEffect, useState } from 'react';
import { api, type Pulse, type PulseMoney } from '../../api';
import styles from './Pulse.module.css';

/** Локальний день, не UTC: пульс читають по днях життя. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d! + by);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

/** Долари з чотирма знаками: хід коштує центи, і два знаки все обнулили б. */
const usd = (n: number | null) => (n === null ? '—' : `$${n.toFixed(4)}`);

const STATE_CLASS: Record<string, string> = {
  'застосована': styles.applied!,
  'скасована': styles.undone!,
  'відхилена': styles.dismissed!,
  'чекає': styles.waiting!,
};

export function PulsePage() {
  const [day, setDay] = useState(today());
  const [data, setData] = useState<Pulse | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.admin.pulse(day)
      .then((p) => { if (alive) { setData(p); setLoading(false); } })
      .catch(() => { if (alive) { setDenied(true); setLoading(false); } });
    return () => { alive = false; };
  }, [day]);

  // Той самий 404, що на сервері: сторінка не видає, що вона існує.
  if (denied) {
    return <div style={{ padding: 24, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)' }}>404</div>;
  }

  return (
    <div className={styles.page} data-pulse>
      <div className={styles.head}>
        <h1 className={styles.title}>Пульс</h1>
        <button type="button" className={styles.nav} onClick={() => setDay(shiftDay(day, -1))}>← день</button>
        <input
          type="date"
          className={styles.day}
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          data-pulse-day
        />
        <button
          type="button"
          className={styles.nav}
          onClick={() => setDay(shiftDay(day, 1))}
          disabled={day >= today()}
        >
          день →
        </button>
        {data && <span className={styles.who}>{data.user_id}</span>}
      </div>

      {loading && <div className={styles.empty}>…</div>}

      {data && !loading && (
        <>
          <section className={styles.block}>
            <h2 className={styles.blockTitle}>Розмови</h2>
            {data.turns.length === 0
              ? <div className={styles.empty}>Цього дня не розмовляли.</div>
              : (
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Час</th><th>Хто</th><th>Репліка</th>
                        <th>Картка</th><th>Стан</th><th>Латентність</th><th>Ціна</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.turns.map((t, i) => (
                        <tr key={`${t.at}-${i}`}>
                          <td className={styles.mono}>{hhmm(t.at)}</td>
                          <td className={styles.mono}>{t.role === 'user' ? 'людина' : 'Семен'}</td>
                          <td className={`${styles.text} ${t.role === 'user' ? styles.roleUser : styles.roleAssistant}`}>
                            {t.text ?? <span className={styles.dim}>—</span>}
                          </td>
                          <td className={styles.mono}>{t.card_type ?? ''}</td>
                          <td>
                            {t.card_state && (
                              <span className={`${styles.state} ${STATE_CLASS[t.card_state] ?? ''}`}>
                                {t.card_state}
                              </span>
                            )}
                          </td>
                          <td className={styles.mono}>{t.latency_ms === null ? '' : `${(t.latency_ms / 1000).toFixed(1)} с`}</td>
                          {/* Порожньо, коли виклику моделі на цьому ході не було
                              (репліка людини); «—», коли виклик був, а ціни
                              моделі ми не знаємо. Це різні новини. */}
                          <td className={styles.mono}>{t.latency_ms === null && t.usd === null ? '' : usd(t.usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>

          <section className={styles.block}>
            <h2 className={styles.blockTitle}>Гроші</h2>
            <div className={styles.money}>
              <MoneyCard title="За день" m={data.money.day} />
              <MoneyCard title="За тиждень" m={data.money.week} />
              <div className={styles.card}>
                <div className={styles.cardTitle}>Ціна дня на людину</div>
                <div className={styles.big}>{usd(data.money.day.usd)}</div>
                {/* Оце і є та юніт-економіка, якої ми не знали: помножити на
                    тридцять і зіставити з $5 підписки. */}
                <div className={styles.sub}>
                  ≈ ${(data.money.day.usd * 30).toFixed(2)} на місяць
                </div>
              </div>
            </div>
          </section>

          <section className={styles.block}>
            <h2 className={styles.blockTitle}>Події</h2>
            {data.events.length === 0
              ? <div className={styles.empty}>Подій немає.</div>
              : (
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>Час</th><th>Подія</th><th>Подробиці</th></tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => {
                        const inc = e.name.startsWith('incident:');
                        const kind = inc ? String(e.props.kind ?? '') : '';
                        return (
                          <tr key={e.id}>
                            <td className={styles.mono}>{hhmm(e.created_at)}</td>
                            <td className={`${styles.mono} ${kind === 'broke' ? styles.broke : kind === 'guard' ? styles.guard : ''}`}>
                              {inc ? e.name.slice('incident:'.length) : e.name}
                              {kind && <span className={styles.dim}> · {kind === 'broke' ? 'зламалось' : 'запобіжник'}</span>}
                            </td>
                            <td className={`${styles.mono} ${styles.dim}`}>{propsLine(e.props, inc)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        </>
      )}
    </div>
  );
}

function MoneyCard({ title, m }: { title: string; m: PulseMoney }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      <div className={styles.big}>{usd(m.usd)}</div>
      <div className={styles.sub}>
        {m.calls} викл. · {m.input.toLocaleString('uk-UA')} вх. · {m.output.toLocaleString('uk-UA')} вих.
        {m.cached > 0 && ` · ${m.cached.toLocaleString('uk-UA')} з кешу`}
      </div>
    </div>
  );
}

/**
 * В інциденті `kind` — це рід, і він уже показаний словом поруч із назвою;
 * дублювати його в подробицях нема сенсу. А от у `attachment_added` те саме
 * слово означає рід вкладення (зображення / pdf) — і його ховати не можна.
 */
function propsLine(props: Record<string, unknown>, isIncident: boolean): string {
  return Object.entries(props)
    .filter(([k]) => !(isIncident && k === 'kind'))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}
