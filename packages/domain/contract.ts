// Спільний контракт для будь-якої реалізації Repo.
// Викликається з тестів InMemoryRepo і PostgresRepo — гарантує, що обидві дають
// однакову семантику. Дрейф між реалізаціями — категорія помилок, яку ловимо тут.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Repo } from './repo.js';
import type { PantryBatch, IntakeCard, HouseholdEventRow, EventCard, AdminOccasionRow } from './types.js';
import { noteHash, type ProfileNote, type VetoRow } from './profile-text.js';
import { createPending, applyCard, undoCard, dismissCard } from './apply.js';
import { displayName } from './product.js';

export interface RepoCtx {
  repo: Repo;
  household_id: string;
  user_id: string;
  /**
   * Другий учасник того самого дому. Потрібен, бо приватність календаря
   * інакше не перевіриш: «не бачу чужого» — твердження про двох людей, і з
   * одним user_id воно вироджується в «не бачу нічого».
   *
   * У Postgres це має бути справжній рядок `"user"`: `created_by` — зовнішній
   * ключ, і вигаданий uuid не вставиться.
   */
  other_user_id: string;
}

export interface RepoFactory {
  make(): Promise<RepoCtx>;   // викликається у beforeEach — має віддавати чистий стан
  teardown?(): Promise<void>; // викликається у afterAll — закрити пул/контейнер
}

async function seedFarsh(
  repo: Repo,
  household_id: string,
  label = 'Яловично-свинячий фарш',
): Promise<PantryBatch> {
  const b: PantryBatch = {
    id: randomUUID(),
    household_id,
    catalog_key: null,   // FK у PG порожня, щоб не тягнути каталог у контрактні тести
    label,
    zone: 'fridge',
    value: 500,
    unit: 'g',
    state: 'sealed',
    opened_at: null,
    expires_at: null,
    best_before_opened_days: 3,
    added_at: new Date().toISOString(),
    depleted_at: null,
    confidence: 1,
    provenance: 'user_statement',
    staple: false,
    last_by: null,
    last_action: 'add',
  };
  await repo.insertBatch(b);
  return b;
}

export function describeRepoContract(name: string, factory: RepoFactory) {
  describe(name, () => {
    let ctx: RepoCtx;
    beforeEach(async () => { ctx = await factory.make(); });
    afterAll(async () => { await factory.teardown?.(); });

    it('add: створює нову партію, undo її видаляє', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [
        { op: 'add', label: 'Моцарела', value: 250, unit: 'g', zone: 'fridge', confidence: 0.9, evidence: 'receipt_line' },
      ]};
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { applied, undo_token } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect(applied).toBe(1);

      const batches = await ctx.repo.listBatches(ctx.household_id);
      expect(batches).toHaveLength(1);
      expect(batches[0]!.label).toBe('Моцарела');

      const res = await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect(res.undone).toBe(true);
      expect(await ctx.repo.listBatches(ctx.household_id)).toHaveLength(0);
    });

    // Черга Д (№2): add-оп із трійкою створює «продукт дому», партія показує
    // на нього, а видима назва ФОРМУЄТЬСЯ з трійки. Знайома трійка (без
    // регістру) реюзається — теги беруться з БД, модельні ігноруються.
    it('add із трійкою: створює продукт дому, формує назву, реюзає знайому трійку', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [
        {
          op: 'add', label: 'Пармезан Galbani', value: 200, unit: 'g', zone: 'fridge',
          product: 'пармезан', brand: 'Galbani', variant: 'тертий',
          tags: { allergens: ['молоко'], lactose: 'low', shelf_open_days: 14 },
        },
      ]};
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await applyCard(ctx.repo, mid, [], ctx.user_id);

      const batches = await ctx.repo.listBatches(ctx.household_id);
      expect(batches).toHaveLength(1);
      const b = batches[0]!;
      expect(b.label).toBe('пармезан Galbani тертий');    // назва — з трійки, не з op.label
      expect(b.product_id).toBeTruthy();
      // shelf_open_days з тегів живить «вжити до» відкритої партії
      expect(b.best_before_opened_days).toBe(14);

      const prod = await ctx.repo.getProduct(b.product_id!);
      expect(prod).toMatchObject({ product: 'пармезан', brand: 'Galbani', variant: 'тертий' });
      expect(prod!.tags.allergens).toEqual(['молоко']);
      expect(displayName(prod!)).toBe(b.label);

      // Друга покупка тієї ж трійки (інший регістр, інші модельні теги) —
      // продукт НЕ дублюється, теги з БД перемагають.
      const mid2 = randomUUID();
      await createPending(ctx.repo, { message_id: mid2, household_id: ctx.household_id, user_id: ctx.user_id, card: {
        type: 'intake_diff', ops: [{
          op: 'add', label: 'пармезан', value: 200, unit: 'g',
          product: 'Пармезан', brand: 'GALBANI', variant: 'Тертий',
          tags: { allergens: ['інше'] },
        }],
      } });
      await applyCard(ctx.repo, mid2, [], ctx.user_id);
      expect(await ctx.repo.listProducts(ctx.household_id)).toHaveLength(1);
      const again = await ctx.repo.listBatches(ctx.household_id);
      expect(again).toHaveLength(2);
      expect(again[1]!.product_id).toBe(b.product_id);
      expect((await ctx.repo.getProduct(b.product_id!))!.tags.allergens).toEqual(['молоко']);
    });

    // Теги правляться ТІЛЬКИ чатом через картку («шити прапорцями —
    // неюзабельно»): correct-оп несе tags — вони мерджаться в продукт партії.
    it('correct з tags: мердж у продукт дому, решта тегів не чіпається', async () => {
      const mid = randomUUID();
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card: {
        type: 'intake_diff', ops: [{
          op: 'add', label: 'камбоцола', value: 200, unit: 'g', zone: 'fridge',
          product: 'камбоцола', tags: { allergens: ['молоко'], lactose: 'yes' },
        }],
      } });
      await applyCard(ctx.repo, mid, [], ctx.user_id);
      const b = (await ctx.repo.listBatches(ctx.household_id))[0]!;

      const mid2 = randomUUID();
      await createPending(ctx.repo, { message_id: mid2, household_id: ctx.household_id, user_id: ctx.user_id, card: {
        type: 'intake_diff', ops: [{ op: 'correct', label: 'камбоцола', tags: { lactose: 'none' } }],
      } });
      await applyCard(ctx.repo, mid2, [], ctx.user_id);

      const prod = await ctx.repo.getProduct(b.product_id!);
      expect(prod!.tags.lactose).toBe('none');
      expect(prod!.tags.allergens).toEqual(['молоко']);   // не затерлось
    });

    // Каталог, кроки 2-3: продукт при народженні отримує catalog_key
    // (резолвер по аліасах) і каталог-дефолти в ДІРКИ тегів. Межа жорстка:
    // каталог дає властивості КЛАСУ (алергени, скоромність), ніколи —
    // екземпляра (бренд/варіант/назву).
    it('add: каталог дає key і алерген-дефолт, але не чіпає трійку і модельні теги', async () => {
      const mid = randomUUID();
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card: {
        type: 'intake_diff', ops: [
          { op: 'add', label: 'камбоцола', value: 200, unit: 'g', zone: 'fridge', product: 'камбоцола' },
        ],
      } });
      await applyCard(ctx.repo, mid, [], ctx.user_id);
      const b = (await ctx.repo.listBatches(ctx.household_id))[0]!;
      const prod = (await ctx.repo.getProduct(b.product_id!))!;
      expect(prod.catalog_key).toBe('cambozola_cheese');
      expect(prod.tags.allergens).toContain('молоко');       // «молочне» → канон тегера
      expect(prod.tags.fasting).toBe(true);                  // категорія «тваринне» → скоромне
      // властивості екземпляра з каталогу НЕ приходять
      expect(prod.brand).toBe(null);
      expect(prod.variant).toBe(null);
      expect(b.label).toBe('камбоцола');                     // слово юзера, не каталожна назва
    });

    it('add: модельні теги перемагають каталожні дефолти', async () => {
      const mid = randomUUID();
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card: {
        type: 'intake_diff', ops: [
          { op: 'add', label: 'камбоцола', value: 200, unit: 'g', zone: 'fridge',
            product: 'камбоцола', tags: { allergens: ['молоко'], lactose: 'low', fasting: false } },
        ],
      } });
      await applyCard(ctx.repo, mid, [], ctx.user_id);
      const b = (await ctx.repo.listBatches(ctx.household_id))[0]!;
      const prod = (await ctx.repo.getProduct(b.product_id!))!;
      expect(prod.tags.lactose).toBe('low');
      expect(prod.tags.fasting).toBe(false);                 // модель сказала — каталог мовчить
      expect(prod.catalog_key).toBe('cambozola_cheese');     // key все одно резолвиться
    });

    // «(початке)» з інвентаря: add-оп може одразу позначити партію відкритою.
    it('add зі state:opened — партія народжується відкритою', async () => {
      const mid = randomUUID();
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card: {
        type: 'intake_diff', ops: [
          { op: 'add', label: 'вершки 20%', value: 200, unit: 'g', zone: 'fridge', state: 'opened' },
        ],
      } });
      await applyCard(ctx.repo, mid, [], ctx.user_id);
      const b = (await ctx.repo.listBatches(ctx.household_id))[0]!;
      expect(b.state).toBe('opened');
      expect(b.opened_at).toBeTruthy();
    });

    it('add без трійки: продукт формується з label (product=label, без бренду)', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [
        { op: 'add', label: 'сіль', value: 500, unit: 'g', zone: 'spices' },
      ]};
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await applyCard(ctx.repo, mid, [], ctx.user_id);
      const b = (await ctx.repo.listBatches(ctx.household_id))[0]!;
      expect(b.label).toBe('сіль');
      expect(b.product_id).toBeTruthy();
      const prod = await ctx.repo.getProduct(b.product_id!);
      expect(prod).toMatchObject({ product: 'сіль', brand: null, variant: null });
    });

    // UX9-27: «купив усе зі списку» додавало в комору, а список стояв як був —
    // продукт одночасно вважав, що олія Є і що олію ТРЕБА купити. Тепер add-оп
    // з тим самим label відмічає позицію списку купленою; undo знімає галочку.
    it('add відмічає однойменну позицію списку купленою; undo знімає', async () => {
      const itemId = randomUUID();
      await ctx.repo.insertShoppingItem({
        id: itemId, household_id: ctx.household_id, label: 'олія оливкова',
        reason: null, value: null, unit: null, zone: null, checked: false,
        added_by: ctx.user_id, source: 'user', created_at: new Date().toISOString(),
      });
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [
        { op: 'add', label: 'Олія оливкова', value: 30, unit: 'ml', zone: 'dry' },
      ]};
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { undo_token } = await applyCard(ctx.repo, mid, [], ctx.user_id);

      let items = await ctx.repo.listShoppingItems(ctx.household_id);
      expect(items.find((i) => i.id === itemId)!.checked).toBe(true);

      await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      items = await ctx.repo.listShoppingItems(ctx.household_id);
      expect(items.find((i) => i.id === itemId)!.checked).toBe(false);
    });

    it('deplete: знаходить партію за назвою й ставить depleted', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id);
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'deplete', label: 'фарш' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await applyCard(ctx.repo, mid, [], ctx.user_id);

      const b = await ctx.repo.getBatch(seeded.id);
      expect(b?.state).toBe('depleted');
      expect(b?.depleted_at).not.toBeNull();
    });

    it('open: ставить opened_at і термін від best_before_opened_days', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id);
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'open', label: 'фарш' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await applyCard(ctx.repo, mid, [], ctx.user_id);

      const b = await ctx.repo.getBatch(seeded.id);
      expect(b?.state).toBe('opened');
      expect(b?.opened_at).not.toBeNull();
      expect(b?.expires_at).not.toBeNull();
    });

    it('rename: змінює label, undo повертає', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id, 'Крем-брусок');
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'rename', label: 'Крем-брусок', to: 'Крем-брюле Pont' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { undo_token } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect((await ctx.repo.getBatch(seeded.id))?.label).toBe('Крем-брюле Pont');

      await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect((await ctx.repo.getBatch(seeded.id))?.label).toBe('Крем-брусок');
    });

    it('correct: змінює вагу; повторний apply з тим самим id — no-op (ідемпотентно)', async () => {
      const seeded = await seedFarsh(ctx.repo, ctx.household_id);
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'correct', label: 'фарш', value: 400, unit: 'g' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const r1 = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect((await ctx.repo.getBatch(seeded.id))?.value).toBe(400);
      expect(r1.already).toBe(false);

      const r2 = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect(r2.already).toBe(true);
      expect(r2.undo_token).toBe(r1.undo_token);
      expect((await ctx.repo.getBatch(seeded.id))?.value).toBe(400);
    });

    it('deplete на неіснуючу назву: стан не чіпаємо І не рапортуємо про зміну', async () => {
      // 02.09: очікування applied=1 тут було СТАРИМ і хибним. Стан справді не
      // мінявся — це правильно, модель не пише в стан напряму, — але картка
      // рапортувала «1 позиція», і репліка казала «Запишу». Людина читала
      // підтвердження зміни, якої не сталось.
      //
      // Той самий принцип уже стояв поруч, у гілці профілю (QA4-05: «рахуємо
      // те, що СПРАВДІ лягло»); комора його не мала. Тепер має, а промах
      // називається в `missed` — щоб було що побачити в лозі.
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'deplete', label: 'ковбаса, якої нема' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { applied, missed } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      expect(applied, 'нічого не лягло — нічого й не рапортуємо').toBe(0);
      expect(missed).toEqual(['deplete «ковбаса, якої нема»']);
      expect(await ctx.repo.listBatches(ctx.household_id)).toHaveLength(0);
    });

    it('чужий актор — forbidden', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await expect(applyCard(ctx.repo, mid, [], randomUUID())).rejects.toThrow(/forbidden/);
    });

    // QA-7: цей клас багів (розсинхрон SQL і схеми) проходив зелений CI, бо
    // жоден тест не виконував INSERT-и PostgresRepo. Контракт тепер торкається
    // кожної сутності хоча б раз — на InMemoryRepo це тривіально зелене, на
    // PostgresRepo кожен запит мусить реально виконатись. Зайвий $12 у
    // shopping_item і household_invite (обидва падали на живій базі з
    // «INSERT has more expressions than target columns») цей блок ловить.
    it('smoke: кожна сутність пишеться й читається', async () => {
      const { repo, household_id, user_id } = ctx;
      const now = new Date().toISOString();

      await repo.insertShoppingItem({
        id: randomUUID(), household_id, label: 'молоко', reason: null,
        value: 1000, unit: 'ml', zone: 'fridge', checked: false,
        added_by: user_id, source: 'user', created_at: now,
      });
      expect((await repo.listShoppingItems(household_id)).map((i) => i.label)).toContain('молоко');

      await repo.saveInvite({
        id: randomUUID(), household_id, invited_by: user_id,
        email: 'invited@example.com', role: 'member',
        token_hash: 'h'.repeat(64), created_at: now,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        consumed_at: null, consumed_by: null, revoked_at: null,
      });
      expect((await repo.listInvitesForHousehold(household_id)).some((i) => i.email === 'invited@example.com')).toBe(true);

      const eater_id = randomUUID();
      await repo.insertEater({
        id: eater_id, household_id, name: 'Смок-їдець',
        allergies: ['арахіс'], wishes: [], antipatterns: [], created_at: now,
      });
      expect((await repo.listEaters(household_id)).some((e) => e.id === eater_id)).toBe(true);

      const recipe_id = randomUUID();
      await repo.saveRecipe({
        id: recipe_id, owner_id: user_id, origin: 'imported', title: 'Смок-рецепт',
        descr: null, character: null, risk: null, base_servings: 2,
        time_total: null, nutrition: null,
        payload: { t: 'Смок-рецепт', ing: [], st: [] }, created_at: now, saved_at: now,
      });
      expect((await repo.listRecipes(user_id)).some((r) => r.id === recipe_id)).toBe(true);
      expect((await repo.listRecentRecipes(user_id)).some((r) => r.id === recipe_id)).toBe(true);

      await repo.saveCookRun({
        id: randomUUID(), household_id, user_id, recipe_id, servings: 2,
        started_at: now, finished_at: now, rating: 5, verdict: 'смок',
        photo_url: null, changes: null, undone_at: null,
      });
      expect((await repo.listCookRuns(user_id)).length).toBeGreaterThan(0);

    });

    it('retail-підключення: upsert по (user, provider), мʼяке відключення, delete', async () => {
      const { repo, user_id } = ctx;
      const now = new Date().toISOString();
      const base = {
        id: randomUUID(), user_id, provider: 'silpo',
        access_token_enc: 'enc-v1', refresh_token_enc: 'enc-r1',
        expires_at: now, status: 'active' as const, connected_at: now, updated_at: now,
        last_receipt_at: null,
      };
      await repo.upsertRetailConnection(base);
      const got = await repo.getRetailConnection(user_id, 'silpo');
      expect(got?.access_token_enc).toBe('enc-v1');
      expect(got?.status).toBe('active');

      // Повторний upsert тієї ж пари — перезапис, не другий рядок (refresh токена).
      await repo.upsertRetailConnection({ ...base, id: randomUUID(), access_token_enc: 'enc-v2' });
      const refreshed = await repo.getRetailConnection(user_id, 'silpo');
      expect(refreshed?.access_token_enc).toBe('enc-v2');

      // Мʼяке відключення: status змінюється, токен лишається (undo без нового OAuth).
      await repo.upsertRetailConnection({ ...refreshed!, status: 'disconnected' });
      expect((await repo.getRetailConnection(user_id, 'silpo'))?.status).toBe('disconnected');

      // Водяний знак синку чеків: last_receipt_at живе в рядку (ідемпотентність).
      await repo.upsertRetailConnection({ ...refreshed!, last_receipt_at: '2026-08-23T10:54:48.000Z' });
      expect((await repo.getRetailConnection(user_id, 'silpo'))?.last_receipt_at)
        .toBe('2026-08-23T10:54:48.000Z');

      // Інший провайдер — окремий рядок, не перетирається.
      expect(await repo.getRetailConnection(user_id, 'atb')).toBeNull();

      await repo.deleteRetailConnection(user_id, 'silpo');
      expect(await repo.getRetailConnection(user_id, 'silpo')).toBeNull();
    });

    it('updateMessageCard: заміна в кошику переживає перезавантаження', async () => {
      const { repo, user_id } = ctx;
      const session = await repo.getOrCreateSessionForDay(user_id, '2026-09-01');
      const mid = randomUUID();
      await repo.saveMessage({
        id: mid, session_id: session.id, role: 'assistant', text: 'Кошик',
        card: { type: 'cart', provider: 'silpo', list_label: null, rows: [], total: 0, found: 0, of: 1, cart_url: 'https://silpo.ua' },
        applied: 0, created_at: new Date().toISOString(),
      });
      await repo.updateMessageCard(mid, {
        type: 'cart', provider: 'silpo', list_label: null, rows: [], total: 72, found: 1, of: 1, cart_url: 'https://silpo.ua',
      });
      const msg = (await repo.listMessages(session.id)).find((m) => m.id === mid);
      expect((msg?.card as { total?: number })?.total).toBe(72);
    });

    // M13-ROLE-VOICE п.2: підпис серверної прози мусить переживати
    // перезавантаження. InMemoryRepo пропускає поле сам собою (спред обʼєкта),
    // Postgres — ні: без колонки й без мапінгу воно тихо зникає, і в проді
    // модель знову читає видачу мережі як власні слова. Тому перевірка живе
    // саме в контракті — вона однаково обовʼязкова для обох реалізацій.
    it('source серверної репліки переживає перезавантаження (і NULL лишається порожнім)', async () => {
      const { repo, user_id } = ctx;
      const session = await repo.getOrCreateSessionForDay(user_id, '2026-09-02');
      const serverId = randomUUID();
      const modelId = randomUUID();
      await repo.saveMessage({
        id: serverId, session_id: session.id, role: 'assistant',
        text: 'У Сільпо є: — Напій Schweppes Pink Tonic · 34₴',
        card: null, applied: 0, created_at: new Date().toISOString(),
        source: 'retail_search',
      });
      await repo.saveMessage({
        id: modelId, session_id: session.id, role: 'assistant',
        text: 'Зробимо пасту.', card: null, applied: 0, created_at: new Date().toISOString(),
      });

      const msgs = await repo.listMessages(session.id);
      expect(msgs.find((m) => m.id === serverId)?.source).toBe('retail_search');
      // Репліка моделі підпису не має — інакше підпис втрачає сенс.
      expect(msgs.find((m) => m.id === modelId)?.source).toBeUndefined();
    });

    // Календар. Перевірка живе саме тут, а не в тесті однієї реалізації:
    // rule — jsonb, supply — jsonb, buy — масив. Кожне з трьох тихо зникає в
    // Postgres без мапінгу, а InMemoryRepo пропускає їх сам собою через спред.
    // Рівно так само зник був last_receipt_at — і три дні цього ніхто не бачив.
    it('події дому: створення, читання, правка, згасання, видалення', async () => {
      const { repo, household_id, user_id } = ctx;
      const id = randomUUID();
      const base: HouseholdEventRow = {
        id, household_id, kind: 'supply',
        title: 'мама привезе цибулю',
        note: 'тиждень готуємо з нею',
        // Разова з тривалістю — форма, якої немає в жодного глобального свята.
        rule: { t: 'once', at: '2026-09-10', days: 7 },
        force: 'hint', restricts: null,
        buy: [], recipe_id: null, servings: null,
        supply: [{ label: 'цибуля', v: 3, u: 'kg' }],
        created_by: user_id, source: 'user',
        expires_at: null, done_at: null,
        created_at: new Date().toISOString(),
      };
      await repo.insertHouseholdEvent(base);

      const got = await repo.getHouseholdEvent(id);
      expect(got?.title).toBe('мама привезе цибулю');
      // Правило мусить пережити перезавантаження цілим, разом із days.
      expect(got?.rule).toEqual({ t: 'once', at: '2026-09-10', days: 7 });
      expect(got?.supply).toEqual([{ label: 'цибуля', v: 3, u: 'kg' }]);
      expect(got?.kind).toBe('supply');

      // Тижневе правило — друга форма дому, і воно теж має переживати запис.
      const weeklyId = randomUUID();
      await repo.insertHouseholdEvent({
        ...base, id: weeklyId, kind: 'constraint', title: 'у вівторок мало часу',
        note: null, rule: { t: 'weekly', dow: 2 }, supply: null,
      });
      expect((await repo.getHouseholdEvent(weeklyId))?.rule).toEqual({ t: 'weekly', dow: 2 });

      const list = await repo.listOwnEvents(household_id, user_id);
      expect(list.map((e) => e.id).sort()).toEqual([id, weeklyId].sort());

      await repo.updateHouseholdEvent(id, { title: 'цибуля від мами', buy: ['часник'] });
      const edited = await repo.getHouseholdEvent(id);
      expect(edited?.title).toBe('цибуля від мами');
      expect(edited?.buy).toEqual(['часник']);
      // Правка одного поля не гасить решту.
      expect(edited?.note).toBe('тиждень готуємо з нею');

      // Згасання — не видалення: рядок лишається, бо історія дому теж історія.
      const at = new Date().toISOString();
      await repo.updateHouseholdEvent(weeklyId, { expires_at: at });
      expect((await repo.getHouseholdEvent(weeklyId))?.expires_at).toBe(at);

      await repo.deleteHouseholdEvent(weeklyId);
      expect(await repo.getHouseholdEvent(weeklyId)).toBeNull();
      expect((await repo.listOwnEvents(household_id, user_id)).length).toBe(1);
    });

    // Довідник глобальний: обидві реалізації мусять віддавати ті самі рядки,
    // інакше сезон у проді й сезон у тестах — різні сезони.
    it('довідник подій: піст приходить обмеженням, якір — без meaning', async () => {
      const catalog = await ctx.repo.listOccasionCatalog();
      const lent = catalog.find((o) => o.id === 'lent');
      expect(lent).toBeDefined();
      expect(lent && 'restricts' in lent ? lent.restricts : null).toContain('жодного мʼяса');
      expect(lent?.rule).toEqual({ t: 'easter', from: -48, to: -1 });

      // Якорі — точки, а не сезони: meaning у них немає, і це не дефект.
      const pesach = catalog.find((o) => o.id === 'pesach');
      expect(pesach?.tradition).toBe('jewish');
      expect(pesach && 'meaning' in pesach && pesach.meaning != null).toBe(false);

      // Рамадан — вікно з дат по роках: має meaning, і орієнтовність не губиться
      // на дорозі через таблицю.
      const ramadan = catalog.find((o) => o.id === 'ramadan');
      expect(ramadan?.rule.t).toBe('dates');
      expect(ramadan && 'approx' in ramadan ? ramadan.approx : false).toBe(true);
      expect(ramadan && 'meaning' in ramadan ? ramadan.meaning : '').toContain('іфтар');
    });

    // Традиції (крок 11 — на user): «не обирала» (null) і «вимкнула все» ([])
    // — різні стани, і сховище мусить повертати їх різними.
    it('традиції: null ≠ [], вибір переживає перечитування', async () => {
      const { repo } = ctx;
      // Справжній рядок user — ctx.user_id у памʼятній реалізації лише id.
      const { user_id } = await repo.createUserWithHousehold(`trad-${randomUUID()}@x.local`, 'Т');
      expect((await repo.getUser(user_id))?.traditions ?? null).toBeNull();
      await repo.setTraditions(user_id, []);
      expect((await repo.getUser(user_id))?.traditions).toEqual([]);
      await repo.setTraditions(user_id, ['catholic', 'islamic']);
      expect((await repo.getUser(user_id))?.traditions).toEqual(['catholic', 'islamic']);
      await repo.setTraditions(user_id, null);
      expect((await repo.getUser(user_id))?.traditions ?? null).toBeNull();
    });

    // Адмінка v0 (фаза 4): чернетка не потрапляє в жоден зі звичайних
    // читачів довідника, поки її явно не опубліковано.
    it('адмінка: чернетка невидима людям, опублікована — довідник її бачить', async () => {
      const { repo } = ctx;
      const row: AdminOccasionRow = {
        id: 'tomato-day-2027', kind: 'editorial', title: 'день томатів 2027',
        meaning: 'Тест.', rule: { t: 'window', from: '09-05', to: '09-07' },
        buy: ['томати'], seeds: [], upcoming_title: null,
        source: 'Kitchen OS', published_at: null, created_at: new Date().toISOString(),
      };
      await repo.upsertAdminOccasion(row);

      let catalog = await repo.listOccasionCatalog();
      expect(catalog.some((o) => o.id === 'tomato-day-2027')).toBe(false);

      const drafts = await repo.listAdminOccasions();
      expect(drafts.find((o) => o.id === 'tomato-day-2027')?.published_at).toBeNull();

      await repo.setOccasionPublished('tomato-day-2027', true);
      catalog = await repo.listOccasionCatalog();
      const published = catalog.find((o) => o.id === 'tomato-day-2027');
      expect(published).toBeDefined();
      expect(published && 'meaning' in published ? published.meaning : null).toBe('Тест.');

      // Правка не публікує й не ховає навмисно розділені дії: title
      // змінюється, published_at лишається на місці.
      await repo.upsertAdminOccasion({ ...row, title: 'день томатів (переписано)', published_at: null });
      catalog = await repo.listOccasionCatalog();
      expect(catalog.find((o) => o.id === 'tomato-day-2027')?.title).toBe('день томатів (переписано)');

      await repo.setOccasionPublished('tomato-day-2027', false);
      catalog = await repo.listOccasionCatalog();
      expect(catalog.some((o) => o.id === 'tomato-day-2027')).toBe(false);

      await repo.deleteAdminOccasion('tomato-day-2027');
      expect((await repo.listAdminOccasions()).some((o) => o.id === 'tomato-day-2027')).toBe(false);
    });

    // Картка event застосовується ОДРАЗУ (card-modes: 'auto'), як і список
    // покупок: вона народжується лише на прямий запит людини, і якщо репліка
    // каже «записав», а події немає — модель бреше про зроблене. Запобіжник —
    // undo, і саме він тут і перевіряється.
    it('картка event: додає, править, закриває; undo повертає все', async () => {
      const { repo, household_id, user_id } = ctx;
      const mid = randomUUID();
      const card: EventCard = {
        type: 'event',
        ops: [{
          op: 'add', title: 'гості, шестеро', kind: 'custom', servings: 6,
          // rule проставляє сервер із `when` — модель дат не рахує.
          rule: { t: 'once', at: '2026-09-12' },
        }],
      };
      await createPending(repo, { message_id: mid, household_id, user_id, card });
      const { undo_token, applied } = await applyCard(repo, mid, [], user_id);
      expect(applied).toBe(1);

      const list = await repo.listOwnEvents(household_id, user_id);
      expect(list).toHaveLength(1);
      expect(list[0]?.title).toBe('гості, шестеро');
      expect(list[0]?.servings).toBe(6);
      // Слід авторства: інакше не розібрати, звідки в календарі те, чого не просили.
      expect(list[0]?.source).toBe('model');

      await undoCard(repo, mid, undo_token, user_id);
      expect(await repo.listOwnEvents(household_id, user_id)).toHaveLength(0);
    });

    // Календар не спільний елемент користування: доданий член сімʼї не бачить
    // чужих планів. Правило коштує один рядок у запиті й тримається лише на
    // памʼяті того, хто його писав, — тому воно тут, а не в коментарі.
    it('події приватні: сусід по дому не бачить і не править чужий план', async () => {
      const { repo, household_id, user_id, other_user_id } = ctx;
      const mine = randomUUID();
      const theirs = randomUUID();
      const base = {
        household_id, kind: 'custom' as const, note: null,
        rule: { t: 'once' as const, at: '2026-09-12' }, force: 'hint' as const, restricts: null,
        buy: [], recipe_id: null, servings: null, supply: null, source: 'user' as const,
        expires_at: null, done_at: null, created_at: new Date().toISOString(),
      };
      await repo.insertHouseholdEvent({ ...base, id: mine, title: 'мої гості', created_by: user_id });
      await repo.insertHouseholdEvent({ ...base, id: theirs, title: 'їхні гості', created_by: other_user_id });

      // Дім той самий — розділяє тільки автор.
      expect((await repo.listOwnEvents(household_id, user_id)).map((e) => e.id)).toEqual([mine]);
      expect((await repo.listOwnEvents(household_id, other_user_id)).map((e) => e.id)).toEqual([theirs]);

      // Правка по прямому id теж не проходить: модель могла взяти id з чужої
      // сесії, і тоді «змінив» було б брехнею, а не помилкою доступу.
      const mid = randomUUID();
      const card: EventCard = {
        type: 'event',
        ops: [{ op: 'edit', id: theirs, title: 'перехоплено' }],
      };
      await createPending(repo, { message_id: mid, household_id, user_id, card });
      const { applied } = await applyCard(repo, mid, [], user_id);
      expect(applied).toBe(0);
      expect((await repo.getHouseholdEvent(theirs))?.title).toBe('їхні гості');
    });

    // Вимикання редакційної теж особисте: сама подія спільна для всіх, але
    // рішення прибрати її зі свого календаря — про свій вигляд.
    it('вимикання приватне: сусід по дому далі бачить подію', async () => {
      const { repo, user_id, other_user_id } = ctx;
      await repo.muteOccasion(user_id, 'tomato-day-2026');
      expect(await repo.listMutedOccasions(user_id)).toEqual(['tomato-day-2026']);
      expect(await repo.listMutedOccasions(other_user_id)).toEqual([]);
    });

    it('картка event: правка й закриття вертаються повним рядком', async () => {
      const { repo, household_id, user_id } = ctx;
      const id = randomUUID();
      await repo.insertHouseholdEvent({
        id, household_id, kind: 'custom', title: 'гості', note: 'четверо',
        rule: { t: 'once', at: '2026-09-12' }, force: 'hint', restricts: null,
        buy: [], recipe_id: null, servings: 4, supply: null,
        created_by: user_id, source: 'user',
        expires_at: null, done_at: null, created_at: new Date().toISOString(),
      });

      const mid = randomUUID();
      const card: EventCard = {
        type: 'event',
        ops: [{ op: 'edit', id, title: 'гості, шестеро', servings: 6 }],
      };
      await createPending(repo, { message_id: mid, household_id, user_id, card });
      const { undo_token } = await applyCard(repo, mid, [], user_id);
      expect((await repo.getHouseholdEvent(id))?.title).toBe('гості, шестеро');
      expect((await repo.getHouseholdEvent(id))?.servings).toBe(6);

      await undoCard(repo, mid, undo_token, user_id);
      const back = await repo.getHouseholdEvent(id);
      expect(back?.title).toBe('гості');
      expect(back?.servings).toBe(4);
      // Правка одного поля не мала загубити решту.
      expect(back?.note).toBe('четверо');
    });

    it('картка event: чужу подію не видаляє і про зроблене не рапортує', async () => {
      const { repo, household_id, user_id, other_user_id } = ctx;
      const alien = randomUUID();
      // Чуже — це сусід по тому самому дому, а не інший дім: після приватності
      // календаря саме це найімовірніший випадок. Вигаданий household_id тут
      // стояти не може — це зовнішній ключ, і Postgres його не пустить.
      await repo.insertHouseholdEvent({
        id: alien, household_id, kind: 'custom', title: 'їхні гості',
        note: null, rule: { t: 'once', at: '2026-09-12' }, force: 'hint', restricts: null,
        buy: [], recipe_id: null, servings: null, supply: null,
        created_by: other_user_id, source: 'user', expires_at: null, done_at: null,
        created_at: new Date().toISOString(),
      });
      const mid = randomUUID();
      await createPending(repo, {
        message_id: mid, household_id, user_id,
        card: { type: 'event', ops: [{ op: 'remove', id: alien }] } as EventCard,
      });
      // Нуль застосованих — і сама подія на місці.
      expect((await applyCard(repo, mid, [], user_id)).applied).toBe(0);
      expect(await repo.getHouseholdEvent(alien)).not.toBeNull();
    });

    it('«не показувати такі»: вимкнення живе, поки його не знято', async () => {
      const { repo, user_id } = ctx;
      expect(await repo.listMutedOccasions(user_id)).toEqual([]);

      await repo.muteOccasion(user_id, 'tomato-day-2026');
      expect(await repo.listMutedOccasions(user_id)).toEqual(['tomato-day-2026']);

      // Повторне вимкнення — не помилка й не другий рядок: людина могла
      // натиснути двічі, і це не привід падати.
      await repo.muteOccasion(user_id, 'tomato-day-2026');
      expect(await repo.listMutedOccasions(user_id)).toHaveLength(1);

      await repo.unmuteOccasion(user_id, 'tomato-day-2026');
      expect(await repo.listMutedOccasions(user_id)).toEqual([]);
      // Зняти те, чого не вимикали, теж має бути тихо.
      await repo.unmuteOccasion(user_id, 'tomato-day-2026');
    });

    it('спіймане вікно: пишеться раз на рік і памʼятає, чим саме', async () => {
      const { repo, household_id } = ctx;
      expect(await repo.listOccasionCatches(household_id)).toEqual([]);

      await repo.recordOccasionCatch({
        household_id, occasion_id: 'mushroom', year: 2026,
        caught_at: '2026-09-10T18:00:00.000Z', by: 'білі гриби', run_id: null,
      });
      const got = await repo.listOccasionCatches(household_id);
      expect(got).toHaveLength(1);
      // `by` мусить пережити перезавантаження: підсумок каже «грибами», а не
      // безлике «спіймано», і без цього поля різниці не буде видно.
      expect(got[0]?.by).toBe('білі гриби');

      // Друге готування того ж сезону — не друга марка.
      await repo.recordOccasionCatch({
        household_id, occasion_id: 'mushroom', year: 2026,
        caught_at: '2026-09-20T18:00:00.000Z', by: 'гриби в сметані', run_id: null,
      });
      expect(await repo.listOccasionCatches(household_id)).toHaveLength(1);

      // Наступний рік — інший факт.
      await repo.recordOccasionCatch({
        household_id, occasion_id: 'mushroom', year: 2027,
        caught_at: '2027-09-12T18:00:00.000Z', by: 'різото з білими', run_id: null,
      });
      expect(await repo.listOccasionCatches(household_id)).toHaveLength(2);
      expect(await repo.listOccasionCatches(household_id, 2026)).toHaveLength(1);
    });


    // ----- Раунд 4, крок 2: профіль як сім речень ---------------------------

    it('profile_text: без записів — сім порожніх полів, а не null', async () => {
      const { repo, user_id } = ctx;
      const p = await repo.getProfileText(user_id);
      expect(p.user_id).toBe(user_id);
      expect(Object.keys(p.fields)).toEqual(['name', 'no', 'ban', 'love', 'meh', 'kit', 'when']);
      expect(p.fields.no).toEqual({ text: '', status: 'empty', updated_at: null });
    });

    it('patchProfileField: текст → filled, обрізка по ліміту поля, інші поля не чіпає', async () => {
      const { repo, user_id } = ctx;
      const v = await repo.patchProfileField(user_id, 'no', { text: '  мʼяса й птиці  ' });
      expect(v.text).toBe('мʼяса й птиці');
      expect(v.status).toBe('filled');
      expect(v.updated_at).toBeTruthy();

      const long = await repo.patchProfileField(user_id, 'name', { text: 'П'.repeat(45) });
      expect(long.text).toBe('П'.repeat(30));

      const p = await repo.getProfileText(user_id);
      expect(p.fields.no.text).toBe('мʼяса й птиці');
      expect(p.fields.name.text).toBe('П'.repeat(30));
      expect(p.fields.love.status).toBe('empty');
    });

    it('patchProfileField: «Нічого такого» — status none і порожній текст; порожній текст — знову empty', async () => {
      const { repo, user_id } = ctx;
      await repo.patchProfileField(user_id, 'ban', { text: 'арахіс' });
      const none = await repo.patchProfileField(user_id, 'ban', { status: 'none' });
      expect(none).toMatchObject({ text: '', status: 'none' });
      expect((await repo.getProfileText(user_id)).fields.ban.status).toBe('none');

      const cleared = await repo.patchProfileField(user_id, 'ban', { text: '   ' });
      expect(cleared).toMatchObject({ text: '', status: 'empty' });
    });

    it('patchProfileField: чужий текст не протікає між людьми', async () => {
      const { repo, user_id, other_user_id } = ctx;
      await repo.patchProfileField(user_id, 'love', { text: 'тайську кухню' });
      expect((await repo.getProfileText(other_user_id)).fields.love.status).toBe('empty');
    });

    it('нотатки: додати, прочитати найсвіжіші, мʼяко прибрати, повернути', async () => {
      const { repo, user_id } = ctx;
      const mk = (text: string, created_at: string, source: ProfileNote['source'] = 'assistant'): ProfileNote => ({
        id: randomUUID(), user_id, subject: null, text, source, created_at, deleted_at: null, norm_hash: noteHash(text),
      });
      const a = mk('Духовка гріє на 20 сильніше', '2026-09-02T10:00:00.000Z');
      const b = mk('Пармезан солоний — воду солити менше', '2026-09-04T10:00:00.000Z', 'user');
      await repo.addProfileNote(a);
      await repo.addProfileNote(b);

      const list = await repo.listProfileNotes(user_id);
      expect(list.map((n) => n.id)).toEqual([b.id, a.id]);
      expect(list[0]).toMatchObject({ source: 'user', subject: null, deleted_at: null, norm_hash: noteHash(b.text) });

      await repo.deleteProfileNote(a.id);
      expect((await repo.listProfileNotes(user_id)).map((n) => n.id)).toEqual([b.id]);
      const withDeleted = await repo.listProfileNotes(user_id, { include_deleted: true });
      expect(withDeleted.find((n) => n.id === a.id)?.deleted_at).toBeTruthy();

      await repo.restoreProfileNote(a.id);
      expect((await repo.listProfileNotes(user_id)).map((n) => n.id)).toEqual([b.id, a.id]);
    });

    it('нотатки: ліміт і чужі не видно', async () => {
      const { repo, user_id, other_user_id } = ctx;
      for (let i = 0; i < 12; i++) {
        const text = `нотатка ${i}`;
        await repo.addProfileNote({
          id: randomUUID(), user_id, subject: null, text, source: 'assistant',
          created_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), deleted_at: null, norm_hash: noteHash(text),
        });
      }
      await repo.addProfileNote({
        id: randomUUID(), user_id: other_user_id, subject: null, text: 'чужа', source: 'assistant',
        created_at: new Date().toISOString(), deleted_at: null, norm_hash: noteHash('чужа'),
      });
      const ten = await repo.listProfileNotes(user_id);
      expect(ten).toHaveLength(10);
      expect(ten[0]!.text).toBe('нотатка 11');
      expect((await repo.listProfileNotes(user_id, { limit: 100 })).some((n) => n.text === 'чужа')).toBe(false);
    });

    it('veto_index: setVetoIndex замінює рядки поля, інше поле не чіпає; порядок зберігається', async () => {
      const { repo, user_id, other_user_id } = ctx;
      const row = (field: VetoRow['field'], label: string, extra: Partial<VetoRow> = {}): VetoRow => ({
        user_id, field, kind: 'category', ref: label, label, allergy: field === 'ban', subject: null, ...extra,
      });
      await repo.setVetoIndex(user_id, 'no', [row('no', 'мʼясо'), row('no', 'кінза', { kind: 'free', ref: null })]);
      await repo.setVetoIndex(user_id, 'ban', [row('ban', 'арахіс', { kind: 'product', ref: 'peanut' })]);
      expect(await repo.getVetoIndex(user_id)).toEqual([
        row('no', 'мʼясо'), row('no', 'кінза', { kind: 'free', ref: null }),
        row('ban', 'арахіс', { kind: 'product', ref: 'peanut' }),
      ]);

      await repo.setVetoIndex(user_id, 'no', [row('no', 'птиця')]);
      expect(await repo.getVetoIndex(user_id)).toEqual([
        row('no', 'птиця'), row('ban', 'арахіс', { kind: 'product', ref: 'peanut' }),
      ]);

      await repo.setVetoIndex(user_id, 'ban', []);
      expect(await repo.getVetoIndex(user_id)).toEqual([row('no', 'птиця')]);
      expect(await repo.getVetoIndex(other_user_id)).toEqual([]);
    });

    it('новий користувач має тариф beta і порожні позначки; touchUser ставить їх', async () => {
      const { repo } = ctx;
      const { user_id } = await repo.createUserWithHousehold(`plan-${randomUUID()}@x.local`, 'Тест');
      const u = await repo.getUser(user_id);
      expect(u?.plan).toBe('beta');
      expect(u?.welcome_seen_at).toBeNull();
      expect(u?.profile_onboarding_at).toBeNull();
      await repo.touchUser(user_id, 'welcome_seen_at', '2026-09-05T10:00:00.000Z');
      await repo.touchUser(user_id, 'profile_onboarding_at', '2026-09-05T10:01:00.000Z');
      const after = await repo.getUser(user_id);
      expect(after?.welcome_seen_at).toBe('2026-09-05T10:00:00.000Z');
      expect(after?.profile_onboarding_at).toBe('2026-09-05T10:01:00.000Z');
    });

    it('deleteUserAccount забирає profile_text, нотатки й вето разом із людиною', async () => {
      const { repo, user_id } = ctx;
      await repo.patchProfileField(user_id, 'no', { text: 'риби' });
      await repo.addProfileNote({
        id: randomUUID(), user_id, subject: null, text: 'x', source: 'user',
        created_at: new Date().toISOString(), deleted_at: null, norm_hash: noteHash('x'),
      });
      await repo.setVetoIndex(user_id, 'no', [{ user_id, field: 'no', kind: 'free', ref: null, label: 'риби', allergy: false, subject: null }]);
      await repo.deleteUserAccount(user_id);
      expect((await repo.getProfileText(user_id)).fields.no.status).toBe('empty');
      expect(await repo.listProfileNotes(user_id, { include_deleted: true })).toEqual([]);
      expect(await repo.getVetoIndex(user_id)).toEqual([]);
    });

    it('undo з неправильним токеном — помилка; повторний undo — no-op', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const { undo_token } = await applyCard(ctx.repo, mid, [], ctx.user_id);
      await expect(undoCard(ctx.repo, mid, randomUUID(), ctx.user_id)).rejects.toThrow(/mismatch/);
      const r1 = await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect(r1.undone).toBe(true);
      const r2 = await undoCard(ctx.repo, mid, undo_token, ctx.user_id);
      expect(r2.already).toBe(true);
    });

    it('dismiss на pending-картці: проставляє dismissed_at, ідемпотентно', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      const r1 = await dismissCard(ctx.repo, mid, ctx.user_id);
      expect(r1.dismissed).toBe(true);
      expect(r1.already).toBe(false);
      const pc = await ctx.repo.getPending(mid);
      expect(pc?.dismissed_at).toBeTruthy();
      // Повторний dismiss — no-op, той самий результат.
      const r2 = await dismissCard(ctx.repo, mid, ctx.user_id);
      expect(r2.dismissed).toBe(true);
      expect(r2.already).toBe(true);
    });

    it('dismiss на застосованій картці — помилка: шлях назад тут undo, не dismiss', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await applyCard(ctx.repo, mid, [], ctx.user_id);
      await expect(dismissCard(ctx.repo, mid, ctx.user_id)).rejects.toThrow(/already applied/);
    });

    it('dismiss чужої картки — forbidden', async () => {
      const mid = randomUUID();
      const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
      await createPending(ctx.repo, { message_id: mid, household_id: ctx.household_id, user_id: ctx.user_id, card });
      await expect(dismissCard(ctx.repo, mid, ctx.other_user_id)).rejects.toThrow(/forbidden/);
    });

    // Аудит раунд 3, крок 5: [ОСТАННІ ДІЇ] — закриті картки поза поточною
    // розмовою. message.id === card_pending.id (та сама інваріанта, що
    // listOpenPending уже покладається) — pending лінкується до сесії через
    // повідомлення-носія, яке треба створити самому.
    it('listRecentResolved: бачить застосовані/скасовані/відхилені, ігнорує ще відкриті', async () => {
      const { repo, household_id, user_id } = ctx;
      const session = await repo.getOrCreateSessionForDay(user_id, '2026-09-05');
      const now = new Date();
      const mkPending = async (label: string) => {
        const mid = randomUUID();
        const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label }] };
        await repo.saveMessage({
          id: mid, session_id: session.id, role: 'assistant', text: null,
          card, applied: 0, created_at: now.toISOString(),
        });
        await createPending(repo, { message_id: mid, household_id, user_id, card });
        return mid;
      };

      const appliedId = await mkPending('застосована');
      await applyCard(repo, appliedId, [], user_id);

      const undoneId = await mkPending('скасована');
      const { undo_token } = await applyCard(repo, undoneId, [], user_id);
      await undoCard(repo, undoneId, undo_token, user_id);

      const dismissedId = await mkPending('відхилена');
      await dismissCard(repo, dismissedId, user_id);

      const stillOpenId = await mkPending('ще чекає');

      const since = new Date(now.getTime() - 60_000);
      const out = await repo.listRecentResolved(household_id, { since, limit: 20 });
      const ids = out.map((pc) => pc.id);
      expect(ids).toContain(appliedId);
      expect(ids).toContain(undoneId);
      expect(ids).toContain(dismissedId);
      expect(ids).not.toContain(stillOpenId);
    });

    it('listRecentResolved: чужа сесія виключена', async () => {
      const { repo, household_id, user_id } = ctx;
      const sessionA = await repo.getOrCreateSessionForDay(user_id, '2026-09-05');
      const sessionB = await repo.createFreshSession(user_id, '2026-09-05');
      const now = new Date();
      const mkAndApply = async (session_id: string) => {
        const mid = randomUUID();
        const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label: 'x' }] };
        await repo.saveMessage({
          id: mid, session_id, role: 'assistant', text: null,
          card, applied: 0, created_at: now.toISOString(),
        });
        await createPending(repo, { message_id: mid, household_id, user_id, card });
        await applyCard(repo, mid, [], user_id);
        return mid;
      };

      const idInA = await mkAndApply(sessionA.id);
      const idInB = await mkAndApply(sessionB.id);

      const since = new Date(now.getTime() - 60_000);
      const out = await repo.listRecentResolved(household_id, { since, limit: 20, exclude_session_id: sessionA.id });
      const ids = out.map((pc) => pc.id);
      expect(ids).not.toContain(idInA);
      expect(ids).toContain(idInB);
    });

    it('listRecentResolved: ліміт і сортування — найновіше рішення першим', async () => {
      const { repo, household_id, user_id } = ctx;
      const session = await repo.getOrCreateSessionForDay(user_id, '2026-09-05');
      const now = new Date();
      const mkAndApply = async (label: string) => {
        const mid = randomUUID();
        const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'add', label }] };
        await repo.saveMessage({
          id: mid, session_id: session.id, role: 'assistant', text: null,
          card, applied: 0, created_at: now.toISOString(),
        });
        await createPending(repo, { message_id: mid, household_id, user_id, card });
        await applyCard(repo, mid, [], user_id);
        // Розводимо мітки часу рішення на реальних мілісекундах — без цього
        // три applyCard поспіль можуть лягти в ту саму мілісекунду й
        // сортування стане недетермінованим.
        await new Promise((r) => setTimeout(r, 5));
        return mid;
      };

      const first = await mkAndApply('перша');
      const second = await mkAndApply('друга');
      const third = await mkAndApply('третя');

      const since = new Date(now.getTime() - 60_000);
      const out = await repo.listRecentResolved(household_id, { since, limit: 2 });
      expect(out).toHaveLength(2);
      expect(out[0]!.id).toBe(third);
      expect(out[1]!.id).toBe(second);
      expect(out.map((pc) => pc.id)).not.toContain(first);
    });
  });
}
