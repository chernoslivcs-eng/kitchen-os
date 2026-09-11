#!/usr/bin/env npx tsx
// Стенд для пар «кадр бандла · рендер» без проду і без моделі.
//
// Локальний стенд за замовчуванням пише в ПРОДОВУ базу (PG_URL у .env =
// Neon), а картки з каталожними ключами народжуються лише з відповіді
// моделі. Тому пари комори/чека/рецептів досі знімались із дому dev на
// проді — з сімома позиціями без категорії. Цей стенд підіймає той самий
// API (buildApp) на InMemoryRepo і засіває дім ЗА КАДРОМ Screens «Комора ·
// збірка»: стейк −9 дн «не їм», помідори сьогодні, фует 2 дн, креветки «не
// можна», сіль «не псується» — щоб рендер порівнювався з кадром на тих самих
// даних, а не на випадкових. Нічого не пише нікуди: памʼять процесу.
//
//   npx tsx scripts/stand-seed.mts            # API на :3010, вхід dev@local.test
//   PORT=3011 npx tsx scripts/stand-seed.mts
//
// Далі web: API_URL=http://localhost:3010 pnpm --filter @kitchen/web dev
// і side-by-side.mjs з --url http://localhost:5173 --email dev@local.test.

import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '../packages/domain/in-memory-repo.ts';
import type { PantryBatch, Zone, Unit, Provenance } from '../packages/domain/types.ts';
import type { HouseholdProduct } from '../packages/domain/product.ts';
import type { VetoRow } from '../packages/domain/profile-text.ts';
import { buildApp } from '../services/api/src/server.ts';
import { InMemoryStore } from '../services/api/src/attachment-store.ts';
import { ConsoleMailer } from '../services/api/src/mailer.ts';

const EMAIL = process.env.STAND_EMAIL ?? 'dev@local.test';
const PORT = Number(process.env.PORT ?? 3010);
const DAY = 86_400_000;
const now = Date.now();
const iso = (daysFromNow: number) => new Date(now + daysFromNow * DAY).toISOString();

const repo = new InMemoryRepo();
const { user_id, household_id } = await repo.createUserWithHousehold(EMAIL, 'Пилип');
// Семена вже бачили — стрічка не перекидає на /welcome.
await repo.touchUser(user_id, 'welcome_seen_at', iso(-10));
await repo.touchUser(user_id, 'profile_onboarding_at', iso(-10));

// ── Продукти дому (трійка → паспорт «бренд · тип» у підзаголовку рядка) ──
type P = { product: string; brand?: string; variant?: string; key: string; unit?: 'g' | 'ml' | 'pcs' | null };
const products: Record<string, HouseholdProduct> = {};
const product = (id: string, p: P) => {
  products[id] = {
    id: `p-${id}`, household_id, product: p.product, brand: p.brand ?? null, variant: p.variant ?? null,
    unit: p.unit ?? 'g', pack_size: null, tags: {}, catalog_key: p.key, created_at: iso(-30),
  };
};
product('steak', { product: 'Стейк Портерхаус', brand: 'яловичина', variant: 'Dry Aged · в/у', key: 'beef_ribeye' });
product('shrimp', { product: 'Креветки', brand: 'Metro Chef', variant: '58/66 очищені', key: 'shrimp_vannamei' });
product('fuet', { product: 'Фует', brand: 'Сільпо', variant: 'ковбаса с/в', key: 'fuet_sausage' });
product('mozz', { product: 'Моцарела', brand: 'Galbani', variant: 'у розсолі', key: 'cheese_mozzarella_brine' });
product('yog', { product: 'Йогурт грецький', brand: 'Молокія', variant: '10%', key: 'yog_greek' });
product('butter', { product: 'Масло', brand: 'Яготинське', variant: '73%', key: 'butter_72' });
product('mustard', { product: 'Гірчиця', brand: 'Торчин', variant: 'дижонська', key: 'mustard', unit: 'pcs' });
product('choc', { product: 'Шоколад', brand: 'Korisni', variant: 'кероб полуниця-чіа', key: 'milk_chocolate_bar' });
product('chips', { product: 'Чипси', brand: "Lay's", variant: 'сметана-зелень', key: 'chips_cheese', unit: 'pcs' });
product('orange', { product: 'Апельсини', variant: 'калібр 56–64', key: 'orange' });
product('onion', { product: 'Цибуля', variant: 'мамина', key: 'onion_yellow' });
for (const p of Object.values(products)) await repo.insertProduct(p);

// ── Партії — як у renderVals() Screens: зона · строк · кількість · походження ──
type B = { label: string; zone: Zone; key: string | null; days?: number | null; value?: number | null; unit?: Unit | null;
  prov?: Provenance; action?: string | null; prod?: string; addedDays?: number };
const batch = async (b: B) => {
  const row: PantryBatch = {
    id: randomUUID(), household_id, catalog_key: b.key, label: b.label, zone: b.zone,
    value: b.value ?? null, unit: b.unit ?? null, state: 'sealed', opened_at: null,
    // Строк — точною датою, щоб число днів у рядку дорівнювало кадру; писач не
    // людина (expires_source не 'manual'), тож рядок каже «≈ ще N дн».
    expires_at: b.days == null ? null : iso(b.days), expires_source: b.days == null ? null : 'category',
    best_before_opened_days: null, added_at: iso(-(b.addedDays ?? 4)), depleted_at: null,
    confidence: 1, provenance: b.prov ?? 'receipt_line', staple: false,
    last_by: user_id, last_action: b.action ?? null, product_id: b.prod ? `p-${b.prod}` : null,
  };
  await repo.insertBatch(row);
  return row;
};
// Свіже
await batch({ label: 'Стейк Портерхаус', zone: 'fresh', key: 'beef_ribeye', days: -9, value: 450, unit: 'g', prod: 'steak', addedDays: 16 });
await batch({ label: 'Салат айсберг', zone: 'fresh', key: 'veg_lettuce_iceberg', days: -4, prov: 'user_statement', action: 'user_add', addedDays: 11 });
await batch({ label: 'Помідори', zone: 'fresh', key: 'veg_tomato_plum', days: 0, value: 400, unit: 'g', prov: 'user_statement', action: 'user_add', addedDays: 7 });
await batch({ label: 'Апельсини', zone: 'fresh', key: 'orange', days: 9, value: 1200, unit: 'g', prod: 'orange' });
await batch({ label: 'Цибуля', zone: 'fresh', key: 'onion_yellow', days: 21, value: 3000, unit: 'g', prov: 'user_statement', prod: 'onion' });
// Холодильник
await batch({ label: 'Фует', zone: 'fridge', key: 'fuet_sausage', days: 2, value: 160, unit: 'g', prod: 'fuet' });
await batch({ label: 'Моцарела', zone: 'fridge', key: 'cheese_mozzarella_brine', days: 3, value: 125, unit: 'g', prov: 'user_statement', prod: 'mozz' });
await batch({ label: 'Йогурт грецький', zone: 'fridge', key: 'yog_greek', days: 6, value: 400, unit: 'g', prov: 'inference', prod: 'yog' });
await batch({ label: 'Яйця', zone: 'fridge', key: 'eggs_chicken', days: 12, value: 6, unit: 'pcs', prov: 'inference' });
await batch({ label: 'Масло', zone: 'fridge', key: 'butter_72', days: 30, value: 200, unit: 'g', prod: 'butter' });
// Морозилка
await batch({ label: 'Креветки', zone: 'freezer', key: 'shrimp_vannamei', days: 92, value: 500, unit: 'g', prod: 'shrimp' });
await batch({ label: 'Фарш яловичий', zone: 'freezer', key: 'beef_mince', days: 60, value: 500, unit: 'g' });
await batch({ label: 'Горошок', zone: 'freezer', key: 'veg_green_peas_pods', days: 180, value: 400, unit: 'g', prov: 'inference' });
// Суха шафа
await batch({ label: 'Гірчиця', zone: 'dry', key: 'mustard', days: 120, value: 2, unit: 'pcs', prod: 'mustard' });
await batch({ label: 'Шоколад', zone: 'dry', key: 'milk_chocolate_bar', days: 173, prod: 'choc' });
await batch({ label: 'Сіль', zone: 'dry', key: 'spice_salt_table', value: 1000, unit: 'g', prov: 'user_statement', action: 'user_add' });
await batch({ label: 'Оцет яблучний', zone: 'dry', key: 'vinegar_apple' });
await batch({ label: 'Чипси', zone: 'dry', key: 'chips_cheese', value: 1, unit: 'pcs', prod: 'chips' });
// Спеції · Напої — по одній, щоб чіпи мали всі шість зон.
await batch({ label: 'Паприка копчена', zone: 'spices', key: null, value: 1, unit: 'pcs', prov: 'user_statement', action: 'user_add' });
await batch({ label: 'Вода газована', zone: 'drinks', key: null, value: 6, unit: 'pcs' });

// ── Вето: «не їм» — мʼясо (стейк); «не можна» — ракоподібні (креветки) ──
const veto = (field: 'no' | 'ban', kind: VetoRow['kind'], ref: string, label: string): VetoRow =>
  ({ user_id, field, kind, ref, label, allergy: field === 'ban', subject: null });
await repo.setVetoIndex(user_id, 'no', [veto('no', 'category', 'яловичина', 'яловичину'), veto('no', 'category', 'шоколад', 'шоколад')]);
await repo.setVetoIndex(user_id, 'ban', [veto('ban', 'category', 'ракоподібні', 'креветки')]);

// ── Список покупок: три позиції, які закриє чек (Screens: «✓ у списку») ──
for (const label of ['Молоко', 'Яйця', 'Масло']) {
  await repo.insertShoppingItem({ id: randomUUID(), household_id, label, reason: null, value: null, unit: null, zone: null, checked: false, added_by: user_id, source: 'user', created_at: iso(-2) });
}

// ── Рецепти (Screens «Рецепти · 1440», «Рецепт · 1440») і журнал («Журнал · 1440») ──
const byLabel = new Map((await repo.listBatches(household_id)).map((b) => [b.label, b.id]));
const P_ = (label: string) => byLabel.get(label);
type R = { id: string; title: string; descr: string; minutes: number; sv?: number; ing: { n: string; v?: number; u?: string; p?: string }[]; st: { t: string; c: string; s?: number }[]; kcal?: number; saved?: boolean; daysAgo?: number };
const recipeIds: Record<string, string> = {};
const recipe = async (r: R) => {
  const id = randomUUID();
  recipeIds[r.id] = id;
  await repo.saveRecipe({
    id, owner_id: user_id, origin: 'generated', title: r.title, descr: r.descr, character: null, risk: null,
    base_servings: r.sv ?? 2, time_total: r.minutes,
    nutrition: r.kcal ? { kcal: r.kcal, p: 22, f: 18, c: 68 } : null,
    payload: { t: r.title, sv: r.sv ?? 2, tm: r.minutes, ch: '', d: r.descr, rk: '', nu: r.kcal ? { kcal: r.kcal, p: 22, f: 18, c: 68 } : undefined, ing: r.ing, st: r.st },
    created_at: iso(-(r.daysAgo ?? 5)), saved_at: r.saved === false ? null : iso(-(r.daysAgo ?? 5)),
  });
  return id;
};
await recipe({ id: 'pasta', title: 'Паста з печеними помідорами й часником', minutes: 25, kcal: 540,
  descr: 'Помідори печуться повільно, доки не стануть майже джемом, і саме вони роблять соус. Часник кладеться цілим і давиться вже в олії.',
  ing: [
    { n: 'Помідори', v: 600, u: 'g', p: P_('Помідори') }, { n: 'Спагеті', v: 200, u: 'g' }, { n: 'Часник', v: 4, u: 'pcs' },
    { n: 'Олія оливкова', v: 45, u: 'ml' }, { n: 'Пармезан', v: 40, u: 'g' }, { n: 'Фует', v: 60, u: 'g', p: P_('Фует') },
  ],
  st: [
    { t: 'Розігріти', c: 'Духовку на 200°. Помідори розрізати навпіл, викласти на лист зрізом догори, часник — цілими зубцями в шкірці.' },
    { t: 'Пекти', c: 'Полити олією, посолити. 20 хвилин, доки краї не почнуть темніти.', s: 1200 },
    { t: 'Паста', c: 'Спагеті в киплячу солону воду на 9 хвилин. Пів склянки води лишити.', s: 540 },
    { t: 'Зібрати', c: 'Часник видавити з шкірки, розтерти з помідорами прямо на листі. Пасту туди ж, долити води, перемішати.' },
  ] });
await recipe({ id: 'shak', title: 'Шакшука з фуетом', minutes: 20, kcal: 420, descr: 'Яйця в томатах, фует — наприкінці.',
  ing: [{ n: 'Помідори', v: 400, u: 'g', p: P_('Помідори') }, { n: 'Яйця', v: 4, u: 'pcs', p: P_('Яйця') }, { n: 'Фует', v: 80, u: 'g', p: P_('Фует') }, { n: 'Цибуля', v: 1, u: 'pcs', p: P_('Цибуля') }],
  st: [{ t: 'Соус', c: 'Цибулю й помідори тушкувати 10 хвилин.', s: 600 }, { t: 'Яйця', c: 'Зробити ямки, вбити яйця, накрити на 5 хвилин.', s: 300 }] });
await recipe({ id: 'rice', title: 'Рис із креветками та лимоном', minutes: 30, kcal: 480, descr: 'Швидка вечеря з морозилки.',
  ing: [{ n: 'Креветки', v: 300, u: 'g', p: P_('Креветки') }, { n: 'Рис', v: 200, u: 'g' }, { n: 'Лимон', v: 1, u: 'pcs' }, { n: 'Часник', v: 2, u: 'pcs' }],
  st: [{ t: 'Рис', c: 'Відварити рис.', s: 900 }, { t: 'Креветки', c: 'Обсмажити з часником 3 хвилини, додати лимон.', s: 180 }], daysAgo: 8 });
await recipe({ id: 'borsch', title: 'Борщ', minutes: 100, kcal: 380, descr: 'З маминою цибулею.',
  ing: [{ n: 'Буряк', v: 300, u: 'g' }, { n: 'Капуста', v: 300, u: 'g' }, { n: 'Цибуля', v: 1, u: 'pcs', p: P_('Цибуля') }, { n: 'Фарш яловичий', v: 300, u: 'g', p: P_('Фарш яловичий') }],
  st: [{ t: 'Бульйон', c: 'Фарш обсмажити, залити водою, варити 40 хвилин.', s: 2400 }, { t: 'Овочі', c: 'Додати буряк і капусту, ще 30 хвилин.', s: 1800 }], daysAgo: 12 });
await recipe({ id: 'omelet', title: 'Омлет із фетою', minutes: 10, kcal: 320, descr: 'Сніданок на пʼять хвилин.',
  ing: [{ n: 'Яйця', v: 3, u: 'pcs', p: P_('Яйця') }, { n: 'Фета', v: 60, u: 'g' }, { n: 'Масло', v: 10, u: 'g', p: P_('Масло') }],
  st: [{ t: 'Збити', c: 'Яйця з сіллю.' }, { t: 'Смажити', c: 'На маслі 4 хвилини, фету зверху.', s: 240 }], daysAgo: 20 });

const run = async (rid: string, o: { daysAgo: number; hour: number; minutes: number; rating?: number; verdict?: string; used?: number; undone?: boolean }) => {
  const fin = new Date(now - o.daysAgo * DAY); fin.setHours(o.hour, o.daysAgo === 0 ? 42 : o.hour === 8 ? 15 : 5, 0, 0);
  const start = new Date(fin.getTime() - o.minutes * 60_000);
  const ids = [...byLabel.values()].slice(0, o.used ?? 0);
  await repo.saveCookRun({
    id: randomUUID(), household_id, user_id, recipe_id: recipeIds[rid]!, servings: 2,
    started_at: start.toISOString(), finished_at: fin.toISOString(), rating: o.rating ?? null, verdict: o.verdict ?? null, photo_url: null,
    changes: { batches: ids.map((id) => ({ id, op: 'deplete' as const, prev_state: 'sealed' as const, prev_depleted_at: null })) },
    undone_at: o.undone ? fin.toISOString() : null, session_id: null,
  });
};
await run('pasta', { daysAgo: 0, hour: 19, minutes: 27, rating: 4, verdict: 'помідори треба було пекти довше', used: 3 });
await run('shak', { daysAgo: 1, hour: 8, minutes: 20, rating: 5, used: 4 });
await run('rice', { daysAgo: 1, hour: 20, minutes: 30, undone: true });
await run('borsch', { daysAgo: 4, hour: 18, minutes: 100, used: 6 });
await run('omelet', { daysAgo: 4, hour: 8, minutes: 10 });
await run('pasta', { daysAgo: 9, hour: 19, minutes: 25, rating: 4 });
console.log(`stand-seed: рецепт «Паста…» — /recipe/${recipeIds.pasta} · /r/${recipeIds.pasta}`);

const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer());
await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`stand-seed: API на :${PORT} · дім ${household_id.slice(0, 8)} · вхід ${EMAIL} · ${(await repo.listBatches(household_id)).length} партій`);
