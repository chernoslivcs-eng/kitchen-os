// Один вибір провайдера на весь процес: сервер і крон мусять користуватись
// тим самим, інакше крон списуватиме у фейку з людей, які платять насправді.
import { captureIncident } from '../sentry.js';
import { FakeBillingProvider } from './fake-provider.js';
import { MonoProvider } from './mono.js';
import type { BillingProvider } from './provider.js';

/** Шлях, на який mono шле статуси інвойсів. Знає лише цей модуль і маршрут. */
export const MONO_WEBHOOK_PATH = '/v1/billing/mono';

/**
 * Прод — це `VERCEL_ENV === 'production'`, як у `sentry.ts` і в
 * `vercel-build.sh` (де за цією ж ознакою пускають міграції).
 *
 * НЕ `NODE_ENV`: Vercel ставить його в 'production' і для Preview теж, тому
 * перевірка по ньому вбила б кожен Preview-деплой. `NODE_ENV === 'production'`
 * у нашому коді означає інше — «не локальна машина» (secure-куки в auth,
 * invites, retail), і для цього воно правильне.
 */
const isProduction = (): boolean => process.env.VERCEL_ENV === 'production';

/**
 * Окремий тип навмисно. Крон загортає виклики провайдера в try/catch і
 * навмисно ковтає збої («mono лежить — спробуємо завтра»). Без власного типу
 * незаданий токен виглядав би для нього рівно як недоступний провайдер, і крон
 * щодня тихо нічого не списував би — тобто ми поміняли б один тихий провал на
 * інший. За цим типом крон помилку прокидає далі.
 */
export class BillingNotConfiguredError extends Error {
  readonly name = 'BillingNotConfiguredError';
}

/**
 * Поза продом без токена — `FakeBillingProvider`: так живуть стенд, тести й
 * Preview без кабінету mono.
 *
 * У проді відсутній токен — падіння, а не фейк. 26.09 у Preview лежав
 * `MONO_TOKEN` із ПОРОЖНІМ значенням (змінну створили, вміст не доїхав), і
 * вибір тихо віддавав фейк. У Preview це безневинно. Якби так сталося в
 * проді, люди отримували б фейкові посилання на оплату, підписки
 * оформлювались би, грошей не списував би ніхто — і жодного сигналу ні в
 * логах, ні в Sentry. Краще гучна відмова.
 *
 * Порожній рядок і пробіли — те саме, що відсутній: значення з вставляння
 * часто приїжджає з переносом рядка, а такий токен усе одно не спрацює, лише
 * помилка від mono буде незрозумілою («Missing required header»).
 */
export function pickBillingProvider(appUrl: string): BillingProvider {
  const token = process.env.MONO_TOKEN?.trim();
  if (!token) {
    if (isProduction()) {
      throw new BillingNotConfiguredError(
        'MONO_TOKEN не задано (або порожній) у Production. Без нього оплати не працюють, '
        + 'а підставляти фейковий провайдер у проді не можна: люди отримували б неробочі '
        + 'посилання на оплату. Поставте MONO_TOKEN у Vercel → Settings → Environment '
        + 'Variables → Production і передеплойте.',
      );
    }
    return new FakeBillingProvider();
  }
  return new MonoProvider(token, `${appUrl}${MONO_WEBHOOK_PATH}`);
}

/**
 * Той самий вибір, але відкладений до першого звернення — і в цьому вся суть
 * радіуса відмови.
 *
 * `pickBillingProvider` кличеться при складанні застосунку, тож виняток із
 * нього означав би 500 на КОЖЕН запит: чат, комора, вхід. Зламаний токен
 * оплат гасив би весь продукт, хоч усе інше працює. Тому провайдер
 * вирішується при першому платіжному виклику — падають лише оплати
 * (checkout, intent, bind) і крон списання, решта API живе.
 *
 * Вебхук провайдера сюди не входить навмисно: він і без токена відповідає
 * 503, і це правильніше за виняток — mono на 503 повторить спробу, а на 500
 * від необробленої помилки теж повторить, але ми втратимо ясність причини.
 *
 * Перше падіння йде в Sentry. Не в `app_event`: там `user_id` має NOT NULL і
 * FK на "user" (міграція 0029), а на шляху наміру людини ще немає за
 * означенням — підставляти чужий id заради рядка гірше, ніж не мати рядка.
 */
export function lazyBillingProvider(appUrl: string): BillingProvider {
  let cached: BillingProvider | null = null;
  let reported = false;
  const resolve = (): BillingProvider => {
    if (cached) return cached;
    try {
      cached = pickBillingProvider(appUrl);
      return cached;
    } catch (err) {
      // Один раз на екземпляр: на Vercel це один холодний старт, тобто Sentry
      // отримає подію на кожен новий інстанс, а не на кожен запит.
      if (!reported) {
        reported = true;
        captureIncident('broke', 'billing-provider-unconfigured', { err, appUrl });
      }
      throw err;
    }
  };
  return {
    checkoutUrl: (i) => resolve().checkoutUrl(i),
    chargeByToken: (i) => resolve().chargeByToken(i),
    deleteToken: (t) => resolve().deleteToken(t),
    removeInvoice: (id) => resolve().removeInvoice(id),
  };
}
