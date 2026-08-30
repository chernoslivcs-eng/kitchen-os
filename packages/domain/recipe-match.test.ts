import { describe, it, expect } from 'vitest';
import { matchRecipe, suggestAlternatives } from './recipe-match.js';
import type { PantryBatch } from './types.js';

function batch(label: string, over: Partial<PantryBatch> = {}): PantryBatch {
  return {
    id: label, household_id: 'h1', catalog_key: null,
    label, zone: 'dry', value: 100, unit: 'g',
    state: 'sealed', opened_at: null, expires_at: null,
    best_before_opened_days: null, added_at: new Date().toISOString(),
    depleted_at: null, confidence: 1, provenance: 'user_statement',
    staple: false, last_by: null, last_action: null,
    ...over,
  };
}

describe('matchRecipe', () => {
  it('усе є → ready', () => {
    const m = matchRecipe(
      [{ n: 'спагеті' }, { n: 'пармезан' }],
      [batch('Спагеті №5'), batch('Пармезан')],
    );
    expect(m.status).toBe('ready');
    expect(m.missing).toHaveLength(0);
    expect(m.have).toBe(2);
    expect(m.total).toBe(2);
  });

  it('бракує критичного → far', () => {
    const m = matchRecipe(
      [{ n: 'спагеті' }, { n: 'бекон' }],
      [batch('Спагеті №5')],
    );
    expect(m.status).toBe('far');
    expect(m.missing.map((x) => x.n)).toEqual(['бекон']);
    expect(m.have).toBe(1);
  });

  it('бракує тільки опційного → near', () => {
    const m = matchRecipe(
      [{ n: 'спагеті' }, { n: 'базилік', role: 'optional' }],
      [batch('Спагеті №5')],
    );
    expect(m.status).toBe('near');
  });

  // Модель «показує пальцем» через ing.p — це має мати пріоритет над назвою.
  it('резолвить за ing.p, не тільки за назвою', () => {
    const b = batch('Karolina — мʼясо мідій', { id: 'p42' });
    const m = matchRecipe([{ p: 'p42', n: 'мідії' }], [b]);
    expect(m.status).toBe('ready');
  });

  it('ing.p на депляцовану партію не рахується', () => {
    const b = batch('Пелаті', { id: 'p1', state: 'depleted' });
    const m = matchRecipe([{ p: 'p1', n: 'пелаті' }], [b]);
    expect(m.status).toBe('far');
  });

  // Той самий відмінковий збіг, що в мітці алергену.
  it.each([
    ['Шоколад з мигдалем', 'мигдаль'],
    ['Помідори пелаті', 'помідори'],
    ['Олія оливкова', 'олія'],
  ])('«%s» резолвить інгредієнт «%s» попри відмінок', (label, name) => {
    const m = matchRecipe([{ n: name }], [batch(label)]);
    expect(m.status, `${label} / ${name}`).toBe('ready');
  });

  it('відкрита партія потрапляє в rescues', () => {
    const m = matchRecipe(
      [{ n: 'пелаті' }],
      [batch('Помідори пелаті', { state: 'opened' })],
    );
    expect(m.rescues.map((r) => r.label)).toEqual(['Помідори пелаті']);
  });

  it('партія з близьким терміном теж у rescues', () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const m = matchRecipe([{ n: 'кефір' }], [batch('Кефір', { expires_at: soon })]);
    expect(m.rescues).toHaveLength(1);
  });

  it('свіжа запакована партія — не rescue', () => {
    const far = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const m = matchRecipe([{ n: 'сіль' }], [batch('Сіль', { expires_at: far })]);
    expect(m.rescues).toHaveLength(0);
  });

  it('порожній рецепт → ready з нулями', () => {
    const m = matchRecipe([], [batch('Сіль')]);
    expect(m.status).toBe('ready');
    expect(m.total).toBe(0);
  });
});

describe('suggestAlternatives', () => {
  it('пропонує партію зі спорідненою назвою', () => {
    const alts = suggestAlternatives({ n: 'вершки' }, [batch('Вершки 20%'), batch('Сіль')]);
    expect(alts.map((a) => a.label)).toContain('Вершки 20%');
  });

  it('нічого спорідненого — порожньо', () => {
    expect(suggestAlternatives({ n: 'трюфель' }, [batch('Сіль')])).toHaveLength(0);
  });

  it('без назви — порожньо', () => {
    expect(suggestAlternatives({ p: 'p1' }, [batch('Сіль')])).toHaveLength(0);
  });
});
