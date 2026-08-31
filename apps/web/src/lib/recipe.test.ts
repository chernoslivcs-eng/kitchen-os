import { describe, it, expect } from 'vitest';
import { renderStepContent, resolveIngName, stepIngredients, stepLabelsFrom, scaleRecipe, type BatchLabels } from './recipe.js';

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

describe('stepIngredients (DA2-05, «НА ЦЬОМУ КРОЦІ»)', () => {
  const ing = [
    { n: 'фует', v: 120, u: 'g' },
    { n: 'вершки', v: 300, u: 'ml' },
    { n: 'пармезан', v: 40, u: 'g' },
  ];

  it('витягує інгредієнти кроку за {N}, у порядку індексів', () => {
    expect(stepIngredients('Витопити {0}, влити {1}', ing).map((i) => i.n))
      .toEqual(['фует', 'вершки']);
  });

  it('дубль {0} не подвоює', () => {
    expect(stepIngredients('{0} нарізати, {0} витопити', ing)).toHaveLength(1);
  });

  it('крок без плейсхолдерів — порожньо', () => {
    expect(stepIngredients('Поставити воду, посолити', ing)).toEqual([]);
  });

  it('індекс за межами — ігнорується', () => {
    expect(stepIngredients('{7} додати', ing)).toEqual([]);
  });
});

// QA8-02: рецепт-повідомлення рендерило кроки самописною копією без
// batchLabels — «Відварити пасту. інгредієнт — кинути в окріп». Копія
// втратила три раніше закриті фікси (QA3-01, QA5-09, QA6-11) одним рядком.
// Гвардія: спільна функція з labels резолвить партії з комори.
describe('renderStepContent — кроки з партіями комори (QA8-02)', () => {
  const labels: BatchLabels = new Map([['6b42a922', 'Спагеті №5']]);
  const ing = [{ p: '6b42a922', v: 200, u: 'g' }, { n: 'яйця', v: 3, u: 'pcs' }];

  it('партія без n резолвиться в назву з комори, не в заглушку', () => {
    const out = renderStepContent('{0} — кинути в окріп', ing, labels);
    expect(out).toContain('Спагеті №5');
    expect(out).not.toContain('інгредієнт');
  });

  it('початок речення капіталізується (QA6-11 не втрачено)', () => {
    const out = renderStepContent('{0} — кинути в окріп', ing, labels);
    expect(out[0]).toBe(out[0]!.toUpperCase());
  });
});

// Черга Д (№4а): КРОКИ показують тільки product («пармезан»), повна назва
// («пармезан Galbani тертий») лишається в списку інгредієнтів.
describe('stepLabelsFrom — базова назва для кроків', () => {
  it('партія з product_id → product; без → label', () => {
    const labels = stepLabelsFrom(
      [
        { id: 'b1', label: 'пармезан Galbani тертий', product_id: 'p1' },
        { id: 'b2', label: 'сіль', product_id: null },
      ],
      [{ id: 'p1', product: 'пармезан' }],
    );
    expect(labels.get('b1')).toBe('пармезан');
    expect(labels.get('b2')).toBe('сіль');
  });
});

// Порційник: детерміноване масштабування без моделі. Множаться ТІЛЬКИ
// кількості інгредієнтів; kcal лишається на порцію, таймери й текст кроків
// не чіпаються (кількостей у кроках немає — QA5-09).
describe('scaleRecipe', () => {
  const base = {
    t: 'Бургер', sv: 2, tm: 25, ch: 'швидко', d: '', rk: '',
    nu: { kcal: 680, p: 30, f: 40, c: 45 },
    ing: [
      { n: 'котлети яловичі', v: 240, u: 'g' },
      { n: 'булки', v: 2, u: 'pcs' },
      { n: 'сіль' },
    ],
    st: [{ t: 'Смаж', c: 'Смаж {0}', s: 240 }],
  };
  it('множить v пропорційно, решту не чіпає', () => {
    const x4 = scaleRecipe(base, 4);
    expect(x4.sv).toBe(4);
    expect(x4.ing[0]!.v).toBe(480);
    expect(x4.ing[1]!.v).toBe(4);
    expect(x4.ing[2]!.v).toBeUndefined();
    expect(x4.nu!.kcal).toBe(680);          // на порцію
    expect(x4.st[0]!.s).toBe(240);          // таймер не залежить
    expect(base.ing[0]!.v).toBe(240);       // вихідний не мутується
  });
  it('вниз теж працює, округлення людське', () => {
    const x1 = scaleRecipe(base, 1);
    expect(x1.ing[0]!.v).toBe(120);
    expect(scaleRecipe({ sv: 3, ing: [{ v: 100 }] }, 2).ing[0]!.v).toBe(66.7);
  });
});
