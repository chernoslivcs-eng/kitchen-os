// Тексти режиму без підписки (спек 2026-09-25-lapsed-subscription-design.md §3).
//
// Це копірайтер власника, погоджено 25.09 — у код ДОСЛІВНО, зі змінними у
// фігурних дужках. Рамка 23.09 забороняє «безпечно», «гарантуємо»,
// «придатне», «не містить», «на жаль», «шкода», «прикро»; на це є тест.
// Один модуль на всі канали (веб, бот, пошта), щоб той самий стан не
// розповідався двома різними голосами.
import { PLAN_PRICE_UAH } from './plans.js';
import { TRIAL_DAYS, type HouseholdSubscription, type SubscriptionState } from './subscription.js';

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

/**
 * Отримувач платежу, як його показує сторінка банку. Не «Kitchen OS»: mono
 * малює назву мерчанта, тобто ФОП. Людина мусить дізнатись це від нас ДО
 * переходу, інакше чуже прізвище на платіжній сторінці читається як помилка.
 */
export const MERCHANT_LEGAL_NAME = 'ФОП Білянський П. М.';

/**
 * Дата першого списання для НОВОГО оформлення: сьогодні + TRIAL_DAYS, словами.
 *
 * Рахується тут, а не в кожного, хто малює підпис. Спершу дату приймали
 * готовим рядком — і лендінг з екраном «Підписка» показали одну й ту саму
 * обіцянку в різному вигляді («10 жовтня» проти «10.10»). Формат той самий,
 * що в листі MAIL.trialEnds: про одне й те саме списання людина читає двічі.
 */
function trialDate(now: Date): string {
  return new Date(now.getTime() + TRIAL_DAYS * 86_400_000)
    .toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

/**
 * Що сказати перед переходом на сторінку банку (борг живого тесту 26.09).
 *
 * Перевірено живцем: сторінка mono не показує ні суми, ні слова «верифікація»
 * — лише «Оплата для {назва мерчанта}», поля картки й «Зберегти картку». Тобто
 * людина бачить слово «Оплата» без жодного числа. Обіцянку «зараз не спишемо»
 * не підтвердить ніхто, крім нас, тому вона мусить стояти тут.
 *
 * `trialAvailable` — false, коли пробний уже витрачено: тоді першого списання
 * «в дату» немає, воно станеться найближчим проходом крону. Обіцяти конкретний
 * день у цьому випадку означало б обіцяти те, чого ми не контролюємо.
 */
export function bankNotice(sum: number, trialAvailable: boolean, now: Date = new Date()): { title: string; text: string; cta: string } {
  const when = trialAvailable
    ? `буде ${trialDate(now)}`
    : 'буде протягом доби — пробний період уже використано';
  return {
    title: 'Далі — сторінка банку',
    text: `monobank збереже картку і зараз нічого не спише — 0 ₴. Перше списання ${sum} ₴ ${when}. `
      + `На сторінці банку стоїть назва отримувача «${MERCHANT_LEGAL_NAME}» — це ми.`,
    cta: 'До банку',
  };
}

/**
 * Картка для показу людині. `mask` — рівно ті цифри, які відкрив провайдер:
 * mono відкриває дві, інші можуть чотири. Дописувати крапки до чотирьох не
 * можна — це була б вигадка про чужий номер.
 *
 * null на вході — null на виході: «••••» без цифр нічого людині не каже.
 */
export function formatCardMask(mask: string | null | undefined): string | null {
  const d = (mask ?? '').replace(/\D/g, '');
  return d ? `•••• ${d}` : null;
}

export const MAIL = {
  lapsed: {
    subject: 'Підписка закінчилась — усе на місці',
    text: 'Підписка закінчилась, але все, що ми тут назбирали, лишилось на місці: комора, список покупок, рецепти й журнал готувань. Зараз нове я не розбираю — ні повідомлення, ні фото, ні голос — і не веду комору далі. Поки просто зробимо паузу. Коли буде настрій продовжити, кнопка «Продовжити» лежить у Профілі.',
  },
  trialEnds: (date: string, mask: string | null, sum: number, link: string) => ({
    subject: `Пробний період — до ${date}`,
    // Друге речення — вимога оферти §4 (коли і скільки спишеться), не прибирати.
    // Оферта вимагає дати й суми; картка — уточнення для людини. Тому коли
    // провайдер маски не дав, згадка про картку зникає, а «коли і скільки»
    // лишається. Раніше тут підставлялось '····' і виходило «з картки •• ····».
    text: `Пробний період триває до ${date}. ${date}${formatCardMask(mask) ? ` з картки ${formatCardMask(mask)}` : ''} спишеться ${sum} ₴ — це перший місяць підписки. Якщо вирішиш, що поки досить, скасувати можна тут: ${link}. Ніяких драм, просто щоб ти знав заздалегідь.`,
  }),
  /**
   * День запуску оплат: бета закінчується, у всіх домів 7 днів попередження
   * (план Task 13).
   *
   * Формулювання про гроші звірене з рішенням власника «A» (LiqPay-підписка):
   * при оформленні НЕ списується нічого, картка лише перевіряється, перше
   * списання — у день закінчення 14 днів. План до цього рішення обіцяв «14
   * днів за 1 ₴» — у коді таких грошей немає (checkout іде на
   * PLAN_PRICE_UAH), і в листі їх теж бути не повинно. Те саме формулювання
   * в оферті (#212) і спеку §6; міняти — у всіх трьох місцях.
   */
  endBeta: (date: string) => ({
    subject: 'Через 7 днів у Kitchen OS запускається оплата',
    text: `Бета закінчується ${date}. Далі — 14 днів безкоштовно з привʼязаною карткою, а потім 210 або 290 ₴ на місяць; усе, що назбирали, лишається на місці. Обрати тариф можна в Профілі → Підписка.`,
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
