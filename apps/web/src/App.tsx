import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SignIn } from './pages/SignIn/SignIn';
import { MagicLinkSent } from './pages/MagicLinkSent/MagicLinkSent';
import { Feed } from './pages/Feed/Feed';
import { PantryPage } from './pages/Pantry/Pantry';
import { ShoppingPage } from './pages/Shopping/Shopping';
import { ProfilePage } from './pages/Profile/Profile';
import { RecipePage } from './pages/Recipe/Recipe';
import { CookPage } from './pages/Cook/Cook';
import { SharePage } from './pages/Share/Share';
import { CookLogPage } from './pages/CookLog/CookLog';
import { RecipesPage } from './pages/Recipes/Recipes';
import { SharedRecipePage } from './pages/SharedRecipe/SharedRecipe';
import { NotFoundPage } from './pages/NotFound/NotFound';
import { useAuth } from './store/auth';

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

export function App() {
  return (
    <BrowserRouter>
      <Boot>
        <Routes>
          <Route path="/" element={<RedirectIfSignedIn><SignIn /></RedirectIfSignedIn>} />
          <Route path="/sent" element={<RedirectIfSignedIn><MagicLinkSent /></RedirectIfSignedIn>} />
          <Route path="/app" element={<RequireAuth><Feed /></RequireAuth>} />
          <Route path="/pantry" element={<RequireAuth><PantryPage /></RequireAuth>} />
          <Route path="/list" element={<RequireAuth><ShoppingPage /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="/recipe" element={<RequireAuth><RecipePage /></RequireAuth>} />
          {/* Р-3: стабільна адреса — рецепт більше не живе тільки в router state. */}
          <Route path="/recipe/:id" element={<RequireAuth><RecipePage /></RequireAuth>} />
          <Route path="/cook" element={<RequireAuth><CookPage /></RequireAuth>} />
          <Route path="/share" element={<RequireAuth><SharePage /></RequireAuth>} />
          <Route path="/cooklog" element={<RequireAuth><CookLogPage /></RequireAuth>} />
          <Route path="/recipes" element={<RequireAuth><RecipesPage /></RequireAuth>} />
          <Route path="/r/:id" element={<SharedRecipePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Boot>
    </BrowserRouter>
  );
}
