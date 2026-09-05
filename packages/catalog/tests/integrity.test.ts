import { describe, it, expect } from 'vitest';
import { CATALOG, BY_KEY, type CatalogItem } from '../seed.js';
import { normalize, resolveLabelToKey } from '../logic.js';

// Критерій 4 (додано при розширенні 131 → 2341):
// каталог такого розміру ламається не логікою, а власною неохайністю —
// дублікатами ключів, аліасами, що ведуть у дві позиції, і кривою схемою.

const ZONES = new Set(['dry', 'fridge', 'freezer', 'fresh', 'spices', 'drinks']);
const ORIGINAL_COUNT = 131;
const originals = CATALOG.slice(0, ORIGINAL_COUNT);
const added = CATALOG.slice(ORIGINAL_COUNT);

describe('integrity · ключі', () => {
  it('обсяг у межах умови готовності (4500-5500)', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(4500);
    expect(CATALOG.length).toBeLessThanOrEqual(5500);
  });

  it('немає дублікатів key', () => {
    const seen = new Map<string, number>();
    for (const i of CATALOG) seen.set(i.key, (seen.get(i.key) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupes).toEqual([]);
  });

  it('BY_KEY покриває весь каталог', () => {
    expect(BY_KEY.size).toBe(CATALOG.length);
  });

  it('key — snake_case латиницею', () => {
    const bad = CATALOG.filter((i) => !/^[a-z0-9_]+$/.test(i.key)).map((i) => i.key);
    expect(bad).toEqual([]);
  });
});

describe('integrity · аліаси', () => {
  // Колізії аліасів дозволені (див. seed.ts, поле priority), але кожна мусить
  // мати одного однозначного власника — інакше резолв недетермінований.
  it('кожен аліас, який ведуть кілька позицій, має рівно одного власника', () => {
    const byAlias = new Map<string, CatalogItem[]>();
    for (const item of CATALOG) {
      for (const a of item.aliases) {
        const n = normalize(a);
        if (!n) continue;
        if (!byAlias.has(n)) byAlias.set(n, []);
        byAlias.get(n)!.push(item);
      }
    }
    const ambiguous: string[] = [];
    for (const [alias, claimants] of byAlias) {
      if (claimants.length < 2) continue;
      const top = Math.max(...claimants.map((c) => c.priority ?? 0));
      const winners = claimants.filter((c) => (c.priority ?? 0) === top);
      // Або один переможець за priority, або переможець за порядком у масиві —
      // але порядок рахується легітимним лише коли перший із них стартовий.
      if (winners.length > 1 && CATALOG.indexOf(winners[0]!) >= ORIGINAL_COUNT) {
        ambiguous.push(`${alias}: ${claimants.map((c) => c.key).join(', ')}`);
      }
    }
    expect(ambiguous).toEqual([]);
  });

  it('жоден доданий аліас не збігається з аліасом або назвою стартових 131', () => {
    const reserved = new Set<string>();
    for (const o of originals) {
      reserved.add(normalize(o.name));
      for (const a of o.aliases) reserved.add(normalize(a));
    }
    const clashes = added.flatMap((i) =>
      i.aliases.filter((a) => reserved.has(normalize(a))).map((a) => `${i.key}: ${a}`),
    );
    expect(clashes).toEqual([]);
  });

  it('немає порожніх і надто коротких аліасів', () => {
    const bad = CATALOG.filter((i) => i.aliases.some((a) => normalize(a).length < 3)).map((i) => i.key);
    expect(bad).toEqual([]);
  });

  it('немає дублікатів аліасів усередині однієї позиції', () => {
    const bad = CATALOG.filter((i) => new Set(i.aliases.map(normalize)).size !== i.aliases.length).map((i) => i.key);
    expect(bad).toEqual([]);
  });
});

// Стартові 131 навмисно виведені з-під схемних перевірок нижче: вони писалися до
// того, як зʼявилась ця дисципліна (в кількох одна категорія, у кількох дробові
// значення nutrition), а завдання прямо забороняє їх редагувати. Тому строгі
// вимоги діють на 2210 доданих; на стартових перевіряється лише те, що вже
// виконується. Це свідомий борг, а не недогляд.
describe('integrity · схема доданих позицій', () => {
  it('zone_default завжди з дозволеного словника', () => {
    const bad = CATALOG.filter((i) => !ZONES.has(i.zone_default)).map((i) => i.key);
    expect(bad).toEqual([]);
  });

  it('у кожної доданої позиції щонайменше дві категорії', () => {
    const bad = added.filter((i) => i.categories.length < 2).map((i) => i.key);
    expect(bad).toEqual([]);
  });

  it('у кожної позиції категорії непорожні й без дублікатів', () => {
    const bad = CATALOG.filter((i) =>
      i.categories.length === 0 ||
      i.categories.some((c) => !normalize(c)) ||
      new Set(i.categories.map(normalize)).size !== i.categories.length,
    ).map((i) => i.key);
    expect(bad).toEqual([]);
  });

  // Раунд 5, крок Н1: БЖВ без ккал, з джерелом. Оцінки генератора — цілі;
  // звірені рядки (usda/ciqual) — як у дампі, з десятковими.
  const NUM_KEYS = ['protein', 'fat', 'carbs', 'fiber', 'sugars', 'sodium_mg', 'alcohol'] as const;
  it('nutrition — скінченні невідʼємні числа, без поля kcal', () => {
    const bad = CATALOG.filter((i) => i.nutrition && (
      'kcal' in i.nutrition
      || NUM_KEYS.some((k) => i.nutrition![k] !== undefined && (!Number.isFinite(i.nutrition![k]) || i.nutrition![k]! < 0))
    )).map((i) => i.key);
    expect(bad).toEqual([]);
  });

  it('nutrition.source — estimate | usda:<id> | ciqual:<code>; оцінки — цілі', () => {
    const badSource = CATALOG.filter((i) => i.nutrition && !/^(estimate|usda:\d+|ciqual:\d+)$/.test(i.nutrition.source)).map((i) => i.key);
    expect(badSource).toEqual([]);
    const badInt = added.filter((i) => i.nutrition?.source === 'estimate' && [i.nutrition.protein, i.nutrition.fat, i.nutrition.carbs].some((v) => !Number.isInteger(v))).map((i) => i.key);
    expect(badInt).toEqual([]);
  });

  // Н1а: клітковина не додається (вуглеводи USDA «by difference» її містять), 0,5 — округлення дампу.
  it('санітарна перевірка: білки+жири+вуглеводи+спирт ≤ 100,5, ккал 4-4-9-7 у межах 0–905', () => {
    const bad = CATALOG.filter((i) => {
      const n = i.nutrition; if (!n) return false;
      const kcal = n.protein * 4 + n.carbs * 4 + n.fat * 9 + (n.alcohol ?? 0) * 7;
      return n.protein + n.fat + n.carbs + (n.alcohol ?? 0) > 100.5 || kcal < 0 || kcal > 905;
    }).map((i) => `${i.key}: ${JSON.stringify(i.nutrition)}`);
    expect(bad).toEqual([]);
  });

  it('звірених позицій (usda/ciqual) — не менше 500', () => {
    expect(CATALOG.filter((i) => i.nutrition && i.nutrition.source !== 'estimate').length).toBeGreaterThanOrEqual(500);
  });

  it('allergen_groups — тільки зі словника груп', () => {
    // «лактоза» лишилась зі стартових 131 і не чіпається; для доданих словник вужчий.
    const VOCAB = new Set(['молочне', 'лактоза', 'глютен', 'горіхи', 'арахіс', 'кунжут', 'соя', 'яйця', 'риба', 'молюски', 'ракоподібні', 'морепродукти', 'селера', 'гірчиця', 'люпин', 'сульфіти']);
    const bad = CATALOG.flatMap((i) => i.allergen_groups.filter((g) => !VOCAB.has(g)).map((g) => `${i.key}: ${g}`));
    expect(bad).toEqual([]);
  });
});

describe('integrity · стартові 131 не постраждали', () => {
  it('перші 131 позиції лишились на місці й у тому ж порядку', () => {
    expect(originals.length).toBe(ORIGINAL_COUNT);
    expect(originals[0]!.key).toBe('mussel_meat');
    expect(originals[1]!.key).toBe('salami_milano_pork');
    expect(originals[2]!.key).toBe('cilantro_fresh');
  });

  it('кожна стартова позиція досі резолвиться за власною канонічною назвою', () => {
    const broken = originals.filter((o) => resolveLabelToKey(o.name) !== o.key).map((o) => `${o.key} -> ${resolveLabelToKey(o.name)}`);
    expect(broken).toEqual([]);
  });
});
