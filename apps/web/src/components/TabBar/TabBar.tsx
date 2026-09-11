import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo/Logo';
import { api, type SessionInfo } from '../../api';
import { dayLabel } from '../ChatHead/SessionsMenu';
import { usePantryFacts } from '../../store/pantryFacts';
import { useAuth } from '../../store/auth';
import { useSessionStore } from '../../store/session';
import { usePantryStore } from '../../store/pantry';
import { RollingNumber } from '../RollingNumber/RollingNumber';
import styles from './TabBar.module.css';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import { useNavStore } from '../../store/nav';

// Правка №1: підпис сесії в сайдбарі — «дата · час · запит». Дата/час із
// created_at, запит — назва сесії (перша репліка або назва рецепта).
/* Рядок розмови всюди один (G1): назва + стан другим рядком; день — у групі. */
function sessionLabel(s: SessionInfo): { when: string; title: string } {
  const d = new Date(s.created_at);
  const when = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
let shoppingCountCache: { value: number; at: number } | null = null;
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
  const pantryFacts = usePantryFacts(pathname);

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
  // 6b-6: у сайдбарі й барі ціль зветься «Чат» (Prototype nav, Responsive R1–R3).
  const tabs: TabDef[] = [
    { path: '/app', icon: 'sys.chat', label: 'Чат' },
    { path: '/pantry', icon: 'sys.pantry', label: 'Комора' },
    { path: '/recipes', icon: 'sys.recipes', label: 'Рецепти' },
    { path: '/list', icon: 'sys.list', label: 'Список', badge: shoppingCount ?? shopCount ?? undefined },
    { path: '/calendar', icon: 'sys.calendar', label: 'Календар' },
  ];

  const initial = (meName?.trim()[0] ?? '·').toUpperCase();
  // Рядок профілю (Prototype nav): імʼя · «дім «Назва» · N» — дім і кількість
  // їдців із /v1/me; на 390 (R3) — «дім · N · профіль».
  const household = useAuth((s) => s.me?.household ?? null);
  const homeLine = household
    ? `дім «${household.name}» · ${household.members.length}`
    : null;

  // Правка №1: сесії — у сайдбарі (тільки десктоп: блок схований у мобільній
  // верстці CSS-ом, як brand/user). Список оновлюється, коли Feed сіпає
  // version (нове повідомлення дало назву, нова сесія, тощо).
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const version = useSessionStore((s) => s.version);
  const [sessions, setSessions] = useState<(SessionInfo & { message_count: number })[]>([]);
  useEffect(() => {
    api.session.list()
      .then(({ sessions: all }) => setSessions(all.filter((s) => s.message_count > 0).slice(0, 6)))
      .catch(() => {/* сайдбар без сесій — не трагедія */});
  }, [version, pathname]);

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
    <div className={`${styles.wrap} ${open ? styles.open : ''}`} data-nav>
      {/* Д01: знак + вордмарк угорі сайдбара. На мобільному приховано. */}
      <div className={styles.brand}>
        {/* Prototype nav: логотип у рейці теж розгортає (30, коло). Кнопка
            «панель» (R1: одна на всі три контейнери) стоїть під логотипом у
            рейці й праворуч від вордмарка в сайдбарі/шухляді. */}
        <button type="button" className={styles['brand-btn']}
          onClick={() => { if (window.innerWidth >= 1024) toggleExpanded(); else setOpen(!open); }}
          aria-label={expanded || open ? 'Згорнути панель' : 'Розгорнути панель'}
          title={expanded || open ? 'Згорнути' : 'Розгорнути'} data-brand-btn>
          <Logo size={26} />
        </button>
        <span className={styles['brand-name']}>Kitchen<span className={styles['brand-os']}> OS</span></span>
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
      {/* Цілі: у шухляді 390 (R3) їх немає — вони в нижньому барі. */}
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
            {/* Responsive R1: на «Коморі» в рейці — крапка danger, коли щось горить;
                у сайдбарі й шухляді — те саме число праворуч (12/500 danger). */}
            {t.path === '/pantry' && (pantryFacts?.soon ?? 0) > 0 && <span className={styles['tab-dot']} aria-hidden />}
            {t.path === '/pantry' && (pantryFacts?.soon ?? 0) > 0 && <span className={styles['tab-count']}>{pantryFacts!.soon}</span>}
          </button>
        );
      })}

      {/* 6b-5: «ЗАРАЗ» і картка «Готування триває» з сайдбара зняті — один
          факт двічі не показуємо: стан дому тепер у шапці чату (чіпи) і в
          панелі «Дім зараз». Сайдбар = Kitchen OS · цілі · «Розмови · + Нова» ·
          сесії по днях · рядок профілю (Prototype nav). Решта — 6b-6. */}
      <div className={styles.sessions}>
        {/* ≥768: «Розмови · + Нова» (Prototype nav); 390: рядок-картка
            «+ Нова розмова» шавлією (R3) — одна дія, дві форми, перемикає CSS. */}
        <div className={styles['sessions-head']}><span className={styles['sessions-label']}>Розмови</span>
        <button className={styles['session-new']} onClick={newSession}><Icon name="sys.add" size={12} inherit decorative /> Нова</button></div>
        <button className={styles['session-new-row']} onClick={newSession} data-new-session-row>
          <Icon name="sys.add" size={16} inherit decorative /> Нова розмова
        </button>
        {sessions.map((s, i) => {
          const { when, title } = sessionLabel(s);
          const day = dayLabel(s.day);
          const first = i === 0 || sessions[i - 1]!.day !== s.day;
          return (
            <div key={s.id} className={`${styles['session-row']} ${leavingSessions.has(s.id) ? styles['session-leave'] : ''}`}>
              {first && <div className={styles['session-day']}>{day}</div>}
              <button
                className={`${styles.session} ${s.id === activeSessionId ? styles.active : ''}`}
                onClick={() => openSession(s.id)}
                title={`${when} · ${title}`}
              >
                <span className={styles['session-title']}>{title}</span>
                <span className={styles['session-when']}>{when}</span>
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
        <span className={styles['user-text']}>
          <span className={styles['user-name']}>{meName ?? 'Профіль'}</span>
          {homeLine && <span className={styles['user-home']}>{homeLine}<span className={styles['user-home-tail']}> · профіль</span></span>}
        </span>
        {/* Prototype малює settings-2; у словнику такого знака нема, а
            system-знак тягне запис у спільний motion.ts — тож шеврон, як у R3. */}
        <Icon name="sys.next" size={16} inherit decorative className={styles['user-chev']} />
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
              <span className={styles['bar-label']}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
