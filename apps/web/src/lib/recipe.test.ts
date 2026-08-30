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

  // QA5-09: кількість у крок НЕ підставляється — вона вже є в списку інгредієнтів,
  // а в тексті ламала фразу («половиною олія оливкова 40 мл»).
  it('підставляє назву без кількості', () => {
    expect(renderStepContent('Закинути {0} в окріп', ing))
      .toBe('Закинути спагетті в окріп');
  });

  it('QA3-01 guard: назва перед {N} — прибирається', () => {
    expect(renderStepContent('Часник {1} подрібни', ing))
      .toBe('Часник подрібни');
    expect(renderStepContent('Моцарела {2} порви руками', ing))
      .toBe('Моцарела порви руками');
  });

  it('guard не спрацьовує коли перед — інше слово', () => {
    expect(renderStepContent('додай {1} до соусу', ing))
      .toBe('Додай часник до соусу');
  });

  it('декілька плейсхолдерів', () => {
    expect(renderStepContent('{0} і {2} — головні', ing))
      .toBe('Спагетті і моцарела — головні');
  });

  it('невідомий індекс — лишається як є', () => {
    expect(renderStepContent('що з {99}?', ing))
      .toBe('Що з {99}?');
  });

  it('без ing.v/u — лише назва', () => {
    expect(renderStepContent('додай {0}', [{ n: 'сіль' }]))
      .toBe('Додай сіль');
  });

  // QA5-09: назва партії приходить із малої, а плейсхолдер часто стоїть першим —
  // виходило «Підготовка. помідори — скибочки».
  it('капіталізує перший символ', () => {
    expect(renderStepContent('{0} — нарізати', [{ n: 'помідори' }]))
      .toBe('Помідори — нарізати');
  });

  // QA6-11: модель пише кілька речень у кроці — капіталізувати треба кожне.
  it('капіталізує після крапки всередині кроку', () => {
    expect(renderStepContent('Соус. {0} — продави пресом. {1}: розігрій', [
      { n: 'часник' }, { n: 'олія оливкова' },
    ])).toBe('Соус. Часник — продави пресом. Олія оливкова: розігрій');
  });
});
