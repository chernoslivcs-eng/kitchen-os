# Біллінг LiqPay — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замість фейкового провайдера — справжній LiqPay: підписка з відкладеним першим списанням, вебхук із перевіркою підпису, оформлення з лендінга до реєстрації через намір, який привʼязується при вході.

**Architecture:** `LiqPayProvider implements BillingProvider` (підпис `base64(sha1(key+data+key))`, hosted checkout `subscribe`, серверні `unsubscribe`/`subscribe_update`); один хелпер `ingestProviderEvent` після довіри — «подія → дім або намір»; два входи з різними моделями довіри (`/v1/billing/liqpay` з підписом LiqPay, стендовий `/v1/subscription/provider-event` із секретом); `payment_intent` живе 7 днів і привʼязується `POST /v1/billing/bind` після будь-якого входу; веб протягує намір через `localStorage`, тож жоден із трьох потоків входу не змінюється.

**Tech Stack:** TypeScript, Fastify, `@kitchen/domain` (`InMemoryRepo` + контракт), Postgres, `node:crypto`, `fetch`, React/vitest, Vercel cron (уже є `cron-billing`).

## Global Constraints

- Спек: `docs/superpowers/specs/2026-09-25-billing-liqpay-design.md` (§9 — обовʼязково); базовий план `2026-09-25-lapsed-subscription.md` уже в `main` (#213–#216).
- Рішення власника «A»: при оформленні **нічого не списується**; `subscribe_date_start` = кінець пробного (+14 днів) або «зараз», якщо пробний уже використано.
- Дата кінця пробного рахується **один раз** у момент наміру/checkout і зберігається в нас; `applyProviderEvent` її не рахує.
- Інваріант `INTENT_TTL_DAYS (7) < TRIAL_DAYS (14)` — тестом.
- Ключі `LIQPAY_PUBLIC_KEY` / `LIQPAY_PRIVATE_KEY` — тільки з env, вводить власник; без них — `FakeBillingProvider`, вебхук `503`.
- `BETA_PLAN` у `copy.ts` лишається `true`; усе нове на лендінгу — за `!BETA_PLAN`, видимих змін до дня оплат немає.
- Код від `origin/main`; PR не мерджити без слова власника; гейти по всіх пакетах; тексти з рамки 23.09.

---

### Task 1: Дата пробного — явна в події, рахується в checkout

**Files:**
- Modify: `packages/domain/subscription.ts` (тип `ProviderEvent.subscribed`, `applyProviderEvent`, коментар до `TRIAL_DAYS`)
- Modify: `packages/domain/subscription.test.ts:34-50`
- Modify: `services/api/src/billing/provider.ts` (`CheckoutInput`)
- Modify: `services/api/src/routes/subscription.ts:38-66` (checkout), стендовий `provider-event` (передає `trial_ends_at` із підписки)
- Modify: `services/api/src/billing/fake-provider.ts`
- Test: `services/api/src/routes/subscription.test.ts`

**Interfaces:**
- Produces: `ProviderEvent` варіант `subscribed`: `{ kind:'subscribed'; household_id; order_id; plan; card_mask; trial_ends_at: string | null; paid_by_user_id }` — поле `trial: boolean` зникає.
- `CheckoutInput`: `{ order_id; household_id: string | null; plan; amount; date_start: string; result_url }` (`date_start` = ISO; для наміру `household_id` null).
- `export const INTENT_TTL_DAYS = 7` у `subscription.ts` + `export function trialEndsFrom(now: Date): string`.

- [ ] **Step 1: Тести**

```ts
// packages/domain/subscription.test.ts — замінити кейси 'subscribed'
it('subscribed з датою пробного → trial з тією самою датою', () => {
  const r = applyProviderEvent(null, { kind:'subscribed', household_id:'h1', order_id:'o1', plan:'home', card_mask:'4242', trial_ends_at:'2026-10-20T00:00:00.000Z', paid_by_user_id:'u1' }, now);
  expect(r.sub.state).toBe('trial');
  expect(r.sub.trial_ends_at).toBe('2026-10-20T00:00:00.000Z');
  expect(r.sub.next_charge_at).toBe('2026-10-20T00:00:00.000Z');
  expect(r.sub.trial_used_at).toBe(now.toISOString());
});
it('subscribed без пробного → active, наступне списання через місяць', () => {
  const r = applyProviderEvent(base({ state:'lapsed', trial_used_at:'2026-01-01T00:00:00Z' }), { kind:'subscribed', household_id:'h1', order_id:'o2', plan:'self', card_mask:'1111', trial_ends_at:null, paid_by_user_id:'u2' }, now);
  expect(r.sub.state).toBe('active'); expect(r.sub.next_charge_at).toBe('2026-11-01T12:00:00.000Z');
});
it('інваріант: намір живе коротше за пробний', () => { expect(INTENT_TTL_DAYS).toBeLessThan(TRIAL_DAYS); });
```
```ts
// services/api/src/routes/subscription.test.ts — дописати
it('checkout зберігає trial_ends_at у підписці і передає date_start провайдеру', async () => {
  // lapsed без trial_used_at → POST /v1/subscription/checkout {plan:'self'}
  // getSubscription().trial_ends_at === fake.calls[0].args.date_start; обидва ≈ now + 14 днів
  // дім із trial_used_at → date_start ≈ now, trial_ends_at null
});
```

- [ ] **Step 2: Прогнати — впаде** (`trial` більше не в типі / `INTENT_TTL_DAYS` нема)
- [ ] **Step 3: Реалізація**

```ts
// subscription.ts
/** Скільки триває пробний. Домен його НЕ рахує — дата приходить у події; константу
 *  використовує лише той, хто створює checkout/намір (trialEndsFrom). */
export const TRIAL_DAYS = 14;
/** Намір без реєстрації живе стільки; менше за TRIAL_DAYS — інакше success міг би прийти для наміру без дому. */
export const INTENT_TTL_DAYS = 7;
export const trialEndsFrom = (now: Date) => addDays(now, TRIAL_DAYS);
// у ProviderEvent: trial_ends_at: string | null замість trial: boolean
// у applyProviderEvent (гілка subscribed):
const trial = ev.trial_ends_at != null;
sub: { …, state: trial ? 'trial' : 'active', trial_used_at: trial ? at : sub?.trial_used_at ?? null,
       trial_ends_at: ev.trial_ends_at, next_charge_at: trial ? ev.trial_ends_at : addMonth(now), … }
```
```ts
// routes/subscription.ts checkout: замість trial: !sub?.trial_used_at
const now = new Date();
const trial_ends_at = sub?.trial_used_at ? null : trialEndsFrom(now);
await repo.saveSubscription({ …, trial_ends_at, … });               // ДО провайдера, як і order_id
const url = await billing.checkoutUrl({ order_id, household_id, plan, amount: PLAN_PRICE_UAH[plan], date_start: trial_ends_at ?? now.toISOString(), result_url: … });
// стендовий provider-event: для kind 'subscribed' без trial_ends_at у тілі — брати з підписки/наміру (Task 3 робить це в ingest)
```
`FakeBillingProvider.checkoutUrl` просто записує `date_start`.

- [ ] **Step 4: Зелено** — `pnpm --filter @kitchen/domain test && pnpm --filter @kitchen/api test`
- [ ] **Step 5: Commit** — `git commit -am "Біллінг: дата пробного явна в події, рахується в checkout; INTENT_TTL_DAYS"`

---

### Task 2: `payment_intent` — міграція, Repo, контракт

**Files:**
- Create: `migrations/0047_payment_intent.sql`
- Modify: `packages/domain/subscription.ts` (тип `PaymentIntent`), `packages/domain/repo.ts`, `packages/domain/in-memory-repo.ts`, `packages/db/postgres-repo.ts`, `packages/domain/contract.ts`

**Interfaces:**
```ts
export interface PaymentIntent {
  order_id: string; plan: Plan; state: 'pending' | 'subscribed' | 'bound' | 'expired';
  trial_ends_at: string | null; card_mask: string | null; household_id: string | null;
  ip: string | null; created_at: string; expires_at: string; bound_at: string | null;
}
// Repo:
insertIntent(i: PaymentIntent): Promise<void>;
getIntent(order_id: string): Promise<PaymentIntent | null>;
updateIntent(order_id: string, patch: Partial<Pick<PaymentIntent, 'state' | 'card_mask' | 'household_id' | 'bound_at'>>): Promise<void>;
listIntentsExpiring(before: Date): Promise<PaymentIntent[]>;   // state in (pending, subscribed) і expires_at <= before
```

- [ ] **Step 1: Міграція**

```sql
-- migrations/0047_payment_intent.sql — спек біллінгу §4: оформлення з лендінга до появи акаунта.
CREATE TABLE payment_intent (
  order_id uuid PRIMARY KEY,
  plan text NOT NULL CHECK (plan IN ('self','home')),
  state text NOT NULL CHECK (state IN ('pending','subscribed','bound','expired')),
  trial_ends_at timestamptz, card_mask text,
  household_id uuid REFERENCES household(id) ON DELETE SET NULL,
  ip text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, bound_at timestamptz
);
CREATE INDEX payment_intent_expiring_idx ON payment_intent(expires_at) WHERE state IN ('pending','subscribed');
```

- [ ] **Step 2: Контрактний тест** (`contract.ts`, блок `describe('payment_intent')`): insert → get; update state/card_mask; `listIntentsExpiring(now)` повертає лише прострочені pending/subscribed, не bound/expired.
- [ ] **Step 3: Впаде → реалізація** (in-memory: `intents = new Map()`; pg — прямі запити, `ON CONFLICT` не потрібен, `order_id` унікальний з боку сервера).
- [ ] **Step 4: Зелено** — `pnpm --filter @kitchen/domain test && pnpm --filter @kitchen/db test`
- [ ] **Step 5: Commit** — `git commit -am "Repo: payment_intent (міграція 0047), контракт"`

---

### Task 3: `ingestProviderEvent` — «подія → дім або намір»

**Files:**
- Create: `services/api/src/billing/ingest.ts`, `services/api/src/billing/ingest.test.ts`
- Modify: `services/api/src/routes/subscription.ts` (стендовий `provider-event` → викликає `ingestProviderEvent`)

**Interfaces:**
```ts
export type IngestResult = { target: 'household'; state: SubscriptionState } | { target: 'intent'; state: PaymentIntent['state'] } | { target: 'none'; reason: 'unknown_order' | 'no_household_for_money' };
export async function ingestProviderEvent(repo: Repo, ev: ProviderEvent, now: Date, log: { warn(o: object, msg: string): void }): Promise<IngestResult>;
```
Правила (спек §9.2): `findSubscriptionByOrder(order_id)` → є → `applyProviderEvent` (для `subscribed` без `trial_ends_at` у події брати `sub.trial_ends_at` — дата вже записана checkout-ом; `household_id`/`paid_by_user_id` — з підписки) → `saveSubscription` + `insertPayment` → `{target:'household'}`. Нема → `getIntent(order_id)`: `subscribed` → `updateIntent({state:'subscribed', card_mask})`; `unsubscribed` → `expired`; `success`/`failure` → `warn` + `saveAppEvents` (`billing_money_event_without_household`) + `{target:'none', reason:'no_household_for_money'}`. Нема й наміру → `{target:'none', reason:'unknown_order'}`.

- [ ] **Step 1: Тести** — пʼять кейсів: дім+success; дім+subscribed без дати (бере з підписки); намір+subscribed; намір+success (none, лог); невідомий order.
- [ ] **Step 2–4:** впаде → реалізація → зелено; стендовий маршрут стає тонким: секрет → `ingestProviderEvent` → `{ ok, result }`. Його стара поведінка для дому не змінюється (тести з #214 лишаються зеленими).
- [ ] **Step 5: Commit** — `git commit -am "Біллінг: ingestProviderEvent — дім або намір; стендовий маршрут через нього"`

---

### Task 4: LiqPay-адаптер і парсер колбеку

**Files:**
- Create: `services/api/src/billing/liqpay.ts`, `services/api/src/billing/liqpay.test.ts`

**Interfaces:**
```ts
export function liqpayEncode(obj: object): string;                     // base64(JSON)
export function liqpaySign(privateKey: string, data: string): string;  // base64(sha1(key+data+key))
export function liqpayVerify(privateKey: string, data: string, signature: string): boolean; // timingSafeEqual
export function liqpayToEvent(payload: Record<string, unknown>): ProviderEvent | null; // мапінг §3
export class LiqPayProvider implements BillingProvider {
  constructor(private keys: { publicKey: string; privateKey: string }, private serverUrl: string, private fetchImpl = fetch) {}
  async checkoutUrl(i: CheckoutInput): Promise<string>;   // https://www.liqpay.ua/api/3/checkout?data=…&signature=…
  async unsubscribe(order_id: string): Promise<void>;     // POST https://www.liqpay.ua/api/request (form: data, signature), action 'unsubscribe'
  async updateAmount(order_id: string, amount: number): Promise<void>; // action 'subscribe_update'
}
```
Параметри `subscribe`: `version:3, public_key, action:'subscribe', amount, currency:'UAH', description:` `Kitchen OS · ${PLAN_NAME[plan]} · щомісяця`, `order_id, subscribe_date_start` (UTC `YYYY-MM-DD HH:mm:ss` з `date_start`), `subscribe_periodicity:'month', result_url, server_url, language:'uk'`.
Мапінг `liqpayToEvent`: `subscribed → {kind:'subscribed', order_id, card_mask: sender_card_mask2 ?? null, …}` — **без** `household_id/paid_by_user_id/plan/trial_ends_at` (їх дає ingest із підписки або наміру; тому тип події для вебхука — `Partial` варіант: додати `export type InboundProviderEvent` = `subscribed` без цих полів | інші як є, і `ingestProviderEvent` приймає саме його); `success → {kind:'success', order_id, amount:Number(amount), provider_payment_id:String(payment_id)}`; `failure|error → failure`; `unsubscribed → unsubscribed`; `3ds_verify|otp_verify|cvv_verify|wait_secure|wait_accept|reversed` → `null`.

- [ ] **Step 1: Тести** — підпис: `liqpaySign('k', liqpayEncode({a:1}))` збігається з еталоном, порахованим у тесті через `createHash('sha1')` напряму (самоузгодженість) і `liqpayVerify` відкидає зіпсований; `checkoutUrl` містить `data` і `signature`, розкодований `data` має `action:'subscribe'`, `subscribe_date_start:'2026-10-15 12:00:00'` для `date_start:'2026-10-15T12:00:00.000Z'`; `unsubscribe` робить POST з `action:'unsubscribe'` (fetch-стаб); мапінг кожного статусу.
- [ ] **Step 2–4:** впаде → реалізація → зелено.
- [ ] **Step 5: Commit** — `git commit -am "Біллінг: LiqPay-адаптер (підпис, checkout subscribe, unsubscribe, subscribe_update, мапінг колбеку)"`

---

### Task 5: Вебхук `POST /v1/billing/liqpay` і намір `POST /v1/billing/intent`, `POST /v1/billing/bind`

**Files:**
- Create: `services/api/src/routes/billing.ts`, `services/api/src/routes/billing.test.ts`
- Modify: `services/api/src/server.ts` (реєстрація; вибір провайдера з env)

**Маршрути:**
- `POST /v1/billing/liqpay` — `application/x-www-form-urlencoded` (`data`, `signature`); якщо `LIQPAY_PRIVATE_KEY` нема → `503`; підпис не збігся → `403` + `saveAppEvents('billing_bad_signature')` без тіла; `liqpayToEvent` null → `200 {ignored:true}`; інакше `ingestProviderEvent` → `200 { ok:true, result }`. Fastify: зареєструвати парсер `app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs:'string' }, (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))))` у цьому файлі, якщо його ще нема в `server.ts`.
- `POST /v1/billing/intent {plan}` — без сесії; `makeRateLimiter` по IP (10/год); створює `PaymentIntent{ order_id: randomUUID(), plan, state:'pending', trial_ends_at: trialEndsFrom(now), expires_at: now+INTENT_TTL_DAYS, ip }` → `insertIntent` **до** провайдера → `billing.checkoutUrl({ order_id, household_id:null, plan, amount, date_start: trial_ends_at, result_url: `${appUrl}/?intent=${order_id}#l3-signin` })` → `{ url }`.
- `POST /v1/billing/bind {order_id}` — `authenticated`; намір: нема → `404`; `expired` → `410`; `bound` → `409 already_bound`; `pending` → `202 {status:'pending'}` (вебхук ще не прийшов); `subscribed` → дім людини: якщо `getSubscription(household_id)` у `trial|active|past_due` → `unsubscribe(order_id)`, `updateIntent(expired)`, `409 already_subscribed`; інакше `applyProviderEvent(sub, { kind:'subscribed', household_id, order_id, plan: intent.plan, card_mask: intent.card_mask, trial_ends_at: intent.trial_ends_at, paid_by_user_id: user_id }, now)` → `saveSubscription`, `updateIntent({state:'bound', household_id, bound_at})` → `200 { subscription }`.
  Правило одне: **`trial_ends_at` завжди береться з наміру як є**, навіть якщо дім уже використав пробний — бо саме ця дата вже стоїть у LiqPay як `subscribe_date_start`, і списання буде в неї; обнулити її в нас означало б показати людині «наступне списання через місяць», а списати через 14 днів. `trial_used_at` при цьому лишається старим (у `applyProviderEvent` — `trial ? at : sub?.trial_used_at`; тут `trial` істинний, тому виправити гілку: `trial_used_at: sub?.trial_used_at ?? (trial ? at : null)` — тест на це в Task 1). Це узгоджений компроміс спека §2: другий пробний через новий дім можливий, через той самий дім — ні, бо намір із лендінга робить лише той, хто ще не увійшов.

- [ ] **Step 1: Тести** — вебхук: 503 без ключа; 403 на зіпсований підпис; 200 ignored на `wait_secure`; `subscribed` для наміру → intent.subscribed з card_mask; `success` для дому → payment записаний. Намір: `intent` → 200 url, запис у repo до провайдера (порядок через fake.calls); ліміт по IP → 429. Bind: усі шість гілок вище.
- [ ] **Step 2–4:** впаде → реалізація → зелено. У `server.ts`: `const billing = opts.billing ?? (process.env.LIQPAY_PUBLIC_KEY && process.env.LIQPAY_PRIVATE_KEY ? new LiqPayProvider({ publicKey, privateKey }, `${appUrl}/v1/billing/liqpay`) : new FakeBillingProvider())`; `billingRoutes(app, repo, billing, appUrl)`.
- [ ] **Step 5: Commit** — `git commit -am "Біллінг: вебхук LiqPay, намір до реєстрації, bind після входу"`

---

### Task 6: Крон — прострочені наміри

**Files:**
- Modify: `services/api/src/billing-cron.ts`, `services/api/src/billing-cron.test.ts`

- [ ] **Step 1: Тест** — намір `pending` старший за 7 днів → `expired`, `unsubscribe` не викликано; `subscribed` старший за 7 днів → `unsubscribe(order_id)` викликано, `expired`; `bound` не чіпається; `out.intentsExpired` рахує.
- [ ] **Step 2–4:** впаде → реалізація (`deps.billing: BillingProvider` у `BillingCronDeps`; цикл по `listIntentsExpiring(now)`) → зелено; `cron-billing-handler.ts` передає той самий провайдер, що й `server.ts` (винести вибір у `services/api/src/billing/pick-provider.ts`).
- [ ] **Step 5: Commit** — `git commit -am "Крон біллінгу: прострочені наміри — unsubscribe і expired"`

---

### Task 7: Веб — лендінг і привʼязка наміру після входу

**Files:**
- Modify: `apps/web/src/api.ts` (`api.billing.intent(plan)`, `api.billing.bind(order_id)`)
- Modify: `apps/web/src/pages/Landing/Landing.tsx:229-233` (кнопка картки при `!BETA_PLAN`), `apps/web/src/pages/Landing/copy.ts` (рядок «Підписка оформлена — лишилось увійти», трайл-рядок «14 днів безкоштовно · картка з першого дня» при `!BETA_PLAN`)
- Modify: `apps/web/src/pages/Landing/SignInForm.tsx:109` (читає `intent` з URL → `localStorage.kos_intent`, показує рядок)
- Modify: `apps/web/src/Shell.tsx` (після `me` завантажено: `localStorage.kos_intent` → `api.billing.bind` → прибрати ключ → на `/profile/subscription` з тостом; `202 pending` → повтор через 3 с до 30 с)
- Test: `apps/web/src/pages/Landing/SignInForm.intent.test.tsx`, `apps/web/src/Shell.bind.test.tsx`

Виконує ЛЕНДІНГ після мерджу задач 1–6. Видимих змін при `BETA_PLAN=true` нема; тести ганяють обидва стани прапорця через `buildPlans(false)` і прямий рендер із `?intent=`.

- [ ] Кроки за тим самим шаблоном: тест → впав → код → зелено → коміт `"Веб: оформлення з лендінга через намір, привʼязка після входу"`.

---

### Task 8: Стенд і живий сценарій

**Files:**
- Modify: `scripts/stand-seed.mts` — `STAND_SUBSCRIPTION=<state>` засіває `household_subscription`; фейкові провайдери входу (як у тимчасовій копії, що використовувалась для пар #216) — під `STAND_FAKE_AUTH=1`.
- Сценарій у тесті `services/api/src/routes/billing.scenario.test.ts`: `intent` → стендовий `provider-event` `{kind:'subscribed', order_id}` (без household) → намір `subscribed` → реєстрація (створити користувача/сесію напряму через repo) → `bind` → підписка `trial` з `trial_ends_at` = дата наміру → через 15 днів `success` → `active`.

- [ ] Тест → зелено → коміт `"Стенд: підписка і фейкові провайдери за env; сценарій наміру наскрізь"`.

---

## Порядок і хто робить

1. Tasks 1–6, 8 — TELEGRAM BOT, двома PR: (1–3) і (4–6, 8). Обидва без ключів LiqPay перевіряються повністю (фейк + підпис у тестах).
2. Task 7 — ЛЕНДІНГ після мерджу другого PR.
3. Живий платіж — після появи `LIQPAY_*` у Vercel і `server_url` у кабінеті (спек §8), у пісочниці LiqPay з `date_start = +1 день`.
4. Юртексти не міняються (уже під «A»).

## Self-review
- §2 спека (намір → checkout → вебхук → bind → 7 днів) → Tasks 2, 5, 6. §3 (підпис, параметри, мапінг) → 4. §4 (дані) → 2. §5 (веб) → 7. §6 (краї: ранній/пізній вебхук, дві вкладки, підпис) → 5. §7 (тести) → 4, 5, 8. §9 (дата один раз, ingest, інваріант, асиметрія) → 1, 3, 5.
- Імена узгоджені: `trialEndsFrom`, `INTENT_TTL_DAYS`, `PaymentIntent`, `insertIntent/getIntent/updateIntent/listIntentsExpiring`, `ingestProviderEvent`, `InboundProviderEvent`, `liqpayEncode/liqpaySign/liqpayVerify/liqpayToEvent`, `LiqPayProvider`, `CheckoutInput.date_start`, `api.billing.intent/bind`.
- Плейсхолдерів нема; Task 7 і 8 описані кроками без повного коду навмисно — веб-частина залежить від того, як ляжуть 1–6, і виконавець вебу пише тести за наведеними контрактами.
