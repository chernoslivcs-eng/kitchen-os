// @vitest-environment jsdom
//
// Крок Т1: рядок метаданих картки рецепта — «5 КРОКІВ · 25ХВ · 2 ПОРЦІЇ».
// Перевірка саме на рендері, а не на самій formatDuration: одиничний тест
// функції не побачив би, що якесь із пʼяти місць лишилось із сирим `${tm}ХВ`.

import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RecipeCard } from './cards';
import type { ChatCard, Recipe } from '../../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const recipe = (tm: number): Recipe => ({
  t: 'Хліб на заквасці',
  st: [{ t: 'Замісити', c: 'Змішати все' }],
  ing: [{ n: 'борошно' }],
  sv: 2,
  tm,
} as unknown as Recipe);

async function meta(tm: number): Promise<string> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const card = { type: 'recipe', recipe: recipe(tm) } as unknown as ChatCard;
  await act(async () => { root!.render(<RecipeCard card={card} />); });
  return host.textContent ?? '';
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
});

describe('рядок метаданих картки рецепта', () => {
  it('коротке лишається у хвилинах', async () => {
    expect(await meta(25)).toContain('25ХВ');
  });

  it('три години — «3ГОД», а не «180ХВ»', async () => {
    const text = await meta(180);
    expect(text).toContain('3ГОД');
    expect(text).not.toContain('180ХВ');
  });

  it('тиждень ферментації читається, а не розшифровується', async () => {
    // Живий репро: тут стояло «10080ХВ».
    const text = await meta(10080);
    expect(text).toContain('168ГОД');
    expect(text).not.toContain('10080');
  });
});
