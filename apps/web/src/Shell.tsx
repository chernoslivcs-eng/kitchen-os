// Каркас застосунку (Shell) — винесено з App.tsx (Мобільний аудит 0912 · A,
// №46): TabBar, панель артефактів, смуги інцидентів і трекінг потрібні лише
// тому, хто ввійшов; гість на лендінгу цей чанк не качає.
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { startTracking } from './lib/track';
import { IncidentStrips, useIncidentSink } from './components/ErrorState/IncidentStrips';
import { shouldShowOnboarding, markSeenLocally } from './pages/Onboarding/seen';
import { useAuth } from './store/auth';
import { TabBar } from './components/TabBar/TabBar';
import { ArtifactPanel } from './components/ArtifactPanel/ArtifactPanel';
import { SubscriptionBanner } from './components/SubscriptionBanner/SubscriptionBanner';
import { Toast, type ToastTone } from './components/ErrorState/Toast';
import { api, ApiError } from './api';
import { getIntent, clearIntent } from './lib/billing-intent';

// Пул-7 №6: навігація — спільний каркас, не елемент сторінки. TabBar живе тут
// ОДИН раз (кінець блиманню і повторним фетчам на кожній навігації), сторінки
// рендеряться в Outlet. Обгортка з key=pathname дає перехід розділу
// (crossfade + X10). /share — свідомо поза каркасом.
//
// Списку «мобільних маршрутів» більше немає: нижній бар прибрано, і шухляда
// доступна з кожного екрана каркаса — ділити маршрути на «з навігацією» і
// «без» стало нічим.
export function Shell() {
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
    if (shouldShowOnboarding(me)) void navigate('/welcome', { replace: true });
  }, [pathname, navigate, me]);
  // Крок Е1: 401/429/офлайн ловляться в api.req і показуються смугою тут —
  // одне місце на всі екрани.
  useIncidentSink();
  // Постановка 2026-09-25 (біллінг LiqPay) §2, §5: людина оформила підписку
  // з лендінга ДО реєстрації (checkout → LiqPay → назад із order_id у
  // localStorage), увійшла — тепер привʼязуємо намір до її дому. Вебхук
  // зазвичай доїжджає раніше за це (result_url), але не завжди — 202
  // означає «ще не прийшов», не помилку: пробуємо ще раз кожні 3 с до 30 с,
  // і якщо й тоді pending — лишаємо ключ (наступний вхід/перезавантаження
  // спробує знову) і кажемо, що чекаємо банк, а не мовчимо.
  const [billingToast, setBillingToast] = useState<{ text: string; tone: ToastTone } | null>(null);
  useEffect(() => {
    if (!me) return;
    const orderId = getIntent();
    if (!orderId) return;
    let cancelled = false;
    let elapsed = 0;
    const tryBind = async () => {
      try {
        const r = await api.billing.bind(orderId);
        if (cancelled) return;
        if ('status' in r && r.status === 'pending') {
          elapsed += 3000;
          if (elapsed >= 30_000) {
            setBillingToast({ text: 'Чекаємо підтвердження від банку — спробуємо ще раз пізніше.', tone: 'amber' });
            return;
          }
          window.setTimeout(() => { if (!cancelled) void tryBind(); }, 3000);
          return;
        }
        clearIntent();
        setBillingToast({ text: 'Підписка привʼязана', tone: 'sage' });
        void navigate('/profile');
      } catch (err) {
        if (cancelled) return;
        if (!(err instanceof ApiError)) return; // мережа впала — ключ лишається, спробуємо на наступному завантаженні
        if (err.status === 410) {
          clearIntent();
          setBillingToast({ text: 'Оформлення застаріло — можна оформити знову в профілі.', tone: 'amber' });
        } else if (err.status === 409) {
          clearIntent();
          const reason = (err.payload as { error?: string } | null)?.error;
          if (reason === 'already_subscribed') setBillingToast({ text: 'У дому вже є підписка.', tone: 'amber' });
          // already_bound — той самий намір уже привʼязано (друга вкладка) — мовчки.
        } else if (err.status === 404) {
          clearIntent(); // застарілий/чужий ключ у localStorage — нема що показувати
        }
        // інші статуси — транзитний збій сервера, ключ лишається на повтор пізніше.
      }
    };
    void tryBind();
    return () => { cancelled = true; };
  }, [me, navigate]);
  // Крок О1а: черга подій поведінки. Живе стільки, скільки відкритий застосунок.
  useEffect(() => startTracking(), []);
  // 6b-5: ⌘K з будь-де (Components «Композитор (⌘K з будь-де)») — з інших
  // екранів веде в стрічку й фокусує композитор; у самій стрічці ловить Feed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && pathname !== '/app') {
        e.preventDefault(); void navigate('/app', { state: { focusComposer: true, at: Date.now() } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathname, navigate]);
  return (
    <>
      {/* Постановка 2026-09-25: рядок стану підписки — над табами, поза
          key={pathname}, щоб не блимав/не перемонтовувався на кожній
          навігації (той самий принцип, що IncidentStrips). */}
      <SubscriptionBanner />
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
      {billingToast && (
        <Toast tone={billingToast.tone} text={billingToast.text} onDismiss={() => setBillingToast(null)} />
      )}
    </>
  );
}
