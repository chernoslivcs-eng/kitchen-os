// E (20.09): «Відкрити у вебі» веде туди, де картка живе у вебі, а не завжди /app:
// рецепт → /recipe/<id>?cook=1 (одразу кукінг-мод), комора → /pantry, список → /list,
// подія/період → /calendar, варіанти й репліка без картки → /app.
import { describe, it, expect } from 'vitest';
import type { Card, Recipe } from '@kitchen/domain';
import { webNextFor, renderTurnMessages } from '../src/telegram.js';

const R: Recipe = { t: 'Паста', sv: 2, tm: 20, ch: '', d: '', rk: '', ing: [{ n: 'паста', v: 200, u: 'g' }], st: [{ t: 'Варити', c: '10 хв' }] } as Recipe;
const APP = 'https://kos.example';

describe('E · next по типах карток', () => {
  it('webNextFor', () => {
    expect(webNextFor({ type: 'recipe_link', recipe_id: 'r-1', title: 'Паста', recipe: R })).toBe('/recipe/r-1?cook=1');
    expect(webNextFor({ type: 'recipe_link', recipe_id: 'r-1', title: 'Паста' })).toBe('/recipe/r-1?cook=1');
    expect(webNextFor({ type: 'recipe', recipe: R })).toBe('/app');           // не збережений — нема адреси
    expect(webNextFor({ type: 'intake_diff', ops: [] })).toBe('/pantry');
    expect(webNextFor({ type: 'shopping', items: [] } as unknown as Card)).toBe('/list');
    expect(webNextFor({ type: 'event', ops: [] } as unknown as Card)).toBe('/calendar');
    expect(webNextFor({ type: 'period', title: 'Піст' } as unknown as Card)).toBe('/calendar');
    expect(webNextFor({ type: 'proposal', items: [] } as unknown as Card)).toBe('/app');
    expect(webNextFor(null)).toBe('/app');
  });

  it('renderTurnMessages кладе глибокий next у лінк', () => {
    const recipe = renderTurnMessages({ reply: null, card: { type: 'recipe_link', recipe_id: 'r-1', title: 'Паста', recipe: R } }, APP);
    expect(recipe.at(-1)).toContain(`Відкрити у вебі: ${APP}/recipe/r-1?cook=1`);
    const shop = renderTurnMessages({ reply: 'ок', card: { type: 'shopping', items: [{ op: 'add', label: 'сіль' }] } as unknown as Card }, APP);
    expect(shop.at(-1)).toContain(`Відкрити у вебі: ${APP}/list`);
  });

  it('рядок «Відкрити у вебі» — лише під карткою; репліка без картки і варіанти — без нього', () => {
    const plain = renderTurnMessages({ reply: 'Привіт, що готуємо?', card: null }, APP);
    expect(plain).toEqual(['Привіт, що готуємо?']);
    const proposal = renderTurnMessages({ reply: null, card: { type: 'proposal', items: [{ title: 'Паста' }] } as unknown as Card }, APP);
    expect(proposal.join('\n')).not.toContain('Відкрити у вебі');
    const pantry = renderTurnMessages({ reply: 'Записав.', card: { type: 'intake_diff', ops: [{ op: 'add', label: 'сіль' }] } as unknown as Card }, APP);
    expect(pantry.at(-1)).toContain(`Відкрити у вебі: ${APP}/pantry`);
    const parsed = renderTurnMessages({ reply: null, card: { type: 'recipe', recipe: R } }, APP);
    expect(parsed.at(-1)).toContain(`Відкрити у вебі: ${APP}/app`);
  });
});
