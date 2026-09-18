// @vitest-environment jsdom
//
// Р3 (spec 18.09): порції — один стан на recipe_id (store/recipePortions),
// спільний для картки рецепта в стрічці (RecipeStreamCard) і артефакта
// (RecipeLinkCard) — зміна в одному місці одразу видна в іншому; склад
// (кількості й «бракує») перераховується тим самим coversNeed, що в артефакті.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RecipeStreamCard, RecipeLinkCard, LivePositions, type LivePosition } from './cards';
import { useRecipePortionsStore } from '../../store/recipePortions';
import type { ChatCard, Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const RID = 'r-salt';
const recipe: Recipe = {
  t: 'Суп',
  st: [{ t: 'Закип\'ятити', c: 'Довести до кипіння' }],
  ing: [{ n: 'сіль', p: 'batch-salt', v: 5, u: 'g' }],
  sv: 2,
} as unknown as Recipe;
const card: ChatCard = { type: 'recipe_link', recipe_id: RID, recipe } as unknown as ChatCard;
const live = new Map<string, LivePosition>([['batch-salt', { label: 'сіль', value: 8, unit: 'g' }]]);

beforeEach(() => {
  useRecipePortionsStore.setState({ byRecipeId: {} });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  useRecipePortionsStore.setState({ byRecipeId: {} });
});

function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  return act(async () => { root!.render(el); });
}

function clickMore(scope: Element) {
  const btn = scope.querySelector('[data-portions] button[aria-label="Більше порцій"]') as HTMLButtonElement;
  return act(async () => { btn.click(); });
}

describe('Р3: порції спільні між карткою в стрічці й артефактом', () => {
  it('зміна в картці стрічки одразу відбивається в артефакті (той самий recipe_id)', async () => {
    await mount(
      <div>
        <div data-testid="stream"><RecipeStreamCard card={card} onOpen={() => {}} live={live} /></div>
        <div data-testid="artifact">
          <LivePositions.Provider value={live}><RecipeLinkCard card={card} /></LivePositions.Provider>
        </div>
      </div>,
    );
    const stream = host!.querySelector('[data-testid=stream]')!;
    const artifact = host!.querySelector('[data-testid=artifact]')!;
    expect(artifact.querySelector('[data-servings]')?.textContent).toContain('2');

    await clickMore(stream);

    expect(artifact.querySelector('[data-servings]')?.textContent).toContain('3');
  });

  it('зміна в артефакті одразу відбивається в картці стрічки', async () => {
    await mount(
      <div>
        <div data-testid="stream"><RecipeStreamCard card={card} onOpen={() => {}} live={live} /></div>
        <div data-testid="artifact">
          <LivePositions.Provider value={live}><RecipeLinkCard card={card} /></LivePositions.Provider>
        </div>
      </div>,
    );
    const stream = host!.querySelector('[data-testid=stream]')!;
    const artifact = host!.querySelector('[data-testid=artifact]')!;

    await clickMore(artifact);

    const streamPortions = stream.querySelector('[data-portions]');
    expect(streamPortions?.textContent).toContain('3');
  });

  it('перерахунок чіпів: кількість росте з порціями, «бракує» зʼявляється, коли scaled-потреба перевищує наявне', async () => {
    await mount(<RecipeStreamCard card={card} onOpen={() => {}} live={live} />);
    const stream = host!.querySelector('[data-recipe-stream]')!;
    // sv=2 → треба 5г солі, є 8г — вистачає.
    expect(stream.textContent).toContain('5 г');
    expect(stream.querySelector('[data-icon="cook.missing"]')).toBeNull();

    // 2 → 3 → 4: 5г × 2 = 10г > 8г наявних — тепер бракує.
    await clickMore(stream);
    await clickMore(stream);

    expect(stream.textContent).toContain('10 г');
    expect(stream.querySelector('[data-icon="cook.missing"]')).not.toBeNull();
  });
});
