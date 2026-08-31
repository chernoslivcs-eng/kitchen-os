import { describe, it, expect } from 'vitest';
import { buildAliasMap, aliasRecipeIds, unaliasRecipeIds , unaliasProse } from './pantry-alias.js';
import { serializePantry } from './context.js';
import type { PantryBatch, Recipe } from './types.js';

function batch(id: string, label: string, over: Partial<PantryBatch> = {}): PantryBatch {
  return {
    id, household_id: 'h1', catalog_key: null,
    label, zone: 'dry', value: 100, unit: 'g',
    state: 'sealed', opened_at: null, expires_at: null,
    best_before_opened_days: null, added_at: new Date().toISOString(),
    depleted_at: null, confidence: 1, provenance: 'user_statement',
    staple: false, last_by: null, last_action: null,
    ...over,
  };
}

const UUID_A = '3f8a1c2e-9d4b-4f7a-b2e1-8c5d6a9f0e3b';
const UUID_B = '7b2d9e4f-1a6c-4d8e-9f3b-2e7c8d5a1b4f';

// UX9-03: модель отримувала ГОЛІ UUID і переписувала їх у рецепт — на
// копіюванні 36 символів плутала спагеті з фуетом, а вморожування впевнено
// підписувало помилку. Тепер модель бачить p1..pN; переклад — детермінований.
describe('pantry alias', () => {
  it('buildAliasMap: стабільні p1..pN в порядку списку', () => {
    const m = buildAliasMap([batch(UUID_A, 'Спагеті'), batch(UUID_B, 'Фует')]);
    expect(m.toAlias.get(UUID_A)).toBe('p1');
    expect(m.toAlias.get(UUID_B)).toBe('p2');
    expect(m.toId.get('p1')).toBe(UUID_A);
    expect(m.toId.get('p2')).toBe(UUID_B);
  });

  it('serializePantry з мапою — аліас замість uuid; ids:"none" — без id взагалі', () => {
    const bs = [batch(UUID_A, 'Спагеті')];
    const m = buildAliasMap(bs);
    const aliased = serializePantry(bs, null, Date.now(), [], false, m.toAlias);
    expect(aliased).toContain('p1 · Спагеті');
    expect(aliased).not.toContain(UUID_A);

    const bare = serializePantry(bs, null, Date.now(), [], false, 'none');
    expect(bare).toContain('Спагеті');
    expect(bare).not.toContain(UUID_A);
    expect(bare).not.toContain('p1');
  });

  it('unaliasRecipeIds: p-аліаси → uuid; невідомий аліас — дроп p, n лишається', () => {
    const m = buildAliasMap([batch(UUID_A, 'Спагеті')]);
    const r: Recipe = {
      t: 'Паста', sv: 1, tm: 10, ch: '', d: '', rk: '',
      ing: [
        { p: 'p1', v: 200, u: 'g' },
        { p: 'p9', n: 'привид', v: 1, u: 'pcs' },   // моделі привиділось
        { n: 'сіль' },
      ],
      st: [{ t: 'Крок', c: '{0}' }],
    };
    const out = unaliasRecipeIds(r, m.toId);
    expect(out.ing[0]).toMatchObject({ p: UUID_A, v: 200 });
    expect(out.ing[1]!.p).toBeUndefined();
    expect(out.ing[1]!.n).toBe('привид');
    expect(out.ing[2]).toEqual({ n: 'сіль' });
    // вхід не мутується
    expect(r.ing[0]!.p).toBe('p1');
  });

  it('aliasRecipeIds: uuid → аліас (для базового рецепта в edit-контексті); невідомий uuid — дроп p', () => {
    const m = buildAliasMap([batch(UUID_A, 'Спагеті')]);
    const r: Recipe = {
      t: 'Паста', sv: 1, tm: 10, ch: '', d: '', rk: '',
      ing: [{ p: UUID_A, n: 'Спагеті', v: 200, u: 'g' }, { p: 'deleted-uuid', n: 'Багет' }],
      st: [],
    };
    const out = aliasRecipeIds(r, m.toAlias);
    expect(out.ing[0]).toMatchObject({ p: 'p1', n: 'Спагеті' });
    expect(out.ing[1]!.p).toBeUndefined();
    expect(out.ing[1]!.n).toBe('Багет');
  });
});

// B1 (OPTIMIZATION_PLAN): хард-кеп серіалізації комори. Позначені партії —
// поза кепом (важіль якості: модель бачить і може попередити), хвостовий
// рядок несе ТІЛЬКИ число (інакше B1 дрейфує до ризик-профілю агрегатів).
describe('serializePantry: хард-кеп', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      batch(`id-${i}`, `Продукт ${i}`, { added_at: new Date(2026, 0, 1 + i).toISOString() }));

  it('до кепу — без змін і без хвостового рядка', () => {
    const s = serializePantry(many(10), null, Date.now(), [], false, 'none');
    expect(s.split('\n')).toHaveLength(10);
    expect(s).not.toContain('і ще');
  });

  it('понад кеп — рівно cap рядків + хвіст лише з числом', () => {
    const s = serializePantry(many(80), null, Date.now(), [], false, 'none', 60);
    const lines = s.split('\n');
    expect(lines).toHaveLength(61);                      // 60 рядків + хвіст
    expect(lines[60]).toBe('…і ще 20 позицій — спитай, якщо треба');
    // хвіст без зон/вмісту — тільки число
    expect(lines[60]).not.toMatch(/dry|fridge|Продукт/);
  });

  it('відбір: свіжі виживають, квота тримає найстаріших, ріжеться середина', () => {
    // Пул-3: 10 найстаріших активних захищені квотою (мости «що купити?»
    // будуються від залежаного) — тому відрізається середньо-старе.
    const s = serializePantry(many(80), null, Date.now(), [], false, 'none', 60);
    expect(s).toContain('Продукт 79');       // найновіший
    expect(s).toContain('Продукт 0 ·');      // найстаріший — у квоті залежаних
    expect(s).not.toContain('Продукт 15 ·'); // середина — відрізана
  });

  it('позначена алергеном партія виживає навіть у найстарішій позиції', () => {
    const bs = many(80);
    bs[0] = batch('id-0', 'Арахісова паста', { added_at: new Date(2026, 0, 1).toISOString() });
    const profile = { user_id: 'u1', allergies: ['арахіс'], wishes: [], antipatterns: [], equipment: {} };
    const s = serializePantry(bs, profile, Date.now(), [], false, 'none', 60);
    expect(s).toContain('Арахісова паста');
    expect(s).toContain('⚠АЛЕРГЕН');
  });

  it('термінова (відкрита) партія виживає попри вік', () => {
    const bs = many(80);
    bs[1] = batch('id-1', 'Відкриті вершки', { added_at: new Date(2026, 0, 2).toISOString(), state: 'opened' });
    const s = serializePantry(bs, null, Date.now(), [], false, 'none', 60);
    expect(s).toContain('Відкриті вершки');
  });
});

// Пул-4 №4в: аліас p21 протікав у ПРОЗОВУ відповідь recipe_gen («краще
// взяти перлову крупу (р21)») — для JSON unalias був, для тексту ні.
// Модель пише і латиницею, і кирилицею («р21»).
describe('unaliasProse', () => {
  const labels = new Map([['p21', 'крупа ячмінна перлова Сквирянка'], ['p3', 'вершки 20%']]);
  it('замінює латинські й кириличні аліаси на назви партій', () => {
    expect(unaliasProse('краще взяти перлову крупу (р21), або пасту', labels))
      .toBe('краще взяти перлову крупу (крупа ячмінна перлова Сквирянка), або пасту');
    expect(unaliasProse('додай p3 у соус', labels)).toBe('додай вершки 20% у соус');
  });
  it('невідомий номер і випадкові збіги не чіпаються', () => {
    expect(unaliasProse('візьми p99', labels)).toBe('візьми p99');
    expect(unaliasProse('слово парк21 не аліас', labels)).toBe('слово парк21 не аліас');
  });
});
