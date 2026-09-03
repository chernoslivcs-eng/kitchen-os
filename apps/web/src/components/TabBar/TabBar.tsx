import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo/Logo';
import { api, type SessionInfo, type EventOccurrence } from '../../api';
import { whenLabel, isLive } from '../../lib/when';
import { bubblesToNow } from '../../lib/spans';
import { useAuth } from '../../store/auth';
import { useSessionStore } from '../../store/session';
import { usePantryStore } from '../../store/pantry';
import { RollingNumber } from '../RollingNumber/RollingNumber';
import { loadCookSession, type CookSession } from '../../lib/cook-session';
import { CookCountdown } from '../../lib/cook-watch';
import styles from './TabBar.module.css';
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
  glyph: string;
  label: string;
  badge?: number;
}

interface Props {
  shoppingCount?: number;
}

// Пул-7 №6: TabBar живе в каркасі й сам знає лічильник списку.
let shoppingCountCache: { value: number; at: number } | null = null;
// «ЗАРАЗ» — той самий патерн кешу: блок живе в каркасі й не мусить смикати
// календар на кожну навігацію.
let nowCache: { value: EventOccurrence[]; at: number } | null = null;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Дві події для блоку: спершу те, що триває (і закінчується раніше), потім
 * найближче попереду. Більше двох — це вже календар, а не натяк.
 *
 * Тривала подія підіймається сюди лише краями — перший день і останні три.
 * Піст на 48 днів не мовчить у «ЗАРАЗ» тільки двічі: на вході й на виході.
 * Середина нічого не змінює, і нагадувати про неї щодня означало б знецінити
 * блок так само, як його свого часу знецінили лічильники у звіті дня.
 */
export function pickNow(events: EventOccurrence[], now = Date.now()): EventOccurrence[] {
  const live = events
    .filter((e) => isLive(e.start, e.end, now) && bubblesToNow(e, now))
    .sort((a, b) => a.end - b.end);
  const ahead = events.filter((e) => e.start > now).sort((a, b) => a.start - b.start);
  return [...live, ...ahead].slice(0, 2);
}

export function TabBar({ shoppingCount }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const open = useNavStore((s) => s.open);
  const setOpen = useNavStore((s) => s.setOpen);

  // Після вибору цілі шухляда йде геть, а «де я» лишається в заголовку шапки:
  // без нижнього бара він єдиний індикатор екрана.
  useEffect(() => { setOpen(false); }, [pathname, setOpen]);

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
  const [nowEvents, setNowEvents] = useState<EventOccurrence[]>(nowCache?.value ?? []);
  useEffect(() => {
    if (nowCache && Date.now() - nowCache.at < 60_000) return;
    const today = new Date();
    const to = new Date(today.getTime() + 21 * 86_400_000);
    api.events.list(iso(today), iso(to))
      .then(({ events }) => {
        const picked = pickNow(events);
        nowCache = { value: picked, at: Date.now() };
        setNowEvents(picked);
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
  // Пʼять цілей. Календар — рішення 03.09; гліф ◷ («коли»), а не ▦: сітка
  // читалась би як місячний вид, якого в продукті немає.
  //
  // Лічильники Комори й Рецептів зняті. «Комора 23» — число, що знецінює себе
  // за тиждень, і продукт уже раз таке викинув зі звіту дня. Бейдж лишається
  // лише на Списку й лише коли є непозначене: це дія, а не рахунок.
  const tabs: TabDef[] = [
    { path: '/app', glyph: '◉', label: 'Стрічка' },
    { path: '/pantry', glyph: '▤', label: 'Комора' },
    { path: '/recipes', glyph: '❋', label: 'Рецепти' },
    { path: '/list', glyph: '☰', label: 'Список', badge: shoppingCount ?? shopCount ?? undefined },
    { path: '/calendar', glyph: '◷', label: 'Календар' },
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
  async function removeSession(e: React.MouseEvent, id: string, title: string | null) {
    e.stopPropagation();
    if (!confirm(`Видалити сесію${title ? ` «${title}»` : ''}? Розмова зникне; журнал готувань лишиться.`)) return;
    try {
      await api.session.remove(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
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
      </div>

      {tabs.map((t) => {
        const active = pathname === t.path;
        return (
          <button
            key={t.path}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            onClick={() => navigate(t.path)}
          >
            <span className={styles.glyph}>{t.glyph}</span>
            <span>{t.label}</span>
            {t.badge != null && t.badge > 0 && <span className={styles.badge}><RollingNumber value={t.badge} /></span>}
          </button>
        );
      })}

      {/* Смужка 768-1023: крапка стану — єдиний вхід до сесій і «ЗАРАЗ».
          Бурштин — щось чекає попереду, шавлія — триває готування, сірий —
          тихо. Числа тут немає навмисно: воно живе на рядку цілі всередині. */}
      <button
        className={styles['rail-more']}
        onClick={() => setOpen(true)}
        aria-label="Показати сесії та події"
        title={[
          cookLive ? 'Готування триває' : null,
          nowEvents[0]?.title ?? null,
        ].filter(Boolean).join(' · ') || 'Сесії та події'}
      >
        {cookLive || nowEvents.length ? (
          <span className={styles.dots}>
            {nowEvents.length > 0 && <span className={styles['dot-amber']}>◌</span>}
            {cookLive && <span className={styles['dot-sage']}>●</span>}
          </span>
        ) : '⋯'}
      </button>

      {/* «ЗАРАЗ» — одразу під цілями, над «Готування триває» (рішення 03.09).
          Подія, що триває, називається кінцем: «ще 4 тижні», не «триває». */}
      {nowEvents.length > 0 && (
        <div className={styles.now}>
          <div className={styles['now-label']}>ЗАРАЗ</div>
          {nowEvents.map((e) => (
            <button
              key={`${e.scope}:${e.id}:${e.start}`}
              className={styles['now-row']}
              onClick={() => navigate('/calendar')}
              title={e.meaning ?? e.title}
            >
              <span className={styles['now-title']}>{e.title}</span>
              <span className={styles['now-when']}>
                {whenLabel(e.start, e.end)}{e.approx ? ' · орієнтовно' : ''}
              </span>
            </button>
          ))}
        </div>
      )}

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
            <span className={styles['cook-live-dot']}>●</span>
            <span className={styles['cook-live-text']}>
              <span className={styles['cook-live-title']}>{cookLive.recipe.t}</span>
              <span className={styles['cook-live-meta']}>
                крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)}/{cookLive.recipe.st.length}
                <CookCountdown deadline={cookLive.deadline} /> · продовжити ›
              </span>
            </span>
          </button>
        )}
        <button className={styles['session-new']} onClick={newSession}>+ Нова сесія</button>
        {sessions.map((s) => {
          const { when, title } = sessionLabel(s);
          return (
            <div key={s.id} className={styles['session-row']}>
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
                aria-label={`Видалити сесію «${title}»`}
                onClick={(e) => void removeSession(e, s.id, s.title)}
              >✕</button>
            </div>
          );
        })}
        {sessions.length > 0 && (
          <button className={styles['session-archive']} onClick={openArchive}>Історія →</button>
        )}
      </div>

      {/* Д01: спейсер + блок користувача внизу; активний, коли відкрито профіль. */}
      <div className={styles.spacer} />
      <button
        className={`${styles.user} ${pathname === '/profile' ? styles.active : ''}`}
        onClick={() => navigate('/profile')}
      >
        <span className={styles['user-avatar']}>{initial}</span>
        <span>{meName ?? 'Профіль'}</span>
      </button>
    </div>
    </>
  );
}
