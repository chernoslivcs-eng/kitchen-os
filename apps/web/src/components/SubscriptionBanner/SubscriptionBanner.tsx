// Постановка 2026-09-25 (режим без підписки), Task 11: рядок над табами —
// `trial` (≤3 дні), `cancelled`, `past_due`, `lapsed`; в `active`/`beta` і
// без рядка підписки — нічого (banner: null). Текст і кнопка приходять
// готовими з `/v1/me` (bannerFor у @kitchen/domain/paywall) — клієнт нічого
// не рахує сам, лише малює.
import { Link } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import styles from './SubscriptionBanner.module.css';

export function SubscriptionBanner() {
  const banner = useAuth((s) => s.me?.subscription?.banner ?? null);
  // past_due — єдиний тривожний стан (бурштин); решта — тон продукту.
  const pastDue = useAuth((s) => s.me?.subscription?.state === 'past_due');
  if (!banner) return null;
  return (
    <div className={`${styles.bar} ${pastDue ? styles.amber : ''}`} role="status">
      <span className={styles.text}>{banner.text}</span>
      {banner.to && (
        <Link to={banner.to} className={styles.cta}>{banner.cta ?? 'Продовжити'}</Link>
      )}
    </div>
  );
}
