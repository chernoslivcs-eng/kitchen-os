import { Suspense, useEffect } from 'react';
import { lazyPage } from './lib/lazyPage';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
const Landing = lazyPage(() => import('./pages/Landing/Landing').then((m) => ({ default: m.Landing })));
const MagicLinkSent = lazyPage(() => import('./pages/MagicLinkSent/MagicLinkSent').then((m) => ({ default: m.MagicLinkSent })));
const Feed = lazyPage(() => import('./pages/Feed/Feed').then((m) => ({ default: m.Feed })));
const IconLab = lazyPage(() => import('./pages/Dev/IconLab').then((m) => ({ default: m.IconLab })));
const PantryPage = lazyPage(() => import('./pages/Pantry/Pantry').then((m) => ({ default: m.PantryPage })));
const ShoppingPage = lazyPage(() => import('./pages/Shopping/Shopping').then((m) => ({ default: m.ShoppingPage })));
const ProfileRoute = lazyPage(() => import('./pages/Profile/ProfileRoute').then((m) => ({ default: m.ProfileRoute })));
const RecipePage = lazyPage(() => import('./pages/Recipe/Recipe').then((m) => ({ default: m.RecipePage })));
const CookOverlay = lazyPage(() => import('./pages/Cook/Cook').then((m) => ({ default: m.CookOverlay })));
import { useCookStore } from './store/cook';
const SharePage = lazyPage(() => import('./pages/Share/Share').then((m) => ({ default: m.SharePage })));
const CookLogPage = lazyPage(() => import('./pages/CookLog/CookLog').then((m) => ({ default: m.CookLogPage })));
const RecipesPage = lazyPage(() => import('./pages/Recipes/Recipes').then((m) => ({ default: m.RecipesPage })));
const CalendarPage = lazyPage(() => import('./pages/Calendar/Calendar').then((m) => ({ default: m.CalendarPage })));
const AdminOccasionsPage = lazyPage(() => import('./pages/Admin/AdminOccasions').then((m) => ({ default: m.AdminOccasionsPage })));
const PulsePage = lazyPage(() => import('./pages/Admin/Pulse').then((m) => ({ default: m.PulsePage })));
const BoomPage = lazyPage(() => import('./pages/Admin/Boom').then((m) => ({ default: m.BoomPage })));
const AdminShell = lazyPage(() => import('./pages/Admin/AdminShell').then((m) => ({ default: m.AdminShell })));
const HouseholdsPage = lazyPage(() => import('./pages/Admin/Households').then((m) => ({ default: m.HouseholdsPage })));
const SharedRecipePage = lazyPage(() => import('./pages/SharedRecipe/SharedRecipe').then((m) => ({ default: m.SharedRecipePage })));
const InvitePage = lazyPage(() => import('./pages/Invite/Invite').then((m) => ({ default: m.InvitePage })));
const NotFoundPage = lazyPage(() => import('./pages/NotFound/NotFound').then((m) => ({ default: m.NotFoundPage })));
const OnboardingPage = lazyPage(() => import('./pages/Onboarding/Onboarding').then((m) => ({ default: m.OnboardingPage })));
import { ErrorBoundary } from './components/ErrorState/ErrorBoundary';
import { captureCrash } from './lib/sentry';
import { ErrorScreen } from './components/ErrorState/ErrorScreen';
import { SERVER_DOWN } from './components/ErrorState/copy';
const LinkExpiredPage = lazyPage(() => import('./pages/LinkGone/LinkGone').then((m) => ({ default: m.LinkExpiredPage })));
const LinkConsumedPage = lazyPage(() => import('./pages/LinkGone/LinkGone').then((m) => ({ default: m.LinkConsumedPage })));
import { useAuth } from './store/auth';
import { GlobalCookAlarm } from './lib/cook-watch';

const Shell = lazyPage(() => import('./Shell').then((m) => ({ default: m.Shell })));

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
    return <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />;
  }
  // Крок Е1: сервер не відповів на старті — це НЕ «ти гість». До цього такий
  // випадок мовчки вів на лендинг, і людина бачила рекламу продукту, у який
  // вона вже зайшла.
  if (status === 'error') {
    return (
      <ErrorScreen
        kicker={SERVER_DOWN.kicker}
        tone="amber"
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

const Quiet = () => <div style={{ minHeight: '100dvh', background: 'var(--bg)' }} />;

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
        {/* Мобільний аудит 0912 · A (№46): сторінки — лазі-чанками (lib/lazyPage);
            поки чанк іде — те саме тихе поле, що й у RequireAuth. */}
        <Suspense fallback={<Quiet />}>
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
          </Route>
          {/* Крок А2: адмінка вийшла з каркаса продукту й має власний.
              Навколо адмінських таблиць більше не видно Стрічки й Комори, а
              перевірка доступу стоїть ОДНА — на каркасі, і відмова показує
              справжню 404 продукту. Ніде в навігації продукту не показана. */}
          <Route element={<RequireAuth><AdminShell /></RequireAuth>}>
            <Route path="/admin" element={<HouseholdsPage />} />
            {/* Свій дім — як було; :household_id — вхід у чужий, зі списку. */}
            <Route path="/admin/pulse" element={<PulsePage />} />
            <Route path="/admin/h/:household_id" element={<PulsePage />} />
            <Route path="/admin/occasions" element={<AdminOccasionsPage />} />
            <Route path="/admin/boom" element={<BoomPage />} />
          </Route>
          <Route path="/share" element={<RequireAuth><SharePage /></RequireAuth>} />
          {/* Знайомство з Семеном — поза каркасом: без табів і панелі, як /share. */}
          <Route path="/welcome" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          <Route path="/r/:id" element={<SharedRecipePage />} />
          {/* Лабораторія знаків для запису руху (Р117) — лише в dev-збірці. */}
          {import.meta.env.DEV && <Route path="/dev/icons" element={<IconLab />} />}
          <Route path="/invite" element={<InvitePage />} />
          {/* Крок Е1: сервер веде сюди браузер на 410 — щоб людина побачила
              екран, а не сирий JSON. Два різні: «запізнився» і «вже спрацював»
              це різні новини, і друга взагалі не про помилку. */}
          <Route path="/link/expired" element={<LinkExpiredPage />} />
          <Route path="/link/consumed" element={<LinkConsumedPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
        <Suspense fallback={null}><CookHost /></Suspense>
        {/* Пул-7 №1: таймер, що вибіг поза Cook Mode, дзвонить звідусіль. */}
        <GlobalCookAlarm />
      </Boot>
    </BrowserRouter>
  );
}
