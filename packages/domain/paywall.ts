// Тексти режиму без підписки (спек 2026-09-25-lapsed-subscription-design.md §3).
//
// Це копірайтер власника, погоджено 25.09 — у код ДОСЛІВНО, зі змінними у
// фігурних дужках. Рамка 23.09 забороняє «безпечно», «гарантуємо»,
// «придатне», «не містить», «на жаль», «шкода», «прикро»; на це є тест.
// Один модуль на всі канали (веб, бот, пошта), щоб той самий стан не
// розповідався двома різними голосами.
import { PLAN_PRICE_UAH } from './plans.js';
import type { HouseholdSubscription, SubscriptionState } from './subscription.js';

export const SUBSCRIPTION_PATH = '/profile/subscription';

export const PAYWALL = {
  chat: {
    text: 'Я зберіг те, що в нас уже є. Зараз я не розбираю нові повідомлення, чеки, фото й голос і не веду комору далі. Поки зупинимось тут — не найгірше місце для паузи.',
    cta: 'Продовжити',
  },
  banner: {
    lapsed: { text: 'Підписка закінчилась — усе лишив як було.', cta: 'Продовжити' },
    cancelled: (date: string) => ({ text: `До ${date} все працює як завжди. Потім просто зробимо паузу.` }),
    past_due: { text: 'Цього разу оплата не пройшла. Оновимо картку й продовжимо звідси.', cta: 'Оновити картку' },
    trial: (date: string, sum: number) => ({ text: `Пробний до ${date}, далі ${sum} ₴/міс.` }),
  },
} as const;

export const MAIL = {
  lapsed: {
    subject: 'Підписка закінчилась — усе на місці',
    text: 'Підписка закінчилась, але все, що ми тут назбирали, лишилось на місці: комора, список покупок, рецепти й журнал готувань. Зараз нове я не розбираю — ні повідомлення, ні фото, ні голос — і не веду комору далі. Поки просто зробимо паузу. Коли буде настрій продовжити, кнопка «Продовжити» лежить у Профілі.',
  },
  trialEnds: (date: string, mask: string, sum: number, link: string) => ({
    subject: `Пробний період — до ${date}`,
    // Друге речення — вимога оферти §4 (коли і скільки спишеться), не прибирати.
    text: `Пробний період триває до ${date}. ${date} з картки •• ${mask} спишеться ${sum} ₴ — це перший місяць підписки. Якщо вирішиш, що поки досить, скасувати можна тут: ${link}. Ніяких драм, просто щоб ти знав заздалегідь.`,
  }),
  /**
   * День запуску оплат: бета закінчується, у всіх домів 7 днів попередження
   * (план Task 13). Текст робочий — копірайтер може замінити, але він тут
   * один на всі канали, як і решта.
   */
  endBeta: (date: string) => ({
    subject: 'Через 7 днів у Kitchen OS запускається оплата',
    text: `Бета закінчується ${date}. Далі — 14 днів за 1 ₴ і 210 або 290 ₴ на місяць; усе, що назбирали, лишається на місці. Обрати тариф можна в Профілі → Підписка.`,
  }),
  deletionWarning: (link: string) => ({
    subject: 'Твій дім у Kitchen OS тихий уже пів року',
    text: `Пів року ніхто з дому не заходив. Через 30 днів ми видалимо комору, список, рецепти й журнал — так записано в політиці. Щоб усе лишилось, досить зайти: ${link}.`,
  }),
} as const;

export function paywallBody(state: SubscriptionState) {
  return { kind: 'paywall' as const, state, text: PAYWALL.chat.text, cta: { label: PAYWALL.chat.cta, to: SUBSCRIPTION_PATH } };
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
const DAY = 86_400_000;

/** Банер над табами — лише коли є що зробити; в `active` і `beta` його нема. */
export function bannerFor(sub: HouseholdSubscription | null, now: Date): { text: string; cta?: string; to?: string } | null {
  if (!sub) return null;
  switch (sub.state) {
    case 'lapsed': return { ...PAYWALL.banner.lapsed, to: SUBSCRIPTION_PATH };
    case 'cancelled': return sub.access_until ? PAYWALL.banner.cancelled(fmt(sub.access_until)) : null;
    case 'past_due': return { ...PAYWALL.banner.past_due, to: SUBSCRIPTION_PATH };
    case 'trial': {
      if (!sub.trial_ends_at || !sub.plan) return null;
      const left = new Date(sub.trial_ends_at).getTime() - now.getTime();
      return left <= 3 * DAY ? PAYWALL.banner.trial(fmt(sub.trial_ends_at), PLAN_PRICE_UAH[sub.plan]) : null;
    }
    default: return null;
  }
}
