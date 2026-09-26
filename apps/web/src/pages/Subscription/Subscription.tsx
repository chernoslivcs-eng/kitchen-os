// Постановка 2026-09-25 (режим без підписки), Task 12 — /profile/subscription:
// єдине місце платіжних дій усередині акаунта (спек §4). Бачать і можуть
// діяти всі члени дому. Шість станів дому: beta (без кнопок, до вимкнення
// прапорця), trial, active, cancelled, past_due, lapsed (дві картки тарифів —
// той самий PlanCard, що на лендінгу, без «Бета-тест»: макет
// (Kitchen OS - Subscription.dc.html) явно показує лише «Для себе»/«Для
// дому» тут, «так само, як на лендінгу» читаємо як «той самий компонент
// картки», не «та сама умова показу бета-картки»).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type Me, type Payment } from '../../api';
import { useAuth } from '../../store/auth';
import { useBreakpoint } from '../../lib/useBreakpoint';
import { PlanCard } from '../../components/PlanCard/PlanCard';
import planCardStyles from '../../components/PlanCard/PlanCard.module.css';
import { Sheet } from '../../components/Sheet/Sheet';
import { Icon } from '../../components/Icon/Icon';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { PLANS } from '../Landing/copy';
import { PLAN_NAME, PLAN_PRICE_UAH } from '@kitchen/domain/plans';
// Глибокий шлях, не барел: барел тягне node:crypto й ламає vite.
import { bankNotice } from '@kitchen/domain/paywall';
import { fmtDate } from './summary';
import styles from './Subscription.module.css';

type Sub = NonNullable<Me['subscription']>;
type Plan = 'self' | 'home';

// Дві картки тарифів у стані lapsed — той самий PlanCard, що на лендінгу,
// без «Бета-тест» (PLANS[0] може бути карткою «Бета-тест», коли BETA_PLAN —
// прибираємо за key, не за прапорцем: тут завжди дім, який уже пройшов повз
// бету, реальний вибір лише між двома тарифами).
const TARIFF_CARDS = PLANS.filter((p) => p.key !== 'beta');

const POLL_MS = 3000;
const POLL_TOTAL_MS = 30_000;

function StatusDot({ tone }: { tone: 'sage' | 'amber' | 'dim' }) {
  return <span className={`${styles.dot} ${styles[`dot-${tone}`]}`} aria-hidden />;
}

/** Верхній рядок стану — тексти дослівно зі спека §4, дата DD.MM (бандл). */
function statusFor(sub: Sub): { tone: 'sage' | 'amber' | 'dim'; title: string } {
  switch (sub.state) {
    case 'beta':
      return { tone: 'sage', title: 'Бета-тест · усе безкоштовно' };
    case 'trial': {
      const price = sub.plan ? PLAN_PRICE_UAH[sub.plan] : null;
      const date = sub.trial_ends_at ? fmtDate(sub.trial_ends_at) : '—';
      return { tone: 'sage', title: price != null ? `Пробний до ${date} · далі ${price} ₴/міс` : `Пробний до ${date}` };
    }
    case 'active': {
      const name = sub.plan ? PLAN_NAME[sub.plan] : '';
      const price = sub.plan ? PLAN_PRICE_UAH[sub.plan] : null;
      const date = sub.next_charge_at ? fmtDate(sub.next_charge_at) : '—';
      return { tone: 'sage', title: price != null ? `${name} · наступне списання ${date}, ${price} ₴` : name };
    }
    case 'cancelled':
      return { tone: 'dim', title: sub.access_until ? `Скасовано · доступ до ${fmtDate(sub.access_until)}` : 'Скасовано' };
    case 'past_due':
      return { tone: 'amber', title: sub.next_charge_at ? `Списання ${fmtDate(sub.next_charge_at)} не пройшло` : 'Останнє списання не пройшло' };
    case 'lapsed': {
      // Дата — з access_until (дійшло через cancelled) або next_charge_at
      // (дійшло через past_due). Дім, який ніколи не мав підписки (нова
      // реєстрація після кінця бети), не має жодної — «закінчилась» тоді
      // не про що казати, лишаємо саму «дані на місці».
      const date = sub.access_until ?? sub.next_charge_at;
      return { tone: 'dim', title: date ? `Підписка закінчилась ${fmtDate(date)} · дані на місці` : 'Дані на місці' };
    }
  }
}

const cardLabel = (m: Payment['status']) => (m === 'success' ? 'сплачено' : 'не пройшло');

export function SubscriptionPage() {
  const bp = useBreakpoint();
  const [searchParams, setSearchParams] = useSearchParams();
  const members = useAuth((s) => s.me?.household.members ?? []);

  const [sub, setSub] = useState<Sub | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sheet, setSheet] = useState<'plan' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.subscription.get();
    setSub(r.subscription);
    setPayments(r.payments);
    return r.subscription;
  }, []);

  // Після checkout (?order=…) — вебхук іноді доганяє пізніше за повернення на
  // сторінку (спек §4/план Task 12): перечитуємо раз на 3с до 30с, поки стан
  // не зміниться, потім прибираємо ?order= незалежно від результату.
  useEffect(() => {
    let cancelled = false;
    const order = searchParams.get('order');
    void (async () => {
      const first = await load();
      if (cancelled || !order) return;
      let elapsed = 0;
      let state = first.state;
      while (!cancelled && elapsed < POLL_TOTAL_MS) {
        await new Promise((r) => window.setTimeout(r, POLL_MS));
        if (cancelled) return;
        const next = await load();
        elapsed += POLL_MS;
        if (next.state !== state) { state = next.state; break; }
      }
      if (!cancelled) setSearchParams((p) => { p.delete('order'); return p; }, { replace: true });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Пробний дає лише НОВЕ оформлення й лише тим, хто його не витрачав. Сервер
  // каже про це `trial_available` (та сама умова, що в checkout), і без цього
  // поля обіцянка про перше списання була б вигадкою.
  const notice = (plan: Plan) => bankNotice(PLAN_PRICE_UAH[plan], sub?.trial_available !== false);

  async function checkout(plan: Plan) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.subscription.checkout(plan);
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError && err.status === 409 ? 'У дому вже є активна підписка.' : 'Не вийшло — спробуй ще раз.');
    }
  }

  async function cancelSubscription() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.subscription.cancel();
      setSub(r.subscription);
      setSheet(null);
    } catch {
      setError('Не вийшло скасувати — спробуй ще раз.');
    } finally {
      setBusy(false);
    }
  }

  async function changePlan(plan: Plan) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.subscription.setPlan(plan);
      setSub(r.subscription);
      setSheet(null);
    } catch {
      setError('Не вийшло змінити тариф — спробуй ще раз.');
    } finally {
      setBusy(false);
    }
  }

  if (!sub) {
    return (
      <div className="screen-view" style={{ padding: 24 }}>
        <SkeletonRows rows={4} />
      </div>
    );
  }

  const status = statusFor(sub);
  const cardMask = (sub.state === 'trial' || sub.state === 'active' || sub.state === 'past_due') && sub.card_mask;

  return (
    <div className={`${styles.page} ${styles[bp]} screen-view`}>
      <header className={styles.head}>
        <Link to="/profile" className={styles.back} data-tap aria-label="Назад до профілю">
          <Icon name="sys.back" size={16} inherit decorative /><span>Профіль</span>
        </Link>
        <h1 className={styles.title}>Підписка</h1>
      </header>

      <div className={styles.statusCard}>
        <div className={styles.statusRow}>
          <StatusDot tone={status.tone} />
          <div className={styles.statusText}>
            <span className={styles.statusTitle}>{status.title}</span>
            {cardMask && (
              <span className={styles.statusSub}><Icon name="sys.card" size={16} inherit decorative />картка •• {cardMask}</span>
            )}
          </div>
        </div>
        {(sub.state === 'trial' || sub.state === 'active' || sub.state === 'cancelled' || sub.state === 'past_due') && (
          <div className={styles.statusActions}>
            {sub.state === 'active' && (
              <button type="button" className={styles.outlineBtn} onClick={() => setSheet('plan')} disabled={busy}>Змінити тариф</button>
            )}
            {(sub.state === 'trial' || sub.state === 'active') && (
              <button type="button" className={styles.textBtn} onClick={() => setSheet('cancel')} disabled={busy}>Скасувати</button>
            )}
            {sub.state === 'cancelled' && (
              <button type="button" className={styles.outlineBtn} onClick={() => void checkout(sub.plan ?? 'self')} disabled={busy}>Продовжити</button>
            )}
            {sub.state === 'past_due' && (
              <button type="button" className={styles.outlineBtn} onClick={() => void checkout(sub.plan ?? 'self')} disabled={busy}>Оновити картку</button>
            )}
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {sub.state === 'lapsed' && (
        <div className={styles.tariffGrid}>
          {TARIFF_CARDS.map((p) => (
            <PlanCard key={p.key} data={p} bp={bp} soonLabel="скоро" reveal={undefined}>
              {/*
                Борг живого тесту 26.09: сторінка mono не показує ні суми, ні
                слова «верифікація» — лише «Оплата для {ФОП}». Підпис стоїть над
                кнопкою, а кнопка називається «До банку»: окремий аркуш додав би
                зайвий тап на мобайлі.
              */}
              <p className={styles.bankNote}>{notice(p.key === 'solo' ? 'self' : 'home').text}</p>
              <button
                type="button" className={planCardStyles.planBtn} disabled={busy}
                onClick={() => void checkout(p.key === 'solo' ? 'self' : 'home')}
              >
                {notice(p.key === 'solo' ? 'self' : 'home').cta}<Icon name="sys.go" size={16} inherit decorative />
              </button>
            </PlanCard>
          ))}
        </div>
      )}

      {payments.length > 0 && (
        <section className={styles.history}>
          <h2 className={styles.historyTitle}>Історія списань</h2>
          <ul className={styles.historyList}>
            {payments.map((p) => {
              const name = members.find((m) => m.user_id === p.paid_by_user_id)?.name ?? '—';
              return (
                <li key={p.id} className={styles.historyRow}>
                  <span className={styles.historyDate}>{fmtDate(p.created_at)}</span>
                  <span className={styles.historySum}>{p.amount} ₴</span>
                  <span className={p.status === 'success' ? styles.historyOk : styles.historyFail}>{cardLabel(p.status)}</span>
                  <span className={styles.historyWho}>{name}</span>
                  {p.status === 'success' && p.receipt_url ? (
                    <a href={p.receipt_url} target="_blank" rel="noreferrer" className={styles.historyReceipt}>Квитанція</a>
                  ) : (
                    <span className={styles.historyReceipt}>—</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sheet === 'cancel' && sub.state !== 'lapsed' && sub.state !== 'beta' && (
        <CancelSheet
          date={sub.next_charge_at ?? sub.trial_ends_at}
          busy={busy}
          onClose={() => setSheet(null)}
          onConfirm={() => void cancelSubscription()}
        />
      )}
      {sheet === 'plan' && sub.plan && (
        <ChangePlanSheet
          current={sub.plan}
          nextChargeAt={sub.next_charge_at}
          busy={busy}
          onClose={() => setSheet(null)}
          onConfirm={(plan) => void changePlan(plan)}
        />
      )}
    </div>
  );
}

function CancelSheet({ date, busy, onClose, onConfirm }: { date: string | null; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Sheet title="Скасувати" ariaLabel="Скасувати підписку" onClose={onClose}>
      <div className={styles.sheetBody}>
        <p className={styles.sheetText}>
          {date ? `Доступ лишиться до ${fmtDate(date)}, далі — тільки читати. Дані не видаляємо.` : 'Доступ стане лише читанням, далі — тільки читати. Дані не видаляємо.'}
        </p>
        <div className={styles.sheetActions}>
          <button type="button" className={styles.sheetPrimary} onClick={onConfirm} disabled={busy}>Скасувати підписку</button>
          <button type="button" className={styles.sheetSecondary} onClick={onClose} disabled={busy}>Лишити</button>
        </div>
      </div>
    </Sheet>
  );
}

function ChangePlanSheet({ current, nextChargeAt, busy, onClose, onConfirm }: {
  current: Plan; nextChargeAt: string | null; busy: boolean; onClose: () => void; onConfirm: (plan: Plan) => void;
}) {
  const [selected, setSelected] = useState<Plan>(current);
  const upgrade = selected === 'home' && current === 'self';
  const downgrade = selected === 'self' && current === 'home';
  const note = upgrade
    ? `Наступне списання ${PLAN_PRICE_UAH.home} — ${nextChargeAt ? fmtDate(nextChargeAt) : '—'}`
    : downgrade
      ? `З ${nextChargeAt ? fmtDate(nextChargeAt) : '—'}. До того — як зараз.`
      : null;
  return (
    <Sheet title="Змінити тариф" ariaLabel="Змінити тариф" onClose={onClose}>
      <div className={styles.sheetBody}>
        <div className={styles.miniCards}>
          {(['self', 'home'] as const).map((plan) => {
            const on = selected === plan;
            return (
              <button
                key={plan} type="button" data-tap
                className={`${styles.miniCard} ${on ? styles.miniCardOn : styles[`miniCard-${plan}`]}`}
                onClick={() => setSelected(plan)}
                aria-pressed={on}
              >
                <span className={styles.miniHead}>
                  <span className={`${styles.miniPill} ${plan === 'self' ? styles.miniPillInk : styles.miniPillSage}`}>{PLAN_NAME[plan]}</span>
                  <span className={`${styles.radio} ${on ? styles.radioOn : ''}`} aria-hidden>
                    {on && <Icon name="sys.done" size={12} inherit decorative />}
                  </span>
                </span>
                <span className={styles.miniPrice}>
                  <span className={styles.miniSum}>{PLAN_PRICE_UAH[plan]} ₴</span>
                  <span className={styles.miniPer}>/ місяць</span>
                </span>
                <span className={styles.miniBlurb}>
                  {plan === 'self' ? 'Для тих, хто вирішує свою вечерю сам.' : 'Для кількох людей, які живуть з однією коморою.'}
                </span>
              </button>
            );
          })}
        </div>
        {note && (
          <span className={styles.planNote}><Icon name="sys.calendar" size={16} inherit decorative />{note}</span>
        )}
        <button
          type="button" className={styles.sheetPrimary} disabled={busy || selected === current}
          onClick={() => onConfirm(selected)}
        >
          Змінити
        </button>
      </div>
    </Sheet>
  );
}
