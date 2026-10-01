// Завершення бети (спек 2026-10-01-demo-instead-of-beta §3) — разова дія в
// день деплою демо.
//
// Що робить: кожному дому, який жив безкоштовно (рядка підписки нема або він
// у стані `beta`), ставить `demo` на 7 днів і шле стартове повідомлення. Далі
// нічого спеціального не треба: у дату `demo_ends_at` їх підхопить щоденний
// крон із billing-cron.ts і переведе в `lapsed` — тим самим кодом, що
// обробляє скасування.
//
// Назва лишилась від бети навмисно: скрипт і далі робить рівно одне — закриває
// бету. Те, ЩО він ставить замість неї, змінилось із `cancelled` на `demo`.
//
// Рішення й виконання розділені навмисно: `planEndBeta` лише каже, що
// зміниться (це і є `--dry-run`), `applyEndBeta` виконує. Дія разова й
// незворотна для сотень домів — подивитись список перед запуском має бути
// дешевше, ніж запустити.
import type { Repo } from '@kitchen/domain';
import { DEMO_DAYS, startDemo, type SubscriptionState } from '@kitchen/domain/subscription';
import { MAIL } from '@kitchen/domain/paywall';
import type { Mailer } from './mailer.js';

const DAY = 86_400_000;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });

export interface EndBetaAction {
  household_id: string;
  /** Що було: `null` — рядка підписки не існувало взагалі. */
  from: SubscriptionState | null;
  demo_ends_at: string;
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
  const demo_ends_at = new Date(now.getTime() + DEMO_DAYS * DAY).toISOString();
  const out: EndBetaAction[] = [];
  for (const h of await repo.listAdminHouseholds()) {
    const sub = await repo.getSubscription(h.id);
    // Той, хто вже платить, уже в паузі — або вже отримав демо, — бети не
    // «закінчує». Умова строго по `beta`, тож повторний запуск скрипта нікому
    // не подовжить безкоштовне.
    if (sub && sub.state !== 'beta') continue;
    out.push({ household_id: h.id, from: sub?.state ?? null, demo_ends_at });
  }
  return out;
}

export async function applyEndBeta(deps: EndBetaDeps): Promise<EndBetaSummary> {
  const now = deps.now?.() ?? new Date();
  const out: EndBetaSummary = { households: 0, mails: 0, notes: 0 };
  for (const a of await planEndBeta(deps.repo, now)) {
    const prev = await deps.repo.getSubscription(a.household_id);
    await deps.repo.saveSubscription({
      // Той самий рядок, що й у нового дому (`startDemo`), лише дата кінця
      // рахується від дня деплою, а не від створення дому.
      ...startDemo(a.household_id, now),
      demo_ends_at: a.demo_ends_at,
      // Сліди попереднього рядка, які ще щось означають. Тариф не вигадуємо:
      // людина обере його сама на екрані «Підписка». Картки в бети не було —
      // токен лишається порожнім, списувати нічим і нізащо.
      provider_order_id: prev?.provider_order_id ?? null,
      card_mask: prev?.card_mask ?? null,
      paid_by_user_id: prev?.paid_by_user_id ?? null,
    });
    out.households++;
    const m = MAIL.demoStarted(fmt(a.demo_ends_at));
    for (const member of await deps.repo.listMembersOfHousehold(a.household_id)) {
      const u = await deps.repo.getUser(member.user_id);
      if (u?.email) { await deps.mailer.sendPlain({ to: u.email, subject: m.subject, text: m.text }); out.mails++; }
      else if (deps.telegramNotify) { await deps.telegramNotify(member.user_id, m.text); out.notes++; }
      // Ні пошти, ні бота — стан міняється однаково, лист нікуди не йде.
    }
  }
  return out;
}
