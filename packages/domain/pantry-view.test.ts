import { describe, it, expect } from 'vitest';
import { topCategory, daysLeft, effectiveExpiry, pantryItemView, pantryVetoRows, vetoMarkOf } from './pantry-view.js';
import { serializePantry } from './context.js';
import { buildVetoIndex } from './veto-index.js';
import { BY_KEY } from '@kitchen/catalog/seed';
import type { PantryBatch } from './types.js';

// Раунд 5, крок Ф1: поля позиції для фільтра комори.

const NOW = new Date('2026-09-06T12:00:00Z').getTime();
const batch = (label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: label, household_id: 'h1', catalog_key: null, label, zone: 'fridge', value: 100, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date(NOW - 5 * 86_400_000).toISOString(),
  depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null, ...over,
});

describe('topCategory', () => {
  it('за токенами categories, перший за пріоритетом', () => {
    expect(topCategory(BY_KEY.get('chicken_fillet')!.categories)).toBe('мʼясо');
    expect(topCategory(BY_KEY.get('parmesan')!.categories)).toBe('сири');
    expect(topCategory(BY_KEY.get('eggs_chicken')!.categories)).toBe('яйця');
    expect(topCategory(['бланк', 'пшеничне пиво', 'пиво', 'алкоголь', 'напої', 'рослинне'])).toBe('алкоголь');
    expect(topCategory(['зелений горошок', 'горошок', 'бобові', 'овочі', 'рослинне'])).toBe('зелень і бобові');
    expect(topCategory(['тунець в олії', 'тунець', 'риба', 'консерви', 'тваринне'])).toBe('консерви');
    expect(topCategory(['рідина для посуду', 'побутова хімія', 'нехарчове'])).toBe('побутове');
    expect(topCategory(['щось', 'дивне'])).toBeNull();
  });
});

describe('effectiveExpiry — строк рахується, а не зберігається (Б1, Р2)', () => {
  it('запечатана партія без дати отримує строк від added_at і зони', () => {
    // Досі 245 із 246 партій були «без терміну», тобто мовчазно свіжі. Строк —
    // чиста функція від дати завантаження й зони, і рахується на льоту: у БД
    // його ніхто не пише.
    const b = batch('помідори', { zone: 'fresh' });   // додано 5 днів тому
    const exp = effectiveExpiry(b, null, NOW);
    expect(exp).not.toBeNull();
    expect(daysLeft(exp, NOW), 'fresh живе 7 днів, 5 минуло').toBe(2);
  });

  it('зона змінює строк без жодної правки даних', () => {
    // Заради цього Р2 і вибрав обчислення замість колонки: та сама партія,
    // перекладена в морозилку, одразу живе інакше.
    const added = new Date(NOW - 5 * 86_400_000).toISOString();
    const inFridge = effectiveExpiry(batch('гуляш', { zone: 'fridge', added_at: added }), null, NOW);
    const inFreezer = effectiveExpiry(batch('гуляш', { zone: 'freezer', added_at: added }), null, NOW);
    expect(daysLeft(inFridge, NOW)).toBe(16);
    expect(daysLeft(inFreezer, NOW)).toBe(265);
  });

  it('ручна дата бʼє розрахунок — і коротша, і довша', () => {
    // `expires_at` лишається з єдиним писачем (ручний PATCH) і означає рівно
    // одне: «людина сказала». Це сильніше за будь-яку таблицю.
    const soon = new Date(NOW + 1 * 86_400_000).toISOString();
    const late = new Date(NOW + 900 * 86_400_000).toISOString();
    expect(effectiveExpiry(batch('х', { zone: 'fresh', expires_at: soon }), null, NOW)).toBe(soon);
    expect(effectiveExpiry(batch('х', { zone: 'fresh', expires_at: late }), null, NOW)).toBe(late);
  });

  it('прострочене не обнуляється — воно лишається простроченим', () => {
    // Партія, яка пролежала довше за свій строк, має показувати мінус, а не
    // «сьогодні»: інакше зріз «скоро зіпсується» ховав би найгірші позиції.
    const old = new Date(NOW - 30 * 86_400_000).toISOString();
    const exp = effectiveExpiry(batch('салат', { zone: 'fresh', added_at: old }), null, NOW);
    expect(daysLeft(exp, NOW)).toBe(-23);
  });
});

describe('каталог поверх зони, зона — арбітр (Б2, Р1/Р3)', () => {
  it('цибуля в тій самій зоні, що салат, живе місяцями — каталог знає, зона ні', () => {
    // Виміряна діра таблиці зон: у проді зона `fresh` тримає і багети (два
    // дні), і шість цибуль із часниками (місяці). Плоскі сім днів помиляються
    // тут у пʼятдесят разів в обидва боки.
    const onion = batch('цибуля', { zone: 'fresh', catalog_key: 'onion_yellow' });
    expect(daysLeft(effectiveExpiry(onion, 'onion_yellow', NOW), NOW)).toBe(115);

    const bread = batch('багет', { zone: 'dry', catalog_key: 'bread_baguette' });
    expect(daysLeft(effectiveExpiry(bread, 'bread_baguette', NOW), NOW)).toBe(-2);
  });

  it('сіль не псується — строку немає взагалі, і це рішення, а не незнання', () => {
    // Р3: після Б2 порожній строк означає рівно «не псується». Позиція не
    // потрапляє у зріз «скоро зіпсується» ніколи — `filter.ts` вимагає days != null.
    const salt = batch('сіль', { zone: 'spices', catalog_key: 'spice_salt_table' });
    expect(effectiveExpiry(salt, 'spice_salt_table', NOW)).toBeNull();
  });

  it('зона бʼє каталог, коли вони не згодні — саме тут гасяться помилки резолвера', () => {
    // `свіжі помідори → Помідори пелаті` (консерва, dry) — чотири партії в
    // проді. Каталог сказав би «не псується»; зона `fresh` каже сім днів, і
    // права вона. Те саме з `лосось морожений → лосось охолоджений`.
    const tomato = batch('помідори', { zone: 'fresh', catalog_key: 'pomodori_pelati' });
    expect(daysLeft(effectiveExpiry(tomato, 'pomodori_pelati', NOW), NOW)).toBe(2);
  });
});

describe('daysLeft', () => {
  it('днів до expires_at, null без терміну', () => {
    expect(daysLeft(new Date(NOW + 3 * 86_400_000).toISOString(), NOW)).toBe(3);
    expect(daysLeft(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe(-1);
    expect(daysLeft(null, NOW)).toBeNull();
  });
});

describe('no збігається з ⚠ у промпті на одному семплі', () => {
  const index = [...buildVetoIndex('u1', 'no', 'мʼяса'), ...buildVetoIndex('u1', 'ban', 'арахіс')];
  const bs = [batch('Стейк рібай'), batch('Арахісова паста'), batch('Картопля'), batch('Куряче філе', { catalog_key: 'chicken_fillet' })];
  it('кожен рядок: не можна ↔ ⚠АЛЕРГЕН, не їм ↔ ⚠НЕ ЇСТЬ, null ↔ без мітки', () => {
    const prompt = serializePantry(bs, NOW, false, 'none', 120, [], '', index);
    for (const b of bs) {
      const line = prompt.split('\n').find((l) => l.startsWith(b.label))!;
      const no = vetoMarkOf(pantryVetoRows(b, b.catalog_key, index));
      expect(line.includes('⚠АЛЕРГЕН'), `${b.label}: ${line}`).toBe(no === 'не можна');
      expect(line.includes('⚠НЕ ЇСТЬ'), `${b.label}: ${line}`).toBe(no === 'не їм');
    }
    expect(vetoMarkOf(pantryVetoRows(bs[0]!, null, index))).toBe('не їм');
    expect(vetoMarkOf(pantryVetoRows(bs[1]!, null, index))).toBe('не можна');
    expect(vetoMarkOf(pantryVetoRows(bs[2]!, null, index))).toBeNull();
    expect(vetoMarkOf(pantryVetoRows(bs[3]!, 'chicken_fillet', index))).toBe('не їм');
  });
});

describe('pantryItemView', () => {
  it('усі поля з каталогу, терміну, чека й індексу', () => {
    const b = batch('Куряче філе', { catalog_key: 'chicken_fillet', expires_at: new Date(NOW + 2 * 86_400_000).toISOString() });
    const v = pantryItemView(b, undefined, buildVetoIndex('u1', 'no', 'мʼяса'), new Set([b.id]), NOW);
    expect(v).toEqual({ cat: 'мʼясо', kcal: 114, fat: 2.62, prot: 22.5, carb: 0, est: false, days: 2, receipt: true, no: 'не їм', added: 5, unit_weight: 180 });
  });
  it('невідомий продукт — БЖВ null, але строк тепер є: він від зони, не від каталогу', () => {
    // Б1 змінив саме це. Раніше `days: null` означало «мовчазно свіже» — і так
    // виглядали 245 із 246 позицій. Тепер позиція без каталогу все одно має
    // строк: fridge живе 21 день, пʼять минуло.
    const v = pantryItemView(batch('Щось xyz'), undefined, [], new Set(), NOW);
    expect(v).toEqual({ cat: null, kcal: null, fat: null, prot: null, carb: null, est: null, days: 16, receipt: false, no: null, added: 5, unit_weight: null });
  });
});
