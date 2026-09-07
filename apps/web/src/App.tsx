import { useEffect } from 'react';
import { startTracking } from './lib/track';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Landing } from './pages/Landing/Landing';
import { MagicLinkSent } from './pages/MagicLinkSent/MagicLinkSent';
import { Feed } from './pages/Feed/Feed';
import { PantryPage } from './pages/Pantry/Pantry';
import { ShoppingPage } from './pages/Shopping/Shopping';
import { ProfileRoute } from './pages/Profile/ProfileRoute';
import { RecipePage } from './pages/Recipe/Recipe';
import { CookOverlay } from './pages/Cook/Cook';
import { useCookStore } from './store/cook';
import { SharePage } from './pages/Share/Share';
import { CookLogPage } from './pages/CookLog/CookLog';
import { RecipesPage } from './pages/Recipes/Recipes';
import { CalendarPage } from './pages/Calendar/Calendar';
import { AdminOccasionsPage } from './pages/Admin/AdminOccasions';
import { PulsePage } from './pages/Admin/Pulse';
import { BoomPage } from './pages/Admin/Boom';
import { SharedRecipePage } from './pages/SharedRecipe/SharedRecipe';
import { InvitePage } from './pages/Invite/Invite';
import { NotFoundPage } from './pages/NotFound/NotFound';
import { OnboardingPage, shouldShowOnboarding, markSeenLocally } from './pages/Onboarding/Onboarding';
import { ErrorBoundary } from './components/ErrorState/ErrorBoundary';
import { captureCrash } from './lib/sentry';
import { ErrorScreen } from './components/ErrorState/ErrorScreen';
import { SERVER_DOWN } from './components/ErrorState/copy';
import { IncidentStrips, useIncidentSink } from './components/ErrorState/IncidentStrips';
import { LinkExpiredPage, LinkConsumedPage } from './pages/LinkGone/LinkGone';
import { useAuth } from './store/auth';
import { TabBar } from './components/TabBar/TabBar';
import { ArtifactPanel } from './components/ArtifactPanel/ArtifactPanel';
import { GlobalCookAlarm } from './lib/cook-watch';

// Пул-7 №6: навігація — спільний каркас, не елемент сторінки. TabBar живе тут
// ОДИН раз (кінець блиманню і повторним фетчам на кожній навігації), сторінки
// рендеряться в Outlet. Обгортка з key=pathname дає перехід розділу
// (crossfade + X10). /share — свідомо поза каркасом.
//
// Списку «мобільних маршрутів» більше немає: нижній бар прибрано, і шухляда
// доступна з кожного екрана каркаса — ділити маршрути на «з навігацією» і
// «без» стало нічим.
function Shell() {
  const { pathname } = useLocation();
  // Онбординг «Семен» — раз, на вході в стрічку. Прапорець у localStorage:
  // це знайомство, а не стан дому, тож нове місце (інший браузер) покаже
  // його ще раз, і це нормально. Глибокі лінки (/recipe/:id) не перехоплює.
  const navigate = useNavigate();
  // Крок О2 (2.2): джерело правди — СЕРВЕР (welcome_seen_at із /v1/me).
  // localStorage лишається кешем: він тільки запамʼятовує «бачив», щоб не
  // ходити зайвий раз, і не має права сказати «бачив» за сервера.
  //
  // Перший захід був `if (!onboardingSeen()) navigate(...)` з безіменною
  // одиницею в localStorage, і на проді це означало: новий акаунт у браузері,
  // де онбординг бачив хтось інший, Семена не отримував узагалі. Тепер кеш
  // іменний — чужа позначка за цю людину не говорить.
  const me = useAuth((s) => s.me);
  useEffect(() => {
    if (pathname !== '/app' || !me) return;
    if (me.user.welcome_seen_at) { markSeenLocally(me.user.id); return; }
    if (shouldShowOnboarding(me)) navigate('/welcome', { replace: true });
  }, [pathname, navigate, me]);
  // Крок Е1: 401/429/офлайн ловляться в api.req і показуються смугою тут —
  // одне місце на всі екрани.
  useIncidentSink();
  // Крок О1а: черга подій поведінки. Живе стільки, скільки відкритий застосунок.
  useEffect(() => startTracking(), []);
  return (
    <>
      <IncidentStrips />
      <div key={pathname} className="screen-view">
        <Outlet />
      </div>
      {/* Після контенту: шухляда fixed, порядок у потоці на неї не впливає,
          але так вона лягає поверх без боротьби зі стековими контекстами. */}
      <TabBar />
      {/* Права панель артефактів — теж каркас (крок 3, 03.09): сторінки лише
          публікують у неї. Раніше жила всередині Стрічки, і на Календарі її
          не існувало — подія на ≥1200 відкривалась шторкою всупереч канвасу. */}
      <ArtifactPanel />
    </>
  );
}

function Boot({ children }: { children: React.ReactNode }) {
  const refresh = useAuth((s) => s.refresh);
  useEffect(() => { void refresh(); }, [refresh]);
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'idle' || status === 'loading') {
    // Тихий стан завантаження: без спінера-на-весь-екран, просто чорне поле.
    // Робимо швидко — /me на локальному стеку відповідає за 20-30 мс.
    return <div style={{ minHeight: '100dvh', background: 'var(--bg-body)' }} />;
  }
  // Крок Е1: сервер не відповів на старті — це НЕ «ти гість». До цього такий
  // випадок мовчки вів на лендинг, і людина бачила рекламу продукту, у який
  // вона вже зайшла.
  if (status === 'error') {
    return (
      <ErrorScreen
        kicker={SERVER_DOWN.kicker}
        h1a={SERVER_DOWN.h1a}
        h1b={SERVER_DOWN.h1b}
        body={SERVER_DOWN.body}
        cta={SERVER_DOWN.cta}
        onCta={() => void useAuth.getState().refresh()}
      />
    );
  }
  if (status !== 'signed_in') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const loc = useLocation();
  if (status === 'signed_in') {
    // Якщо гість прийшов з розшареного лінка й тепер залогінений — повертаємо на нього.
    // ?next мусить бути внутрішнім шляхом, щоб не міг стати open-redirect на зовнішній хост.
    const params = new URLSearchParams(loc.search);
    const next = params.get('next');
    const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
    return <Navigate to={safe} replace />;
  }
  return <>{children}</>;
}

function CookHost() {
  // Пул-3: Cook Mode — поп-ап поверх будь-якого екрана. key скидає стан
  // кроків/таймера, коли відкривають ІНШЕ готування.
  const args = useCookStore((s) => s.args);
  if (!args) return null;
  return <CookOverlay key={`${args.recipeId ?? args.recipe.t}:${args.startAt ?? 0}`} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Boot>
        {/* Крок О1б: місце під код інциденту, залишене в Е1, тепер заповнене.
            captureCrash повертає вісім знаків event id — той самий, що людина
            бачить чипом на екрані падіння й може продиктувати. */}
        <ErrorBoundary onError={(e, info) => captureCrash(e, info.componentStack)}>
        <Routes>
          <Route path="/" element={<RedirectIfSignedIn><Landing /></RedirectIfSignedIn>} />
          <Route path="/sent" element={<RedirectIfSignedIn><MagicLinkSent /></RedirectIfSignedIn>} />
          <Route element={<RequireAuth><Shell /></RequireAuth>}>
            <Route path="/app" element={<Feed />} />
            <Route path="/pantry" element={<PantryPage />} />
            <Route path="/list" element={<ShoppingPage />} />
            <Route path="/profile" element={<ProfileRoute />} />
            <Route path="/recipe" element={<RecipePage />} />
            {/* Р-3: стабільна адреса — рецепт більше не живе тільки в router state. */}
            <Route path="/recipe/:id" element={<RecipePage />} />
            <Route path="/cooklog" element={<CookLogPage />} />
            <Route path="/recipes" element={<RecipesPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/admin/occasions" element={<AdminOccasionsPage />} />
            {/* Крок О1: пульс дня. Як і приводи — тільки прямим посиланням. */}
            <Route path="/admin/pulse" element={<PulsePage />} />
            {/* Крок О1: димовий тест символікації. Падає навмисно — ловить
                ErrorBoundary вище. Ніде в навігації не показаний. */}
            <Route path="/admin/boom" element={<BoomPage />} />
          </Route>
          <Route path="/share" element={<RequireAuth><SharePage /></RequireAuth>} />
          {/* Знайомство з Семеном — поза каркасом: без табів і панелі, як /share. */}
          <Route path="/welcome" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          <Route path="/r/:id" element={<SharedRecipePage />} />
          <Route path="/invite" element={<InvitePage />} />
          {/* Крок Е1: сервер веде сюди браузер на 410 — щоб людина побачила
              екран, а не сирий JSON. Два різні: «запізнився» і «вже спрацював»
              це різні новини, і друга взагалі не про помилку. */}
          <Route path="/link/expired" element={<LinkExpiredPage />} />
          <Route path="/link/consumed" element={<LinkConsumedPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </ErrorBoundary>
        <CookHost />
        {/* Пул-7 №1: таймер, що вибіг поза Cook Mode, дзвонить звідусіль. */}
        <GlobalCookAlarm />
      </Boot>
    </BrowserRouter>
  );
}
