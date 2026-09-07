// Крок О1: /admin/pulse — те, що власник відкриває ввечері.
//
// Питання, на яке ця сторінка відповідає: «що сьогодні сталось у ДОМІ і
// скільки це коштувало». Не «скільки DAU» — на кількох людях когорти й
// графіки не означають нічого, а один прожитий день означає все.
//
// Одиниця рахунку — дім: комора спільна, розмови спільні, рахунок за модель
// приходить один. Поки сторінка дивилась на власника, витрати й поведінка
// запрошених у дім не були видні ніде.
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
import { useOutletContext, useParams } from 'react-router-dom';
import { api, type Pulse, type PulseMoney } from '../../api';
import type { AdminContext } from './AdminShell';
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

/**
 * Крок А2: ціна хода й те, ЯК вона порахована.
 *
 * «≈» — не прикраса. До А1 указівника на хід не існувало, і ціна зшивалась
 * здогадкою: найближчий виклик тієї самої людини в межах хвилини. На такому
 * числі не можна будувати юніт-економіку, і людина мусить бачити різницю, а
 * не здогадуватись про неї. Точна ціна йде без значка.
 */
function priceCell(t: { usd: number | null; latency_ms: number | null; price_from: 'message' | 'time' | null }) {
  if (t.latency_ms === null && t.usd === null) return '';       // виклику не було
  // «≈ —» було б нісенітницею: риска означає «ціни цієї моделі не знаємо», і
  // приблизність тут нема до чого. Значок ставимо тільки поруч із числом.
  if (t.usd === null) return '—';
  if (t.price_from === 'time') return `≈ ${usd(t.usd)}`;
  return usd(t.usd);
}

/** household_member.role словом: у таблиці «owner» нічого не пояснює. */
const ROLE_WORD: Record<string, string> = { owner: 'власник', member: 'учасник' };

const STATE_CLASS: Record<string, string> = {
  'застосована': styles.applied!,
  'скасована': styles.undone!,
  'відхилена': styles.dismissed!,
  'чекає': styles.waiting!,
};

/**
 * «Дім Олі» → «дому Олі». Назва дому в базі має вигляд «Дім <ім'я>»
 * (createUserWithHousehold), і присвійна форма з неї виходить одним рухом.
 * Якщо дім перейменували руками — беремо назву в лапки, а не ламаємо мову.
 */
export function possessive(name: string): string {
  const m = /^Дім\s+(.+)$/i.exec(name.trim());
  return m ? `дому ${m[1]}` : `дому «${name}»`;
}

export function PulsePage() {
  const [day, setDay] = useState(today());
  const [data, setData] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  // Крок А2: дім — з адреси. Немає в адресі — свій, як було.
  const { household_id } = useParams();
  const { house } = useOutletContext<AdminContext>();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.admin.pulse(day, household_id)
      .then((p) => { if (alive) { setData(p); setLoading(false); } })
      // Крок А2: власного 404 тут більше немає — доступ перевіряє каркас, і
      // відмова показує справжню сторінку продукту. Тут лишається тільки
      // «не завантажилось».
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [day, household_id]);

  // Порожньо ЦІЛКОМ: ні ходів, ні подій, ні жодного виклику моделі. Три
  // порожні таблиці підряд сказали б те саме, але гірше — і за ними не видно
  // головного: у цьому домі не сталось нічого, і це факт про людину.
  const nothing = !!data && data.turns.length === 0 && data.events.length === 0
    && data.money.day.calls === 0;

  return (
    <div className={styles.page} data-pulse>
      <div className={styles.head}>
        {/* Присвійний заголовок: власник дивиться на чужі гроші й чужі розмови,
            і сплутати їх зі своїми — найлегша помилка тут. */}
        <h1 className={styles.title}>
          {data?.household_name ? `Пульс ${possessive(data.household_name)}` : 'Пульс'}
        </h1>
        {data?.guest && <span className={styles.guestTag} data-guest-tag>У ГОСТЯХ · ЛИШЕ ЧИТАННЯ</span>}
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
        {data && (
          <span className={styles.who}>
            {data.members.length} {data.members.length === 1 ? 'людина' : 'людей'}
          </span>
        )}
      </div>

      {loading && <div className={styles.empty}>…</div>}

      {/* Дім, у якому нічого не сталось. Це не помилка й не порожня сторінка —
          це те, що справді сталось, і на пілоті таких домів буде більшість.
          Тому окремий екран, а не три порожні таблиці підряд. */}
      {data && !loading && nothing && (
        <div className={styles.nothing} data-nothing>
          {/* копі: головна фраза екрана «у цьому домі ще нічого не сталось». */}
          <b>У цьому домі ще нічого не сталось</b>
          <p>
            Цього дня тут не було жодного ходу, жодної події і жодного виклику моделі.
          </p>
          <div className={styles.nothingRows}>
            <div><span>Ходів</span><span>немає</span></div>
            <div><span>Гроші</span><span>$0.0000 — виклику моделі не було жодного</span></div>
            <div><span>Помилки</span><span>нічого не ламалось</span></div>
          </div>
        </div>
      )}

      {data && !loading && !nothing && (
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
                        <th>Час</th><th>Людина</th><th>Хто</th><th>Репліка</th>
                        <th>Картка</th><th>Стан</th><th>Латентність</th><th>Ціна</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.turns.map((t, i) => (
                        <tr key={`${t.at}-${i}`}>
                          <td className={styles.mono}>{hhmm(t.at)}</td>
                          {/* Чий це хід. У домі з двох людей стрічка без імені
                              не читається взагалі. */}
                          <td className={styles.mono}>{t.who}</td>
                          {/* Рід репліки, не рід людини: «сказала» тут читалось
                              неправильно рівно для половини дому. */}
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
                              моделі ми не знаємо. Це різні новини.
                              «≈» — ціна зшита за часом, не за викликом. */}
                          <td
                            className={`${styles.mono} ${t.price_from === 'time' ? styles.dim : ''}`}
                            data-price-from={t.price_from ?? undefined}
                            title={t.price_from === 'time' ? 'зшито за часом, не за викликом — точніше не знаємо'
                              : t.price_from === 'message' ? 'сума викликів цього ходу' : undefined}
                          >
                            {priceCell(t)}
                          </td>
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
              <MoneyCard title="Дім за день" m={data.money.day} />
              <MoneyCard title="Дім за тиждень" m={data.money.week} />
              <div className={styles.card}>
                <div className={styles.cardTitle}>Ціна дня на дім</div>
                <div className={styles.big}>{usd(data.money.day.usd)}</div>
                {/* Оце і є та юніт-економіка, якої ми не знали: помножити на
                    тридцять і зіставити з ціною підписки. */}
                <div className={styles.sub}>
                  ≈ ${(data.money.day.usd * 30).toFixed(2)} на місяць
                </div>
              </div>
            </div>
            {/* Рахунок приходить один, але видно має бути, з чого він склався. */}
            <div className={styles.scroll}>
              <table className={styles.table} data-money-by-member>
                <thead>
                  <tr>
                    <th>Людина</th><th>Роль</th><th>За день</th><th>Викликів</th><th>За тиждень</th>
                  </tr>
                </thead>
                <tbody>
                  {data.money.byMember.map((m) => (
                    <tr key={m.user_id} data-member={m.user_id}>
                      <td>{m.name}</td>
                      <td className={`${styles.mono} ${styles.dim}`}>{ROLE_WORD[m.role] ?? m.role}</td>
                      <td className={styles.mono}>{usd(m.day.usd)}</td>
                      <td className={`${styles.mono} ${styles.dim}`}>{m.day.calls}</td>
                      <td className={styles.mono}>{usd(m.week.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                      <tr><th>Час</th><th>Людина</th><th>Подія</th><th>Подробиці</th></tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => {
                        const inc = e.name.startsWith('incident:');
                        const kind = inc ? String(e.props.kind ?? '') : '';
                        return (
                          <tr key={e.id}>
                            <td className={styles.mono}>{hhmm(e.created_at)}</td>
                            <td className={styles.mono}>{e.who}</td>
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
