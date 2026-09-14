// Шапка чату (6b-5) — за Screens «Чат · збірка» (1440), Responsive G1/G3
// (390: один чіп «Дім ●●● N» → шторка). Без фону: лежить поверх стрічки на
// градієнті bg → прозорий, стрічка йде під неї у фейд.
//
// 14.09 (рішення власника, відгук тестувальниці): шапка розчищена повністю,
// на 390 і 1440. Знято: пілюлю розмови (назва сесії, №22 — «де я» показує
// сайдбар/нижній бар, не шапка), «+ Нова» (дублювала «Нова» в сайдбарі/
// шухляді — TabBar), чіп «Чекають на тебе · N» (§11 від 12.09 — рахунок і
// прокрутка до картки жили лише заради нього й теж прибрані). №22 і §11 у
// FIXES-V3.md позначені скасованими. Лишилось: panel-left (лише <704),
// чіпи стану, «Дім зараз». Зліва — порожньо (крім panel-left на <704),
// чіпи праворуч, без «стрибків» при появі/зникненні чіпів.
//
// Три розкладки за шириною КОНТЕЙНЕРА стрічки, не вʼюпорту (Р38): панель
// артефакта 720 на 1440 лишає стрічці ~440, і там діє правило 390. Пороги —
// ті самі, що у вʼюпортів, мінус рейка: 1024 − 60 = 964, 768 − 64 = 704.
//   ≥964   panel-left (лише <704 видно) · розпірка · чіпи родів ·
//          «Дім зараз · ще N»
//   704…   (R2) розпірка · компактні чіпи 36/13: flame «10» · moon «піст» ·
//          timer «6:32» (знак + найкоротший факт) · «Дім ●●● N» (№27:
//          згорнутий чіп дому лишається, тап — панель; §14 закрито)
//   <704   (G3) panel-left-open · розпірка · «Дім ●●● N»
// Чіпи — по одному на рід і лише коли стан є: danger flame «Прострочено N»,
// plum moon «Піст · до 27 вер», sage timer «Готуємо · таймер». Сезони й свої
// події чіпів не мають — вони тихі рядки панелі «Дім зараз».
import { Icon } from '../Icon/Icon';
import { CookCountdown } from '../../lib/cook-watch';
import { shortDate } from '../../lib/period';
import type { CookSession } from '../../lib/cook-session';
import type { HomeNow } from '../../store/homeNow';
import styles from './ChatHead.module.css';

export interface ChatHeadProps {
  home: HomeNow;
  cookLive: CookSession | null;
  /** panel-left-open — розгорнути сайдбар або шухляду. */
  onAllSessions: () => void;
  onCook: () => void;
  onOverdue: () => void;
  /** Чіп «Дім зараз» / «Дім ●●● N». */
  onHome: () => void;
  homeOpen: boolean;
  /** «· ще N» — рядки панелі без свого чіпа (§13: без свого чіпа). */
  quietCount: number;
  /** Форма за шириною контейнера стрічки (Р38): 'wide' ≥964 · 'mid' 704–963 (R2) · 'narrow' <704 (G3). */
  form: 'wide' | 'mid' | 'narrow';
}

export function ChatHead(p: ChatHeadProps) {
  const kinds: ('danger' | 'plum' | 'sage')[] = [];
  if (p.home.overdue > 0) kinds.push('danger');
  if (p.home.strict) kinds.push('plum');
  if (p.cookLive) kinds.push('sage');

  return (
    <header className={styles.head} data-chat-head data-form={p.form}>
      {/* 390: кнопка «панель» 40 на card — шухляда або сайдбар. Ширше — сайдбар
          стоїть завжди докованим, окремої кнопки в шапці не треба. */}
      <button type="button" className={styles.burger} data-tap onClick={p.onAllSessions} aria-label="Розгорнути панель">
        <Icon name="sys.expand" size={18} inherit decorative />
      </button>

      <span className={styles.gap} />

      {p.home.overdue > 0 && (
        <button type="button" className={`${styles.chip} ${styles['chip-danger']}`} data-tap onClick={p.onOverdue} data-chip-overdue>
          {/* 12.09 (ANSWERS A10): «Прострочено N» — alert-triangle, danger; flame — тільки «Горить». */}
          <Icon name="live.overdue" size={16} inherit decorative />
          <span className={styles.long}>Прострочено </span>{p.home.overdue}
        </button>
      )}
      {p.home.strict && (
        <button type="button" className={`${styles.chip} ${styles['chip-plum']}`} data-tap onClick={p.onHome} data-chip-strict>
          <Icon name="live.fast" size={16} inherit decorative />
          <span className={styles.long}>{p.home.strict.title} · до {shortDate(p.home.strict.to)}</span>
          <span className={styles.short}>{p.home.strict.title.toLocaleLowerCase('uk')}</span>
        </button>
      )}
      {p.cookLive && (
        <button type="button" className={`${styles.chip} ${styles['chip-sage']}`} data-tap onClick={p.onCook} data-chip-cooking>
          {/* Живий стан: timer тікає, поки таймер біжить (1.5b). */}
          <Icon name="cook.timer" size={16} inherit decorative live={p.cookLive.deadline ? 'timer' : undefined} />
          <span className={styles.long}>Готуємо · </span><CookCountdown deadline={p.cookLive.deadline} />
        </button>
      )}

      {/* ≥768: «Дім зараз · ще N»; <768: «Дім ●●● N» — крапки родів активних станів,
          число — скільки їх; при нулі станів (§13) — «Дім · тихо» без крапок і числа. */}
      <button type="button" className={`${styles.chip} ${styles['chip-home']} ${p.homeOpen ? styles['chip-on'] : ''}`} data-tap onClick={p.onHome}
        aria-expanded={p.homeOpen} data-chip-home>
        <Icon name="sys.home" size={16} inherit decorative />
        <span className={styles['home-wide']}>Дім зараз{p.quietCount > 0 && <span className={styles['home-more']}> · ще {p.quietCount}</span>}</span>
        <span className={styles['home-narrow']} data-home-quiet={kinds.length === 0 || undefined}>
          {kinds.length === 0 ? <>Дім<span className={styles['home-more']}> · тихо</span></> : 'Дім'}
          {kinds.length > 0 && (
            <span className={styles.dots} aria-hidden>{kinds.map((k) => <span key={k} className={`${styles.dot} ${styles[`dot-${k}`]}`} />)}</span>
          )}
          {kinds.length > 0 && <span className={styles.count}>{kinds.length}</span>}
        </span>
      </button>
    </header>
  );
}
