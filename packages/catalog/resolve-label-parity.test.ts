// Ш3, звіряльний прогін як тест.
//
// Передпідрахунок каталогу не мав змінити жодного збіга: ті самі значення,
// пораховані раніше. «Не мав» — не доказ, тому доказ тут: увесь каталог і всі
// аліаси проганяються через еталонну реалізацію (та, що була до правки,
// дослівно) і через нинішню, і результати звіряються один в один.
//
// Еталон лежить у файлі поруч навмисно, а не імпортується з історії git:
// тест має падати сам по собі, без доступу до репозиторію, і читатись як
// «ось два алгоритми, ось доказ, що вони однакові».
//
// Чому це важливіше за швидкість: правила матчингу — роки налагоджених
// винятків («Сільпо» містить «сіль», «кедрова» містить «дрова»). Тиха зміна
// одного збіга означає чужий алерген на продукті або з'їхалу зону зберігання,
// і побачити це можна тільки так.

import { describe, expect, it } from 'vitest';
import { CATALOG, type CatalogItem } from './seed.js';
import { resolveLabel, normalize, type MatchTier } from './logic.js';

const TIER_RANK: Record<MatchTier, number> = { words: 1, generic: 2, anchored: 3, exact: 4 };
const prio = (item: CatalogItem): number => item.priority ?? 0;
function wordsOf(s: string): string[] {
  return normalize(s).split(/[^\p{L}\p{N}%]+/u).filter(Boolean);
}
function headOf(ws: string[]): string | undefined {
  return ws.find((w) => /[а-яіїєґ]/.test(w)) ?? ws[0];
}

/**
 * Еталон: resolveLabel рівно таким, яким він був до кроку Ш3 — з normalize і
 * wordsOf усередині циклу. Дослівна копія; єдина зміна — ім'я.
 */
function resolveLabelReference(
  label: string,
  minTier: MatchTier = 'anchored',
  catalog: readonly CatalogItem[] = CATALOG,
): { key: string; tier: MatchTier } | null {
  const norm = normalize(label);
  const ws = wordsOf(label);
  const set = new Set(ws);
  const head = headOf(ws);
  let best: { key: string; tier: MatchTier; score: number; priority: number } | null = null;
  for (const item of catalog) {
    for (const cand of [item.name, ...item.aliases]) {
      const c = normalize(cand);
      if (!c) continue;
      let tier: MatchTier | null = null;
      let weight = 0;
      if (c === norm) { tier = 'exact'; weight = c.length; }
      else {
        const cw = wordsOf(cand);
        if (cw.length && cw.every((w) => set.has(w))) {
          const anchored = (head !== undefined && cw.includes(head))
            || cw.some((w) => /^[a-z0-9'’-]{4,}$/.test(w));
          tier = anchored ? 'anchored' : 'words';
          weight = cw.reduce((s, w) => s + w.length, 0);
        } else if (ws.length && ws.every((w) => new Set(cw).has(w))) {
          tier = 'generic';
          weight = 0;
        }
      }
      if (!tier || TIER_RANK[tier] < TIER_RANK[minTier]) continue;
      const score = TIER_RANK[tier] * 1000 + weight;
      if (!best || score > best.score || (score === best.score && prio(item) > best.priority)) {
        best = { key: item.key, tier, score, priority: prio(item) };
      }
    }
  }
  return best ? { key: best.key, tier: best.tier } : null;
}

// Повний корпус — 4985 назв і 21983 аліаси. Еталон коштує ~50 мс на виклик,
// тож увесь каталог × 4 тири тут не проженеш: це 280 секунд на CI. Вичерпний
// прогін (усі назви, усі аліаси, усі мітки з прод-бази, чотири тири — 108 616
// порівнянь) робиться окремо разовим скриптом, і його результат стоїть у
// звіті кроку. Тут лишається сторож на регресію: детермінований зріз плюс
// мітки, на яких колись ловились підміни.
//
// Зріз кожен n-й, а не випадковий: тест, що падає раз на десять запусків,
// гірший за відсутній.
const names = CATALOG.map((i) => i.name);
const aliases = CATALOG.flatMap((i) => i.aliases);
const every = <T>(arr: T[], n: number): T[] => arr.filter((_, i) => i % n === 0);

describe('передпідрахунок каталогу не змінив жодного збіга', () => {
  const tiers: MatchTier[] = ['exact', 'anchored', 'generic', 'words'];

  it.each(tiers)('назви позицій, тир %s', (tier) => {
    let diffs = 0;
    const examples: unknown[] = [];
    for (const label of every(names, 100)) {
      const a = resolveLabelReference(label, tier);
      const b = resolveLabel(label, tier);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs++;
        if (examples.length < 5) examples.push({ label, reference: a, actual: b });
      }
    }
    expect({ diffs, examples }).toEqual({ diffs: 0, examples: [] });
  });

  it.each(tiers)('аліаси, тир %s', (tier) => {
    let diffs = 0;
    const examples: unknown[] = [];
    for (const label of every(aliases, 800)) {
      const a = resolveLabelReference(label, tier);
      const b = resolveLabel(label, tier);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs++;
        if (examples.length < 5) examples.push({ label, reference: a, actual: b });
      }
    }
    expect({ diffs, examples }).toEqual({ diffs: 0, examples: [] });
  });

  // Мітки, на яких колись ловились підміни, — і, головне, мітки, ЧУТЛИВІ до
  // помилки в передпідрахунку. Другий список не вигаданий: кожне поле
  // PreparedCand по черзі псувалось у копії реалізації, і весь корпус (27 139
  // міток × 4 тири) прогонявся проти цілої — так знайшлись ті самі мітки, на
  // яких помилка взагалі проявляється. Їх мало:
  //   latinBrand    — 8 міток на 27 139 (усі з латинським брендом);
  //   тир words/generic — 7 міток.
  // Зріз «кожен n-й» жодну з них не ловив: перша мутація проходила зелено.
  // Тому вони стоять поіменно — інакше тест лише вдавав би сторожа.
  const tricky = [
    'Сільпо', 'олія кедрова', 'портерхаус', 'гель для душу', 'картопляні чіпси',
    'MC ПАРМІДЖАНО РЕДЖАНО', 'KASEREI СИР КАМБОЦОЛА 70%', 'Кр135БрусPontЧорОлив',
    'сир', 'масло', 'ковбаски', 'сметана', 'риба', 'стейк', 'олія ЧАСНИК',
    'вершки Галичина 33%', 'фарфалле Barilla №65', 'морський коктейль', '', '   ',
    // Латинський бренд вирішує тир anchored.
    'Напій Schweppes Original Bitter Lemon сил/газ скло',
    'Напій Schweppes Pink Tonic б/алк сил/газ скло',
    'вино біле б/а Hans Greyl совіньйон блан',
    'напій Schweppes Orange Bitter Lemon',
    'напій Schweppes Pink Tonic',
    'пиво Kronenbourg Blanc',
    'тонік Double Dutch Double Lemon',
    'тонік Goldberg Bitter Lemon',
    // Межа words / generic.
    'насадки для зубної щітки Oral-B Precision Clean 2шт',
    'перець Еко золотий серпанок з лимоном',
    'томат черрі Гордій',
    'фіточай Yogi Tea Bed Time',
    'шоколад Korona мигдаль-кокос',
    'шоколад Korona полуниця-чіа',
    'яловичина стейк Портер',
  ];
  it.each(tiers)('мітки з живими підмінами, тир %s', (tier) => {
    for (const label of tricky) {
      expect({ label, r: resolveLabel(label, tier) })
        .toEqual({ label, r: resolveLabelReference(label, tier) });
    }
  });
});

describe('кеш передпідрахунку не псує стан', () => {
  it('другий виклик дає той самий результат, що перший', () => {
    for (const label of ['сир твердий', 'молоко', 'олія кедрова', 'Сільпо']) {
      const first = resolveLabel(label, 'generic');
      const second = resolveLabel(label, 'generic');
      const third = resolveLabel(label, 'generic');
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    }
  });

  it('свій каталог не перетирає загальний і навпаки', () => {
    // resolveLabel приймає catalog параметром, і кеш ключується САМИМ
    // об'єктом каталогу. Якби ключ був глобальний, перший виклик із тестовим
    // набором отруїв би прод-каталог на весь процес.
    const mini = [{ key: 'test_thing', name: 'вигадка', aliases: ['вигадка проста'], categories: [], priority: 99 }] as unknown as CatalogItem[];
    expect(resolveLabel('вигадка', 'exact', mini)).toEqual({ key: 'test_thing', tier: 'exact' });
    // Загальний каталог такого не знає — і не дізнався від попереднього виклику.
    expect(resolveLabel('вигадка', 'exact')).toBeNull();
    // А тестовий набір і далі не знає молока.
    expect(resolveLabel('молоко', 'exact', mini)).toBeNull();
    expect(resolveLabel('молоко', 'exact')).not.toBeNull();
  });
});
