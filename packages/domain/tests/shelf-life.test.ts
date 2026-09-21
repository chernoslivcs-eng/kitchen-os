// Строки v2 (21.09, spec 2026-09-21-shelf-life-v2-design.md): одна таблиця
// категорія × {запечатане, відкрите} × {полиця, холодильник, морозилка}.
// Файл стереже: покриття каталогу (жодних дефолтів зон більше нема — непокрита
// позиція лишається БЕЗ числа), порядок правил (вужче вище), порожня клітинка =
// «зона не для цього», арбітр лише проти хибного ключа, ключові числа таблиці.
import { describe, it, expect } from 'vitest';
import { CATALOG } from '@kitchen/catalog/seed';
import { shelfRuleFor, shelfSealedDays, shelfOpenDays, uncoveredCategories, SHELF_RULES, shelfGroupOf } from '../shelf-life.js';

// Стеля непокритих позицій. Число можна тільки ЗМЕНШУВАТИ: без правила позиція
// тепер не має числа взагалі, і кожна така — мовчазна дірка.
const UNCOVERED_MAX = 1;
const UNCOVERED_TOP: [string, number][] = [
  ['рисовий папір', 1],       // не хліб і не папір — обгортка для ролів, окремого рядка нема
];

describe('покриття каталогу правилами строків', () => {
  it('покриття не просідає: непокритих не більше за стелю', () => {
    const total = uncoveredCategories(CATALOG).reduce((n, [, c]) => n + c, 0);
    expect(total, 'непокритих позицій').toBeLessThanOrEqual(UNCOVERED_MAX);
  });
  it('список непокритого в файлі збігається з дійсністю', () => {
    expect(uncoveredCategories(CATALOG)).toEqual(UNCOVERED_TOP);
  });
  it('жодне правило не мертве (крім родинних) — кожне ловить хоч одну позицію каталогу', () => {
    const dead = SHELF_RULES.filter((r) => !r.family && !CATALOG.some((i) => shelfRuleFor(i.categories, i.name) === r)).map((r) => r.when[0]);
    expect(dead).toEqual([]);
  });
  it('у кожного правила є хоч одна клітинка або явне «не псується»', () => {
    for (const r of SHELF_RULES) {
      const cells = (m: typeof r.sealed) => (m === null ? 1 : Object.keys(m).length);
      expect(cells(r.sealed) + cells(r.opened), r.when[0]).toBeGreaterThan(0);
    }
  });
});

describe('порядок правил — вужче вище', () => {
  const rule = (key: string) => { const i = CATALOG.find((x) => x.key === key)!; return shelfRuleFor(i.categories, i.name)?.when[0]; };
  it('батон — хліб, не крупа (несе «борошняне» й «зернові»)', () => { expect(rule('bread_baton')).toBe('хліб'); });
  it('хлібці — суха бакалія, не хліб; печиво — печиво, не випічка', () => { expect(rule('bread_crispbread_rye')).toBe('хлібці'); expect(rule('bake_oat_cookies')).toBe('печиво'); });
  it('масло вершкове — молочне, не олія (несе «жири»)', () => { expect(rule('butter_82')).toBe('масло вершкове'); });
  it('гірчиця — банка, не вічна спеція (перше слово назви)', () => { expect(rule('mustard')).toBe('гірчиця'); });
  it('пиво — напій, не крупа (несе «ячмінь»); кава — кава, не напій', () => { expect(rule('alc_beer_lager_pale')).toBe('пиво'); expect(rule('coffee_ground_turkish')).toBe('кава зернова'); });
  it('томатна паста — свій рядок, не паста і не консерви', () => { expect(rule('tomato_paste')).toBe('томатна паста'); });
  it('панірувальні сухарі — свій рядок 365/120 (слово не перше в назві); крем-суп сухий — сухі суміші, не «готове»', () => {
    expect(rule('breadcrumbs')).toBe('панірувальні'); expect(shelfOpenDays('breadcrumbs', 'dry')).toBe(120);
    expect(rule('pea_mushroom_soup_mix')).toBe('желе'); expect(shelfSealedDays('pea_mushroom_soup_mix', 'dry')).toBe(540);
  });
  it('пармезан — твердий сир; кефір — кисломолочне; морожений лосось — заморожене, не риба', () => {
    expect(rule('parmesan')).toBe('твердий сир'); expect(rule('dairy_kefir_1')).toBe('кисломолочне'); expect(rule('salmon_portioned_frozen')).toBe('заморожене');
  });
});

describe('клітинки таблиці: групи зон, порожнє = зона не для цього', () => {
  it('полиця = fresh + dry + spices + drinks; холодильник і морозилка окремо', () => {
    expect(['fresh', 'dry', 'spices', 'drinks'].map((z) => shelfGroupOf(z as never))).toEqual(['shelf', 'shelf', 'shelf', 'shelf']);
    expect(shelfGroupOf('fridge')).toBe('fridge'); expect(shelfGroupOf('freezer')).toBe('freezer');
  });
  it('молоко пастеризоване: холодильник 10 запечатане / 3 відкрите; на полиці й у морозилці — числа нема', () => {
    expect(shelfSealedDays('milk_cow_25', 'fridge')).toBe(10);
    expect(shelfOpenDays('milk_cow_25', 'fridge')).toBe(3);
    expect(shelfSealedDays('milk_cow_25', 'dry')).toBeUndefined();
    expect(shelfSealedDays('milk_cow_25', 'freezer')).toBeUndefined();
  });
  it('консерви: запечатані 730 на полиці; відкриті — 3 дні лише в холодильнику; відкрита на полиці — числа нема', () => {
    expect(shelfSealedDays('tuna_canned', 'dry')).toBe(730);
    expect(shelfOpenDays('tuna_canned', 'fridge')).toBe(3);
    expect(shelfOpenDays('tuna_canned', 'dry')).toBeNull();
  });
  it('олія: 540 запечатана / 90 відкрита — колишній «363» від дефолту зони зник', () => {
    expect(shelfSealedDays('sunflower_oil', 'spices')).toBe(540);
    expect(shelfOpenDays('sunflower_oil', 'spices')).toBe(90);
  });
  it('поправки власника: картопля 60 на кухні, твердий сир 45/10, цитрусові 14, хлібці відкриті 60', () => {
    expect(shelfSealedDays('potato', 'fresh')).toBe(60);
    expect(shelfSealedDays('parmesan', 'fridge')).toBe(45); expect(shelfOpenDays('parmesan', 'fridge')).toBe(10);
    expect(shelfOpenDays('bread_crispbread_rye', 'dry')).toBe(60);
  });
  it('не псується: сіль — null і запечатана, і відкрита; вино — запечатане ∞, відкрите 14 (не підтверджено власником)', () => {
    expect(shelfSealedDays('spice_salt_table', 'spices')).toBeNull(); expect(shelfOpenDays('spice_salt_table', 'spices')).toBeNull();
    expect(shelfSealedDays('alc_wine_white_dry', 'drinks')).toBeNull(); expect(shelfOpenDays('alc_wine_white_dry', 'fridge')).toBe(14);
    expect(shelfOpenDays('alc_wine_white_dry', 'drinks')).toBeNull();   // відкрите — у холодильник
  });
  it('яйця: відкритого стану нема — opened порожній', () => {
    expect(shelfSealedDays('eggs_chicken', 'fridge')).toBe(28);
    expect(shelfOpenDays('eggs_chicken', 'fridge')).toBeNull();
  });
});

describe('арбітр — лише проти хибного ключа', () => {
  it('свіжі помідори, зрезолвлені в пелаті (консерви, dry), у fresh числа не дістають; сама консерва в dry — 730, у холодильнику — теж', () => {
    expect(shelfSealedDays('pomodori_pelati', 'dry')).toBe(730);
    expect(shelfSealedDays('pomodori_pelati', 'fresh')).toBeUndefined();
    expect(shelfSealedDays('pomodori_pelati', 'fridge')).toBeUndefined();   // клітинки fridge для консервів нема
  });
  it('зберігальна зона ключ не спростовує: гірчиця (spices) у холодильнику — 365, оливки в холодильнику — 540', () => {
    expect(shelfSealedDays('mustard', 'fridge')).toBe(365);
    expect(shelfSealedDays('olives_green', 'fridge')).toBe(540);
  });
  it('цибуля (fresh) у сухій шафі — та сама полиця, число є', () => {
    expect(shelfSealedDays('onion_yellow', 'dry')).toBe(45);
  });
  it('невідомий ключ і порожній ключ — мовчання, а не здогад', () => {
    expect(shelfSealedDays('nope', 'fridge')).toBeUndefined();
    expect(shelfSealedDays(null, 'fridge')).toBeUndefined();
    expect(shelfOpenDays(null, 'fridge')).toBeNull();
  });
});
