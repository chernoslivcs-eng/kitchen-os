// Щоденний крон біллінгу (спек 2026-09-25 §5, §6). Три роботи в одному
// проході: переходи станів, лист за 3 дні до кінця пробного, тихі доми.
//
// Ідемпотентність — головна вимога: крон ходить щодня, а людина має отримати
// кожен лист один раз. Тому кожна дія лишає слід датою на самому рядку
// підписки (`trial_mail_sent_at`, `deletion_warned_at`), а не покладається на
// те, що «сьогодні ми вже бігали».
import { randomUUID } from 'node:crypto';
import type { Repo } from '@kitchen/domain';
import { applyProviderEvent, tick } from '@kitchen/domain/subscription';
import { PLAN_PRICE_UAH } from '@kitchen/domain/plans';
import { MAIL, SUBSCRIPTION_PATH } from '@kitchen/domain/paywall';
import type { Mailer } from './mailer.js';
import type { BillingProvider } from './billing/provider.js';
import { ingestProviderEvent } from './billing/ingest.js';
import { BillingNotConfiguredError } from './billing/pick-provider.js';

const DAY = 86_400_000;
/** Пів року тиші — і дім отримує попередження (спек §5). */
const QUIET_DAYS = 182;
/** Після попередження — ще 30 днів. */
const WARN_DAYS = 30;
/**
 * Скільки діб поспіль повторювати невдале списання. Далі мовчимо: банку
 * однаково, а людину щоденні спроби лише дратують. До `lapsed` усе одно
 * лишається PAST_DUE_GRACE_DAYS від тієї ж дати.
 */
const CHARGE_RETRY_DAYS = 3;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });

export interface BillingCronDeps {
  repo: Repo;
  mailer: Mailer;
  appUrl: string;
  /**
   * Потрібен лише для прострочених намірів. Той самий, що в сервера —
   * інакше крон відписуватиме у фейку те, що створив справжній провайдер.
   */
  billing?: BillingProvider;
  /** Акаунт без пошти (з Telegram) — той самий текст іде в бот (спек §7). */
  telegramNotify?: (user_id: string, text: string) => Promise<void>;
  now?: () => Date;
}

export interface BillingCronSummary {
  transitions: number;
  trialMails: number;
  lapsedMails: number;
  warnings: number;
  deleted: number;
  intentsExpired: number;
  /** Скільки домів списано успішно сьогодні. */
  charged: number;
  /** Скільки списань не пройшло (дім пішов у past_due). */
  chargeFailures: number;
}

async function notifyHousehold(deps: BillingCronDeps, household_id: string, subject: string, text: string): Promise<void> {
  for (const m of await deps.repo.listMembersOfHousehold(household_id)) {
    const u = await deps.repo.getUser(m.user_id);
    if (u?.email) await deps.mailer.sendPlain({ to: u.email, subject, text });
    else if (deps.telegramNotify) await deps.telegramNotify(m.user_id, text);
    // Ні пошти, ні бота — нічого не шлемо; стан міняється однаково (спек §7).
  }
}

export async function runBillingCron(deps: BillingCronDeps): Promise<BillingCronSummary> {
  const now = deps.now?.() ?? new Date();
  const out: BillingCronSummary = { transitions: 0, trialMails: 0, lapsedMails: 0, warnings: 0, deleted: 0, intentsExpired: 0, charged: 0, chargeFailures: 0 };

  // 1. Переходи станів.
  for (const sub of await deps.repo.listSubscriptionsByState(['trial', 'cancelled', 'past_due'])) {
    const next = tick(sub, now);
    if (!next) continue;
    await deps.repo.saveSubscription(next);
    out.transitions++;
    if (next.state === 'lapsed') {
      await notifyHousehold(deps, sub.household_id, MAIL.lapsed.subject, MAIL.lapsed.text);
      out.lapsedMails++;
    }
  }

  // 2. Лист за 3 дні до кінця пробного — один раз на цикл підписки.
  for (const sub of await deps.repo.listSubscriptionsByState(['trial'])) {
    if (!sub.trial_ends_at || !sub.plan || sub.trial_mail_sent_at) continue;
    if (new Date(sub.trial_ends_at).getTime() - now.getTime() > 3 * DAY) continue;
    const m = MAIL.trialEnds(fmt(sub.trial_ends_at), sub.card_mask ?? '····', PLAN_PRICE_UAH[sub.plan], `${deps.appUrl}${SUBSCRIPTION_PATH}`);
    await notifyHousehold(deps, sub.household_id, m.subject, m.text);
    await deps.repo.saveSubscription({ ...sub, trial_mail_sent_at: now.toISOString() });
    out.trialMails++;
  }

  // 3. Тихі доми: попередження, потім видалення.
  for (const sub of await deps.repo.listSubscriptionsByState(['lapsed'])) {
    const seen = await deps.repo.householdLastSeenAt(sub.household_id);
    // Будь-який вхід після попередження обнуляє відлік: людина повернулась,
    // і видаляти в неї нічого не можна.
    if (sub.deletion_warned_at && seen && new Date(seen) > new Date(sub.deletion_warned_at)) {
      await deps.repo.saveSubscription({ ...sub, deletion_warned_at: null });
      continue;
    }
    if (sub.deletion_warned_at) {
      if ((now.getTime() - new Date(sub.deletion_warned_at).getTime()) / DAY < WARN_DAYS) continue;
      // Подія пишеться ДО видалення: після нього членів уже не знайти, а
      // AppEventRow вимагає user_id.
      const [first] = await deps.repo.listMembersOfHousehold(sub.household_id);
      if (first) {
        await deps.repo.saveAppEvents([{
          id: randomUUID(), user_id: first.user_id, household_id: sub.household_id,
          name: 'household_deleted_quiet', props: {}, viewport_w: null, device_class: null,
          ua_family: null, created_at: now.toISOString(),
        }]);
      }
      await deps.repo.deleteHousehold(sub.household_id);
      out.deleted++;
      continue;
    }
    // Відлік — від пізнішої з дат: кінець оплаченого доступу або останній вхід.
    const since = Math.max(
      seen ? new Date(seen).getTime() : 0,
      sub.access_until ? new Date(sub.access_until).getTime() : 0,
    );
    if ((now.getTime() - since) / DAY < QUIET_DAYS) continue;
    const m = MAIL.deletionWarning(`${deps.appUrl}/app`);
    await notifyHousehold(deps, sub.household_id, m.subject, m.text);
    await deps.repo.saveSubscription({ ...sub, deletion_warned_at: now.toISOString() });
    out.warnings++;
  }

  // 4. Списання за токеном (план mono, задача 4). У mono підписки як сутності
  // немає: щомісячні гроші знімає саме крон, а не провайдер.
  if (deps.billing) {
    for (const s of await deps.repo.listSubscriptionsDue(now)) {
      // Тариф — джерело суми. Без нього списувати невідомо скільки.
      if (!s.plan || !s.provider_order_id || !s.card_token) continue;
      // Повтори не вічні: від дати списання рахуємо CHARGE_RETRY_DAYS ЦІЛИМИ
      // добами. Порівнювати позначки часу не можна — крон ходить о 03:30, і
      // третя доба обрізалася б на три з половиною години раніше.
      if (Math.floor((now.getTime() - new Date(s.next_charge_at!).getTime()) / DAY) > CHARGE_RETRY_DAYS) continue;
      // Крон могли запустити двічі за добу — рядок платежу за сьогодні
      // означає, що спроба вже була, і другу робити не можна.
      if (await deps.repo.hasPaymentToday(s.household_id, now)) continue;

      let res;
      try {
        res = await deps.billing.chargeByToken({
          card_token: s.card_token, amount: PLAN_PRICE_UAH[s.plan], reference: s.provider_order_id,
        });
      } catch (err) {
        // Незаданий провайдер — не «полежить і встане»: молчки пропускати
        // списання щодня означало б тихо не брати грошей ні з кого.
        if (err instanceof BillingNotConfiguredError) throw err;
        // Провайдер недоступний — це НЕ відмова картки. Стан не міняємо й
        // рядка платежу не пишемо: завтра спробуємо ще раз.
        console.error('charge failed', s.household_id, String(err));
        continue;
      }

      if (res.status === 'processing') continue; // Рішення принесе вебхук.

      if (res.status === 'success') {
        // Через ingest, а не applyProviderEvent напряму: вебхук про це саме
        // списання прийде слідом, і insertPayment по тому самому invoiceId
        // не продублює рядок.
        await ingestProviderEvent(deps.repo, {
          kind: 'success', order_id: s.provider_order_id,
          amount: PLAN_PRICE_UAH[s.plan], provider_payment_id: res.provider_payment_id,
        }, now, { warn: (o, m) => console.warn(m, o) });
        out.charged++;
        continue;
      }

      const r = applyProviderEvent(s, { kind: 'failure', order_id: s.provider_order_id }, now);
      await deps.repo.saveSubscription(r.sub);
      // Рядок невдачі потрібен не для звітності, а як слід «сьогодні вже
      // пробували»: саме його читає hasPaymentToday.
      await deps.repo.insertPayment({
        household_id: s.household_id, amount: PLAN_PRICE_UAH[s.plan], currency: 'UAH', status: 'failure',
        provider_payment_id: res.provider_payment_id, paid_by_user_id: s.paid_by_user_id,
        receipt_url: null, created_at: now.toISOString(),
      });
      out.chargeFailures++;
    }
  }

  // 5. Прострочені наміри (спек §2). Намір живе 7 днів: якщо за цей час людина
  // не увійшла, прибираємо його. Картку вже могли токенізувати — тоді спершу
  // видаляємо токен, інакше вона лишиться збереженою в mono назавжди, за
  // акаунтом, якого не існує.
  for (const intent of await deps.repo.listIntentsExpiring(now)) {
    if (intent.state === 'subscribed' && intent.card_token) {
      if (!deps.billing) continue; // Без провайдера видалити нічим — лишаємо на наступний раз.
      try {
        await deps.billing.deleteToken(intent.card_token);
      } catch (err) {
        if (err instanceof BillingNotConfiguredError) throw err;
        // Провайдер лежить — намір лишається subscribed і повернеться завтра.
        // Позначити expired зараз означало б забути про живу картку назавжди.
        console.error('intent token delete failed', intent.order_id, String(err));
        continue;
      }
    }
    await deps.repo.updateIntent(intent.order_id, { state: 'expired' });
    out.intentsExpired++;
  }

  return out;
}
