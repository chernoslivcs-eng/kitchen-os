// Один вибір провайдера на весь процес: сервер і крон мусять користуватись
// тим самим, інакше крон списуватиме у фейку з людей, які платять насправді.
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
      throw new Error(
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
