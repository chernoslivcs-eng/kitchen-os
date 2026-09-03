// Онбординг «Семен»: 11 карток-коміксів, одна на екран, назад / далі /
// свайп, прогрес рисками зверху. Тексти й порядок — з канвасу
// «Онбординг - Семен». Показується раз після першого входу; «Пропустити»
// і фінальна кнопка ведуть у стрічку і запамʼятовують, що бачив.
//
// Дві розкладки одного стану (канвас О1 і О3): до 1280 — телефонна колонка,
// від 1280 — картка розгорнута горизонтально (текст 400 ліворуч, ілюстрація
// праворуч на сірій підложці), сусідні картки визирають з боків по 180px.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Onboarding.module.css';

export const ONBOARDING_SEEN_KEY = 'kos-onboarding-seen';

export function onboardingSeen(): boolean {
  try { return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1'; } catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(ONBOARDING_SEEN_KEY, '1'); } catch { /* приватний режим — покажемо ще раз, не біда */ }
}

interface Card { tag: string; title: string; lines: string[] }

// Повний текст Пилипа (04.09), канвас мав скорочений. Рядок із «*» —
// панчлайн: курсив і шавлія; їх може бути два поспіль («Я знав.» / «Майже.»).
const CARDS: Card[] = [
  { tag: 'ЗНАЙОМСТВО', title: 'Привіт, я Семен', lines: ['Я користуюсь Kitchen OS. Покажу, як.', 'Я не дуже організований, тому мені подобається, що тут не треба вести кухню як бухгалтерію.', '*Зараз би ще згадати, навіщо я відкрив холодильник.'] },
  { tag: 'ДОДАТИ ПРОДУКТИ', title: 'Я просто кажу, що зʼявилось удома', lines: ['Можна сфотографувати полицю, кинути чек, написати списком або надиктувати.', 'Я зазвичай пишу.', '*Голосом швидше, але тоді треба розмовляти.'] },
  { tag: 'КОМОРА', title: 'Далі воно саме складається в комору', lines: ['Написав: «помідори, яйця, пармезан і якась ковбаса».', 'Kitchen OS розібрав, що я мав на увазі, і показав перед тим, як записати.', 'Ковбаса, до речі, була фуетом.', '*Я знав.', '*Майже.'] },
  { tag: 'ЩО ГОТУВАТИ', title: 'Потім я питаю, що з цього зробити', lines: ['Раніше було навпаки: знаходжу рецепт — і виявляється, що вдома немає половини продуктів.', 'Тепер спочатку моя кухня, потім рецепт.', '*Так значно менше шансів о 20:40 урочисто йти по вершки.'] },
  { tag: 'ЩО ВАРТО ВИКОРИСТАТИ', title: 'Іноді відповідь уже лежить у холодильнику', lines: ['Якщо помідори лежать давно або щось уже відкрите, Kitchen OS врахує це першим.', 'Тому «що сьогодні?» іноді означає:', '«Семене, в тебе знову є справа до цих помідорів».', '*Ми обоє знаємо, про які.'] },
  { tag: 'АЛЕРГІЯ, СМАКИ, ОБМЕЖЕННЯ', title: 'Він ще памʼятає, що зі мною краще не робити', lines: ['У мене алергія на фундук.', 'А кінзу я просто не люблю.', 'Це різні речі.', '*Одне — не пропонувати взагалі. Друге — можна запропонувати, якщо дуже хочеться посваритися.'] },
  { tag: 'МАМА', title: 'Потім приїжджає мама', lines: ['І привозить «трохи домашньої цибулі».', '«Трохи» в маминій системі вимірювання — це пакет, який треба нести двома руками.', '*Я просто додаю її в комору, і якийсь час Kitchen OS дуже добре розуміє, що нам усім тепер треба більше цибулі.'] },
  { tag: 'ДІМ', title: 'Кухня в нас спільна', lines: ['Якщо хтось купив молоко — я це бачу.', 'Якщо я використав останнє — бачать усі.', 'Так ми перестали купувати третю гірчицю.', '*Другу, на жаль, ніхто не зміг пояснити.'] },
  { tag: 'ОСОБИСТИЙ КОНТЕКСТ', title: 'Але всі в цьому домі їдять по-різному', lines: ['Мама любить цибулю.', 'Я не їм фундук.', 'Хтось інший не любить гостре.', 'Продукти в нас спільні. Смаки — ні.', '*Це дуже корисно, коли троє людей дивляться на одну каструлю з трьома різними очікуваннями.'] },
  { tag: 'ПІСЛЯ ГОТУВАННЯ', title: 'Після вечері я нічого не переписую', lines: ['Підтверджую, що приготував — залишки оновлюються.', 'А якщо щось вийшло не так, просто пишу:', '«наступного разу менше перцю».', '*Деякі мої кулінарні помилки тепер мають довготривалу практичну цінність.'] },
  { tag: 'ФІНАЛ', title: 'От і весь мій метод', lines: ['Я повідомляю, що зʼявилось.', 'Kitchen OS памʼятає, що залишилось.', 'А коли я не знаю, що готувати, він уже знає достатньо, щоб допомогти.', '*Значно більше, ніж я.'] },
];

const pad = (n: number) => String(n).padStart(2, '0');
const DESKTOP = '(min-width: 1280px)';

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <div className={styles.lines}>
      {lines.map((l) => (
        l.startsWith('*')
          ? <p key={l} className={styles.punch}>{l.slice(1)}</p>
          : <p key={l}>{l}</p>
      ))}
    </div>
  );
}

function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke="#1d2126" strokeWidth="3" strokeLinecap="round" strokeDasharray="104 15" transform="rotate(-58 24 24)" />
      <circle cx="24" cy="24" r="6" fill="#58754e" />
    </svg>
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<'f' | 'b'>('f');
  const last = step === CARDS.length - 1;
  const card = CARDS[step]!;
  const desktop = useMedia(DESKTOP);

  const go = (n: number, d: 'f' | 'b') => {
    if (n < 0 || n >= CARDS.length) return;
    setDir(d); setStep(n);
  };
  const finish = () => { markSeen(); navigate('/app', { replace: true }); };

  // Свайп: поріг 50px, як у канвасі.
  const tx = useRef(0);
  const onTS = (e: React.TouchEvent) => { tx.current = e.touches[0]!.clientX; };
  const onTE = (e: React.TouchEvent) => {
    const d = e.changedTouches[0]!.clientX - tx.current;
    if (d < -50) go(step + 1, 'f');
    if (d > 50) go(step - 1, 'b');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(step + 1, 'f');
      if (e.key === 'ArrowLeft') go(step - 1, 'b');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Наступна ілюстрація підвантажується наперед, щоб картка не входила порожньою.
  useEffect(() => {
    if (last) return;
    const img = new Image();
    img.src = `/onboarding/semen-${pad(step + 2)}.png`;
  }, [step, last]);

  const progress = (
    <div className={styles.progress} aria-hidden="true">
      {CARDS.map((_, i) => <span key={i} className={i <= step ? styles.on : ''} />)}
    </div>
  );
  const controls = (
    <div className={styles.controls}>
      <button type="button" className={styles.prev} onClick={() => go(step - 1, 'b')} disabled={step === 0} aria-label="Назад">←</button>
      <button type="button" className={`${styles.next} ${last ? styles['next-final'] : ''}`} onClick={() => (last ? finish() : go(step + 1, 'f'))}>
        {last ? 'Почати з того, що є' : 'Далі'}
      </button>
    </div>
  );
  const anim = dir === 'b' ? styles.back : styles.in;

  if (desktop) {
    const prevCard = step > 0 ? CARDS[step - 1] : null;
    const nextCard = !last ? CARDS[step + 1] : null;
    return (
      <div className={styles.desk}>
        <div className={styles['desk-head']}>
          <div className={styles.logo}><Mark size={26} /><span>Kitchen<em> OS</em></span></div>
          <div className={styles['desk-head-right']}>
            {progress}
            <button type="button" className={styles.skip} onClick={finish}>Пропустити</button>
          </div>
        </div>
        <div className={styles.strip}>
          {/* Сусідні картки — приглушені, клік гортає. Порожня — на краях стрічки. */}
          <button type="button" className={`${styles.side} ${styles['side-prev']} ${prevCard ? '' : styles['side-empty']}`} onClick={() => go(step - 1, 'b')} disabled={!prevCard} aria-label="Попередня картка">
            {prevCard && (<>
              <div className={styles['side-text']}><span className={styles['side-num']}>{pad(step)} / {pad(CARDS.length)}</span><div className={styles['side-title']}>{prevCard.title}</div></div>
              <div className={styles['side-ill']}><img src={`/onboarding/semen-${pad(step)}.png`} alt="" /></div>
            </>)}
          </button>
          <div key={step} className={`${styles['desk-card']} ${anim}`}>
            <div className={styles['desk-text']}>
              <div className={styles['desk-meta']}><span className={styles.num}>{pad(step + 1)} / {pad(CARDS.length)}</span><span className={styles.tag}>{card.tag}</span></div>
              <h1 className={styles['desk-title']}>{card.title}</h1>
              <Lines lines={card.lines} />
              {controls}
            </div>
            <div className={styles['desk-ill']}><img src={`/onboarding/semen-${pad(step + 1)}.png`} alt="" /></div>
          </div>
          <button type="button" className={`${styles.side} ${styles['side-next']} ${nextCard ? '' : styles['side-empty']}`} onClick={() => go(step + 1, 'f')} disabled={!nextCard} aria-label="Наступна картка">
            {nextCard && (<>
              <div className={styles['side-text']}><span className={styles['side-num']}>{pad(step + 2)} / {pad(CARDS.length)}</span><div className={styles['side-title']}>{nextCard.title}</div></div>
              <div className={styles['side-ill']}><img src={`/onboarding/semen-${pad(step + 2)}.png`} alt="" /></div>
            </>)}
          </button>
        </div>
        <div className={styles['desk-hint']}>← → НА КЛАВІАТУРІ · КЛІК ПО СУСІДНІЙ КАРТЦІ</div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.phone} onTouchStart={onTS} onTouchEnd={onTE}>
        <div className={styles.head}>
          <div className={styles.logo}><Mark /><span>Kitchen<em> OS</em></span></div>
          <button type="button" className={styles.skip} onClick={finish}>Пропустити</button>
        </div>
        {progress}
        <div className={styles['card-wrap']}>
          <div key={step} className={`${styles.card} ${anim}`}>
            <div className={styles['card-head']}>
              <span className={styles.num}>{pad(step + 1)} / {pad(CARDS.length)}</span>
              <span className={styles.tag}>{card.tag}</span>
            </div>
            <div className={styles.body}>
              <h1 className={styles.title}>{card.title}</h1>
              <Lines lines={card.lines} />
            </div>
            <div className={styles.ill}>
              <img src={`/onboarding/semen-${pad(step + 1)}.png`} alt="" />
            </div>
          </div>
        </div>
        {controls}
      </div>
    </div>
  );
}
