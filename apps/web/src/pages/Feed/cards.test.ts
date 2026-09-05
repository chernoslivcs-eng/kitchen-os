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
  });

  // Аудит раунд 3, крок 3: статус — з applyMode (card-modes.ts). proposal —
  // mode 'none': нема чого чекати, тож без «· ОЧІКУЄ», лише тип.
  it('proposal: mode none — тип без статусу', () => {
    expect(labelFor('proposal').text).toBe('ПРОПОЗИЦІЯ');
    expect(labelFor('proposal').tone).toBe('muted');
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
    // Крок 4в (5): профіль — не комора; те саме для картки поля.
    expect(appliedToast({ type: 'profile', ops: [{}, {}, {}, {}, {}] })).toBe('Записано в „Про тебе"');
    expect(appliedToast({ type: 'profile', field: 'no', mode: 'append', text: 'кінзи' })).toBe('Записано в „Про тебе"');
  });

  it('рецепт називає страву, а не рахує позиції', () => {
    expect(appliedToast({ type: 'recipe', recipe: { t: 'Плескавиця' } as never }))
      .toBe('«Плескавиця» — у рецептах');
  });

  it('рецепт без назви не ламає тост', () => {
    expect(appliedToast({ type: 'recipe' })).toBe('Рецепт збережено');
  });

  // 01.09: чек-картка дозволяє стрикаут — «Застосувати 9» з 10 у списку.
  // Без appliedCount тост рахував ПОВНИЙ card.ops.length, ігноруючи вибір
  // людини: тиснеш «9», а тост каже «10».
  it('appliedCount override рахує реально застосоване, не повний ops.length', () => {
    expect(appliedToast({ type: 'intake_diff', ops: [{}, {}, {}] }, 2)).toBe('2 позиції у коморі');
  });
});
