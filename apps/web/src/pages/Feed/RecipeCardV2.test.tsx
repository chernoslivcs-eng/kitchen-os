// @vitest-environment jsdom
//
// Картка рецепта v2 (spec 2026-09-18-recipe-card-design, «Рішення після
// макета»): превʼю без «+» (усі розкриті однаково), картка в стрічці без
// cook.go/зеленого кола, низ дій «Готуємо»/«У список·N» у трьох станах,
// кошик cook.missing amber у складі картки й артефакту.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProposalCard, RecipeStreamCard, RecipeLinkCard, type LivePosition } from './cards';
import { useRecipePortionsStore } from '../../store/recipePortions';
import type { ChatCard, Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => { useRecipePortionsStore.setState({ byRecipeId: {} }); });
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

describe('Р2: превʼю в пропозиції — усі розкриті, «+» геть', () => {
  it('немає кнопки «+»/aria-label «Розгорнути»; кожен пункт показує опис одразу', async () => {
    const card = {
      type: 'proposal',
      items: [
        { title: 'Борщ', desc: 'З мамою цибулею', character: 'ситний' },
        { title: 'Салат', desc: 'Швидкий', character: 'легкий' },
        { title: 'Паста', desc: 'На вечерю', character: 'швидко' },
      ],
    } as unknown as ChatCard;
    await mount(<ProposalCard card={card} onOpen={() => {}} />);
    expect(host!.querySelector('[aria-label="Розгорнути"]')).toBeNull();
    expect(host!.querySelectorAll('[data-proposal="closed"]')).toHaveLength(0);
    expect(host!.querySelectorAll('[data-proposal="open"]')).toHaveLength(3);
    // усі три описи видно одночасно (не лише перший розкритий)
    expect(host!.textContent).toContain('З мамою цибулею');
    expect(host!.textContent).toContain('Швидкий');
    expect(host!.textContent).toContain('На вечерю');
  });

  it('«Відкрити» — chevron (sys.next), не cook.go/каструля', async () => {
    const card = { type: 'proposal', items: [{ title: 'Борщ' }] } as unknown as ChatCard;
    await mount(<ProposalCard card={card} onOpen={() => {}} />);
    const openBtn = host!.querySelector('[data-proposal-open]')!;
    expect(openBtn.querySelector('[data-icon="sys.next"]')).not.toBeNull();
    expect(openBtn.querySelector('[data-icon="cook.go"]')).toBeNull();
  });
});

const RID = 'r-stream';
// Без `p` (не привʼязано до партії) — isMissing() завжди «бракує», без
// залежності від live-мапи (та нюансована перевірка coversNeed уже вкрита
// RecipeCardPortions.test.tsx).
const missingRecipe: Recipe = {
  t: 'Суп',
  st: [{ t: "Закип'ятити", c: 'Довести до кипіння' }],
  ing: [{ n: 'сіль', v: 5, u: 'g' }],
  sv: 2,
} as unknown as Recipe;
const missingCard: ChatCard = { type: 'recipe_link', recipe_id: RID, recipe: missingRecipe } as unknown as ChatCard;

const haveRecipe: Recipe = {
  t: 'Суп',
  st: [{ t: "Закип'ятити", c: 'Довести до кипіння' }],
  ing: [{ n: 'сіль', p: 'batch-salt', v: 5, u: 'g' }],
  sv: 2,
} as unknown as Recipe;
const haveCard: ChatCard = { type: 'recipe_link', recipe_id: 'r-have', recipe: haveRecipe } as unknown as ChatCard;
const haveLive = new Map<string, LivePosition>([['batch-salt', { label: 'сіль', value: 100, unit: 'g' }]]);

describe('Р2/Р4: картка рецепта в стрічці — без cook.go, низ дій у три стани', () => {
  it('жодної кнопки cook.go/зеленого кола — картка вже відкрита', async () => {
    await mount(<RecipeStreamCard card={missingCard} onOpen={() => {}} />);
    expect(host!.querySelector('[data-icon="cook.go"]')).toBeNull();
    expect(host!.querySelector('[data-recipe-open]')).not.toBeNull();
  });

  it('«Готуємо» — текст без іконки', async () => {
    await mount(<RecipeStreamCard card={missingCard} onCook={() => {}} />);
    const goBtn = host!.querySelector('[data-cook-go]')!;
    expect(goBtn.textContent?.trim()).toBe('Готуємо');
    expect(goBtn.querySelector('[data-icon]')).toBeNull();
  });

  it('є що докупити → «Готуємо» + «У список · N» поруч', async () => {
    await mount(<RecipeStreamCard card={missingCard} onCook={() => {}} onNeedToList={() => {}} />);
    expect(host!.querySelector('[data-cook-go]')).not.toBeNull();
    const toList = host!.querySelector('[data-recipe-tolist]') as HTMLButtonElement;
    expect(toList).not.toBeNull();
    expect(toList.disabled).toBe(false);
    expect(toList.textContent).toContain('У список · 1');
  });

  it('нічого докупляти (усе вдома) → лише «Готуємо», без «У список»', async () => {
    await mount(<RecipeStreamCard card={haveCard} onCook={() => {}} onNeedToList={() => {}} live={haveLive} />);
    expect(host!.querySelector('[data-cook-go]')).not.toBeNull();
    expect(host!.querySelector('[data-recipe-tolist]')).toBeNull();
  });

  it('«Уже в списку» — клік по «У список · N» переводить кнопку в неактивний стан', async () => {
    const added: string[] = [];
    await mount(<RecipeStreamCard card={missingCard} onCook={() => {}} onNeedToList={(label) => added.push(label)} />);
    const toList = host!.querySelector('[data-recipe-tolist]') as HTMLButtonElement;
    await act(async () => { toList.click(); });
    expect(added).toEqual(['сіль']);
    const toListAfter = host!.querySelector('[data-recipe-tolist]') as HTMLButtonElement;
    expect(toListAfter.disabled).toBe(true);
    expect(toListAfter.textContent).toBe('Уже в списку');
  });

  it('Р5: кошик cook.missing amber у чіпі складу — лише на «докупити»', async () => {
    await mount(<RecipeStreamCard card={missingCard} />);
    expect(host!.querySelector('[data-icon="cook.missing"]')).not.toBeNull();
  });
});

describe('Р5: кошик cook.missing amber у рядках складу артефакту', () => {
  it('«докупити» — cook.missing перед назвою, не крапка', async () => {
    await mount(<RecipeLinkCard card={missingCard} />);
    const row = host!.querySelector('[data-missing]')!;
    expect(row.querySelector('[data-icon="cook.missing"]')).not.toBeNull();
  });
});
