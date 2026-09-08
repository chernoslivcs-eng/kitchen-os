// Крок А2: Зведення — поки що список домів, і з нього починається адмінка.
//
// Головний рядок тут не той, де багато ходів, а той, де їх немає зовсім:
// людина зайшла за лінком і не написала нічого. На пілоті таких буде
// більшість, і саме вони кажуть те, чого не скаже жодна розмова. Тому такий
// дім стоїть у списку нарівні з рештою, з підписом «ходів не було», а не
// відфільтровується як порожній.
//
// Ім'я й пошта власника — свідомий виняток із «PII в адмінку не носимо».
// Власник цих людей особисто кликав і має розрізняти їх у списку.
//
// КОПІ: тексти нижче — робочі, не остаточні. Місця, де потрібне рішення копі,
// позначені коментарем «копі:».

import { useOutletContext, useNavigate } from 'react-router-dom';
import type { AdminContext } from './AdminShell';
import type { AdminHousehold } from '../../api';
import { MoneyBlock } from './Money';
import styles from './Households.module.css';

/** «сьогодні, 21:02» / «2 вер., 19:04» — свій день читається інакше за чужий. */
function whenWord(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `сьогодні, ${time}`;
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `вчора, ${time}`;
  return `${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}, ${time}`;
}

/**
 * Дім, число словом. «1 дім · 2 доми · 5 домів» — і 11–14 теж «домів».
 * Без цього підпис читався як «3 ДОМІВ», і адмінка починалася з граматичної
 * помилки в першому ж рядку.
 */
export function houseWord(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'дім';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'доми';
  return 'домів';
}

/**
 * Рядок про дім без ходів: коли заходили — це все, що ми про нього знаємо.
 *
 * Формулювання безрідне навмисно. Попереднє («заходила … і не написала»)
 * приписувало жіночий рід кожній людині в списку — на пілоті це ламається на
 * першому ж Михайлові.
 */
export function silenceLine(h: AdminHousehold): string {
  if (!h.last_seen_at) return 'жодного входу за лінком';
  return `останній вхід ${whenWord(h.last_seen_at)} · жодного повідомлення`;
}

export function HouseholdsPage() {
  const { households, hiddenTechnical, technicalTotal, showTechnical, setShowTechnical } =
    useOutletContext<AdminContext>();
  const navigate = useNavigate();

  const silent = households.filter((h) => h.turns === 0).length;

  return (
    <div className={styles.page} data-households>
      <div className={styles.head}>
        <h1 className={styles.title}>Зведення</h1>
        <span className={styles.kicker}>
          {/* копі: підпис під заголовком. Періоди й порівняння — наступні кроки. */}
          Увесь продукт · {households.length} {houseWord(households.length)}
          {silent > 0 && ` · ${silent} без жодного ходу`}
          {/* Скільки приховано — і одразу спосіб їх побачити. Мовчазний фільтр,
              про який ніде не сказано, з часом читається як втрачені дані. */}
          {hiddenTechnical > 0 && (
            <>
              {' · '}
              <button type="button" className={styles.toggle} data-show-technical onClick={() => setShowTechnical(true)}>
                приховано {hiddenTechnical} технічних — показати
              </button>
            </>
          )}
          {showTechnical && technicalTotal > 0 && (
            <>
              {' · '}
              <button type="button" className={styles.toggle} data-hide-technical onClick={() => setShowTechnical(false)}>
                технічні показано — сховати
              </button>
            </>
          )}
        </span>
      </div>

      {/* Крок А4: гроші стоять НАД списком домів. Питання «на що йдуть гроші»
          старше за питання «хто ці доми» — список нижче лишається як був. */}
      <MoneyBlock technical={showTechnical} />

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <span className={styles.blockTitle}>ДОМИ</span>
          <span className={styles.blockNote}>ЄДИНИЙ ВХІД УСЕРЕДИНУ</span>
        </div>

        {households.length === 0 ? (
          // копі: порожній стан усього продукту. Побачити його можна тільки в
          // перший день або якщо щось справді зламалось.
          <div className={styles.empty} data-empty>
            <b>Домів ще немає</b>
            <p>Ніхто не заходив за лінком. Щойно перша людина відкриє продукт, вона з’явиться тут окремим рядком.</p>
          </div>
        ) : (
          <div className={styles.table} role="table">
            <div className={styles.rowHead} role="row">
              <span>ДІМ</span><span>ЛЮДЕЙ</span><span>ОСТАННІЙ ХІД</span><span>ХОДІВ</span><span />
            </div>
            {households.map((h) => (
              <div
                key={h.id}
                className={h.turns === 0 ? `${styles.row} ${styles.silent}` : styles.row}
                role="row"
                data-household={h.id}
                data-silent={h.turns === 0 ? '' : undefined}
                onClick={() => navigate(`/admin/h/${h.id}`)}
              >
                <div className={styles.who}>
                  <span className={styles.avatar}>
                    {h.name.replace(/^Дім\s+/i, '').charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.names}>
                    <span className={styles.name}>
                      {h.name}
                      {h.mine && <span className={styles.mineTag}>твій</span>}
                      {h.technical && !h.mine && <span className={styles.techTag}>технічний</span>}
                    </span>
                    {/* Пошта — щоб власник упізнав, кого саме він кликав. */}
                    <span className={styles.owner}>
                      {h.owner_name ?? '—'}{h.owner_email ? ` · ${h.owner_email}` : ''}
                    </span>
                  </span>
                </div>
                <span className={styles.mono}>{h.people}</span>
                <span className={styles.mono}>
                  {h.last_turn_at ? whenWord(h.last_turn_at) : <span className={styles.dim}>ходів не було</span>}
                </span>
                <span className={styles.mono}>
                  {h.turns > 0 ? h.turns : <span className={styles.dim}>{silenceLine(h)}</span>}
                </span>
                <span className={styles.enter}>УВІЙТИ →</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
