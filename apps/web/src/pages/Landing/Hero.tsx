// Перший екран лендингу v5 («ланцюг»): шапка, заголовок, картка входу і сесія
// з чотирьох фрагментів — запит → комора/сезон → пропозиція → списання.
// Фрагменти — ілюстрація, не UI: крок підсвічується по колу, паралакс за
// курсором на ≥1280, нитки між кроками — тільки там. 768–1279: фрагменти
// щільніше навколо картки, без ниток. <768: сесії немає — історію розказують
// секції нижче (правила порогів з канвасу «адаптив»).

import { useEffect, useRef, useState } from 'react';
import { DotField } from './DotField';
import { useMagicLink } from './useMagicLink';
import { api } from '../../api';
import styles from './Landing.module.css';

export function Mark({ size = 32, ring = '#f6efe0', dot = '#93b48b' }: { size?: number; ring?: string; dot?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke={ring} strokeWidth="3" strokeLinecap="round" strokeDasharray="104 15" transform="rotate(-58 24 24)" />
      <circle cx="24" cy="24" r="6" fill={dot} />
    </svg>
  );
}

// Кольоровий «G» — офіційна чотириколірна марка Google.
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const CREAM = '#f6efe0';
const DIM = 'rgba(246,239,224,.55)';
const AMBER = '#e8cf96';
const SEQ: [number, number][] = [[0, 1800], [1, 2000], [2, 3000], [3, 3200]];

const PANTRY = [
  { z: 'd', zc: AMBER, n: 'Помідори', q: '400 г · лежать 3 дні', t: '3 ДНІ', tc: AMBER, used: '400 → 0 г' },
  { z: 'f', zc: DIM, n: 'Фует', q: '160 г · відкрито', t: '', tc: DIM, used: '160 → 60 г' },
  { z: 'f', zc: DIM, n: 'Пармезан', q: '90 г · відкрито', t: '', tc: DIM, used: '90 → 60 г' },
  { z: 's', zc: DIM, n: 'Спагеті', q: '500 г · ціле', t: '', tc: DIM, used: '500 → 300 г' },
];

export function LoginCard({ id }: { id: string }) {
  const { email, setEmail, error, loading, submit } = useMagicLink();
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => {
    api.auth.providers().then((p) => setGoogleOn(p.google)).catch(() => setGoogleOn(false));
  }, []);
  return (
    <div id={id} className={styles.card}>
      <div className={styles['card-head']}>
        <span className={styles.mono}>ВХІД · БЕЗ ПАРОЛЯ</span>
        <Mark size={22} ring="#1d2126" dot="#58754e" />
      </div>
      <div className={styles['card-titles']}>
        <div className={styles['card-title']}>Почати з того, що є</div>
        <div className={styles['card-sub']}>Лінк на пошту — клік — і ти всередині.</div>
      </div>
      <form className={styles.pill} onSubmit={submit} noValidate>
        <input
          type="email" inputMode="email" autoComplete="email" placeholder="Твій email" required
          value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email"
        />
        <button type="submit" disabled={loading}>{loading ? 'Надсилаю…' : 'Надіслати лінк'}</button>
      </form>
      {error && <div className={styles['form-error']}>{error}</div>}
      {googleOn && (
        <button type="button" className={styles.google} onClick={() => { window.location.href = '/v1/auth/google'; }}>
          <GoogleMark /> Увійти через Google
        </button>
      )}
      <div className={styles['card-foot']}>
        <span>Пароля немає. Лінк діє 15 хвилин.</span>
        <a href="#how">Як це працює ↓</a>
      </div>
    </div>
  );
}

export function Hero({ still }: { still: boolean }) {
  // Крок сесії по колу; reduced motion — одразу «після вечері», без циклу.
  const [step, setStep] = useState(still ? 3 : 0);
  useEffect(() => {
    if (still) return;
    let i = 0;
    let t = 0;
    const next = () => { const [s, d] = SEQ[i]!; setStep(s); i = (i + 1) % SEQ.length; t = window.setTimeout(next, d); };
    next();
    return () => clearTimeout(t);
  }, [still]);

  // Паралакс: курсор над сценою → фрагменти зсуваються від нього.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const [m, setM] = useState({ x: 0, y: 0 });
  const onMove = (e: React.MouseEvent) => {
    if (still || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setM({ x: mouse.current.x / r.width - 0.5, y: mouse.current.y / r.height - 0.5 });
  };
  const onLeave = () => { mouse.current = null; setM({ x: 0, y: 0 }); };

  const hi = step >= 1, done = step >= 3;
  const on = (s: number) => (step === s ? styles['frag-on'] : styles['frag-off']);
  const left = { transform: `translate(${-m.x * 16}px, ${-m.y * 10}px)` };
  const right = (k = 10) => ({ transform: `translate(${m.x * 18}px, ${m.y * k}px)` });
  const thread = (active: boolean) => `rgba(246,239,224,${active ? 0.55 : 0.12})`;

  return (
    <div className={styles.top}>
      <div ref={stageRef} className={styles.stage} onMouseMove={onMove} onMouseLeave={onLeave}>
        <DotField mouse={mouse} still={still} />
        <div className={styles['stage-shade']} />
      </div>

      <div className={styles.container}>
        <header className={styles.header}>
          <a className={styles.logo} href="#top"><Mark /><span>Kitchen<em> OS</em></span></a>
          <nav className={styles.nav}>
            <a href="#how">Як це працює</a>
            <a href="#price">Ціна</a>
            <a href="#account" className={styles['nav-desk']}>Облік</a>
            <span className={`${styles.mono} ${styles['nav-tab']}`}>$5 · $7 · $70</span>
            <a href="#signin" className={styles['nav-pill']}>Увійти</a>
          </nav>
        </header>

        <section className={styles.hero} aria-label="Вхід">
          <h1 className={styles.h1}>
            <span className={styles['h1-light']}>Кухня, яка памʼятає.</span>
            <span className={styles['h1-bold']}>Готуй з того, що вже є.</span>
          </h1>

          <div className={styles['hero-card']}><LoginCard id="signin" /></div>

          <div className={styles['hero-lead']}>
            <p>Kitchen OS памʼятає, що є вдома, що вже відкрите і що давно дивиться на тебе з холодильника. Питаєш «що на вечерю?» — отримуєш відповідь, яка не починається з походу в магазин.</p>
            <span className={styles.mono}>ФОТО, ЧЕК АБО «ТАМ ЩЕ ДЕСЬ БУЛА МОЦАРЕЛА» — ЦЬОГО ДОСТАТНЬО</span>
          </div>

          {/* Нитки між кроками — тільки ≥1280 (ховаються стилем). */}
          <svg className={styles.threads} viewBox="0 0 1280 900" fill="none" aria-hidden="true">
            <path d="M190 352 C 190 380, 190 400, 190 430" stroke={thread(step === 1)} />
            <path d="M1040 334 C 1040 360, 1040 370, 1040 392" stroke={thread(step === 2)} />
            <path d="M336 550 C 380 550, 380 480, 420 480" stroke={thread(step === 2)} />
            <path d="M860 480 C 900 480, 900 520, 938 520" stroke={thread(done)} />
            <path d="M1060 690 C 1060 770, 640 800, 200 770 C 120 764, 110 660, 180 660" stroke={thread(step === 0)} />
          </svg>

          {/* 01 запит */}
          <div className={`${styles.frag} ${styles['f-req']} ${on(0)}`} style={left}>
            <span className={styles.kick}>01 · ЗАПИТ · ЧТ 18:40</span>
            <div className={`${styles.glass} ${styles.bubble} ${styles.swL}`}>що на вечерю?</div>
          </div>

          {/* 02 сезон */}
          <div className={`${styles.frag} ${styles['f-season']} ${on(1)}`} style={right()}>
            <span className={styles.kick}>02 · КАЛЕНДАР · СЕЗОН</span>
            <div className={`${styles.glass} ${styles.season} ${styles.swR}`}>
              <span className={styles['season-glyph']}>◷</span>
              <div><span>Сезон помідорів</span><span className={styles.mono}>ДО КІНЦЯ ВЕРЕСНЯ · СВІЖЕ ВАЖИТЬ БІЛЬШЕ</span></div>
            </div>
          </div>

          {/* 02 комора */}
          <div className={`${styles.frag} ${styles['f-pantry']} ${on(1)}`} style={left}>
            <span className={styles.kick}>02 · КОМОРА · ТЕ, ЩО Є</span>
            <div className={`${styles.glass} ${styles.pantry} ${styles.swL}`}>
              {PANTRY.map((r) => {
                const usedNow = done;
                return (
                  <div key={r.n} className={styles['pantry-row']} style={{ background: hi && !done ? 'rgba(246,239,224,.1)' : 'transparent' }}>
                    <span className={styles.mono} style={{ color: r.zc, width: 12 }}>{r.z}</span>
                    <div>
                      <span style={{ color: usedNow ? DIM : CREAM }}>{r.n}</span>
                      <span className={styles.mono}>{usedNow ? r.used : r.q}</span>
                    </div>
                    <span className={styles.mono} style={{ color: usedNow ? AMBER : r.tc }}>{usedNow ? 'СПИСАНО' : r.t}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 03 пропозиція */}
          <div className={`${styles.frag} ${styles['f-prop']} ${on(2)}`} style={right(10)}>
            <span className={styles.kick}>03 · ПРОПОЗИЦІЯ · З ТОГО, ЩО Є</span>
            <div className={`${styles.glass} ${styles.prop} ${styles.swR}`}>
              <div className={styles['prop-head']}><span className={styles.mono}>ПРОПОЗИЦІЯ</span><span className={styles.mono}>20 ХВ</span></div>
              <div className={styles['prop-title']}>Паста з помідорами й фуетом</div>
              <div className={styles['prop-head']}><span className={styles.mono}>≈ 540 ккал · Б 22 · Ж 18 · В 68</span><span className={styles.mono}>НА ПОРЦІЮ</span></div>
              <div className={styles.chips}>
                <span className={styles['chip-amber']}>◷ помідори · сезон · 3 дні</span>
                <span>фует</span><span>спагеті</span><span>пармезан</span>
              </div>
              <div className={styles['prop-note']}>Помідори вже третій день чекають свого моменту. Схоже, він настав.</div>
            </div>
          </div>

          {/* 04 після вечері */}
          <div className={`${styles.frag} ${styles['f-after']} ${on(3)}`} style={right(14)}>
            <span className={styles.kick}>04 · СПИСАННЯ · ПІСЛЯ ВЕЧЕРІ</span>
            <div className={`${styles.glass} ${styles.after} ${styles.swB}`}>
              <span className={styles['after-num']}>8 з 8</span>
              <div><span>з комори · списано 4 партії</span><span className={styles.mono}>помідори 400 → 0 · фует 160 → 60</span></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
