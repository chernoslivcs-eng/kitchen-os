# Біллінг: monobank замість LiqPay — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити провайдера за інтерфейсом `BillingProvider`: картка токенізується інвойсом mono на 0 ₴ (`verification`), списання робить наш крон за токеном (`wallet/payment`, `initiationKind: 'merchant'`), вебхук mono з підписом X-Sign веде події в той самий `ingestProviderEvent`.

**Architecture:** Модель «B без 1 ₴» (`PAYMENTS-RECON-0925.md` §6). Усе з #213–#219 лишається: домен, `payment_intent`, `ingestProviderEvent`, маршрути `/v1/subscription` і `/v1/billing/{intent,bind}`, веб. Міняються три речі: адаптер (`MonoProvider`), вебхук (`/v1/billing/mono`), крок списання в `billing-cron`. `provider_order_id` = наш `order_id`, який ми кладемо в `merchantPaymInfo.reference` кожного інвойсу — по ньому вебхук знаходить дім або намір. У підписці зʼявляється `card_token`.

**Tech Stack:** як у плані LiqPay; `node:crypto` (`createVerify('SHA256')`, ECDSA P-256 DER), `fetch` до `https://api.monobank.ua`.

## Global Constraints

- Спек біллінгу `2026-09-25-billing-liqpay-design.md` §2, §6, §9 діють; §3 (LiqPay) замінюється цим планом.
- Секрет один: `MONO_TOKEN` (X-Token). Без нього — `FakeBillingProvider`, вебхук 503. Тестовий у Preview, бойовий у Production — вводить власник.
- Списання ініціює лише крон, лише `initiationKind: 'merchant'`, лише в `next_charge_at` або при повторі; жодних списань з маршрутів за запитом людини.
- Повтори невдалого списання: щодня, 3 дні (`PAST_DUE_GRACE_DAYS` лишається 7 днів до `lapsed`; повтори — дні 1–3, далі мовчимо до `lapsed`).
- Ідемпотентність: `provider_payment_id` = `invoiceId` mono; крон не робить друге списання, якщо за сьогодні вже є `payment` для дому (успішний або ні).
- Код від `origin/main`; PR не мерджити без слова власника; гейти по всіх пакетах.

---

### Task 1: `card_token` у підписці; подія `subscribed` несе токен

**Files:** `migrations/0048_subscription_card_token.sql` (`ALTER TABLE household_subscription ADD COLUMN card_token text;` + `ALTER TABLE payment_intent ADD COLUMN card_token text;`), `packages/domain/subscription.ts` (`HouseholdSubscription.card_token: string | null`; `ProviderEvent.subscribed` + `card_token: string | null`; `applyProviderEvent` копіює; `unsubscribed` → `card_token: null`), `PaymentIntent.card_token`, repo (in-memory + pg мапери), контракт, `ingestProviderEvent` (для наміру зберігає `card_token` разом із `card_mask`), `bind` (передає `intent.card_token` у подію).
- [ ] Тести (домен: subscribed → card_token збережено; unsubscribed → null; контракт: save/get з токеном; ingest: намір отримує токен) → впало → код → зелено → коміт `"Біллінг mono: card_token у підписці й намірі"`.

### Task 2: `MonoProvider`

**Files:** `services/api/src/billing/mono.ts`, `mono.test.ts`; `provider.ts` — `CheckoutInput` отримує `reference: string` (= `order_id`) і `wallet_id: string` (= `household_id` або, для наміру, `order_id`); `BillingProvider` отримує `chargeByToken(input: { card_token: string; amount: number; reference: string; webhook_url: string }): Promise<{ provider_payment_id: string; status: 'success' | 'failure' | 'processing' }>` і `deleteToken(card_token: string): Promise<void>`; `unsubscribe` лишається в інтерфейсі як «скасувати підписку в провайдера» і для mono = `deleteToken` (у mono підписка живе в нас); `updateAmount` для mono — no-op (сума в нас).
```ts
export class MonoProvider implements BillingProvider {
  constructor(private token: string, private fetchImpl = fetch, private base = 'https://api.monobank.ua') {}
  async checkoutUrl(i: CheckoutInput) {
    // Інвойс 0 ₴ типу verification зі збереженням картки; повертає pageUrl.
    const r = await this.post('/api/merchant/invoice/create', { amount: 0, ccy: 980, paymentType: 'verification',
      saveCardData: { saveCard: true, walletId: i.wallet_id }, redirectUrl: i.result_url, webHookUrl: i.webhook_url,
      validity: 3600, merchantPaymInfo: { reference: i.reference, destination: `Kitchen OS · ${PLAN_NAME[i.plan]}` } });
    return r.pageUrl as string;
  }
  async chargeByToken(i) { const r = await this.post('/api/merchant/wallet/payment', { cardToken: i.card_token, amount: i.amount * 100, ccy: 980, initiationKind: 'merchant', webHookUrl: i.webhook_url, merchantPaymInfo: { reference: i.reference, destination: 'Kitchen OS · підписка' } }); return { provider_payment_id: r.invoiceId, status: mapStatus(r.status) }; }
  async deleteToken(card_token) { await this.del(`/api/merchant/wallet/card?cardToken=${encodeURIComponent(card_token)}`); } // шлях звірити з «Видалення токенізованої картки» в api-docs
  async unsubscribe(order_id) { /* no-op на боці mono; токен видаляє cancel-маршрут через deleteToken */ }
  async updateAmount() { /* no-op */ }
  private headers() { return { 'X-Token': this.token, 'Content-Type': 'application/json' }; }
}
export async function monoPubKey(fetchImpl = fetch, base = 'https://api.monobank.ua'): Promise<string>; // GET /api/merchant/pubkey → base64 → PEM; кешувати 1 год
export function monoVerify(pemPublicKey: string, rawBody: Buffer, xSignBase64: string): boolean; // crypto.createVerify('SHA256').update(rawBody).verify(pem, Buffer.from(sig,'base64'))
export function monoToEvent(body: MonoInvoiceStatus): InboundProviderEvent | null;
```
Мапінг `monoToEvent` (тіло вебхука = статус інвойсу):
- `status === 'success'` і `walletData?.status === 'created'` і `amount === 0` → `{ kind:'subscribed', order_id: reference, card_mask: paymentInfo.maskedPan → '••••1234', card_token: walletData.cardToken }`;
- `status === 'success'` і `amount > 0` → `{ kind:'success', order_id: reference, amount: amount/100, provider_payment_id: invoiceId }`;
- `status === 'failure'` і `amount > 0` → `{ kind:'failure', order_id: reference }`; `failure` на верифікації → `{ kind:'unsubscribed', order_id }` (картка не пройшла — намір/підписка не оформлені);
- `created | processing | hold | reversed | expired` → `null` (ігнор; `reversed` — лог).
`FakeBillingProvider` отримує `chargeByToken` (записує виклик, повертає `success`) і `deleteToken`.
- [ ] Тести: підпис (згенерувати пару ключів P-256 у тесті, підписати тіло, перевірити true/false); `checkoutUrl` шле `verification` + `saveCardData`; `chargeByToken` шле `initiationKind: 'merchant'` і суму в копійках; мапінг шести статусів → коміт `"Біллінг mono: адаптер, підпис X-Sign, мапінг статусів"`.

### Task 3: Вебхук `/v1/billing/mono` і `LIQPAY` → `MONO` у виборі провайдера

**Files:** `services/api/src/routes/billing.ts` (додати маршрут; маршрут `/v1/billing/liqpay` і `billing/liqpay.ts` — **видалити** разом із тестами, щоб не було двох правд), `services/api/src/billing/pick-provider.ts` (`MONO_TOKEN` → `MonoProvider`, інакше `Fake`), `server.ts`.
Маршрут: `addContentTypeParser('application/json', { parseAs: 'buffer' })` **лише для цього шляху** (потрібне сире тіло для підпису; глобальний JSON-парсер не чіпати — зробити через `config: { rawBody: true }` або окремий `fastify.register` зі своїм парсером у scope); без `MONO_TOKEN` → 503; `monoVerify` false → 403 + `app_event` без тіла; `monoToEvent` null → 200 `{ignored:true}`; інакше `ingestProviderEvent` → 200.
- [ ] Тести: 503/403/200-ignored/subscribed для наміру/success для дому (ключ P-256 з тесту) → коміт `"Біллінг mono: вебхук з X-Sign; LiqPay-адаптер прибрано"`.

### Task 4: Крок списання в кроні

**Files:** `services/api/src/billing-cron.ts`, `billing-cron.test.ts`; `Repo.listSubscriptionsDue(now)` (стан `trial|active|past_due`, `next_charge_at <= now`, `card_token` не null) + `hasPaymentToday(household_id, day)`.
Логіка: для кожної due-підписки — якщо `hasPaymentToday` → пропустити; інакше `billing.chargeByToken({ card_token, amount: PLAN_PRICE_UAH[plan], reference: provider_order_id, webhook_url })`; `success` → `ingestProviderEvent({kind:'success', …})` одразу (вебхук потім ідемпотентно повторить те саме — `insertPayment` по `invoiceId` не дублює); `failure` → `insertPayment(status:'failure')` + `applyProviderEvent(failure)` (→ `past_due`); `processing` → нічого (чекаємо вебхук). `past_due` списуємо щодня, поки `now < next_charge_at + 3 дні`; далі не чіпаємо до `tick → lapsed` (7 днів). Лист «списання не пройшло» — після першої невдачі, один раз (поле `past_due_mail_sent_at`? — ні, YAGNI: банер уже є; лист лишити на потім).
- [ ] Тести: due → списано → active + payment; невдача → past_due, повтор наступного дня, після 3 днів — тиша; сьогоднішній платіж є → не списуємо двічі; без токена → пропуск → коміт `"Крон біллінгу: списання за токеном mono з повторами"`.

### Task 5: Скасування = видалення токена; стенд; сценарій

- `POST /v1/subscription/cancel` → `billing.deleteToken(card_token)` (замість `unsubscribe`), `card_token: null`; крон більше не знайде цей дім у due.
- `bind` для наміру: `card_token` з наміру → у підписку (Task 1).
- Стенд: `FakeBillingProvider` + `STAND_SUBSCRIPTION`; сценарій `billing-scenario.test.ts` переписати під mono-події (`subscribed` з `card_token`, потім крон списує через фейк → `active`).
- [ ] Коміт `"Біллінг mono: скасування видаляє токен; сценарій наскрізь"`.

### Task 6: Юртексти і спек
- ЮРИСТ: `PRIVACY.md` субпроцесор платежів → «АТ «Універсал Банк» (monobank)» замість «LiqPay (АТ КБ «ПриватБанк»)»; `OFFER.md` — назва платіжного партнера так само. Окремий PR.
- Спек біллінгу: §3 позначити «замінено планом mono», посилання сюди.

## Порядок
TELEGRAM BOT: Tasks 1–5 одним PR (розмір ~ як #218) або двома (1–3, 4–5). Живий тест — тестовим `MONO_TOKEN` у Preview (власник), вебхук у тесті — перевірити, чи приходить; якщо ні, сценарій крону покриває шлях без вебхука (`chargeByToken` повертає статус синхронно).
