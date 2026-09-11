// Крок А2: власний каркас адмінки.
//
// Досі адмінка була трьома незв'язаними адресами (`/admin/pulse`,
// `/admin/occasions`, `/admin/boom`), і всі три жили ВСЕРЕДИНІ каркаса
// продукту: навколо адмінських таблиць видно було сайдбар зі Стрічкою й
// Коморою. Тепер вона виходить із `Shell` і має свою рейку.
//
// Друге, і важливіше за перше: перевірка доступу тут ОДНА. Раніше кожна
// сторінка малювала власний сірий прямокутник із написом «404» — не схожий ні
// на що в продукті, і тому він сам себе видавав: стороння людина розуміла, що
// натрапила не на порожнє місце, а на щось приховане. Тепер відмова показує
// той самий `NotFoundPage`, що й будь-яка неіснуюча адреса, без жодної
// відмінності.
//
// Чим перевіряємо: списком домів. Він потрібен каркасу так чи так (Зведення —
// це він, а стан «у гостях» бере звідти назву дому), і окремий ендпоінт
// «чи я адмін» був би другим джерелом тієї самої правди.

import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, type AdminHousehold } from '../../api';
import { NotFoundPage } from '../NotFound/NotFound';
import styles from './AdminShell.module.css';

type Gate = 'checking' | 'allowed' | 'denied';

export interface AdminContext {
  households: AdminHousehold[];
  myHouseholdId: string;
  /** Дім, усередині якого зараз стоїмо (з адреси). Null — рівень продукту. */
  house: AdminHousehold | null;
  /** Скільки технічних домів приховано зараз, і скільки їх узагалі. */
  hiddenTechnical: number;
  technicalTotal: number;
  /** Показувати технічні доми. Перемикач живе в підписі Зведення. */
  showTechnical: boolean;
  setShowTechnical: (v: boolean) => void;
  reload: () => void;
}

/** Мітка Kitchen OS у рейці — та сама, що на знайомстві. */
function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="104 15" transform="rotate(-58 24 24)" />
      <circle cx="24" cy="24" r="6" fill="var(--sage)" />
    </svg>
  );
}

export function AdminShell() {
  const [gate, setGate] = useState<Gate>('checking');
  const [households, setHouseholds] = useState<AdminHousehold[]>([]);
  const [mine, setMine] = useState('');
  const [hiddenTechnical, setHidden] = useState(0);
  const [technicalTotal, setTechnicalTotal] = useState(0);
  const [showTechnical, setShowTechnical] = useState(false);
  const [tick, setTick] = useState(0);
  const navigate = useNavigate();
  const { household_id } = useParams();

  useEffect(() => {
    let alive = true;
    api.admin.households(showTechnical)
      .then((r) => {
        if (!alive) return;
        setHouseholds(r.households);
        setMine(r.my_household_id);
        setHidden(r.hidden_technical);
        setTechnicalTotal(r.technical_total);
        setGate('allowed');
      })
      .catch(() => { if (alive) setGate('denied'); });
    return () => { alive = false; };
  }, [tick, showTechnical]);

  // Поки не знаємо — не показуємо нічого. Проблиск рейки перед 404 сказав би
  // сторонньому рівно те, що ми ховаємо.
  if (gate === 'checking') return null;
  // Справжня 404 продукту, той самий компонент. Жодної відмінності — інакше
  // адмінка знову почне видавати себе формою відмови.
  if (gate === 'denied') return <NotFoundPage />;

  const house = household_id ? households.find((h) => h.id === household_id) ?? null : null;
  const guest = !!house && !house.mine;
  const ctx: AdminContext = {
    households, myHouseholdId: mine, house,
    hiddenTechnical, technicalTotal, showTechnical, setShowTechnical,
    reload: () => setTick((n) => n + 1),
  };

  return (
    <div className={guest ? `${styles.wrap} ${styles.guest}` : styles.wrap} data-admin data-guest={guest ? '' : undefined}>
      {/* Паспарту: чужий дім видно ФОРМОЮ, а не лише адресним рядком. Колір
          навмисно нейтральний — слива в продукті означає АНТИ й лишається під
          іншим. */}
      {guest && (
        <div className={styles.mat} data-guest-bar>
          <span className={styles.matText}>
            У ГОСТЯХ · {house!.name.toUpperCase()} · ЛИШЕ ЧИТАННЯ
          </span>
          <button type="button" className={styles.matBack} onClick={() => navigate('/admin')}>
            ← ДО СПИСКУ ДОМІВ
          </button>
        </div>
      )}

      <div className={styles.frame}>
        <aside className={styles.rail}>
          <div className={styles.brand}><Mark /><b>АДМІНКА</b></div>

          <div className={styles.group}>ПРОДУКТ ЦІЛКОМ</div>
          <NavLink to="/admin" end className={({ isActive }) => isActive ? `${styles.link} ${styles.on}` : styles.link}>
            ЗВЕДЕННЯ
          </NavLink>

          {house && (
            <div className={styles.houseBox} data-house-box>
              <span className={styles.houseKicker}>{guest ? 'ДІМ · У ГОСТЯХ' : 'ДІМ'}</span>
              <div className={styles.houseName}>
                <span className={styles.avatar}>{house.name.replace(/^Дім\s+/i, '').charAt(0).toUpperCase()}</span>
                <span>{house.name}</span>
              </div>
              <span className={styles.houseMeta}>
                {house.people} {house.people === 1 ? 'людина' : 'людей'}
                {guest ? ' · лише читання' : ' · це твій дім'}
              </span>
              <button type="button" className={styles.houseBack} onClick={() => navigate('/admin')}>
                ← ДО СПИСКУ ДОМІВ
              </button>
            </div>
          )}
          {house && (
            <NavLink to={`/admin/h/${house.id}`} className={({ isActive }) => isActive ? `${styles.link} ${styles.on}` : styles.link}>
              ПУЛЬС
            </NavLink>
          )}

          <div className={styles.group}>ДОВІДНИКИ</div>
          <NavLink to="/admin/occasions" className={({ isActive }) => isActive ? `${styles.link} ${styles.on}` : styles.link}>
            ПРИВОДИ
          </NavLink>

          <div className={styles.group}>СЕРВІС</div>
          <NavLink to="/admin/boom" className={({ isActive }) => isActive ? `${styles.link} ${styles.on}` : styles.link}>
            ДИМОВИЙ ТЕСТ
          </NavLink>

          <div className={styles.spacer} />
          <span className={styles.hint}>дім вибирається у Зведенні,<br />у блоці «Доми»</span>
          <button type="button" className={styles.exit} onClick={() => navigate('/app')}>← У ПРОДУКТ</button>
        </aside>

        <main className={styles.main}>
          <Outlet context={ctx} />
        </main>
      </div>
    </div>
  );
}
