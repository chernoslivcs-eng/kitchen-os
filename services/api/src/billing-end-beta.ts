// Завершення бети (план 2026-09-25, Task 13) — разова дія в день запуску оплат.
//
// Що робить: кожному дому, який жив безкоштовно (рядка підписки нема або він
// у стані `beta`), ставить `cancelled` з доступом на 7 днів і шле лист. Далі
// нічого спеціального не треба: у дату `access_until` їх підхопить щоденний
// крон із billing-cron.ts і переведе в `lapsed` — тим самим кодом, що
// обробляє звичайне скасування.
//
// Рішення й виконання розділені навмисно: `planEndBeta` лише каже, що
// зміниться (це і є `--dry-run`), `applyEndBeta` виконує. Дія разова й
// незворотна для сотень домів — подивитись список перед запуском має бути
// дешевше, ніж запустити.
import type { Repo } from '@kitchen/domain';
import type { SubscriptionState } from '@kitchen/domain/subscription';
import { MAIL } from '@kitchen/domain/paywall';
import type { Mailer } from './mailer.js';

/** Скільки днів доступу лишається після оголошення (спек §1: попередження за 7 днів). */
export const END_BETA_GRACE_DAYS = 7;
const DAY = 86_400_000;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });

export interface EndBetaAction {
  household_id: string;
  /** Що було: `null` — рядка підписки не існувало взагалі. */
  from: SubscriptionState | null;
  access_until: string;
}

export interface EndBetaDeps {
  repo: Repo;
  mailer: Mailer;
  appUrl: string;
  /** Акаунт без пошти (з Telegram) — той самий текст у бот. */
  telegramNotify?: (user_id: string, text: string) => Promise<void>;
  now?: () => Date;
}

export interface EndBetaSummary {
  households: number;
  mails: number;
  notes: number;
}

/** Кого зачепить і як. Нічого не змінює — це і є `--dry-run`. */
export async function planEndBeta(repo: Repo, now: Date): Promise<EndBetaAction[]> {
  const access_until = new Date(now.getTime() + END_BETA_GRACE_DAYS * DAY).toISOString();
  const out: EndBetaAction[] = [];
  for (const h of await repo.listAdminHouseholds()) {
    const sub = await repo.getSubscription(h.id);
    // Той, хто вже платить (або вже в паузі), бети не «закінчує».
    if (sub && sub.state !== 'beta') continue;
    out.push({ household_id: h.id, from: sub?.state ?? null, access_until });
  }
  return out;
}

export async function applyEndBeta(deps: EndBetaDeps): Promise<EndBetaSummary> {
  const now = deps.now?.() ?? new Date();
  const out: EndBetaSummary = { households: 0, mails: 0, notes: 0 };
  for (const a of await planEndBeta(deps.repo, now)) {
    const prev = await deps.repo.getSubscription(a.household_id);
    await deps.repo.saveSubscription({
      household_id: a.household_id,
      state: 'cancelled',
      // Тариф не вигадуємо: людина обере його сама на екрані «Підписка».
      plan: null,
      trial_used_at: prev?.trial_used_at ?? null,
      // Бета скінчилась — картки в нас і не було; списувати нічим і нізащо.
      card_token: null,
      trial_ends_at: null,
      next_charge_at: null,
      access_until: a.access_until,
      provider_order_id: prev?.provider_order_id ?? null,
      card_mask: prev?.card_mask ?? null,
      paid_by_user_id: prev?.paid_by_user_id ?? null,
      deletion_warned_at: null,
      trial_mail_sent_at: null,
      updated_at: now.toISOString(),
    });
    out.households++;
    const m = MAIL.endBeta(fmt(a.access_until));
    for (const member of await deps.repo.listMembersOfHousehold(a.household_id)) {
      const u = await deps.repo.getUser(member.user_id);
      if (u?.email) { await deps.mailer.sendPlain({ to: u.email, subject: m.subject, text: m.text }); out.mails++; }
      else if (deps.telegramNotify) { await deps.telegramNotify(member.user_id, m.text); out.notes++; }
      // Ні пошти, ні бота — стан міняється однаково, лист нікуди не йде.
    }
  }
  return out;
}
