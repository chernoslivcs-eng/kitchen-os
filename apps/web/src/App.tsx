import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SignIn } from './pages/SignIn/SignIn';
import { MagicLinkSent } from './pages/MagicLinkSent/MagicLinkSent';
import { Feed } from './pages/Feed/Feed';
import { PantryPage } from './pages/Pantry/Pantry';
import { ShoppingPage } from './pages/Shopping/Shopping';
import { ProfilePage } from './pages/Profile/Profile';
import { RecipePage } from './pages/Recipe/Recipe';
import { CookPage } from './pages/Cook/Cook';
import { SharePage } from './pages/Share/Share';
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
  if (status === 'signed_in') return <Navigate to="/app" replace />;
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
          <Route path="/cook" element={<RequireAuth><CookPage /></RequireAuth>} />
          <Route path="/share" element={<RequireAuth><SharePage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Boot>
    </BrowserRouter>
  );
}
