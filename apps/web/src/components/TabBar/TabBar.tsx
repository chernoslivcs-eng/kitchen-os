import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo/Logo';
import { api, type SessionInfo, type NowItem } from '../../api';
import { toneOfNow, nowWhen, nowEmptyKind, nowEmptyText } from '../../lib/period';
import { isSoon, hasScale } from '@kitchen/domain/shelf-thresholds';
import { useAuth } from '../../store/auth';
import { useSessionStore } from '../../store/session';
import { usePantryStore } from '../../store/pantry';
import { RollingNumber } from '../RollingNumber/RollingNumber';
import { loadCookSession, type CookSession } from '../../lib/cook-session';
import { CookCountdown } from '../../lib/cook-watch';
import styles from './TabBar.module.css';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import { useCookStore } from '../../store/cook';
import { useNavStore } from '../../store/nav';

// Правка №1: підпис сесії в сайдбарі — «дата · час · запит». Дата/час із
// created_at, запит — назва сесії (перша репліка або назва рецепта).
function sessionLabel(s: SessionInfo): { when: string; title: string } {
  const d = new Date(s.created_at);
  const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { when, title: s.title ?? 'без назви' };
}

interface TabDef {
  path: string;
  icon: IconName;
  label: string;
  badge?: number;
}

interface Props {
  shoppingCount?: number;
}

// Пул-7 №6: TabBar живе в каркасі й сам знає лічильник списку.
let pantryFactsCache: { value: { count: number; soon: number }; at: number } | null = null;
let shoppingCountCache: { value: number; at: number } | null = null;
// «ЗАРАЗ» — той самий патерн кешу: блок живе в каркасі й не мусить смикати
// календар на кожну навігацію.
let nowCache: { value: NowItem[]; at: number } | null = null;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * П2: «Зараз» — з GET /v1/now (приводи крізь підписку і записи дому одним
 * контрактом), до трьох активних; суворе — першим, далі за кінцем. Дієта в
 * тому ж ряду, що сезон.
 */
export function pickNow(items: NowItem[]): NowItem[] {
  return [...items].sort((a, b) => Number(b.strict) - Number(a.strict) || a.to.localeCompare(b.to)).slice(0, 3);
}

export function TabBar({ shoppingCount }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const open = useNavStore((s) => s.open);
  const setOpen = useNavStore((s) => s.setOpen);

  // Після вибору цілі шухляда йде геть, а «де я» лишається в заголовку шапки:
  // без нижнього бара він єдиний індикатор екрана.
  useEffect(() => { setOpen(false); }, [pathname, setOpen]);
  // Етап 6a: рейка 60 ⇄ сайдбар 256 (≥1024). Клас на <body> зсуває контент
  // (tokens.css); сам стан — у сторі й localStorage.
  const expanded = useNavStore((s) => s.expanded);
  const toggleExpanded = useNavStore((s) => s.toggleExpanded);
  useEffect(() => {
    document.body.classList.toggle('nav-expanded', expanded);
    return () => document.body.classList.remove('nav-expanded');
  }, [expanded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  const meName = useAuth((s) => s.me?.user?.name ?? null);
  // Пул-5 №5: bump від Feed (apply/undo картки) скидає кеш — бейдж списку
  // оновлюється одразу, а не за 60с чи по зміні маршруту.
  const pantryVersion = usePantryStore((s) => s.version);

  // Блок «ЗАРАЗ»: горизонт 21 день — той самий, що в контексті промпта.
  const [nowEvents, setNowEvents] = useState<NowItem[]>(nowCache?.value ?? []);
  // Моушн-кіт §03: картка, що пішла з «ЗАРАЗ», згортається 250ms exit, а не
  // зникає між двома фетчами; нова входить base/enter (див. .now-row).
  const [leavingNow, setLeavingNow] = useState<Set<string>>(new Set());
  const nowRef = useRef<NowItem[]>(nowEvents);
  nowRef.current = nowEvents;
  const nowKey = (e: NowItem) => `${e.occasion_id ?? e.id}:${e.from}`;
  useEffect(() => {
    if (nowCache && Date.now() - nowCache.at < 60_000) return;
    api.events.now()
      .then(({ now }) => {
        const picked = pickNow(now);
        nowCache = { value: picked, at: Date.now() };
        const next = new Set(picked.map(nowKey));
        const gone = nowRef.current.map(nowKey).filter((k) => !next.has(k));
        if (!gone.length) { setNowEvents(picked); return; }
        setLeavingNow(new Set(gone));
        window.setTimeout(() => { setNowEvents(picked); setLeavingNow(new Set()); }, 250);
      })
      .catch(() => {/* навігація без подій — не трагедія */});
  }, [pathname]);

  // Пул-7 №6: лічильник списку — свій фетч (сторінки більше не передають);
  // bump від pantryStore слугує загальним сигналом «лічильники змінились».
  const [shopCount, setShopCount] = useState<number | null>(shoppingCountCache?.value ?? null);
  useEffect(() => {
    if (pantryVersion === 0 && shoppingCountCache && Date.now() - shoppingCountCache.at < 60_000) return;
    api.shopping.list()
      .then(({ count }) => {
        shoppingCountCache = { value: count, at: Date.now() };
        setShopCount(count);
      })
      .catch(() => {/* тихо */});
  }, [pathname, pantryVersion]);

  // Етап 4 (Components · «Дім зараз» · «Порожні стани · різні слова»): три
  // порожнечі — три різні речі, і всі три реальні просто зараз:
  //   «Нічого не горить. N позицій у порядку.»  — комора є, горіти нема чому;
  //   «Комора порожня — розкажи, що є вдома.»    — позицій нуль;
  //   «Зараз нічого не триває. …»                — подій немає.
  // Доти блок просто не малювався, коли подій нуль, — і всі три звучали як
  // мовчання. Для першого й другого блок має знати комору.
  const [pantryFacts, setPantryFacts] = useState<{ count: number; soon: number } | null>(pantryFactsCache?.value ?? null);
  useEffect(() => {
    if (pantryVersion === 0 && pantryFactsCache && Date.now() - pantryFactsCache.at < 60_000) return;
    api.pantry()
      .then(({ count, batches }) => {
        const soon = batches.filter((b) => isSoon(b.days) && hasScale(b.catalog_key)).length;
        pantryFactsCache = { value: { count, soon }, at: Date.now() };
        setPantryFacts({ count, soon });
      })
      .catch(() => {/* тихо */});
  }, [pathname, pantryVersion]);

  // На десктопі таб-бар стає sidebar-ом ліворуч. Ставимо клас на <body> щоб
  // головні screens зсунулись праворуч (див. tokens.css). Знімаємо при
  // unmount — Cook/Share/SignIn сайдбара не мають.
  useEffect(() => {
    document.body.classList.add('with-sidebar');
    return () => document.body.classList.remove('with-sidebar');
  }, []);

  // Бриф-2 п.2: чотири таби — канон. Профіль живе аватаром у шапці екранів
  // (на десктопі — блоком унизу сайдбара, Д01), журнал сесій — сегментом
  // «Історія» в Стрічці, журнал готувань — лінком із Рецептів.
  // Пʼять цілей. Календар — рішення 03.09; знак «коли», а не сітка: сітка
  // читалась би як місячний вид, якого в продукті немає.
  //
  // Етап 1.5: текстові гліфи ◉ ▤ ❋ ☰ ◷ замінені знаками зі словника
  // (components/Icon/icons.ts). Канон забороняє гліфи-символи в ролі знаків,
  // і аудит їх лічить. «Комора» — `boxes`, не `refrigerator`: холодильник
  // належить ЗОНІ холодильника, а комора як місце — це склад речей.
  //
  // Лічильники Комори й Рецептів зняті. «Комора 23» — число, що знецінює себе
  // за тиждень, і продукт уже раз таке викинув зі звіту дня. Бейдж лишається
  // лише на Списку й лише коли є непозначене: це дія, а не рахунок.
  const tabs: TabDef[] = [
    { path: '/app', icon: 'sys.chat', label: 'Стрічка' },
    { path: '/pantry', icon: 'sys.pantry', label: 'Комора' },
    { path: '/recipes', icon: 'sys.recipes', label: 'Рецепти' },
    { path: '/list', icon: 'sys.list', label: 'Список', badge: shoppingCount ?? shopCount ?? undefined },
    { path: '/calendar', icon: 'sys.calendar', label: 'Календар' },
  ];

  const initial = (meName?.trim()[0] ?? '·').toUpperCase();

  // Правка №1: сесії — у сайдбарі (тільки десктоп: блок схований у мобільній
  // верстці CSS-ом, як brand/user). Список оновлюється, коли Feed сіпає
  // version (нове повідомлення дало назву, нова сесія, тощо).
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const cookOpen = useCookStore((s) => s.open);
  const cookArgs = useCookStore((s) => s.args);
  const version = useSessionStore((s) => s.version);
  const [sessions, setSessions] = useState<(SessionInfo & { message_count: number })[]>([]);
  useEffect(() => {
    api.session.list()
      .then(({ sessions: all }) => setSessions(all.filter((s) => s.message_count > 0).slice(0, 6)))
      .catch(() => {/* сайдбар без сесій — не трагедія */});
  }, [version, pathname]);

  // Пул-2 №2: «Готування триває» живе в сайдбарі над сесіями (десктоп).
  // Перечитуємо на зміні маршруту й поверненні фокуса — готування могло
  // завершитись в іншій вкладці.
  const [cookLive, setCookLive] = useState<CookSession | null>(() => loadCookSession());
  useEffect(() => {
    setCookLive(loadCookSession());
    const onVis = () => setCookLive(loadCookSession());
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onVis);
      document.removeEventListener('visibilitychange', onVis);
    };
    // cookArgs: поп-ап відкрили/закрили без навігації — фрейм мусить ожити одразу.
  }, [pathname, cookArgs]);

  function openSession(id: string) {
    navigate('/app', { state: { sessionId: id, at: Date.now() } });
  }
  function newSession() {
    navigate('/app', { state: { freshSession: true, at: Date.now() } });
  }
  function openArchive() {
    navigate('/app', { state: { openHistory: true, at: Date.now() } });
  }
  // Пул-4 №1: видалення сесії. Активна видалена → свіжа сесія.
  // Моушн-кіт §03: рядок розмови згортається 250ms exit перед тим, як зникнути.
  const [leavingSessions, setLeavingSessions] = useState<Set<string>>(new Set());
  async function removeSession(e: React.MouseEvent, id: string, title: string | null) {
    e.stopPropagation();
    if (!confirm(`Видалити розмову${title ? ` «${title}»` : ''}? Сам чат зникне, але приготовані страви лишаться в журналі.`)) return;
    setLeavingSessions((prev) => new Set(prev).add(id));
    try {
      await Promise.all([api.session.remove(id), new Promise<void>((res) => window.setTimeout(res, 250))]);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setLeavingSessions((prev) => { const n = new Set(prev); n.delete(id); return n; });
      if (id === activeSessionId) navigate('/app', { state: { freshSession: true, at: Date.now() } });
    } catch {/* тихо: рядок лишиться, повторний тап спробує ще */}
  }

  return (
    <>
      {/* Бекдроп існує лише під шухлядою (<768). Вище навігація стоїть
          постійно, і затемнювати нема чого. */}
      <div
        className={`${styles.backdrop} ${open ? styles['backdrop-on'] : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
    <div className={`${styles.wrap} ${open ? styles.open : ''}`}>
      {/* Д01: знак + вордмарк угорі сайдбара. На мобільному приховано. */}
      <div className={styles.brand}>
        <Logo size={26} />
        <span className={styles['brand-name']}>Kitchen OS</span>
        {/* Одна кнопка «панель» на всі контейнери (Responsive R1): у рейці
            ≥1024 розгортає сайдбар, у сайдбарі — згортає; у рейці 768–1023
            розсуває шухляду; у шухляді — закриває її. */}
        <button type="button" className={styles['panel-btn']}
          onClick={() => { if (window.innerWidth >= 1024) toggleExpanded(); else setOpen(!open); }}
          aria-label={expanded || open ? 'Згорнути панель' : 'Розгорнути панель'}
          title={expanded || open ? 'Згорнути' : 'Розгорнути'} data-panel-btn>
          <Icon name={expanded || open ? 'sys.collapse' : 'sys.expand'} size={18} inherit decorative />
        </button>
      </div>

      {/* Крок С1: усе між брендом і профілем — одна скрольована стрічка.
          Раніше скрол мав лише блок сесій, а цілі, «ЗАРАЗ» і роздільник були
          прибиті до колонки. На короткому екрані (ноут 13" з вікном на пів
          висоти, шухляда з відкритою клавіатурою) три активні події з'їдали
          висоту, і список сесій стискався до одного рядка або зникав — до
          історії було не дістатись жодним способом.
          Бренд лишається вгорі, профіль унизу: вони справді закріплені.
          «Історія →» за макетом іде в кінці списку, отже всередині скролу. */}
      <div className={styles.scroll} data-nav-scroll>
      {tabs.map((t) => {
        const active = pathname === t.path;
        return (
          <button
            key={t.path}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            onClick={() => navigate(t.path)}
            title={t.label}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={t.icon} size={18} decorative className={styles.glyph} />
            <span>{t.label}</span>
            {t.badge != null && t.badge > 0 && <span className={styles.badge}><RollingNumber value={t.badge} /></span>}
            {/* Responsive R1: на «Коморі» в рейці — крапка danger, коли щось горить. */}
            {t.path === '/pantry' && (pantryFacts?.soon ?? 0) > 0 && <span className={styles['tab-dot']} aria-hidden />}
          </button>
        );
      })}

      {/* «ЗАРАЗ» — одразу під цілями, над «Готування триває» (рішення 03.09).
          Подія, що триває, називається кінцем: «ще 4 тижні», не «триває». */}
      {/* Етап 4: «Дім зараз» — блок є ЗАВЖДИ. Порожнеча тут не наслідок, а
          головний стан на сьогодні, і в неї три різні слова (див. вище). */}
      <div className={styles.now} data-now-state={nowEvents.length ? 'events' : nowEmptyKind(pantryFacts)}>
        <div className={styles['now-label']}>ЗАРАЗ</div>
        {nowEvents.length === 0 && <div className={styles['now-empty']}>{nowEmptyText(pantryFacts)}</div>}
        {nowEvents.map((e) => (
          <button
            key={nowKey(e)}
            type="button"
            className={`${styles['now-row']} ${styles[`t-${toneOfNow(e)}`]} ${leavingNow.has(nowKey(e)) ? styles['now-leave'] : ''}`}
            onClick={() => navigate('/calendar')}
            title={e.rule_text ?? e.meaning ?? e.title}
          >
            <span className={styles['now-dot']} aria-hidden />
            <span className={styles['now-text']}>
              <span className={styles['now-title']}>{e.title}</span>
              {/* Три позначки за PLAN §5: джерело — знак 11 px; орієнтовно — «≈»
                  перед часом (у nowWhen); суворо — сливова заливка, не слово в
                  рядку. Час — кінцем і тижнями, як у бандлі. */}
              <span className={styles['now-when']}>
                <Icon name={e.source === 'catalog' ? 'sys.tradition' : e.source === 'chat' ? 'sys.chat' : 'live.byHand'} size={12} inherit decorative />
                {nowWhen(e) ?? 'триває'}
                {e.strict && <span className={styles['now-strict']}>суворо</span>}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Правка №1: сесії — частина навігації. Нова сесія → останні → архів. */}
      <div className={styles.sessions}>
        <div className={styles['sessions-divider']} />
        {/* Пул-2 №2: фрейм «Готування триває» — над сесіями. */}
        {cookLive && (
          <button
            className={styles['cook-live']}
            onClick={() => cookOpen({
              recipe: cookLive.recipe,
              recipeId: cookLive.recipeId,
              returnSessionId: cookLive.returnSessionId ?? activeSessionId,
            })}
          >
            <span className={styles['cook-live-dot']} aria-hidden />
            <span className={styles['cook-live-text']}>
              <span className={styles['cook-live-title']}>{cookLive.recipe.t}</span>
              <span className={styles['cook-live-meta']}>
                крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)}/{cookLive.recipe.st.length}
                <CookCountdown deadline={cookLive.deadline} /> · продовжити ›
              </span>
            </span>
          </button>
        )}
        <button className={styles['session-new']} onClick={newSession}>+ Нова розмова</button>
        {sessions.map((s) => {
          const { when, title } = sessionLabel(s);
          return (
            <div key={s.id} className={`${styles['session-row']} ${leavingSessions.has(s.id) ? styles['session-leave'] : ''}`}>
              <button
                className={`${styles.session} ${s.id === activeSessionId ? styles.active : ''}`}
                onClick={() => openSession(s.id)}
                title={`${when} · ${title}`}
              >
                <span className={styles['session-when']}>{when}</span>
                <span className={styles['session-title']}>{title}</span>
              </button>
              <button
                className={styles['session-x']}
                aria-label={`Видалити розмову «${title}»`}
                onClick={(e) => void removeSession(e, s.id, s.title)}
              ><Icon name="sys.close" size={16} inherit /></button>
            </div>
          );
        })}
        {sessions.length > 0 && (
          <button className={styles['session-archive']} onClick={openArchive}>Історія →</button>
        )}
      </div>
      </div>

      {/* Д01: блок користувача внизу; активний, коли відкрито профіль.
          Спейсера тут більше немає: висоту забирає скрольований блок вище
          (flex: 1), і другий flex-жадібний сусід ділив би вільне місце з ним
          навпіл — половина колонки лишалась би порожньою. */}
      <button
        className={`${styles.user} ${pathname === '/profile' ? styles.active : ''}`}
        onClick={() => navigate('/profile')}
      >
        <span className={styles['user-avatar']}>{initial}</span>
        <span>{meName ?? 'Профіль'}</span>
      </button>
    </div>
      {/* Етап 6a, Screens D5 · 390: нижній бар із пʼяти цілей (закриває ⚠6).
          Ховається, поки композитор у фокусі й поки відкрита шторка —
          обидві умови з HANDOFF, класами на <body>. */}
      <nav className={styles.bar} aria-label="Розділи" data-tab-bar>
        {tabs.map((t) => {
          const active = pathname === t.path;
          return (
            <button key={t.path} type="button" className={`${styles['bar-tab']} ${active ? styles.active : ''}`}
              onClick={() => navigate(t.path)} aria-current={active ? 'page' : undefined}>
              <span className={styles['bar-glyph']}>
                <Icon name={t.icon} size={20} inherit decorative />
                {t.badge != null && t.badge > 0 && <span className={styles['bar-badge']}>{t.badge}</span>}
              </span>
              <span className={styles['bar-label']}>{t.label === 'Стрічка' ? 'Чат' : t.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
