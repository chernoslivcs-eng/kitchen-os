import { describe, it, expect } from 'vitest';
import { labelFor, appliedToast } from './cards';

// Мітка над карткою — єдине, що каже людині, куди саме поїде «Так».
// Для картки рецепта вона мовчки казала «ПРОПОЗИЦІЯ», бо тип провалювався
// в дефолтну гілку: імпорт із книжки виглядав як вигадка моделі.
describe('мітка над карткою', () => {
  it('рецепт має власну мітку, не «ПРОПОЗИЦІЯ»', () => {
    expect(labelFor('recipe').text).toBe('РЕЦЕПТ · ◌ ОЧІКУЄ');
  });

  it('решта типів не зачеплена', () => {
    expect(labelFor('intake_diff').text).toBe('КОМОРА · ◌ ОЧІКУЄ');
    expect(labelFor('shopping').text).toBe('СПИСОК · ◌ ОЧІКУЄ');
    expect(labelFor('profile').text).toBe('ПРОФІЛЬ · ◌ ОЧІКУЄ');
    expect(labelFor('proposal').text).toBe('ПРОПОЗИЦІЯ · ◌ ОЧІКУЄ');
  });

  it('стан переважає тип', () => {
    expect(labelFor('recipe', true).text).toBe('✓ ЗАСТОСОВАНО');
    expect(labelFor('recipe', false, true).text).toBe('↩ СКАСОВАНО');
    expect(labelFor('recipe', false, false, true).text).toBe('✕ ВІДХИЛЕНО');
  });
});

// Текст тосту після «Так». Рахувався як «кількість ops або items» з формами
// «у коморі»/«у списку» — для картки рецепта це давало «0 позицій у коморі».
describe('тост після застосування', () => {
  it('комора рахує ops', () => {
    expect(appliedToast({ type: 'intake_diff', ops: [{}, {}] })).toBe('2 позиції у коморі');
  });

  it('список має свої форми', () => {
    expect(appliedToast({ type: 'shopping', items: [{}] })).toBe('1 позиція у списку');
  });

  it('профіль рахує ops, не items', () => {
    expect(appliedToast({ type: 'profile', ops: [{}, {}, {}, {}, {}] })).toBe('5 позицій у коморі');
  });

  it('рецепт називає страву, а не рахує позиції', () => {
    expect(appliedToast({ type: 'recipe', recipe: { t: 'Плескавиця' } as never }))
      .toBe('«Плескавиця» — у рецептах');
  });

  it('рецепт без назви не ламає тост', () => {
    expect(appliedToast({ type: 'recipe' })).toBe('Рецепт збережено');
  });
});
