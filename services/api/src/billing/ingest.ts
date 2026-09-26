// Один вхід для подій провайдера ПІСЛЯ того, як їм повірили (спек §9.2).
//
// Моделей довіри дві й вони різні: бойовий вебхук перевіряє підпис LiqPay,
// стендовий маршрут — свій секрет. Спільним має бути лише те, що відбувається
// далі, інакше мапінг і запис розповзуться по двох обробниках і розійдуться.
//
// Головне правило: подія веде або до ДОМУ, або до НАМІРУ. Вебхук знає тільки
// `order_id`, і за ним ми з'ясовуємо, що це було.
import type { Repo } from '@kitchen/domain';
import { applyProviderEvent, type PaymentIntent, type ProviderEvent, type SubscriptionState } from '@kitchen/domain/subscription';

/**
 * Те, що приходить іззовні. Вебхук не знає ні дому, ні тарифу, ні дати
 * пробного — усе це вже лежить у нас, у підписці або в намірі.
 */
export type InboundProviderEvent =
  | { kind: 'subscribed'; order_id: string; card_mask: string | null; card_token: string | null }
  | Extract<ProviderEvent, { kind: 'success' | 'failure' | 'unsubscribed' }>;

export type IngestResult =
  | { target: 'household'; state: SubscriptionState }
  | { target: 'intent'; state: PaymentIntent['state'] }
  | { target: 'none'; reason: 'unknown_order' | 'no_household_for_money' };

export async function ingestProviderEvent(
  repo: Repo,
  ev: InboundProviderEvent,
  now: Date,
  log: { warn(o: object, msg: string): void },
): Promise<IngestResult> {
  const sub = await repo.findSubscriptionByOrder(ev.order_id);
  if (sub) {
    // Та сама картка на тому самому замовленні вже застосована — це повторна
    // доставка. Застосувати її вдруге означало б перезібрати рядок з нуля:
    // оплачена підписка впала б назад у пробну, а слід листа про кінець
    // пробного стерся б і лист пішов би ще раз.
    //
    // Порівнюємо саме токен, а не сам факт підписки: людина могла дати НОВУ
    // картку на те саме замовлення, і це вже не повтор, а зміна.
    if (ev.kind === 'subscribed' && ev.card_token != null && sub.card_token === ev.card_token) {
      return { target: 'household', state: sub.state };
    }

    const full: ProviderEvent = ev.kind === 'subscribed'
      // Дім уже відомий, і дата пробного вже порахована checkout-ом — беремо
      // її звідти, а не рахуємо заново.
      ? { kind: 'subscribed', order_id: ev.order_id, household_id: sub.household_id, plan: sub.plan ?? 'self', card_mask: ev.card_mask ?? sub.card_mask, card_token: ev.card_token ?? sub.card_token, trial_ends_at: sub.trial_ends_at, paid_by_user_id: sub.paid_by_user_id ?? '' }
      : ev;
    const r = applyProviderEvent(sub, full, now);

    // Гроші — першими. insertPayment ідемпотентний по provider_payment_id
    // (= invoiceId), і його `false` — єдине надійне «цю подію ми вже бачили».
    // Якщо спершу зберегти підписку, то повторний вебхук про те саме списання
    // зсуне next_charge_at ще на місяць, а другого платежу так і не буде:
    // місяць даром. А mono бʼє до трьох спроб, поки не побачить 200.
    if (r.payment) {
      const fresh = await repo.insertPayment(r.payment);
      if (!fresh) {
        // Рядок уже є — найчастіше його поклав крон одразу після синхронного
        // списання, а комісію mono називає тільки тут, у вебхуку. Якщо просто
        // вийти, вона втратиться назавжди.
        if (r.payment.fee != null && ev.kind === 'success') {
          await repo.setPaymentFee(ev.provider_payment_id, r.payment.fee);
        }
        return { target: 'household', state: sub.state };
      }
    }
    await repo.saveSubscription(r.sub);
    return { target: 'household', state: r.sub.state };
  }

  const intent = await repo.getIntent(ev.order_id);
  if (!intent) return { target: 'none', reason: 'unknown_order' };

  if (ev.kind === 'subscribed') {
    await repo.updateIntent(ev.order_id, { state: 'subscribed', card_mask: ev.card_mask, card_token: ev.card_token });
    return { target: 'intent', state: 'subscribed' };
  }
  if (ev.kind === 'unsubscribed') {
    await repo.updateIntent(ev.order_id, { state: 'expired' });
    return { target: 'intent', state: 'expired' };
  }

  // Гроші для наміру без дому — стан «не може бути»: намір живе 7 днів, а
  // перше списання не раніше ніж через 14 (інваріант INTENT_TTL_DAYS <
  // TRIAL_DAYS). Якщо сюди дійшло, зламалось щось вище.
  //
  // План казав писати це в app_event — але не виходить: `app_event.user_id`
  // має NOT NULL і FK на "user" (міграція 0029), а тут ні людини, ні дому за
  // означенням немає. Підставляти чужий чи порожній id заради рядка в
  // таблиці — гірше, ніж не мати рядка. Лишається лог сервера.
  log.warn({ order_id: ev.order_id, kind: ev.kind, at: now.toISOString() }, 'billing-money-event-without-household');
  return { target: 'none', reason: 'no_household_for_money' };
}
