import { describe, it, expect } from 'vitest';
import { renderStepContent, resolveIngName, type BatchLabels } from './recipe.js';

describe('resolveIngName', () => {
  const labels: BatchLabels = new Map([['b1', 'Моцарела'], ['b2', 'Пелаті']]);

  it('uuid → назва з мапи', () => {
    expect(resolveIngName({ p: 'b1' }, labels)).toBe('Моцарела');
  });
  it('без мапи → fallback ing.n', () => {
    expect(resolveIngName({ p: 'b1', n: 'моцарела вручну' }, undefined)).toBe('моцарела вручну');
  });
  it('нема ні мапи ні n → «інгредієнт»', () => {
    expect(resolveIngName({ p: 'unknown' }, labels)).toBe('інгредієнт');
  });
  it('nʼна перше', () => {
    expect(resolveIngName({ n: 'сіль' })).toBe('сіль');
  });
});

describe('renderStepContent · placeholder replacement', () => {
  const ing = [
    { n: 'спагетті', v: 300, u: 'g' },
    { n: 'часник', v: 2, u: 'pcs' },
    { n: 'моцарела', v: 250, u: 'g' },
  ];

  it('простий плейсхолдер із кількістю', () => {
    expect(renderStepContent('Закинути {0} в окріп', ing))
      .toBe('Закинути спагетті 300 г в окріп');
  });

  it('QA3-01 guard: назва перед {N} — прибирається', () => {
    expect(renderStepContent('Часник {1} подрібни', ing))
      .toBe('часник 2 шт подрібни');
    expect(renderStepContent('Моцарела {2} порви руками', ing))
      .toBe('моцарела 250 г порви руками');
  });

  it('guard не спрацьовує коли перед — інше слово', () => {
    expect(renderStepContent('додай {1} до соусу', ing))
      .toBe('додай часник 2 шт до соусу');
  });

  it('декілька плейсхолдерів', () => {
    expect(renderStepContent('{0} і {2} — головні', ing))
      .toBe('спагетті 300 г і моцарела 250 г — головні');
  });

  it('невідомий індекс — лишається як є', () => {
    expect(renderStepContent('що з {99}?', ing))
      .toBe('що з {99}?');
  });

  it('без ing.v/u — лише назва', () => {
    expect(renderStepContent('додай {0}', [{ n: 'сіль' }]))
      .toBe('додай сіль');
  });
});
