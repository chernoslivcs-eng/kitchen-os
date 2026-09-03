import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Landing } from './pages/Landing/Landing';
import { MagicLinkSent } from './pages/MagicLinkSent/MagicLinkSent';
import { Feed } from './pages/Feed/Feed';
import { PantryPage } from './pages/Pantry/Pantry';
import { ShoppingPage } from './pages/Shopping/Shopping';
import { ProfilePage } from './pages/Profile/Profile';
import { RecipePage } from './pages/Recipe/Recipe';
import { CookOverlay } from './pages/Cook/Cook';
import { useCookStore } from './store/cook';
import { SharePage } from './pages/Share/Share';
import { CookLogPage } from './pages/CookLog/CookLog';
import { RecipesPage } from './pages/Recipes/Recipes';
import { CalendarPage } from './pages/Calendar/Calendar';
import { AdminOccasionsPage } from './pages/Admin/AdminOccasions';
import { SharedRecipePage } from './pages/SharedRecipe/SharedRecipe';
import { InvitePage } from './pages/Invite/Invite';
import { NotFoundPage } from './pages/NotFound/NotFound';
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
  return (
    <>
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
        <Routes>
          <Route path="/" element={<RedirectIfSignedIn><Landing /></RedirectIfSignedIn>} />
          <Route path="/sent" element={<RedirectIfSignedIn><MagicLinkSent /></RedirectIfSignedIn>} />
          <Route element={<RequireAuth><Shell /></RequireAuth>}>
            <Route path="/app" element={<Feed />} />
            <Route path="/pantry" element={<PantryPage />} />
            <Route path="/list" element={<ShoppingPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/recipe" element={<RecipePage />} />
            {/* Р-3: стабільна адреса — рецепт більше не живе тільки в router state. */}
            <Route path="/recipe/:id" element={<RecipePage />} />
            <Route path="/cooklog" element={<CookLogPage />} />
            <Route path="/recipes" element={<RecipesPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/admin/occasions" element={<AdminOccasionsPage />} />
          </Route>
          <Route path="/share" element={<RequireAuth><SharePage /></RequireAuth>} />
          <Route path="/r/:id" element={<SharedRecipePage />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <CookHost />
        {/* Пул-7 №1: таймер, що вибіг поза Cook Mode, дзвонить звідусіль. */}
        <GlobalCookAlarm />
      </Boot>
    </BrowserRouter>
  );
}
