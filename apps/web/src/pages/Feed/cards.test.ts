import { describe, it, expect } from 'vitest';
import { labelFor, appliedToast } from './cards';

// Мітка над карткою — єдине, що каже людині, куди саме поїде «Так».
// Для картки рецепта вона мовчки казала «ПРОПОЗИЦІЯ», бо тип провалювався
// в дефолтну гілку: імпорт із книжки виглядав як вигадка моделі.
// Етап 2a: гліфи ◌ ✓ ↩ ✕ знято з міток карток. Вони пережили етапи 1.5 і 1.6,
// бо мітка малюється лише коли в чаті є картка, а прогін аудиту туди не
// заходить (DEBT §26 — четвертий приклад тієї самої сліпоти).
// Капс у самих словах лишається: це блок 1 COPY-DEBT, окрема робота.
describe('мітка над карткою', () => {
  it('рецепт має власну мітку, не «ПРОПОЗИЦІЯ»', () => {
    expect(labelFor('recipe').text).toBe('РЕЦЕПТ · ОЧІКУЄ');
  });

  it('решта типів не зачеплена', () => {
    expect(labelFor('intake_diff').text).toBe('КОМОРА · ОЧІКУЄ');
    expect(labelFor('shopping').text).toBe('СПИСОК · ОЧІКУЄ');
    expect(labelFor('period').text).toBe('КАЛЕНДАР · ОЧІКУЄ');
  });

  // Аудит раунд 3, крок 3: статус — з applyMode (card-modes.ts). proposal —
  // mode 'none': нема чого чекати, тож без «· ОЧІКУЄ», лише тип.
  it('proposal: mode none — тип без статусу', () => {
    expect(labelFor('proposal').text).toBe('ПРОПОЗИЦІЯ');
    expect(labelFor('proposal').tone).toBe('muted');
  });

  it('стан переважає тип', () => {
    expect(labelFor('recipe', true).text).toBe('ЗАСТОСОВАНО');
    expect(labelFor('recipe', false, true).text).toBe('СКАСОВАНО');
    expect(labelFor('recipe', false, false, true).text).toBe('ВІДХИЛЕНО');
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

  // П4-Т4. Тост ігнорував appliedCount і повертав захардкоджений рядок
  // завжди. 7 вересня людина побачила підтвердження запису, якого не було.
  // Ловили це на картці профілю; П5-В4 родину прибрав — правило лишилось,
  // і воно однакове для кожної родини, у якої може лягти нуль.
  it('при нулі жодна родина не каже «Записано»', () => {
    expect(appliedToast({ type: 'period', kind: 'custom' } as never, 0)).toBe('У календарі нічого не змінилось');
    expect(appliedToast({ type: 'shopping', items: [{}, {}] }, 0)).toBe('У списку нічого не змінилось');
    expect(appliedToast({ type: 'intake_diff', ops: [{}] }, 0)).toBe('У коморі нічого не змінилось');
  });

  // Решта родин, які після Т2 теж уміють повернути нуль.
  it('нуль називає місце, а не лише факт', () => {
    expect(appliedToast({ type: 'shopping', items: [{}] }, 0)).toBe('У списку нічого не змінилось');
    expect(appliedToast({ type: 'intake_diff', ops: [{}] }, 0)).toBe('У коморі нічого не змінилось');
    expect(appliedToast({ type: 'event', ops: [{}] }, 0)).toBe('У календарі нічого не змінилось');
    expect(appliedToast({ type: 'period', items: [{}] }, 0)).toBe('У календарі нічого не змінилось');
  });
});

describe('етап 3 · частковий успіх у сліді (PLAN §4)', () => {
  // Сервер віддає applied / missed / already_there / truncated з першого дня,
  // а слід казав «ЗАСТОСОВАНО» булевим: числа жили лише в тості й зникали
  // за секунди. Слід — тривале, і саме він має нести «9 із 14».
  it('усе застосовано — без чисел, як і було', () => {
    expect(labelFor('intake_diff', true, false, false, { applied: 14, total: 14 }).text).toBe('ЗАСТОСОВАНО');
  });

  it('частина — «9 із 14 · 5 пропущено», і тон лишається applied', () => {
    const l = labelFor('intake_diff', true, false, false, { applied: 9, total: 14, missed: ['a', 'b', 'c', 'd', 'e'] });
    expect(l.text).toBe('ЗАСТОСОВАНО · 9 із 14 · 5 пропущено');
    expect(l.tone).toBe('applied');
  });

  it('«вже було» — окремим словом, бо це не пропуск і не помилка', () => {
    expect(labelFor('intake_diff', true, false, false, { applied: 9, total: 14, alreadyThere: 5 }).text)
      .toBe('ЗАСТОСОВАНО · 9 із 14 · 5 уже було');
  });

  it('обрізано стелею — окремим словом', () => {
    expect(labelFor('shopping', true, false, false, { applied: 10, total: 23, truncated: true }).text)
      .toBe('ЗАСТОСОВАНО · 10 із 23 · решту не вмістило');
  });

  it('без результату (старі ходи з історії) — як і було', () => {
    expect(labelFor('intake_diff', true).text).toBe('ЗАСТОСОВАНО');
  });
});
