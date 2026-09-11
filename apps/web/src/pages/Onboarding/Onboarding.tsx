// Онбординг «Семен»: 11 карток, одна на екран, назад / далі / свайп /
// ← →. Етап 11 — вигляд за «Kitchen OS - Onboarding.dc.html»: копі дослівно з
// масиву ONB у Prototype (рядок із «*» — ремарка Семена, шавлієвий рядок
// бабла). Показується раз після першого входу; «Пропустити» і фінальна кнопка
// ведуть у стрічку і запамʼятовують, що бачив (логіка без змін).
//
// Дві розкладки одного стану (кадри «Онбординг · Семен» і «Онбординг · 390»):
// ≥1024 — ілюстрація ліворуч, текст праворуч, прогрес рисками в шапці;
// нижче — колонка: текст → бабл → ілюстрація → кнопки внизу на всю ширину,
// прогрес — смуга під шапкою. Крок памʼятається в kos-onb-step (як у бандлі).
//
// №37: знайомство — кроки 12–18 того самого потоку (Prototype «Картки
// знайомства»): та сама шапка з рисками, сцена як у Семена, замість бабла —
// поле «Мене звати …» з лічильником і підказка Семена шавлією; низ «← ·
// Пропустити · Далі →». Що і куди пишеться — як у картці в стрічці:
// PATCH /v1/profile/:key текстом, «Нічого такого» на алергіях — status none,
// «Пропустити» лишає поле порожнім і нічого не пише.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProfileFieldV2 } from '../../api';
import { PROFILE_ROWS } from '../../lib/profile-copy';
import { useAuth } from '../../store/auth';
import { track } from '../../lib/track';
import styles from './Onboarding.module.css';
import { Icon } from '../../components/Icon/Icon';

export const ONBOARDING_SEEN_KEY = 'kos-onboarding-seen';

/**
 * Крок О2 (2.2): кеш ІМЕННИЙ. Раніше тут лежала одиниця — «в цьому браузері
 * онбординг бачили», без уточнення хто. Через це новий акаунт у браузері, де
 * Семена бачив хтось інший, його не отримував узагалі: чужа одиниця
 * перебивала сервер.
 *
 * Тепер кеш каже, ХТО бачив, і тому не може говорити за іншу людину. Роль у
 * нього лишилась одна — прикрити щілину між «людина щойно закрила онбординг»
 * і «сервер це підтвердив»: meSeen() і refresh() летять слідом, і без кешу
 * стрічка встигла б відкинути її назад на /welcome.
 *
 * Стара одиниця з попередніх версій ні з ким не збігається — тобто просто
 * перестає діяти, і це правильно: приписати її комусь ми не можемо.
 */
export function onboardingSeen(userId: string): boolean {
  try { return !!userId && localStorage.getItem(ONBOARDING_SEEN_KEY) === userId; } catch { return false; }
}
export function markSeenLocally(userId: string) {
  try { localStorage.setItem(ONBOARDING_SEEN_KEY, userId); } catch { /* приватний режим — покажемо ще раз, не біда */ }
}
/**
 * Крок О2 (2.2): одне правило, за яким вирішується, чи показувати знайомство.
 * Живе тут, а не в каркасі, бо це рішення продукту, а не навігації: сервер
 * каже, чи людина його бачила; кеш має право лише підтвердити «щойно бачила»
 * для ТІЄЇ САМОЇ людини, поки /v1/me ще не перечитався.
 */
export function shouldShowOnboarding(me: { user: { id: string; welcome_seen_at?: string | null } }): boolean {
  if (me.user.welcome_seen_at) return false;
  return !onboardingSeen(me.user.id);
}

// Крок 7: позначка — на сервері (welcome_seen_at), локально — кеш.
function markSeen(userId: string) {
  markSeenLocally(userId);
  void api.meSeen().then(() => useAuth.getState().refresh()).catch(() => { /* мережа — локальний кеш прикриє до наступного разу */ });
}

interface Card { tag: string; title: string; lines: string[] }

// Копі — дослівно з масиву ONB у Prototype (renderVals). Рядок із «*» — ремарка
// Семена: окремий рядок бабла шавлією, 500; їх може бути два поспіль («Я знав.» / «Майже.»).
const CARDS: Card[] = [
  { tag: 'Знайомство', title: 'Привіт, я Семен', lines: ['Я користуюсь Kitchen OS. Покажу, як.', 'Я не дуже організований, тому мені подобається, що тут не треба вести кухню як бухгалтерію.', '*Зараз би ще згадати, навіщо я відкрив холодильник.'] },
  { tag: 'Додати продукти', title: 'Я просто кажу, що зʼявилось удома', lines: ['Можна сфотографувати полицю, кинути чек, написати списком або надиктувати.', 'Я зазвичай пишу.', '*Голосом швидше, але тоді треба розмовляти.'] },
  { tag: 'Комора', title: 'Далі воно саме складається в комору', lines: ['Написав: «помідори, яйця, пармезан і якась ковбаса».', 'Kitchen OS розібрав, що я мав на увазі, і показав перед тим, як записати.', 'Ковбаса, до речі, була фуетом.', '*Я знав.', '*Майже.'] },
  { tag: 'Що готувати', title: 'Потім я питаю, що з цього зробити', lines: ['Раніше було навпаки: знаходжу рецепт — і виявляється, що вдома немає половини продуктів.', 'Тепер спочатку моя кухня, потім рецепт.', '*Так значно менше шансів о 20:40 урочисто йти по вершки.'] },
  { tag: 'Що варто використати', title: 'Іноді відповідь уже лежить у холодильнику', lines: ['Якщо помідори лежать давно або щось уже відкрите, Kitchen OS врахує це першим.', 'Тому «що сьогодні?» іноді означає:', '«Семене, в тебе знову є справа до цих помідорів».', '*Ми обоє знаємо, про які.'] },
  { tag: 'Алергія, смаки, обмеження', title: 'Він ще памʼятає, що зі мною краще не робити', lines: ['У мене алергія на фундук.', 'А кінзу я просто не люблю.', 'Це різні речі.', '*Одне — не пропонувати взагалі. Друге — можна запропонувати, якщо дуже хочеться посваритися.'] },
  { tag: 'Мама', title: 'Потім приїжджає мама', lines: ['І привозить «трохи домашньої цибулі».', '«Трохи» в маминій системі вимірювання — це пакет, який треба нести двома руками.', '*Я просто додаю її в комору, і якийсь час Kitchen OS дуже добре розуміє, що нам усім тепер треба більше цибулі.'] },
  { tag: 'Дім', title: 'Кухня в нас спільна', lines: ['Якщо хтось купив молоко — я це бачу.', 'Якщо я використав останнє — бачать усі.', 'Так ми перестали купувати третю гірчицю.', '*Другу, на жаль, ніхто не зміг пояснити.'] },
  { tag: 'Особистий контекст', title: 'Але всі в цьому домі їдять по-різному', lines: ['Мама любить цибулю.', 'Я не їм фундук.', 'Хтось інший не любить гостре.', 'Продукти в нас спільні. Смаки — ні.', '*Це дуже корисно, коли троє людей дивляться на одну каструлю з трьома різними очікуваннями.'] },
  { tag: 'Після готування', title: 'Після вечері я нічого не переписую', lines: ['Підтверджую, що приготував — залишки оновлюються.', 'А якщо щось вийшло не так, просто пишу:', '«наступного разу менше перцю».', '*Деякі мої кулінарні помилки тепер мають довготривалу практичну цінність.'] },
  { tag: 'Фінал', title: 'От і весь мій метод', lines: ['Я повідомляю, що зʼявилось.', 'Kitchen OS памʼятає, що залишилось.', 'А коли я не знаю, що готувати, він уже знає достатньо, щоб допомогти.', '*Значно більше, ніж я.'] },
];

const pad = (n: number) => String(n).padStart(2, '0');
/** Потік один: 11 карток Семена + 7 карток знайомства = 18 кроків (0–17). */
const SEMEN = CARDS.length;
const TOTAL = SEMEN + PROFILE_ROWS.length;
const len = (t: string) => Array.from(t).length;
const DESKTOP = '(min-width: 1024px)';
/** Крок памʼятається між заходами, як у бандлі (kos-onb-step). */
const STEP_KEY = 'kos-onb-step';
const readStep = (): number => { try { const v = parseInt(localStorage.getItem(STEP_KEY) || '0', 10); return isNaN(v) ? 0 : Math.min(TOTAL - 1, Math.max(0, v)); } catch { return 0; } };

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

/** Бабл Семена: репліки, потім ремарки («*») шавлією — як у бандлі (body · punch). */
function Bubble({ lines }: { lines: string[] }) {
  const body = lines.filter((l) => !l.startsWith('*'));
  const punch = lines.filter((l) => l.startsWith('*')).map((l) => l.slice(1));
  return (
    <div className={styles.bubble}>
      <div className={styles.lines}>{body.map((l) => <p key={l}>{l}</p>)}</div>
      {punch.map((l) => <p key={l} className={styles.punch}>{l}</p>)}
    </div>
  );
}

function Mark() {
  return <span className={styles.mark} aria-hidden="true"><span /></span>;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(readStep);
  const [dir, setDir] = useState<'f' | 'b'>('f');
  const desktop = useMedia(DESKTOP);
  const intake = step >= SEMEN;
  const last = step === TOTAL - 1;
  const card = CARDS[Math.min(step, SEMEN - 1)]!;
  const row = intake ? PROFILE_ROWS[step - SEMEN]! : null;

  // Знайомство: те, що вже є в профілі, показуємо в полі; чернетки — локально.
  const [fields, setFields] = useState<Record<string, ProfileFieldV2> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    api.profileV2.get().then((r) => setFields(r.fields)).catch(() => setFields(null));
  }, []);
  const draftOf = (k: string) => drafts[k] ?? (fields?.[k]?.status === 'filled' ? fields[k]!.text : '');
  useEffect(() => { if (intake) inputRef.current?.focus({ preventScroll: true }); }, [step, intake]);

  const go = (n: number, d: 'f' | 'b') => {
    if (n < 0 || n >= TOTAL) return;
    try { localStorage.setItem(STEP_KEY, String(n)); } catch { /* приватний режим */ }
    setDir(d); setStep(n);
  };

  /**
   * Крок А1: знайомство — перше, що бачить нова людина, і досі воно не
   * лишало по собі жодного сліду. Де саме людина закриває Семена (на другій
   * картці чи на десятій) — питання, яке їй не поставиш.
   *
   * У props тільки номер: правило 0029 — назв продуктів і вмісту комори в
   * подіях не буває. Тут їх і нема чому взятися, але правило те саме.
   */
  useEffect(() => { track('welcome_started'); }, []);
  useEffect(() => {
    if (!intake) track('welcome_card_reached', { card: step + 1 });
    else track('onboarding_panel_reached', { panel: step - SEMEN + 1 });
  }, [step, intake]);
  // Перша картка знайомства — «почав»; раз за потік.
  const intakeStarted = useRef(false);
  useEffect(() => { if (intake && !intakeStarted.current) { intakeStarted.current = true; track('onboarding_started'); } }, [intake]);

  const finish = (how: 'finished' | 'skipped') => {
    // «Пропустити» в шапці і «Готово» ведуть в одне місце, але значать
    // протилежне: одна людина дочитала, друга — ні. Розрізняємо.
    if (how === 'finished') { track('onboarding_finished'); track('welcome_finished'); }
    else track('welcome_skipped', { card: step + 1 });
    markSeen(useAuth.getState().me?.user.id ?? '');
    navigate('/app', { replace: true });
  };

  /** «Далі» на картці знайомства: є текст — записати; порожньо на алергіях — «нічого такого»; порожньо деінде — пропуск. */
  async function intakeNext() {
    if (!row || busy) return;
    const text = draftOf(row.k).trim();
    setBusy(true);
    try {
      if (text) {
        const r = await api.profileV2.patchField(row.k, { text });
        setFields((f) => ({ ...(f ?? {}), [row.k]: r.field }));
      } else if (row.k === 'ban') {
        const r = await api.profileV2.patchField(row.k, { status: 'none' });
        setFields((f) => ({ ...(f ?? {}), [row.k]: r.field }));
      } else {
        track('onboarding_skipped', { panel: step - SEMEN + 1 });
      }
    } catch { /* лишаємось на картці — людина повторить */ setBusy(false); return; }
    setBusy(false);
    if (last) finish('finished'); else go(step + 1, 'f');
  }
  /** «Пропустити» на картці знайомства — лишає поле порожнім, нічого не пише. */
  function intakeSkip() {
    if (!row) return;
    track('onboarding_skipped', { panel: step - SEMEN + 1 });
    if (last) finish('finished'); else go(step + 1, 'f');
  }

  // Свайп: поріг 50px, як у канвасі. На картці знайомства — лише поза полем.
  const tx = useRef(0);
  const onTS = (e: React.TouchEvent) => { tx.current = e.touches[0]!.clientX; };
  const onTE = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('input')) return;
    const d = e.changedTouches[0]!.clientX - tx.current;
    if (d < -50 && !intake) go(step + 1, 'f');
    if (d > 50) go(step - 1, 'b');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' && !intake) go(step + 1, 'f');
      if (e.key === 'ArrowLeft') go(step - 1, 'b');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Наступна ілюстрація підвантажується наперед, щоб картка не входила порожньою.
  useEffect(() => {
    if (last) return;
    const img = new Image();
    img.src = step + 1 < SEMEN ? `/onboarding/semen-${pad(step + 2)}.png` : `/onboarding/profile-${PROFILE_ROWS[step + 1 - SEMEN]!.k}.png`;
  }, [step, last]);

  const illSrc = intake ? `/onboarding/profile-${row!.k}.png` : `/onboarding/semen-${pad(step + 1)}.png`;
  const progress = (
    <div className={styles.progress} aria-hidden="true">
      {Array.from({ length: TOTAL }, (_, i) => <button key={i} type="button" tabIndex={-1} className={`${styles.dot} ${i <= step ? styles.dotOn : ''} ${i === step ? styles.dotCur : ''}`} onClick={() => go(i, i > step ? 'f' : 'b')} />)}
    </div>
  );
  const meta = intake
    ? <div className={styles.meta}><span className={styles.num}>{pad(step - SEMEN + 1)}</span><span className={styles.of}>/ {PROFILE_ROWS.length}</span><span className={styles.sep} /><span className={styles.tag}>Знайомство</span></div>
    : <div className={styles.meta}><span className={styles.num}>{pad(step + 1)}</span><span className={styles.of}>/ {SEMEN}</span><span className={styles.sep} /><span className={styles.tag}>{card.tag}</span></div>;
  const n = row ? len(draftOf(row.k)) : 0;
  const atLimit = !!row && n >= row.max;
  const field = row && (
    <div className={styles.fieldBlock}>
      <span className={row.danger ? styles.startDanger : styles.start}>{row.danger && <Icon name="cook.ban" size={12} inherit decorative />}{row.start}</span>
      <input
        ref={inputRef} className={styles.input} type="text" value={draftOf(row.k)} placeholder={row.ph} maxLength={row.max} spellCheck={false}
        aria-label={row.start} data-intake-input
        onChange={(e) => setDrafts((d) => ({ ...d, [row.k]: e.target.value }))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void intakeNext(); } }}
      />
      <div className={styles.fieldRow}><span className={styles.hint}>{row.hint}</span><span className={`${styles.counter} ${atLimit ? styles.counterLimit : ''}`} data-counter>{atLimit ? row.lim : `${n}/${row.max}`}</span></div>
    </div>
  );
  const controls = (
    <div className={styles.controls}>
      <button type="button" className={styles.prev} onClick={() => go(step - 1, 'b')} disabled={step === 0} aria-label="Назад"><Icon name="sys.back" size={18} inherit decorative /></button>
      {intake && <button type="button" className={styles.skipStep} onClick={intakeSkip} disabled={busy} data-intake-skip>Пропустити</button>}
      {intake
        ? <button type="button" className={styles.next} onClick={() => void intakeNext()} disabled={busy} data-intake-next>{last ? 'Готово' : 'Далі'}<Icon name="sys.next" size={16} inherit decorative /></button>
        : <button type="button" className={styles.next} onClick={() => go(step + 1, 'f')}>Далі<Icon name="sys.next" size={16} inherit decorative /></button>}
    </div>
  );
  const anim = dir === 'b' ? styles.back : styles.in;
  const head = (
    <header className={styles.head}>
      <span className={styles.logo}><Mark /><span className={styles.logoText}>Kitchen OS</span></span>
      <div className={styles.headRight}>
        {desktop && progress}
        <button type="button" className={styles.skip} onClick={() => finish('skipped')}>Пропустити</button>
      </div>
    </header>
  );
  const text = intake
    ? <><h1 className={styles.title}>{row!.card}</h1><p className={styles.sub}>{row!.body}</p>{field}</>
    : <><h1 className={styles.title}>{card.title}</h1><Bubble lines={card.lines} /></>;

  if (desktop) {
    return (
      <div className={`${styles.page} ${styles.desk}`} data-onb-step={step + 1}>
        {head}
        <main className={styles.main}>
          <div className={styles.grid}>
            <div key={`ill-${step}`} className={`${styles.ill} ${anim}`}><img src={illSrc} alt="" /></div>
            <div className={styles.text}>
              {meta}
              <div key={step} className={`${styles.textBlock} ${anim}`}>{text}</div>
              {controls}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${styles.mob}`} onTouchStart={onTS} onTouchEnd={onTE} data-onb-step={step + 1}>
      {head}
      {progress}
      <div className={styles.col}>
        {meta}
        <div key={step} className={`${styles.colBlock} ${anim}`}>{text}</div>
        <div key={`ill-${step}`} className={`${styles.ill} ${anim}`}><img src={illSrc} alt="" /></div>
      </div>
      {controls}
    </div>
  );
}
