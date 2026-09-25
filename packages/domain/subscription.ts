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
