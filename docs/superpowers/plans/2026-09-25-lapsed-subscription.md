# Режим без підписки — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дім отримує стан підписки; без підписки модель не викликається, людина бачить заскриптований паювел, читає свої дані, а в профілі має екран «Підписка», де оформлює/скасовує/міняє тариф; щоденний крон переводить стани, шле листи й видаляє тихі доми через пів року.

**Architecture:** Стан підписки — рядок `household_subscription` (1:1 з домом), чисті функції домену рахують `entitlement` і переходи; єдині ворота — на вході `runChatTurn` (веб і Telegram текст/файл) плюс перевірка перед STT у голосі і перед дайджестом; провайдер оплат сховано за інтерфейсом `BillingProvider` з фейком (справжній LiqPay-адаптер і вебхук — окремий план біллінгу). Веб лише малює те, що віддає `/v1/me` і `/v1/subscription`.

**Tech Stack:** TypeScript, Fastify (services/api), домен `@kitchen/domain` з `InMemoryRepo` і контрактними тестами, Postgres (`packages/db/postgres-repo.ts`, міграції SQL), React + vitest (apps/web), Vercel cron.

## Global Constraints

- Спек: `docs/superpowers/specs/2026-09-25-lapsed-subscription-design.md` — тексти §3 у код **дослівно**; заборонені слова рамки 23.09: «безпечно», «гарантуємо», «придатне», «не містить», «на жаль», «шкода», «прикро».
- Стани: `beta | trial | active | cancelled | past_due | lapsed`; entitlement: `full | read_only`.
- Підписка належить дому; будь-який член може оформити/скасувати/змінити; пробний — один раз на дім (`trial_used_at`).
- Підвищення тарифу — одразу, пониження — з наступного списання.
- Тиша: 6 місяців без входу в `lapsed` → лист → +30 днів → видалення дому.
- Ціни: `self` 210 ₴, `home` 290 ₴ (`packages/domain/plans.ts`).
- Код на `origin/main`; гілка від нього; PR не мерджити без слова власника; перед push — `pnpm -r test`, `pnpm -r typecheck`, lint.
- Істина коду — `origin/main` (робоча тека може стояти на старій гілці).
- Веб імпортує з `@kitchen/domain` лише глибокі шляхи (`@kitchen/domain/paywall`), не барел.

---

### Task 1: Домен — типи підписки й `entitlementOf`

**Files:**
- Create: `packages/domain/subscription.ts`
- Test: `packages/domain/subscription.test.ts`
- Modify: `packages/domain/plans.ts` (додати ціни числом)

**Interfaces:**
- Produces: `SubscriptionState`, `Plan`, `HouseholdSubscription`, `Entitlement`, `entitlementOf(sub, now, opts)`, `PLAN_PRICE_UAH`.

- [ ] **Step 1: Тест**

```ts
// packages/domain/subscription.test.ts
import { describe, it, expect } from 'vitest';
import { entitlementOf, type HouseholdSubscription } from './subscription.js';

const base = (p: Partial<HouseholdSubscription>): HouseholdSubscription => ({
  household_id: 'h1', state: 'active', plan: 'self', trial_used_at: null, trial_ends_at: null,
  next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null,
  paid_by_user_id: null, deletion_warned_at: null, trial_mail_sent_at: null, updated_at: '2026-09-25T00:00:00Z', ...p,
});
const now = new Date('2026-10-01T12:00:00Z');

describe('entitlementOf', () => {
  it('без рядка: full у бету, read_only без бети', () => {
    expect(entitlementOf(null, now, { beta: true })).toBe('full');
    expect(entitlementOf(null, now, { beta: false })).toBe('read_only');
  });
  it.each([
    ['beta', {}, 'full'],
    ['active', {}, 'full'],
    ['past_due', {}, 'full'],
    ['lapsed', {}, 'read_only'],
    ['trial', { trial_ends_at: '2026-10-15T00:00:00Z' }, 'full'],
    ['trial', { trial_ends_at: '2026-09-30T00:00:00Z' }, 'read_only'],
    ['cancelled', { access_until: '2026-10-15T00:00:00Z' }, 'full'],
    ['cancelled', { access_until: '2026-09-30T00:00:00Z' }, 'read_only'],
  ] as const)('%s %o → %s', (state, extra, want) => {
    expect(entitlementOf(base({ state, ...extra }), now, { beta: false })).toBe(want);
  });
});
```

- [ ] **Step 2: Прогнати — має впасти**

Run: `pnpm --filter @kitchen/domain test -- subscription`
Expected: FAIL — `Cannot find module './subscription.js'`

- [ ] **Step 3: Реалізація**

```ts
// packages/domain/subscription.ts
// Стан підписки ДОМУ (спек 2026-09-25-lapsed-subscription-design.md §1).
export type SubscriptionState = 'beta' | 'trial' | 'active' | 'cancelled' | 'past_due' | 'lapsed';
export type Plan = 'self' | 'home';
export type Entitlement = 'full' | 'read_only';

export interface HouseholdSubscription {
  household_id: string;
  state: SubscriptionState;
  plan: Plan | null;
  trial_used_at: string | null;
  trial_ends_at: string | null;
  next_charge_at: string | null;
  access_until: string | null;
  provider_order_id: string | null;
  card_mask: string | null;
  paid_by_user_id: string | null;
  deletion_warned_at: string | null;
  /** Лист «за 3 дні до кінця пробного» надіслано — щоб крон не слав двічі. */
  trial_mail_sent_at: string | null;
  updated_at: string;
}

/** Рахується на кожен запит, без кешу: оплата з іншого пристрою вмикає все негайно. */
export function entitlementOf(sub: HouseholdSubscription | null, now: Date, opts: { beta: boolean }): Entitlement {
  if (!sub) return opts.beta ? 'full' : 'read_only';
  switch (sub.state) {
    case 'beta': case 'active': case 'past_due': return 'full';
    case 'lapsed': return 'read_only';
    case 'trial': return sub.trial_ends_at && now < new Date(sub.trial_ends_at) ? 'full' : 'read_only';
    case 'cancelled': return sub.access_until && now < new Date(sub.access_until) ? 'full' : 'read_only';
  }
}

/** Прапорець бети — з env, один на процес. */
export function betaFlag(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUBSCRIPTION_BETA !== '0';
}
```

І в `packages/domain/plans.ts` дописати:

```ts
export const PLAN_PRICE_UAH: Record<'self' | 'home', number> = { self: 210, home: 290 };
export const PLAN_NAME: Record<'self' | 'home', string> = { self: 'Для себе', home: 'Для дому' };
```

- [ ] **Step 4: Прогнати — зелено**

Run: `pnpm --filter @kitchen/domain test -- subscription`
Expected: PASS (10 тестів)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/subscription.ts packages/domain/subscription.test.ts packages/domain/plans.ts
git commit -m "Домен: стан підписки дому, entitlementOf, ціни тарифів числом"
```

---

### Task 2: Домен — переходи станів (крон і події провайдера)

**Files:**
- Modify: `packages/domain/subscription.ts`
- Test: `packages/domain/subscription.test.ts`

**Interfaces:**
- Produces: `ProviderEvent`, `applyProviderEvent(sub, ev, now)`, `tick(sub, now)`, константи `PAST_DUE_GRACE_DAYS = 7`, `TRIAL_DAYS = 14`.

- [ ] **Step 1: Тест**

```ts
// дописати в packages/domain/subscription.test.ts
import { applyProviderEvent, tick } from './subscription.js';

describe('applyProviderEvent', () => {
  it('subscribed з пробним → trial з датами і card_mask', () => {
    const r = applyProviderEvent(null, { kind: 'subscribed', household_id: 'h1', order_id: 'o1', plan: 'home', card_mask: '4242', trial: true, paid_by_user_id: 'u1' }, now);
    expect(r.sub.state).toBe('trial');
    expect(r.sub.trial_ends_at).toBe('2026-10-15T12:00:00.000Z');
    expect(r.sub.trial_used_at).toBe(now.toISOString());
    expect(r.sub.next_charge_at).toBe('2026-10-15T12:00:00.000Z');
  });
  it('subscribed без пробного (повернення) → active, наступне списання через місяць', () => {
    const prev = base({ state: 'lapsed', trial_used_at: '2026-01-01T00:00:00Z' });
    const r = applyProviderEvent(prev, { kind: 'subscribed', household_id: 'h1', order_id: 'o2', plan: 'self', card_mask: '1111', trial: false, paid_by_user_id: 'u2' }, now);
    expect(r.sub.state).toBe('active');
    expect(r.sub.next_charge_at).toBe('2026-11-01T12:00:00.000Z');
  });
  it('success у trial → active, платіж записаний, next_charge +1 міс', () => {
    const prev = base({ state: 'trial', trial_ends_at: '2026-10-01T00:00:00Z', next_charge_at: '2026-10-01T00:00:00Z', provider_order_id: 'o1' });
    const r = applyProviderEvent(prev, { kind: 'success', order_id: 'o1', amount: 210, provider_payment_id: 'p1' }, now);
    expect(r.sub.state).toBe('active');
    expect(r.payment).toMatchObject({ household_id: 'h1', amount: 210, status: 'success' });
    expect(r.sub.next_charge_at).toBe('2026-11-01T00:00:00.000Z');
  });
  it('failure → past_due; unsubscribed → cancelled з access_until = next_charge_at', () => {
    const prev = base({ next_charge_at: '2026-10-20T00:00:00Z', provider_order_id: 'o1' });
    expect(applyProviderEvent(prev, { kind: 'failure', order_id: 'o1' }, now).sub.state).toBe('past_due');
    const c = applyProviderEvent(prev, { kind: 'unsubscribed', order_id: 'o1' }, now).sub;
    expect(c.state).toBe('cancelled');
    expect(c.access_until).toBe('2026-10-20T00:00:00Z');
  });
});

describe('tick (щоденний крон)', () => {
  it('cancelled після access_until → lapsed', () => {
    expect(tick(base({ state: 'cancelled', access_until: '2026-09-30T00:00:00Z' }), now)?.state).toBe('lapsed');
  });
  it('past_due довше за 7 днів після next_charge_at → lapsed', () => {
    expect(tick(base({ state: 'past_due', next_charge_at: '2026-09-20T00:00:00Z' }), now)?.state).toBe('lapsed');
    expect(tick(base({ state: 'past_due', next_charge_at: '2026-09-28T00:00:00Z' }), now)).toBeNull();
  });
  it('trial після trial_ends_at + 1 день без success → past_due', () => {
    expect(tick(base({ state: 'trial', trial_ends_at: '2026-09-29T00:00:00Z', next_charge_at: '2026-09-29T00:00:00Z' }), now)?.state).toBe('past_due');
  });
  it('active з next_charge_at у майбутньому — без змін', () => {
    expect(tick(base({ next_charge_at: '2026-11-01T00:00:00Z' }), now)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнати — впаде** (`applyProviderEvent is not a function`)

- [ ] **Step 3: Реалізація** (дописати в `subscription.ts`)

```ts
export const TRIAL_DAYS = 14;
export const PAST_DUE_GRACE_DAYS = 7;
const DAY = 86_400_000;
const addDays = (iso: string | Date, d: number) => new Date(new Date(iso).getTime() + d * DAY).toISOString();
const addMonth = (iso: string | Date) => { const x = new Date(iso); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString(); };

export type ProviderEvent =
  | { kind: 'subscribed'; household_id: string; order_id: string; plan: Plan; card_mask: string | null; trial: boolean; paid_by_user_id: string }
  | { kind: 'success'; order_id: string; amount: number; provider_payment_id: string }
  | { kind: 'failure'; order_id: string }
  | { kind: 'unsubscribed'; order_id: string };

export interface PaymentRow {
  id: string; household_id: string; amount: number; currency: 'UAH';
  status: 'success' | 'failure'; provider_payment_id: string | null;
  paid_by_user_id: string | null; receipt_url: string | null; created_at: string;
}

/** Чиста функція: нова підписка + (опційно) платіж для запису. Ідемпотентність по provider_payment_id — на рівні repo. */
export function applyProviderEvent(sub: HouseholdSubscription | null, ev: ProviderEvent, now: Date): { sub: HouseholdSubscription; payment?: Omit<PaymentRow, 'id'> } {
  const at = now.toISOString();
  if (ev.kind === 'subscribed') {
    const trialEnds = ev.trial ? addDays(now, TRIAL_DAYS) : null;
    return { sub: {
      household_id: ev.household_id, state: ev.trial ? 'trial' : 'active', plan: ev.plan,
      trial_used_at: ev.trial ? at : sub?.trial_used_at ?? null, trial_ends_at: trialEnds,
      next_charge_at: ev.trial ? trialEnds : addMonth(now), access_until: null,
      provider_order_id: ev.order_id, card_mask: ev.card_mask, paid_by_user_id: ev.paid_by_user_id,
      deletion_warned_at: null, updated_at: at,
    } };
  }
  if (!sub) throw new Error(`provider event ${ev.kind} for unknown order ${ev.order_id}`);
  if (ev.kind === 'success') {
    return {
      sub: { ...sub, state: 'active', next_charge_at: addMonth(sub.next_charge_at ?? now), updated_at: at },
      payment: { household_id: sub.household_id, amount: ev.amount, currency: 'UAH', status: 'success', provider_payment_id: ev.provider_payment_id, paid_by_user_id: sub.paid_by_user_id, receipt_url: null, created_at: at },
    };
  }
  if (ev.kind === 'failure') return { sub: { ...sub, state: 'past_due', updated_at: at } };
  return { sub: { ...sub, state: 'cancelled', access_until: sub.next_charge_at, card_mask: null, updated_at: at } };
}

/** Що крон робить із рядком сьогодні; null — нічого. */
export function tick(sub: HouseholdSubscription, now: Date): HouseholdSubscription | null {
  const at = now.toISOString();
  if (sub.state === 'cancelled' && sub.access_until && now >= new Date(sub.access_until)) return { ...sub, state: 'lapsed', updated_at: at };
  if (sub.state === 'past_due' && sub.next_charge_at && now >= new Date(addDays(sub.next_charge_at, PAST_DUE_GRACE_DAYS))) return { ...sub, state: 'lapsed', updated_at: at };
  if (sub.state === 'trial' && sub.trial_ends_at && now >= new Date(addDays(sub.trial_ends_at, 1))) return { ...sub, state: 'past_due', updated_at: at };
  return null;
}
```

- [ ] **Step 4: Прогнати — зелено**

- [ ] **Step 5: Commit** — `git commit -am "Домен: події провайдера і щоденні переходи підписки"`

---

### Task 3: Домен — тексти паювела й листів

**Files:**
- Create: `packages/domain/paywall.ts`, `packages/domain/paywall.test.ts`

**Interfaces:**
- Produces: `PAYWALL`, `paywallBody(state)`, `bannerFor(sub, now)`, `MAIL`.

- [ ] **Step 1: Тест**

```ts
// packages/domain/paywall.test.ts
import { describe, it, expect } from 'vitest';
import { PAYWALL, MAIL, bannerFor, paywallBody } from './paywall.js';

const BANNED = /безпечн|гарантує|придатн|не містить|на жаль|шкода|прикро/i;
const all = JSON.stringify({ PAYWALL, MAIL });

describe('paywall copy', () => {
  it('без заборонених слів', () => { expect(all).not.toMatch(BANNED); });
  it('тіло 402 має kind, текст і двері', () => {
    expect(paywallBody('lapsed')).toEqual({ kind: 'paywall', state: 'lapsed', text: PAYWALL.chat.text, cta: { label: 'Продовжити', to: '/profile/subscription' } });
  });
  it('банер по станах', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(bannerFor({ state: 'lapsed' } as never, now)?.text).toBe('Підписка закінчилась — усе лишив як було.');
    expect(bannerFor({ state: 'trial', trial_ends_at: '2026-10-03T00:00:00Z', plan: 'self' } as never, now)?.text).toContain('далі 210 ₴/міс');
    expect(bannerFor({ state: 'trial', trial_ends_at: '2026-10-20T00:00:00Z', plan: 'self' } as never, now)).toBeNull();
    expect(bannerFor({ state: 'active' } as never, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнати — впаде**

- [ ] **Step 3: Реалізація** (тексти зі спека §3, дослівно)

```ts
// packages/domain/paywall.ts
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
```

- [ ] **Step 4: Прогнати — зелено**
- [ ] **Step 5: Commit** — `git commit -am "Домен: тексти паювела, банерів і листів (копірайтер 25.09)"`

---

### Task 4: Repo — міграція, методи, in-memory і Postgres, контрактні тести

**Files:**
- Create: `migrations/0046_household_subscription.sql`
- Modify: `packages/domain/repo.ts` (інтерфейс), `packages/domain/in-memory-repo.ts`, `packages/db/postgres-repo.ts`, `packages/domain/contract.ts` (контрактні тести — виконуються і на in-memory, і на pg у `packages/db`)

**Interfaces:**
- Produces на `Repo`:
  - `getSubscription(household_id): Promise<HouseholdSubscription | null>`
  - `saveSubscription(sub: HouseholdSubscription): Promise<void>` (upsert)
  - `findSubscriptionByOrder(order_id): Promise<HouseholdSubscription | null>`
  - `listSubscriptionsByState(states: SubscriptionState[]): Promise<HouseholdSubscription[]>`
  - `insertPayment(p: Omit<PaymentRow,'id'>): Promise<boolean>` — `false`, якщо `provider_payment_id` уже є (ідемпотентність)
  - `listPayments(household_id): Promise<PaymentRow[]>`
  - `householdLastSeenAt(household_id): Promise<string | null>` — max `user.last_seen_at` серед членів
  - `deleteHousehold(household_id): Promise<void>` — усе, що є в домі; членство знімається; акаунти лишаються

- [ ] **Step 1: Міграція**

```sql
-- migrations/0046_household_subscription.sql
-- Спек 2026-09-25-lapsed-subscription-design.md §6: підписка належить дому.
CREATE TABLE household_subscription (
  household_id uuid PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('beta','trial','active','cancelled','past_due','lapsed')),
  plan text CHECK (plan IN ('self','home')),
  trial_used_at timestamptz, trial_ends_at timestamptz, next_charge_at timestamptz, access_until timestamptz,
  provider_order_id text UNIQUE, card_mask text, paid_by_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  deletion_warned_at timestamptz, trial_mail_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL, currency text NOT NULL DEFAULT 'UAH',
  status text NOT NULL CHECK (status IN ('success','failure')),
  provider_payment_id text UNIQUE, paid_by_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  receipt_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_household_idx ON payment(household_id, created_at DESC);
```

- [ ] **Step 2: Контрактний тест** (у `packages/domain/contract.ts`, поруч із тестами `createUserFromTelegram`; той самий `ctx.repo`)

```ts
describe('subscription', () => {
  it('save/get/findByOrder/listByState', async () => {
    const { household_id } = await ctx.repo.createUserWithHousehold('s1@x.test', 'S');
    const sub = { household_id, state: 'trial' as const, plan: 'self' as const, trial_used_at: '2026-10-01T00:00:00.000Z', trial_ends_at: '2026-10-15T00:00:00.000Z', next_charge_at: '2026-10-15T00:00:00.000Z', access_until: null, provider_order_id: 'ord-1', card_mask: '4242', paid_by_user_id: null, deletion_warned_at: null, updated_at: '2026-10-01T00:00:00.000Z' };
    await ctx.repo.saveSubscription(sub);
    expect(await ctx.repo.getSubscription(household_id)).toMatchObject({ state: 'trial', provider_order_id: 'ord-1' });
    expect((await ctx.repo.findSubscriptionByOrder('ord-1'))?.household_id).toBe(household_id);
    await ctx.repo.saveSubscription({ ...sub, state: 'lapsed' });
    expect((await ctx.repo.listSubscriptionsByState(['lapsed'])).map((s) => s.household_id)).toContain(household_id);
  });
  it('insertPayment ідемпотентний по provider_payment_id', async () => {
    const { household_id } = await ctx.repo.createUserWithHousehold('s2@x.test', 'S');
    const p = { household_id, amount: 210, currency: 'UAH' as const, status: 'success' as const, provider_payment_id: 'pay-1', paid_by_user_id: null, receipt_url: null, created_at: '2026-10-15T00:00:00.000Z' };
    expect(await ctx.repo.insertPayment(p)).toBe(true);
    expect(await ctx.repo.insertPayment(p)).toBe(false);
    expect(await ctx.repo.listPayments(household_id)).toHaveLength(1);
  });
  it('householdLastSeenAt — максимум по членах; deleteHousehold зносить дім, лишає акаунти', async () => {
    const { user_id, household_id } = await ctx.repo.createUserWithHousehold('s3@x.test', 'S');
    await ctx.repo.touchUser(user_id, 'last_seen_at', '2026-09-01T00:00:00.000Z');
    expect(await ctx.repo.householdLastSeenAt(household_id)).toBe('2026-09-01T00:00:00.000Z');
    await ctx.repo.deleteHousehold(household_id);
    expect(await ctx.repo.getHousehold(household_id)).toBeNull();
    expect(await ctx.repo.getUser(user_id)).not.toBeNull();
  });
});
```

`last_seen_at` уже є в `UserRow` (repo.ts:98); додати `'last_seen_at'` до `UserStampField` (repo.ts:32), якщо його там нема.

- [ ] **Step 3: Прогнати — впаде** (`pnpm --filter @kitchen/domain test -- contract` і `pnpm --filter @kitchen/db test`)

- [ ] **Step 4: Інтерфейс + in-memory**

```ts
// packages/domain/repo.ts — у interface Repo:
getSubscription(household_id: string): Promise<HouseholdSubscription | null>;
saveSubscription(sub: HouseholdSubscription): Promise<void>;
findSubscriptionByOrder(order_id: string): Promise<HouseholdSubscription | null>;
listSubscriptionsByState(states: SubscriptionState[]): Promise<HouseholdSubscription[]>;
insertPayment(p: Omit<PaymentRow, 'id'>): Promise<boolean>;
listPayments(household_id: string): Promise<PaymentRow[]>;
householdLastSeenAt(household_id: string): Promise<string | null>;
deleteHousehold(household_id: string): Promise<void>;
```

```ts
// packages/domain/in-memory-repo.ts — поля: subscriptions = new Map<string, HouseholdSubscription>(); payments: PaymentRow[] = [];
async getSubscription(household_id: string) { return this.subscriptions.get(household_id) ?? null; }
async saveSubscription(sub: HouseholdSubscription) { this.subscriptions.set(sub.household_id, { ...sub }); }
async findSubscriptionByOrder(order_id: string) { return [...this.subscriptions.values()].find((s) => s.provider_order_id === order_id) ?? null; }
async listSubscriptionsByState(states: SubscriptionState[]) { return [...this.subscriptions.values()].filter((s) => states.includes(s.state)); }
async insertPayment(p: Omit<PaymentRow, 'id'>) {
  if (p.provider_payment_id && this.payments.some((x) => x.provider_payment_id === p.provider_payment_id)) return false;
  this.payments.push({ id: randomUUID(), ...p }); return true;
}
async listPayments(household_id: string) { return this.payments.filter((p) => p.household_id === household_id).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
async householdLastSeenAt(household_id: string) {
  const seen = this.members.filter((m) => m.household_id === household_id).map((m) => this.users.get(m.user_id)?.last_seen_at ?? null).filter((x): x is string => !!x);
  return seen.length ? seen.sort().at(-1)! : null;
}
async deleteHousehold(household_id: string) {
  this.households.delete(household_id); this.subscriptions.delete(household_id);
  this.members = this.members.filter((m) => m.household_id !== household_id);
  for (const [id, b] of this.batches) if (b.household_id === household_id) this.batches.delete(id);
  for (const [id, p] of this.products) if (p.household_id === household_id) this.products.delete(id);
  // + інші мапи з household_id у цьому класі: рецепти, події, список, картки, повідомлення сесій дому — пройти по кожній так само.
}
```

- [ ] **Step 5: Postgres** (`packages/db/postgres-repo.ts`, стиль сусідніх методів)

```ts
async getSubscription(household_id: string) {
  const { rows } = await this.pool.query('SELECT * FROM household_subscription WHERE household_id = $1', [household_id]);
  return rows[0] ? subRow(rows[0]) : null;
}
async saveSubscription(s: HouseholdSubscription) {
  await this.pool.query(`INSERT INTO household_subscription (household_id, state, plan, trial_used_at, trial_ends_at, next_charge_at, access_until, provider_order_id, card_mask, paid_by_user_id, deletion_warned_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (household_id) DO UPDATE SET state=EXCLUDED.state, plan=EXCLUDED.plan, trial_used_at=EXCLUDED.trial_used_at, trial_ends_at=EXCLUDED.trial_ends_at, next_charge_at=EXCLUDED.next_charge_at, access_until=EXCLUDED.access_until, provider_order_id=EXCLUDED.provider_order_id, card_mask=EXCLUDED.card_mask, paid_by_user_id=EXCLUDED.paid_by_user_id, deletion_warned_at=EXCLUDED.deletion_warned_at, updated_at=EXCLUDED.updated_at`,
    [s.household_id, s.state, s.plan, s.trial_used_at, s.trial_ends_at, s.next_charge_at, s.access_until, s.provider_order_id, s.card_mask, s.paid_by_user_id, s.deletion_warned_at, s.updated_at]);
}
async findSubscriptionByOrder(order_id: string) { const { rows } = await this.pool.query('SELECT * FROM household_subscription WHERE provider_order_id = $1', [order_id]); return rows[0] ? subRow(rows[0]) : null; }
async listSubscriptionsByState(states: SubscriptionState[]) { const { rows } = await this.pool.query('SELECT * FROM household_subscription WHERE state = ANY($1)', [states]); return rows.map(subRow); }
async insertPayment(p: Omit<PaymentRow, 'id'>) {
  const { rowCount } = await this.pool.query(`INSERT INTO payment (household_id, amount, currency, status, provider_payment_id, paid_by_user_id, receipt_url, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (provider_payment_id) DO NOTHING`,
    [p.household_id, p.amount, p.currency, p.status, p.provider_payment_id, p.paid_by_user_id, p.receipt_url, p.created_at]);
  return (rowCount ?? 0) > 0;
}
async listPayments(household_id: string) { const { rows } = await this.pool.query('SELECT * FROM payment WHERE household_id = $1 ORDER BY created_at DESC', [household_id]); return rows.map(payRow); }
async householdLastSeenAt(household_id: string) {
  const { rows } = await this.pool.query('SELECT max(u.last_seen_at) AS m FROM household_member hm JOIN "user" u ON u.id = hm.user_id WHERE hm.household_id = $1', [household_id]);
  return rows[0]?.m ? new Date(rows[0].m).toISOString() : null;
}
async deleteHousehold(household_id: string) { await this.pool.query('DELETE FROM household WHERE id = $1', [household_id]); } // FK ON DELETE CASCADE на всіх таблицях дому — перевірити \d+ household у міграціях; де каскаду нема, додати в 0046.
```
`subRow`/`payRow` — мапери timestamptz → ISO, як інші мапери у файлі. Назву таблиці членства (`household_member`) звірити з міграцією 0001.

- [ ] **Step 6: Прогнати контракт на обох** — `pnpm --filter @kitchen/domain test && pnpm --filter @kitchen/db test` → PASS
- [ ] **Step 7: Commit** — `git commit -am "Repo: household_subscription і payment, міграція 0046, контрактні тести"`

---

### Task 5: Ворота в `runChatTurn` (веб і Telegram текст/файл)

**Files:**
- Modify: `services/api/src/chat-turn.ts:110-125`
- Test: `services/api/src/chat-turn.paywall.test.ts`

**Interfaces:**
- Consumes: `entitlementOf`, `betaFlag`, `paywallBody`, `repo.getSubscription`.
- Produces: `ChatTurnHttpError(402, paywallBody(...))` — маршрут `/v1/chat` уже перетворює `ChatTurnHttpError` на HTTP (chat.ts:52-60).

- [ ] **Step 1: Тест**

```ts
// services/api/src/chat-turn.paywall.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '@kitchen/domain/in-memory-repo';
import { runChatTurn, ChatTurnHttpError } from './chat-turn.js';
import { InMemoryStore } from './attachment-store.js';

describe('runChatTurn без підписки', () => {
  it('lapsed → 402 paywall, повідомлення не збережене, модель не викликана', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('p@x.test', 'P');
    await repo.saveSubscription({ household_id, state: 'lapsed', plan: 'self', trial_used_at: null, trial_ends_at: null, next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null, paid_by_user_id: null, deletion_warned_at: null, updated_at: new Date().toISOString() });
    let modelCalls = 0;
    const opts = { model: async () => { modelCalls++; return { text: '' }; } } as never; // той самий стаб моделі, що в chat-turn.test.ts
    const err = await runChatTurn(repo, new InMemoryStore(), opts, { user: { user_id, household_id }, text: 'що на вечерю?', channel: 'web' }).catch((e) => e);
    expect(err).toBeInstanceOf(ChatTurnHttpError);
    expect(err.status).toBe(402);
    expect(err.body).toMatchObject({ kind: 'paywall', cta: { to: '/profile/subscription' } });
    expect(modelCalls).toBe(0);
    expect(await repo.hasUserMessageSince(user_id, '2000-01-01T00:00:00Z')).toBe(false);
  });
});
```
Стаб моделі взяти з наявного `chat-turn.test.ts` (як там підміняють модель через `opts`), щоб тест не залежав від OpenRouter.

- [ ] **Step 2: Прогнати — впаде** (зараз піде в модель або збереже повідомлення)

- [ ] **Step 3: Реалізація** — у `runChatTurn` одразу після `const { user_id, household_id } = ctx;` (рядок ~114):

```ts
import { entitlementOf, betaFlag } from '@kitchen/domain/subscription';
import { paywallBody } from '@kitchen/domain/paywall';
// ...
const sub = await repo.getSubscription(household_id);
if (entitlementOf(sub, new Date(), { beta: betaFlag() }) === 'read_only') {
  throw new ChatTurnHttpError(402, paywallBody(sub?.state ?? 'lapsed'));
}
```
Переконатись, що це стоїть **до** `saveMsg` ходу людини і до створення сесії.

- [ ] **Step 4: Прогнати — зелено**; також `pnpm --filter @kitchen/api test` цілком (нічого не має зламатись: без рядка підписки і з `SUBSCRIPTION_BETA` не `0` — `full`).
- [ ] **Step 5: Commit** — `git commit -am "Ворота: 402 paywall у runChatTurn без підписки"`

---

### Task 6: Telegram — голос до STT і рендер паювела

**Files:**
- Modify: `services/api/src/telegram.ts` — `handleTelegramText` (~627-800), `handleTelegramFile` (~410-470), `handleTelegramVoice` (~807+)
- Test: `services/api/src/telegram.paywall.test.ts` (стиль — наявні `telegram*.test.ts`, `deps.turn` як стаб)

**Interfaces:**
- Consumes: `ChatTurnHttpError` зі status 402; `webLink(deps, user_id)` (telegram.ts:372) для кнопки; `PAYWALL.chat`.
- Produces: `TelegramReply` з `messages: [PAYWALL.chat.text]` і `keyboard: [[{ text: 'Продовжити', url: <webLink на /profile/subscription> }]]`.

- [ ] **Step 1: Тест**

```ts
// services/api/src/telegram.paywall.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '@kitchen/domain/in-memory-repo';
import { PAYWALL } from '@kitchen/domain/paywall';
import { handleTelegramText, handleTelegramVoice } from './telegram.js';
import { ChatTurnHttpError } from './chat-turn.js';
import { paywallBody } from '@kitchen/domain/paywall';

async function lapsedDeps() {
  const repo = new InMemoryRepo();
  const { user_id, household_id } = await repo.createUserWithHousehold('t@x.test', 'T');
  await repo.linkTelegram({ telegram_user_id: 777, user_id, chat_id: 555, linked_at: new Date().toISOString(), revoked_at: null });
  await repo.saveSubscription({ household_id, state: 'lapsed', plan: null, trial_used_at: null, trial_ends_at: null, next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null, paid_by_user_id: null, deletion_warned_at: null, updated_at: new Date().toISOString() });
  let stt = 0;
  const deps = { repo, appUrl: 'http://app.test', stt: async () => { stt++; return { text: 'молоко' }; }, turn: async () => { throw new ChatTurnHttpError(402, paywallBody('lapsed')); } } as never;
  return { deps, stt: () => stt };
}

describe('telegram без підписки', () => {
  it('текст → паювел з кнопкою на сайт', async () => {
    const { deps } = await lapsedDeps();
    const r = await handleTelegramText(deps, { telegram_user_id: 777, chat_id: 555, text: 'що є вдома?' } as never);
    expect(r.messages).toEqual([PAYWALL.chat.text]);
    expect(r.keyboard?.[0]?.[0]).toMatchObject({ text: 'Продовжити' });
    expect(r.keyboard?.[0]?.[0]?.url).toContain('/profile/subscription');
  });
  it('голос → паювел без виклику STT', async () => {
    const { deps, stt } = await lapsedDeps();
    const r = await handleTelegramVoice(deps, { telegram_user_id: 777, chat_id: 555, file_id: 'f', duration: 3 } as never);
    expect(r.messages).toEqual([PAYWALL.chat.text]);
    expect(stt()).toBe(0);
  });
});
```
Форму `IncomingText`/`IncomingVoice` звірити з типами у `telegram.ts` (рядки ~395-410) і підставити обовʼязкові поля.

- [ ] **Step 2: Прогнати — впаде**

- [ ] **Step 3: Реалізація**

```ts
// telegram.ts — спільний хелпер поруч із renderTurnMessages:
import { entitlementOf, betaFlag } from '@kitchen/domain/subscription';
import { PAYWALL, SUBSCRIPTION_PATH } from '@kitchen/domain/paywall';

async function paywallReply(deps: TelegramDeps, user_id: string): Promise<TelegramReply> {
  const link = await webLink(deps, user_id);            // одноразовий веб-токен, як «Відкрити сайт»
  const url = typeof link === 'string' ? link : link.url;
  return { messages: [PAYWALL.chat.text], html: false, keyboard: [[{ text: PAYWALL.chat.cta, url: `${url}${url.includes('?') ? '&' : '?'}next=${encodeURIComponent(SUBSCRIPTION_PATH)}` }]] };
}
async function readOnly(deps: TelegramDeps, household_id: string): Promise<boolean> {
  return entitlementOf(await deps.repo.getSubscription(household_id), deps.now?.() ?? new Date(), { beta: betaFlag() }) === 'read_only';
}
```
- у `handleTelegramVoice` — після резолву користувача/дому і **до** `deps.stt(...)`: `if (await readOnly(deps, household_id)) return paywallReply(deps, user_id);`
- у `handleTelegramText` і `handleTelegramFile` — навколо `await turn(input)`: `catch (e) { if (e instanceof ChatTurnHttpError && e.status === 402) return paywallReply(deps, user_id); throw e; }` (якщо там уже є try/catch для `ChatTurnHttpError` — додати гілку 402 туди).
- Команди читання (`/pantry /list /recipes /calendar /home`) не чіпати — вони не йдуть у `turn`.
- Як `webLink` приймає `next` — звірити з `webNextFor` (telegram.ts:303); якщо є параметр `next` у `createTelegramWebToken`, передати через нього, а не через query.

- [ ] **Step 4: Прогнати — зелено**; `pnpm --filter @kitchen/api test` цілком.
- [ ] **Step 5: Commit** — `git commit -am "Telegram: паювел без підписки, голос не йде в STT"`

---

### Task 7: `/v1/me` віддає підписку; дайджест не шлеться `read_only`

**Files:**
- Modify: `services/api/src/routes/me.ts:12-40`, `services/api/src/digest.ts:57` (`runDigestFor`), `apps/web/src/api.ts:100-113` (`Me`)
- Test: `services/api/src/routes/me.subscription.test.ts`, дописати в `services/api/src/digest.test.ts`

**Interfaces:**
- Produces в `Me`: `subscription: { state, plan, entitlement, trial_ends_at, next_charge_at, access_until, card_mask, banner: {text, cta?, to?} | null }`.

- [ ] **Step 1: Тести**

```ts
// services/api/src/routes/me.subscription.test.ts — за зразком наявного me.test.ts (buildApp з InMemoryRepo, логін через cookie-хелпер)
it('/v1/me: підписка і банер для lapsed', async () => {
  // …створити користувача, saveSubscription({state:'lapsed'}), GET /v1/me з кукою
  expect(body.subscription).toMatchObject({ state: 'lapsed', entitlement: 'read_only', banner: { text: 'Підписка закінчилась — усе лишив як було.', to: '/profile/subscription' } });
});
it('/v1/me без рядка в бету → beta/full/без банера', async () => {
  expect(body.subscription).toMatchObject({ state: 'beta', entitlement: 'full', banner: null });
});
```
```ts
// digest.test.ts — дописати
it('дім read_only пропускається з причиною read_only', async () => {
  // кандидат із saveSubscription({state:'lapsed'}); runDigestFor → { status:'skipped', reason:'read_only' }; модель не викликана
});
```

- [ ] **Step 2: Прогнати — впаде**
- [ ] **Step 3: Реалізація**

```ts
// me.ts — у Promise.all додати repo.getSubscription(household_id); у відповідь:
const now = new Date();
const sub = subscriptionRow;
const entitlement = entitlementOf(sub, now, { beta: betaFlag() });
subscription: {
  state: sub?.state ?? (betaFlag() ? 'beta' : 'lapsed'), plan: sub?.plan ?? null, entitlement,
  trial_ends_at: sub?.trial_ends_at ?? null, next_charge_at: sub?.next_charge_at ?? null, access_until: sub?.access_until ?? null, card_mask: sub?.card_mask ?? null,
  banner: bannerFor(sub, now),
},
```
```ts
// digest.ts, на початку runDigestFor:
const sub = await deps.repo.getSubscription(c.household_id);
if (entitlementOf(sub, deps.now?.() ?? new Date(), { beta: betaFlag() }) === 'read_only') return { status: 'skipped', reason: 'read_only' };
```
```ts
// apps/web/src/api.ts — у interface Me:
subscription: {
  state: 'beta' | 'trial' | 'active' | 'cancelled' | 'past_due' | 'lapsed';
  plan: 'self' | 'home' | null; entitlement: 'full' | 'read_only';
  trial_ends_at: string | null; next_charge_at: string | null; access_until: string | null; card_mask: string | null;
  banner: { text: string; cta?: string; to?: string } | null;
};
```
Тести вебу, що мокають `/v1/me`, отримують `subscription` у фікстурі (один спільний хелпер у `apps/web/src/test/me.ts`, якщо його ще нема — створити і використати там, де фікстура `Me` дублюється).

- [ ] **Step 4: Зелено** — `pnpm --filter @kitchen/api test && pnpm --filter @kitchen/web typecheck`
- [ ] **Step 5: Commit** — `git commit -am "/v1/me: стан підписки й банер; дайджест не шлеться read_only"`

---

### Task 8: Провайдер за інтерфейсом + маршрути `/v1/subscription`

**Files:**
- Create: `services/api/src/billing/provider.ts`, `services/api/src/billing/fake-provider.ts`, `services/api/src/routes/subscription.ts`
- Modify: `services/api/src/server.ts` (реєстрація маршруту; `buildApp` отримує `billing?: BillingProvider`, типово `FakeBillingProvider`), `scripts/stand-seed.mts` (передати фейк — для пар і стенда)
- Test: `services/api/src/routes/subscription.test.ts`

**Interfaces:**
```ts
// billing/provider.ts
export interface CheckoutInput { order_id: string; household_id: string; plan: 'self' | 'home'; amount: number; trial: boolean; result_url: string; }
export interface BillingProvider {
  checkoutUrl(input: CheckoutInput): Promise<string>;
  unsubscribe(order_id: string): Promise<void>;
  updateAmount(order_id: string, amount: number): Promise<void>;
}
// fake-provider.ts
export class FakeBillingProvider implements BillingProvider {
  calls: Array<{ op: string; args: unknown }> = [];
  async checkoutUrl(i: CheckoutInput) { this.calls.push({ op: 'checkout', args: i }); return `http://localhost:5190/fake-checkout?order=${i.order_id}`; }
  async unsubscribe(order_id: string) { this.calls.push({ op: 'unsubscribe', args: order_id }); }
  async updateAmount(order_id: string, amount: number) { this.calls.push({ op: 'update', args: { order_id, amount } }); }
}
```
Маршрути (усі `authenticated(repo)`, дім — з `requireUser`):
- `GET /v1/subscription` → `{ subscription: <як у /v1/me>, payments: PaymentRow[] }`
- `POST /v1/subscription/checkout { plan }` → `{ url }`; дозволено лише в станах `lapsed`, `cancelled`, `past_due` або без рядка при вимкненій беті; `trial = !sub?.trial_used_at`; `order_id = randomUUID()`; **до** редиректу зберігає `saveSubscription({...sub, provider_order_id: order_id, plan, state: sub?.state ?? 'lapsed'})`, щоб вебхук знайшов дім по `order_id`; інакше `409 { error: 'already_active' }`.
- `POST /v1/subscription/cancel` → `unsubscribe(order_id)` + `saveSubscription(applyProviderEvent(sub, {kind:'unsubscribed', order_id}, now).sub)`; дозволено в `trial`/`active`/`past_due`; інакше 409.
- `POST /v1/subscription/plan { plan }` → підвищення (`self→home`): `updateAmount(order_id, 290)`, `plan = 'home'` одразу; пониження: `updateAmount(order_id, 210)`, `plan` міняється в дату `next_charge_at` — зберігаємо `pending_plan` **ні** (YAGNI): пониження застосовуємо одразу в `plan`, а `updateAmount` у провайдера набирає чинності з наступного списання — це і є «з наступного списання»; у відповіді `{ effective_at: next_charge_at }` для пониження, `null` для підвищення.
- `POST /v1/subscription/provider-event` — **лише для стенда і тестів**: `header x-billing-secret === process.env.BILLING_EVENT_SECRET` (503, якщо секрет не заданий); тіло — `ProviderEvent`; знаходить дім по `order_id` (`findSubscriptionByOrder`) або з `household_id` для `subscribed`; `applyProviderEvent` → `saveSubscription` + `insertPayment`. Справжній вебхук LiqPay (підпис, мапінг статусів) — план біллінгу, він викликатиме той самий `applyProviderEvent`.

- [ ] **Step 1: Тест** (`subscription.test.ts`, за зразком `me.test.ts`)

```ts
it('lapsed → checkout повертає url фейка і записує order_id', async () => { /* POST /v1/subscription/checkout {plan:'home'} → 200 {url:/fake-checkout/}; getSubscription().provider_order_id визначено; fake.calls[0].args.trial === true */ });
it('active → checkout 409', async () => {});
it('cancel в active → unsubscribe викликано, стан cancelled, access_until = next_charge_at', async () => {});
it('plan self→home одразу; home→self з effective_at', async () => {});
it('provider-event subscribed+success → trial→active, платіж один при повторі', async () => { /* двічі той самий success → listPayments().length === 1 */ });
it('provider-event без секрету → 503, з чужим → 401', async () => {});
```

- [ ] **Step 2: Прогнати — впаде**
- [ ] **Step 3: Реалізація** — `services/api/src/routes/subscription.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { applyProviderEvent, entitlementOf, betaFlag, type ProviderEvent, type Plan } from '@kitchen/domain/subscription';
import { PLAN_PRICE_UAH } from '@kitchen/domain/plans';
import { bannerFor } from '@kitchen/domain/paywall';
import { authenticated, requireUser } from '../middleware/session.js';
import type { BillingProvider } from '../billing/provider.js';

export function subscriptionRoute(app: FastifyInstance, repo: Repo, billing: BillingProvider, appUrl: string) {
  const view = async (household_id: string) => {
    const sub = await repo.getSubscription(household_id); const now = new Date();
    return { state: sub?.state ?? (betaFlag() ? 'beta' : 'lapsed'), plan: sub?.plan ?? null, entitlement: entitlementOf(sub, now, { beta: betaFlag() }),
      trial_ends_at: sub?.trial_ends_at ?? null, next_charge_at: sub?.next_charge_at ?? null, access_until: sub?.access_until ?? null, card_mask: sub?.card_mask ?? null, banner: bannerFor(sub, now) };
  };
  app.get('/v1/subscription', { preHandler: authenticated(repo) }, async (req) => {
    const { household_id } = requireUser(req);
    return { subscription: await view(household_id), payments: await repo.listPayments(household_id) };
  });
  app.post<{ Body: { plan: Plan } }>('/v1/subscription/checkout', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req); const plan = req.body?.plan;
    if (plan !== 'self' && plan !== 'home') return reply.code(400).send({ error: 'plan' });
    const sub = await repo.getSubscription(household_id);
    const open = !sub ? !betaFlag() : ['lapsed', 'cancelled', 'past_due'].includes(sub.state);
    if (!open) return reply.code(409).send({ error: 'already_active' });
    const order_id = randomUUID(); const now = new Date().toISOString();
    await repo.saveSubscription({ household_id, state: sub?.state ?? 'lapsed', plan, trial_used_at: sub?.trial_used_at ?? null, trial_ends_at: sub?.trial_ends_at ?? null, next_charge_at: sub?.next_charge_at ?? null, access_until: sub?.access_until ?? null, provider_order_id: order_id, card_mask: sub?.card_mask ?? null, paid_by_user_id: user_id, deletion_warned_at: null, updated_at: now });
    const url = await billing.checkoutUrl({ order_id, household_id, plan, amount: PLAN_PRICE_UAH[plan], trial: !sub?.trial_used_at, result_url: `${appUrl}/profile/subscription?order=${order_id}` });
    return { url };
  });
  app.post('/v1/subscription/cancel', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { household_id } = requireUser(req); const sub = await repo.getSubscription(household_id);
    if (!sub?.provider_order_id || !['trial', 'active', 'past_due'].includes(sub.state)) return reply.code(409).send({ error: 'nothing_to_cancel' });
    await billing.unsubscribe(sub.provider_order_id);
    await repo.saveSubscription(applyProviderEvent(sub, { kind: 'unsubscribed', order_id: sub.provider_order_id }, new Date()).sub);
    return { subscription: await view(household_id) };
  });
  app.post<{ Body: { plan: Plan } }>('/v1/subscription/plan', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { household_id } = requireUser(req); const plan = req.body?.plan; const sub = await repo.getSubscription(household_id);
    if (plan !== 'self' && plan !== 'home') return reply.code(400).send({ error: 'plan' });
    if (!sub?.provider_order_id || !['trial', 'active'].includes(sub.state) || sub.plan === plan) return reply.code(409).send({ error: 'cannot_change' });
    await billing.updateAmount(sub.provider_order_id, PLAN_PRICE_UAH[plan]);
    const upgrade = plan === 'home';
    await repo.saveSubscription({ ...sub, plan, updated_at: new Date().toISOString() });
    return { subscription: await view(household_id), effective_at: upgrade ? null : sub.next_charge_at };
  });
  app.post<{ Body: ProviderEvent }>('/v1/subscription/provider-event', async (req, reply) => {
    const secret = process.env.BILLING_EVENT_SECRET;
    if (!secret) return reply.code(503).send({ error: 'billing_events_not_configured' });
    if (req.headers['x-billing-secret'] !== secret) return reply.code(401).send();
    const ev = req.body; const now = new Date();
    const sub = ev.kind === 'subscribed' ? (await repo.findSubscriptionByOrder(ev.order_id)) ?? (await repo.getSubscription(ev.household_id)) : await repo.findSubscriptionByOrder(ev.order_id);
    if (!sub && ev.kind !== 'subscribed') return reply.code(404).send({ error: 'unknown_order' });
    const r = applyProviderEvent(sub, ev, now);
    await repo.saveSubscription(r.sub);
    if (r.payment) await repo.insertPayment(r.payment);
    return { ok: true, state: r.sub.state };
  });
}
```
У `server.ts`: `import { subscriptionRoute }`, у `buildApp` — `subscriptionRoute(app, repo, opts.billing ?? new FakeBillingProvider(), process.env.APP_URL ?? 'http://localhost:5173')`. У `stand-seed.mts` нічого додавати не треба (фейк типовий), але для пар зручно засіяти `saveSubscription` у стан `lapsed` за `STAND_SUBSCRIPTION=lapsed`.

- [ ] **Step 4: Зелено** — `pnpm --filter @kitchen/api test`
- [ ] **Step 5: Commit** — `git commit -am "Маршрути /v1/subscription за інтерфейсом BillingProvider з фейком"`

---

### Task 9: Mailer — простий лист; крон біллінгу; видалення тихих домів

**Files:**
- Modify: `services/api/src/mailer.ts:13-30` (+`sendPlain` в інтерфейс, `ConsoleMailer`, `SmtpMailer`), `package.json:14` (`build:vercel-fn` + `cron-billing`), `vercel.json:23-25` (crons)
- Create: `services/api/src/billing-cron.ts`, `services/api/src/cron-billing-handler.ts`, `api/cron-billing.ts`
- Test: `services/api/src/billing-cron.test.ts`

**Interfaces:**
- `Mailer.sendPlain(mail: { to: string; subject: string; text: string }): Promise<void>`
- `runBillingCron(deps: { repo: Repo; mailer: Mailer; appUrl: string; telegramNotify?: (user_id: string, text: string) => Promise<void>; now?: () => Date }): Promise<{ transitions: number; trialMails: number; lapsedMails: number; warnings: number; deleted: number }>`

- [ ] **Step 1: Тест**

```ts
// services/api/src/billing-cron.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '@kitchen/domain/in-memory-repo';
import { ConsoleMailer } from './mailer.js';
import { runBillingCron } from './billing-cron.js';

const sub = (household_id: string, p: Record<string, unknown>) => ({ household_id, state: 'active', plan: 'self', trial_used_at: null, trial_ends_at: null, next_charge_at: null, access_until: null, provider_order_id: 'o', card_mask: '4242', paid_by_user_id: null, deletion_warned_at: null, updated_at: '2026-09-01T00:00:00Z', ...p } as never);

describe('runBillingCron', () => {
  it('cancelled → lapsed у дату + лист «підписка закінчилась» один раз', async () => {
    const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
    const { household_id } = await repo.createUserWithHousehold('a@x.test', 'A');
    await repo.saveSubscription(sub(household_id, { state: 'cancelled', access_until: '2026-10-01T00:00:00Z' }));
    const deps = { repo, mailer, appUrl: 'http://app.test', now: () => new Date('2026-10-01T03:30:00Z') };
    expect((await runBillingCron(deps)).transitions).toBe(1);
    expect((await repo.getSubscription(household_id))?.state).toBe('lapsed');
    expect(mailer.plain.map((m) => m.subject)).toEqual(['Підписка закінчилась — усе на місці']);
    await runBillingCron(deps);
    expect(mailer.plain).toHaveLength(1);
  });
  it('лист за 3 дні до кінця пробного — раз', async () => {
    const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
    const { household_id } = await repo.createUserWithHousehold('b@x.test', 'B');
    await repo.saveSubscription(sub(household_id, { state: 'trial', plan: 'home', trial_ends_at: '2026-10-04T00:00:00Z', next_charge_at: '2026-10-04T00:00:00Z' }));
    const deps = { repo, mailer, appUrl: 'http://app.test', now: () => new Date('2026-10-01T03:30:00Z') };
    await runBillingCron(deps); await runBillingCron(deps);
    expect(mailer.plain).toHaveLength(1);
    expect(mailer.plain[0].text).toContain('спишеться 290 ₴');
  });
  it('тиша 6 міс → попередження; +30 днів → видалення; вхід скидає', async () => {
    const repo = new InMemoryRepo(); const mailer = new ConsoleMailer();
    const { user_id, household_id } = await repo.createUserWithHousehold('c@x.test', 'C');
    await repo.touchUser(user_id, 'last_seen_at', '2026-01-01T00:00:00Z');
    await repo.saveSubscription(sub(household_id, { state: 'lapsed', access_until: '2026-01-15T00:00:00Z' }));
    const at = (d: string) => ({ repo, mailer, appUrl: 'http://app.test', now: () => new Date(d) });
    expect((await runBillingCron(at('2026-07-20T03:30:00Z'))).warnings).toBe(1);
    expect((await repo.getSubscription(household_id))?.deletion_warned_at).toBeTruthy();
    await repo.touchUser(user_id, 'last_seen_at', '2026-08-01T00:00:00Z');       // зайшов
    expect((await runBillingCron(at('2026-08-25T03:30:00Z'))).deleted).toBe(0);
    expect((await repo.getSubscription(household_id))?.deletion_warned_at).toBeNull(); // відлік скинуто
    expect((await runBillingCron(at('2027-03-10T03:30:00Z'))).warnings).toBe(1);
    expect((await runBillingCron(at('2027-04-15T03:30:00Z'))).deleted).toBe(1);
    expect(await repo.getHousehold(household_id)).toBeNull();
  });
});
```
`ConsoleMailer.plain` — масив надісланих простих листів (додати в реалізації).

- [ ] **Step 2: Прогнати — впаде**
- [ ] **Step 3: Реалізація**

```ts
// mailer.ts — інтерфейс
export interface PlainMail { to: string; subject: string; text: string }
export interface Mailer { sendMagicLink(mail: MagicLinkMail): Promise<void>; sendPlain(mail: PlainMail): Promise<void>; }
// ConsoleMailer: public plain: PlainMail[] = []; async sendPlain(m) { this.plain.push(m); console.log(`[mail] ${m.subject} → ${m.to}\n  ${m.text}`); }
// SmtpMailer: async sendPlain(m) { await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text }); } — той самий from, що в sendMagicLink.
```
```ts
// services/api/src/billing-cron.ts
import type { Repo } from '@kitchen/domain';
import { tick, type HouseholdSubscription } from '@kitchen/domain/subscription';
import { PLAN_PRICE_UAH } from '@kitchen/domain/plans';
import { MAIL, SUBSCRIPTION_PATH } from '@kitchen/domain/paywall';
import type { Mailer } from './mailer.js';

const DAY = 86_400_000; const QUIET_DAYS = 182; const WARN_DAYS = 30;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });

export interface BillingCronDeps { repo: Repo; mailer: Mailer; appUrl: string; telegramNotify?: (user_id: string, text: string) => Promise<void>; now?: () => Date }

async function notifyHousehold(deps: BillingCronDeps, household_id: string, subject: string, text: string) {
  for (const m of await deps.repo.listMembersOfHousehold(household_id)) {
    const u = await deps.repo.getUser(m.user_id);
    if (u?.email) await deps.mailer.sendPlain({ to: u.email, subject, text });
    else if (deps.telegramNotify) await deps.telegramNotify(m.user_id, text);
  }
}

export async function runBillingCron(deps: BillingCronDeps) {
  const now = deps.now?.() ?? new Date(); const out = { transitions: 0, trialMails: 0, lapsedMails: 0, warnings: 0, deleted: 0 };
  // 1. Переходи
  for (const sub of await deps.repo.listSubscriptionsByState(['trial', 'cancelled', 'past_due'])) {
    const next = tick(sub, now); if (!next) continue;
    await deps.repo.saveSubscription(next); out.transitions++;
    if (next.state === 'lapsed') { await notifyHousehold(deps, sub.household_id, MAIL.lapsed.subject, MAIL.lapsed.text); out.lapsedMails++; }
  }
  // 2. Лист за 3 дні до кінця пробного — раз: позначка в deletion_warned_at не годиться, тому окреме поле: trial_mail_sent_at
  for (const sub of await deps.repo.listSubscriptionsByState(['trial'])) {
    if (!sub.trial_ends_at || !sub.plan || sub.trial_mail_sent_at) continue;
    if (new Date(sub.trial_ends_at).getTime() - now.getTime() > 3 * DAY) continue;
    const m = MAIL.trialEnds(fmt(sub.trial_ends_at), sub.card_mask ?? '····', PLAN_PRICE_UAH[sub.plan], `${deps.appUrl}${SUBSCRIPTION_PATH}`);
    await notifyHousehold(deps, sub.household_id, m.subject, m.text);
    await deps.repo.saveSubscription({ ...sub, trial_mail_sent_at: now.toISOString() }); out.trialMails++;
  }
  // 3. Тихі доми
  for (const sub of await deps.repo.listSubscriptionsByState(['lapsed'])) {
    const seen = await deps.repo.householdLastSeenAt(sub.household_id);
    const since = Math.max(seen ? new Date(seen).getTime() : 0, sub.access_until ? new Date(sub.access_until).getTime() : 0);
    const quietDays = (now.getTime() - since) / DAY;
    if (sub.deletion_warned_at && seen && new Date(seen) > new Date(sub.deletion_warned_at)) { await deps.repo.saveSubscription({ ...sub, deletion_warned_at: null }); continue; } // зайшов після попередження — скидаємо
    if (!sub.deletion_warned_at && quietDays >= QUIET_DAYS) {
      const m = MAIL.deletionWarning(`${deps.appUrl}/app`); await notifyHousehold(deps, sub.household_id, m.subject, m.text);
      await deps.repo.saveSubscription({ ...sub, deletion_warned_at: now.toISOString() }); out.warnings++; continue;
    }
    if (sub.deletion_warned_at && (now.getTime() - new Date(sub.deletion_warned_at).getTime()) / DAY >= WARN_DAYS) {
      await deps.repo.deleteHousehold(sub.household_id); out.deleted++;
      await deps.repo.saveAppEvents([{ user_id: null, household_id: sub.household_id, name: 'household_deleted_quiet', props: {}, at: now.toISOString() } as never]); // форму AppEventRow звірити з repo.ts:9
    }
  }
  return out;
}
```
Поле `trial_mail_sent_at` додати в `HouseholdSubscription` (Task 1 тип), у міграцію 0046 (`trial_mail_sent_at timestamptz`) і в обидва repo. У тесті з видаленням: після `touchUser` (вхід) крон бачить `seen > deletion_warned_at` і скидає позначку — це і перевіряється.

```ts
// services/api/src/cron-billing-handler.ts — копія cron-digest-handler.ts (той самий CRON_SECRET/Bearer), але викликає runBillingCron({ repo, mailer: pickMailer(), appUrl: process.env.APP_URL ?? 'http://localhost:3000', telegramNotify: <функція з telegram.ts, що шле текст користувачу по chat_id, якщо така є; інакше undefined> })
// api/cron-billing.ts — копія api/cron-digest.ts із bundlePath 'api-dist/cron-billing.mjs'
```
`package.json` `build:vercel-fn`: додати `&& esbuild services/api/src/cron-billing-handler.ts --bundle --platform=node --format=esm --target=node20 --sourcemap --external:pg-native --banner:js='…той самий banner…' --outfile=api-dist/cron-billing.mjs` перед `rm -rf api-dist/versions`.
`vercel.json` crons: `{ "path": "/api/cron-billing", "schedule": "30 3 * * *" }`.

- [ ] **Step 4: Зелено** — `pnpm --filter @kitchen/api test`; `pnpm build:vercel-fn` збирає три бандли.
- [ ] **Step 5: Commit** — `git commit -am "Крон біллінгу: переходи, листи, тихі доми; Mailer.sendPlain; cron-billing у Vercel"`

---

### Task 10: Веб — паювел у чаті

**Files:**
- Modify: `apps/web/src/pages/Feed/Feed.tsx` (тип `Turn` ~106-120; відправка ~860-905; рендер бульбашки асистента)
- Test: `apps/web/src/pages/Feed/Feed.paywall.test.tsx` (стиль `Feed.test.tsx`: мок `api`)

**Interfaces:**
- Consumes: `ApiError` зі `status === 402` і `payload.kind === 'paywall'` (`apps/web/src/api.ts:4-75`).
- Produces: `Turn.paywall?: { label: string; to: string }` — бульбашка з кнопкою-посиланням.

- [ ] **Step 1: Тест**

```tsx
it('402 paywall → репліка людини зникає, відповідь асистента з кнопкою «Продовжити»', async () => {
  mockApi.chat.mockRejectedValueOnce(new ApiError(402, { kind: 'paywall', state: 'lapsed', text: PAYWALL.chat.text, cta: { label: 'Продовжити', to: '/profile/subscription' } }, 'paywall'));
  render(<Feed />); await type('що на вечерю?'); await pressEnter();
  expect(await screen.findByText(PAYWALL.chat.text)).toBeInTheDocument();
  expect(screen.queryByText('що на вечерю?')).toBeNull();
  expect(screen.getByRole('link', { name: 'Продовжити' })).toHaveAttribute('href', '/profile/subscription');
});
```

- [ ] **Step 2: Прогнати — впаде**
- [ ] **Step 3: Реалізація** — у `catch` навколо `api.chat(...)` (Feed.tsx ~880):

```ts
if (err instanceof ApiError && err.status === 402 && (err.payload as { kind?: string })?.kind === 'paywall') {
  const p = err.payload as { text: string; cta: { label: string; to: string } };
  setTurns((prev) => [...prev.filter((t) => t.id !== turnId), { id: newId(), role: 'assistant', time: hhmm(), fresh: true, text: p.text, card: null, paywall: p.cta }]);
  return;
}
```
У рендері бульбашки асистента: `{t.paywall && <Link to={t.paywall.to} className={styles.paywallCta}>{t.paywall.label}</Link>}` — стиль кнопки з Components (чорна пігулка), верстка по макету Claude Design після експорту (бриф `ai 2/project/SUBSCRIPTION-BRIEF-0925.md`).

- [ ] **Step 4: Зелено** — `pnpm --filter @kitchen/web test -- Feed`
- [ ] **Step 5: Commit** — `git commit -am "Веб: паювел у чаті без підписки"`

---

### Task 11: Веб — банер над табами

**Files:**
- Create: `apps/web/src/components/SubscriptionBanner/SubscriptionBanner.tsx`, `.module.css`, `SubscriptionBanner.test.tsx`
- Modify: `apps/web/src/App.tsx` (рендер над `<TabBar>` у розкладці застосунку — знайти місце, де `TabBar` монтується для маршрутів `/app /pantry /recipes /list /calendar`)

**Interfaces:**
- Consumes: `useAuth((s) => s.me?.subscription?.banner)`.

- [ ] **Step 1: Тест** — три кейси: `banner: null` → нічого; `{text, cta, to}` → текст і посилання; `{text}` без `to` → лише текст.
- [ ] **Step 2: Прогнати — впаде**
- [ ] **Step 3: Реалізація**

```tsx
export function SubscriptionBanner() {
  const banner = useAuth((s) => s.me?.subscription?.banner ?? null);
  const past = useAuth((s) => s.me?.subscription?.state === 'past_due');
  if (!banner) return null;
  return (
    <div className={`${styles.bar} ${past ? styles.amber : ''}`} role="status">
      <span>{banner.text}</span>
      {banner.to && <Link to={banner.to} className={styles.cta}>{banner.cta ?? 'Продовжити'}</Link>}
    </div>
  );
}
```
Кольори — токени продукту; `past_due` — бурштин, без червоного.

- [ ] **Step 4: Зелено**; **Step 5: Commit** — `git commit -am "Веб: банер стану підписки над табами"`

---

### Task 12: Веб — екран «Підписка»

**Files:**
- Create: `apps/web/src/pages/Subscription/Subscription.tsx`, `.module.css`, `Subscription.test.tsx`
- Modify: `apps/web/src/api.ts` (клієнт), `apps/web/src/App.tsx:113` (маршрут `/profile/subscription`), сторінка профілю (`ProfileRoute`) — пункт «Підписка» зі станом одним рядком

**Interfaces:**
- `api.subscription = { get: () => req<{ subscription: Me['subscription']; payments: Payment[] }>('/v1/subscription'), checkout: (plan) => req<{ url: string }>('/v1/subscription/checkout', { method: 'POST', body: JSON.stringify({ plan }) }), cancel: () => req<{ subscription }>('/v1/subscription/cancel', { method: 'POST', body: '{}' }), setPlan: (plan) => req<{ subscription; effective_at: string | null }>('/v1/subscription/plan', { method: 'POST', body: JSON.stringify({ plan }) }) }`

- [ ] **Step 1: Тест** — по одному кейсу на стан (верхній рядок і кнопки за таблицею спека §4), плюс: «Скасувати» відкриває аркуш → підтвердження → `api.subscription.cancel` викликано; «Оформити» → `window.location.assign(url)`; «Змінити тариф» пониження показує `effective_at`.
- [ ] **Step 2: Прогнати — впаде**
- [ ] **Step 3: Реалізація** — стани й тексти зі спека §4 дослівно; аркуші на `components/Sheet` (`title`, `onClose`); картки тарифів — ті самі, що в секції «Ціна» лендінга (`PLAN_NAME`, `PLAN_PRICE_UAH`, списки з `Landing/copy.ts` PLANS через спільний модуль, якщо його ще нема — винести список рядків тарифів у `@kitchen/domain/plans.ts` як `PLAN_LINES`). Після повернення з checkout (`?order=…`) сторінка перечитує `api.subscription.get()` раз на 3 с до 30 с, поки `state` не зміниться (вебхук приходить із затримкою).
- [ ] **Step 4: Зелено**; здача — пари «кадр бандла · рендер» після експорту макетів (1440 і 390×664 на кожен стан), стенд із `STAND_SUBSCRIPTION=<state>`.
- [ ] **Step 5: Commit** — `git commit -am "Веб: екран «Підписка» — стани, аркуші, історія списань"`

---

### Task 13: Завершення бети — разовий скрипт

**Files:**
- Create: `scripts/billing/end-beta.mts`, `scripts/billing/end-beta.test.ts` (логіка — чиста функція в `services/api/src/billing-end-beta.ts`)

**Interfaces:**
- `planEndBeta(repo, now)`: для кожного дому без рядка або зі `state: 'beta'` → `saveSubscription({ state: 'cancelled', access_until: now + 7 днів, plan: null, … })` і лист усім членам (тема «Через 7 днів у Kitchen OS запускається оплата», текст: «Бета закінчується {дата}. Далі — 14 днів за 1 ₴ і 210 або 290 ₴ на місяць; усе, що назбирали, лишається на місці. Обрати тариф можна в Профілі → Підписка.»). Через 7 днів крон із Task 9 переведе їх у `lapsed` і надішле лист № 5.
- Запуск: `SUBSCRIPTION_BETA=0 npx tsx scripts/billing/end-beta.mts --dry-run` (лише список), потім без прапорця; одночасно `SUBSCRIPTION_BETA=0` і `BETA_PLAN=false` у Vercel — ставить власник.

- [ ] **Step 1: Тест** — два доми (`beta` і без рядка) → обидва `cancelled` з `access_until = +7 днів`, два листи; повторний запуск нічого не міняє.
- [ ] **Step 2–4:** впаде → реалізація → зелено.
- [ ] **Step 5: Commit** — `git commit -am "Скрипт завершення бети: 7 днів попередження перед режимом читання"`

---

## Порядок і хто робить

1. Tasks 1–4 (домен + repo) — TELEGRAM BOT (api/domain), один PR.
2. Tasks 5–9 (ворота, Telegram, /v1/me, маршрути, крон) — TELEGRAM BOT, другий PR поверх першого після мерджу.
3. Tasks 10–12 (веб) — ЛЕНДІНГ; 10–11 можна одразу після мерджу PR 2 (контракт `/v1/me` і `402` відомі з цього плану); 12 — після експорту макетів із Claude Design (бриф `ai 2/project/SUBSCRIPTION-BRIEF-0925.md`).
4. Task 13 — TELEGRAM BOT, окремий PR; запуск — лише за словом власника в день запуску оплат.
5. Поза планом: справжній LiqPay-адаптер `BillingProvider` і вебхук `/api/liqpay` → `applyProviderEvent` (план біллінгу після рішення власника A/B), правки юртекстів (ЮРИСТ, спек §9, уже поставлено).

## Self-review

- Спек §1 (стани, переходи) → Tasks 1, 2, 9. §2 (ворота) → 5, 6, 7. §3 (по місцях, тексти) → 3, 6, 10, 11. §4 (екран) → 8, 12. §5 (тиша) → 4, 9. §6 (дані, крон) → 4, 9. §7 (краї: подвійний вебхук — insertPayment; гонка з кроном — tick не чіпає active з майбутнім next_charge_at; двоє платять — 409 у checkout; без пошти — telegramNotify) → 2, 4, 8, 9. §8 (тести) — у кожній задачі. `beta → lapsed` → 13.
- Поле `trial_mail_sent_at` зʼявляється в Task 9 — додати його в тип (Task 1), міграцію й repo (Task 4) одразу, щоб не повертатись.
- Назви узгоджені: `getSubscription/saveSubscription/findSubscriptionByOrder/listSubscriptionsByState/insertPayment/listPayments/householdLastSeenAt/deleteHousehold`; `entitlementOf/betaFlag/applyProviderEvent/tick`; `paywallBody/bannerFor/PAYWALL/MAIL/SUBSCRIPTION_PATH`; `BillingProvider/FakeBillingProvider`; `runBillingCron`.
