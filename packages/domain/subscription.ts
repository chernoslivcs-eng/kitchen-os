// Стан підписки ДОМУ (спек 2026-09-25-lapsed-subscription-design.md §1).
//
// Підписка належить дому, не людині: у всіх членів один стан, оплатити чи
// скасувати може будь-хто з дому. Тут — лише типи й ЧИСТІ функції: що дім
// має право робити зараз (`entitlementOf`), як стан міняють події провайдера
// (`applyProviderEvent`) і що з ним робить щоденний крон (`tick`).
// Ні репозиторію, ні дат «зараз» усередині — усе приходить параметром.
export type SubscriptionState = 'beta' | 'trial' | 'active' | 'cancelled' | 'past_due' | 'lapsed';
export type Plan = 'self' | 'home';
export type Entitlement = 'full' | 'read_only';

export interface HouseholdSubscription {
  household_id: string;
  state: SubscriptionState;
  plan: Plan | null;
  trial_used_at: string | null;
  trial_ends_at: string | null;
  next_charge_at: string | null;
  access_until: string | null;
  provider_order_id: string | null;
  card_mask: string | null;
  /**
   * Токен картки в mono. У LiqPay підписка жила в провайдера; у mono картку
   * тримаємо ми, і списання ініціює наш крон саме цим токеном. Немає токена —
   * немає з чого списувати, і крон такий дім не бере.
   */
  card_token: string | null;
  paid_by_user_id: string | null;
  deletion_warned_at: string | null;
  /** Лист «за 3 дні до кінця пробного» надіслано — щоб крон не слав двічі. */
  trial_mail_sent_at: string | null;
  updated_at: string;
}

/** Рахується на кожен запит, без кешу: оплата з іншого пристрою вмикає все негайно. */
export function entitlementOf(sub: HouseholdSubscription | null, now: Date, opts: { beta: boolean }): Entitlement {
  if (!sub) return opts.beta ? 'full' : 'read_only';
  switch (sub.state) {
    case 'beta': case 'active': case 'past_due': return 'full';
    case 'lapsed': return 'read_only';
    case 'trial': return sub.trial_ends_at && now < new Date(sub.trial_ends_at) ? 'full' : 'read_only';
    case 'cancelled': return sub.access_until && now < new Date(sub.access_until) ? 'full' : 'read_only';
  }
}

/** Прапорець бети — з env, один на процес. Поки він стоїть, усі доми мають full. */
export function betaFlag(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUBSCRIPTION_BETA !== '0';
}

/**
 * Скільки триває пробний. Домен його НЕ рахує — дата приходить у події
 * готовою (спек біллінгу §9.1). Константу використовує лише той, хто створює
 * checkout або намір, через `trialEndsFrom`: це має бути ТЕ САМЕ число, що
 * пішло в LiqPay як `subscribe_date_start`.
 */
export const TRIAL_DAYS = 14;
/**
 * Намір із лендінга (оформлення до реєстрації) живе стільки. Строго менше за
 * TRIAL_DAYS — інакше перше списання могло б прийти для наміру, який ще не
 * привʼязаний до дому, і гроші не було б куди записати. На це є тест.
 */
export const INTENT_TTL_DAYS = 7;
export const PAST_DUE_GRACE_DAYS = 7;
const DAY = 86_400_000;
const addDays = (iso: string | Date, d: number) => new Date(new Date(iso).getTime() + d * DAY).toISOString();
/** Дата кінця пробного — рахується ОДИН раз, у checkout або при створенні наміру. */
export const trialEndsFrom = (now: Date): string => addDays(now, TRIAL_DAYS);
const addMonth = (iso: string | Date) => { const x = new Date(iso); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString(); };

export type ProviderEvent =
  // `trial_ends_at` — не «чи є пробний», а САМЕ ЧИСЛО, яке вже стоїть у
  // провайдера. null — без пробного, списання одразу.
  | { kind: 'subscribed'; household_id: string; order_id: string; plan: Plan; card_mask: string | null; card_token: string | null; trial_ends_at: string | null; paid_by_user_id: string }
  | { kind: 'success'; order_id: string; amount: number; provider_payment_id: string }
  | { kind: 'failure'; order_id: string }
  | { kind: 'unsubscribed'; order_id: string };

export interface PaymentRow {
  id: string; household_id: string; amount: number; currency: 'UAH';
  status: 'success' | 'failure'; provider_payment_id: string | null;
  paid_by_user_id: string | null; receipt_url: string | null; created_at: string;
}

/** Чиста функція: нова підписка + (опційно) платіж для запису. Ідемпотентність по provider_payment_id — на рівні repo. */
export function applyProviderEvent(sub: HouseholdSubscription | null, ev: ProviderEvent, now: Date): { sub: HouseholdSubscription; payment?: Omit<PaymentRow, 'id'> } {
  const at = now.toISOString();
  if (ev.kind === 'subscribed') {
    const trialEnds = ev.trial_ends_at;
    const trial = trialEnds != null;
    return { sub: {
      household_id: ev.household_id, state: trial ? 'trial' : 'active', plan: ev.plan,
      // Перший пробний лишається першим: намір із лендінга несе дату навіть
      // для дому, який пробний уже витратив (списання буде саме в неї), але
      // другим пробним це не стає.
      trial_used_at: sub?.trial_used_at ?? (trial ? at : null), trial_ends_at: trialEnds,
      // Без пробного перше списання — ЗАРАЗ, і зробить його наш крон. Тут
      // колись стояло addMonth(now): за LiqPay це було правильно, бо він сам
      // списував у момент підписання, а місяць відлічувався від того списання.
      // У mono в момент підписання не списує ніхто, тож addMonth дарував би
      // місяць кожному, хто пробний уже витратив.
      next_charge_at: trial ? trialEnds : at, access_until: null,
      provider_order_id: ev.order_id, card_mask: ev.card_mask, card_token: ev.card_token, paid_by_user_id: ev.paid_by_user_id,
      // Нове оформлення — новий цикл: попередження про кінець пробного
      // рахується від цього trial_ends_at, старий слід тут тільки заважав би.
      deletion_warned_at: null, trial_mail_sent_at: null, updated_at: at,
    } };
  }
  if (!sub) throw new Error(`provider event ${ev.kind} for unknown order ${ev.order_id}`);
  if (ev.kind === 'success') {
    return {
      sub: { ...sub, state: 'active', next_charge_at: addMonth(sub.next_charge_at ?? now), updated_at: at },
      payment: { household_id: sub.household_id, amount: ev.amount, currency: 'UAH', status: 'success', provider_payment_id: ev.provider_payment_id, paid_by_user_id: sub.paid_by_user_id, receipt_url: null, created_at: at },
    };
  }
  if (ev.kind === 'failure') return { sub: { ...sub, state: 'past_due', updated_at: at } };
  // Токен стираємо разом із маскою: сам токен у mono видаляє маршрут
  // скасування через deleteToken, а тут ми прибираємо привід ним скористатись.
  return { sub: { ...sub, state: 'cancelled', access_until: sub.next_charge_at, card_mask: null, card_token: null, updated_at: at } };
}

/** Що крон робить із рядком сьогодні; null — нічого. */
export function tick(sub: HouseholdSubscription, now: Date): HouseholdSubscription | null {
  const at = now.toISOString();
  if (sub.state === 'cancelled' && sub.access_until && now >= new Date(sub.access_until)) return { ...sub, state: 'lapsed', updated_at: at };
  if (sub.state === 'past_due' && sub.next_charge_at && now >= new Date(addDays(sub.next_charge_at, PAST_DUE_GRACE_DAYS))) return { ...sub, state: 'lapsed', updated_at: at };
  if (sub.state === 'trial' && sub.trial_ends_at && now >= new Date(addDays(sub.trial_ends_at, 1))) return { ...sub, state: 'past_due', updated_at: at };
  return null;
}

/**
 * Намір оплати (спек біллінгу §4): людина дала картку на лендінгу, акаунта ще
 * немає. Живе INTENT_TTL_DAYS і закінчується або привʼязкою до дому (`bound`),
 * або `expired` — тоді крон відписує його в провайдера.
 */
export interface PaymentIntent {
  order_id: string;
  plan: Plan;
  state: 'pending' | 'subscribed' | 'bound' | 'expired';
  /** Те саме число, що стоїть у нас як перше списання; провайдер його не знає. */
  trial_ends_at: string | null;
  card_mask: string | null;
  /** Токен із verification-інвойсу: переїде в підписку при `bind`. */
  card_token: string | null;
  household_id: string | null;
  ip: string | null;
  created_at: string;
  expires_at: string;
  bound_at: string | null;
}
