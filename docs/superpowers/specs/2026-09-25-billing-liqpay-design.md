# Біллінг через LiqPay — дизайн (25.09.2026)

> **26.09: провайдер змінено на monobank.** Розділи §1 п.1–2 і §3 (підпис, параметри, мапінг LiqPay)
> замінені планом `docs/superpowers/plans/2026-09-25-billing-mono.md` і розвідкою
> `PAYMENTS-RECON-0925.md` §6. Модель — «B без 1 ₴»: інвойс mono `verification` на 0 ₴ зі
> збереженням картки, списання за токеном нашим кроном, вебхук з підписом X-Sign. Решта
> документа (§2 намір до реєстрації, §4–§9) чинна.

Підстава: рішення власника «A» (`PAYMENTS-RECON-0925.md` §5) і порядок кроків зі спека
`2026-09-23-legal-frame-design.md` §6 (оформлення до реєстрації). Стани, ворота, екран
«Підписка», крон і тексти — у `2026-09-25-lapsed-subscription-design.md` та плані
`docs/superpowers/plans/2026-09-25-lapsed-subscription.md`; цей документ лише
підставляє справжнього провайдера замість фейка і зшиває лендінг → оплату → реєстрацію.

## 1. Що будуємо

1. **`LiqPayProvider implements BillingProvider`** (інтерфейс із плану, Task 8):
   `checkoutUrl` → підписаний `action=subscribe`; `unsubscribe` → `action=unsubscribe`;
   `updateAmount` → `action=subscribe_update`.
2. **Вебхук** `POST /v1/billing/liqpay` (`server_url`): перевірка підпису, мапінг статусів
   LiqPay → `ProviderEvent`, далі той самий `applyProviderEvent` + `saveSubscription` +
   `insertPayment`, що й у стендовому `/v1/subscription/provider-event`.
3. **Намір оплати до реєстрації** — `payment_intent`: оформлення з лендінга без акаунта.
4. **Лендінг**: кнопки карток тарифів несуть тариф в оформлення; блок входу вміє
   прийняти `intent` і привʼязати його до нового чи наявного дому.

## 2. Оформлення з лендінга (людини ще немає)

```
[Ціна: «Оформити» на картці] → POST /v1/billing/intent {plan}      (без сесії, ліміт по IP)
   → payment_intent {order_id, plan, state:'pending', household_id:null, expires_at:+7д}
   → 302 на LiqPay checkout (action=subscribe, order_id, amount, date_start=+14д,
     result_url=/?intent=<order_id>#l3-signin, server_url=/v1/billing/liqpay)
[LiqPay: картка] → server_url: status=subscribed → intent.state='subscribed', card_mask
                → result_url → лендінг, блок входу з intent у стані
[Реєстрація/вхід будь-яким способом: intent їде в `next` (магік-лінк), `state` (Google),
 токен Telegram] → після входу веб викликає POST /v1/billing/bind {intent}
   → сервер: intent.subscribed і не привʼязаний → household_subscription через
     applyProviderEvent(null, {kind:'subscribed', trial: !trial_used_at, …}) → intent.state='bound'
```
- Людина, що вже має акаунт і зайшла «Вхід» — той самий `bind` на її дім; якщо дім уже
  має `active/trial` — `409`, підписку в LiqPay скасовуємо (`unsubscribe`), кажемо
  «у дому вже є підписка».
- Пробний — один раз на дім: якщо `trial_used_at` стоїть, `bind` робить
  `subscribe_update`? Ні — `date_start` уже +14д у LiqPay. Тому **`date_start` вирішується
  в момент `intent`**: для оформлення з лендінга (акаунта нема) — завжди +14д; для
  оформлення з екрана «Підписка» (акаунт є) — +14д, якщо `trial_used_at` порожній, інакше
  «зараз». Обхід «новий акаунт заради другого пробного» лишається можливим — це
  усвідомлений компроміс (мінімальний виграш для людини, нуль коду для нас).
- Намір без `bind` 7 днів → крон: `unsubscribe(order_id)`, `intent.state='expired'`.
  Списань не було — повертати нічого.
- `payment_intent` для оформлення з екрана «Підписка» не потрібен: там дім відомий,
  `checkout` із плану (Task 8) пише `provider_order_id` одразу в `household_subscription`.

## 3. LiqPay: підпис, параметри, мапінг

- Запит: `data = base64(JSON)`, `signature = base64(sha1(private_key + data + private_key))`;
  checkout — `https://www.liqpay.ua/api/3/checkout` (POST-форма або редирект з `data`+`signature`
  у query); серверні дії (`unsubscribe`, `subscribe_update`) — `POST https://www.liqpay.ua/api/request`.
- `subscribe`: `version:3, public_key, action:'subscribe', amount, currency:'UAH',
  description:'Kitchen OS · Для дому · щомісяця', order_id, subscribe_date_start (UTC
  'YYYY-MM-DD HH:mm:ss'), subscribe_periodicity:'month', result_url, server_url, language:'uk'`.
- Вебхук приходить як `application/x-www-form-urlencoded` з `data` і `signature`;
  перевіряємо підпис **тим самим** private_key; без збігу — `403`, без обробки.
- Мапінг `status` → `ProviderEvent`:
  `subscribed` → `subscribed` (card_mask із `sender_card_mask2`, `order_id`);
  `success` → `success` (`amount`, `payment_id` як `provider_payment_id`);
  `failure` | `error` → `failure`;
  `unsubscribed` → `unsubscribed`;
  `3ds_verify | otp_verify | cvv_verify | wait_secure | wait_accept` → нічого (ще не результат);
  `reversed` → запис `payment` зі статусом `failure`? Ні — окремий статус не потрібен:
  reversed після success — рідкість, логуємо як `app_event` і не міняємо стан.
- Ідемпотентність: `payment_id` унікальний у `payment`; повторний `subscribed` для того ж
  `order_id` — без змін (стан уже `trial/active`).
- Sandbox: тестові ключі з кабінету → `LIQPAY_PUBLIC_KEY/LIQPAY_PRIVATE_KEY` у Preview і на
  стенді; прод-ключі — тільки в Production. Ключі вводить власник.
- `server_url` має бути публічним https — на стенді вебхук не приходить; для стенда й
  тестів лишається `/v1/subscription/provider-event` із плану.

## 4. Дані

`payment_intent`: `order_id uuid PK`, `plan`, `state ('pending'|'subscribed'|'bound'|'expired')`,
`card_mask`, `household_id null`, `created_at`, `expires_at`, `bound_at`, `ip`.

## 5. Лендінг і вхід (веб)

- Секція «Ціна» при `BETA_PLAN=false`: кнопка картки → `POST /v1/billing/intent` → редирект
  на checkout. Рядок над картками: «14 днів безкоштовно · картка з першого дня» замість
  «без картки» (текст остаточний після копірайтера; до того — цей).
- Блок входу з `?intent=` у URL: над способами входу один рядок «Підписка оформлена —
  лишилось увійти», і `intent` протягується в `next` для магік-лінка, у `state` для Google,
  у payload токена для Telegram (де саме ці параметри живуть — див. `SignInForm.tsx` і
  `auth-google.ts`/`auth-telegram.ts`; веб після входу читає `intent` із URL `/app?intent=`
  і викликає `bind`).
- Екран «Підписка» після повернення з checkout (`?order=`) — опитує стан, як у плані.

## 6. Помилки й краї
- Вебхук прийшов раніше за `result_url` (типово) — `bind` уже бачить `subscribed`.
- Вебхук не прийшов (LiqPay повторює), людина вже увійшла — `bind` повертає
  `202 pending`; веб показує «чекаємо підтвердження від банку» і опитує `/v1/subscription`.
- Людина закрила checkout — `intent.pending` до 7 днів, потім `expired`; підписки в
  LiqPay не було, `unsubscribe` не потрібен.
- Той самий `intent` двічі (дві вкладки) — другий `bind` → `409 already_bound`.
- Підпис не збігся / ключі не задані — `403`/`503`, лог в `app_event` без тіла.

## 7. Тести
- Підпис: відомі приклади з документації LiqPay (data/signature) → true; зіпсований — false.
- Мапінг кожного статусу → подія або «нічого».
- Сценарій лендінга на стенді: `intent` → фейковий «subscribed» через
  `/v1/subscription/provider-event` (розширити: приймати `order_id` наміру) → реєстрація
  з `?intent=` → `bind` → стан `trial` з `trial_ends_at` = +14д.
- Сирітський намір → крон 7 днів → `unsubscribe` викликано, `expired`.

## 8. Що потрібно від власника
1. Кабінет LiqPay на ФОП, `LIQPAY_PUBLIC_KEY` / `LIQPAY_PRIVATE_KEY` (тест і прод) у Vercel.
2. `server_url` у кабінеті — `https://kitchen-os.app/v1/billing/liqpay`.
3. Один живий платіж із власної картки після викладення (пробний → перше списання
   можна перевірити лише через 14 днів; для швидкої перевірки — тестова підписка з
   `date_start` = +1 день у пісочниці).

## Поза межами
Apple/Google Pay окремо не вмикаємо — вони йдуть із hosted checkout; квитанції в
Telegram; знижки/промокоди; річний тариф.

## 9. Уточнення до плану (25.09, після розбору з виконавцем)

1. **Дата кінця пробного — одне джерело.** `ProviderEvent.subscribed` отримує явне
   `trial_ends_at: string | null` (null — без пробного). Значення рахується **один раз**,
   у момент створення наміру або checkout з профілю, і це те саме число, що пішло в
   LiqPay як `subscribe_date_start`. `applyProviderEvent` більше не рахує `now + 14`.
   Причина: між оформленням і `bind` може минути до 7 днів, і лист «пробний до {дата}»
   розʼїхався б із реальним списанням.
2. **`ingestProviderEvent(repo, ev)` — подія → дім АБО намір.** Порядок: `findSubscriptionByOrder`
   → якщо є дім — `applyProviderEvent` + запис; якщо нема — шукати `payment_intent` по
   `order_id`: `subscribed` → `intent.state='subscribed'`, зберегти `card_mask` і
   `trial_ends_at`; `unsubscribed` → `intent.state='expired'`; `success`/`failure` для
   наміру без дому — стан «не може бути» (TTL наміру 7 днів < 14 днів до першого
   списання): лог в `app_event`, відповідь 202, нічого не пишемо. Інваріант
   `INTENT_TTL_DAYS < TRIAL_DAYS` — тестом.
3. **`bind`** створює `household_subscription` через `applyProviderEvent(null,
   {kind:'subscribed', household_id, paid_by_user_id: <хто увійшов>, plan, card_mask,
   trial_ends_at: intent.trial_ends_at, trial: intent.trial_ends_at != null, order_id})`.
   Тобто `household_id`/`paid_by_user_id` у події лишаються обовʼязковими — їх дає `bind`,
   не вебхук.
4. **Стендовий `/v1/subscription/provider-event` і бойовий `/v1/billing/liqpay`** — два
   різні входи з різними моделями довіри (секрет проти підпису LiqPay), спільний лише
   `ingestProviderEvent`. Стендовий приймає й `order_id` наміру — це навмисна асиметрія
   для тесту сценарію лендінга, описати в плані явно.
