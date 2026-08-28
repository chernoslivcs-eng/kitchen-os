// Плейсхолдер стрічки — щоб редирект після /auth/verify мав куди йти.
// Повноцінна стрічка (04 Стрічка з брифу) — наступний коміт.

import { Logo } from '../../components/Logo/Logo';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { Button } from '../../components/Button/Button';
import { useAuth } from '../../store/auth';

export function Feed() {
  const me = useAuth((s) => s.me);
  const logout = useAuth((s) => s.logout);

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg-surface)',
      display: 'flex',
      flexDirection: 'column',
      padding: '26px 26px 26px',
      gap: 24,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo variant="wordmark" size={38} />
        <Button variant="secondary" onClick={() => logout()}>Вийти</Button>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MonoLabel>ЗАЙШОВ · {me?.household.role.toUpperCase() ?? ''}</MonoLabel>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: 'var(--tracking-tight)' }}>
          {me?.household.name}
        </div>
        <div style={{ color: 'var(--fg-muted)' }}>
          {me?.household.members.length ?? 0} учасник(ів)
        </div>
      </div>
      <div style={{
        marginTop: 24,
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--r-xl)',
        padding: 20,
        color: 'var(--fg-muted)',
        fontSize: 14,
        lineHeight: 1.55,
      }}>
        Тут з’явиться стрічка з чатом, коморою і пропозиціями — наступним кроком за брифом (04 Стрічка).
      </div>
    </div>
  );
}
