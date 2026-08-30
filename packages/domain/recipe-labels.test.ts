import { describe, it, expect } from 'vitest';
import { resolveRecipeLabels } from './recipe-labels.js';
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

function recipe(ing: Recipe['ing']): Recipe {
  return {
    t: 'Тост', sv: 1, tm: 5, ch: '5 хв', d: 'опис', rk: 'примітка',
    ing,
    st: [{ t: 'Крок', c: 'Зробити з {0}' }],
  };
}

// QA9-01: рендер брав назву партії з ЖИВОЇ комори. Партія списана або
// перейменована → у стрічці «з комори», у кроках «Інгредієнт». Назва має
// вморожуватись у payload у момент генерації — рецепт незмінний документ.
describe('resolveRecipeLabels', () => {
  it('вписує n з label партії для ing з p', () => {
    const r = resolveRecipeLabels(
      recipe([{ p: 'b1', v: 60, u: 'g' }, { n: 'арахісова паста', v: 40, u: 'g' }]),
      [batch('b1', 'Багет')],
    );
    expect(r.ing[0]).toMatchObject({ p: 'b1', n: 'Багет', v: 60, u: 'g' });
    // n-інгредієнт не чіпаємо
    expect(r.ing[1]).toMatchObject({ n: 'арахісова паста' });
  });

  it('не перезаписує вже наявний n', () => {
    const r = resolveRecipeLabels(
      recipe([{ p: 'b1', n: 'Французький багет' }]),
      [batch('b1', 'Багет')],
    );
    expect(r.ing[0]!.n).toBe('Французький багет');
  });

  it('p без відповідної партії — лишає як є, без n', () => {
    const r = resolveRecipeLabels(recipe([{ p: 'привид' }]), [batch('b1', 'Багет')]);
    expect(r.ing[0]).toEqual({ p: 'привид' });
  });

  it('не мутує вхідний рецепт', () => {
    const src = recipe([{ p: 'b1' }]);
    resolveRecipeLabels(src, [batch('b1', 'Багет')]);
    expect(src.ing[0]!.n).toBeUndefined();
  });
});
