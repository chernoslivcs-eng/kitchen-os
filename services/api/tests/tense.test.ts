import { describe, it, expect } from 'vitest';
import { loadPrompt } from '@kitchen/prompts';
import { fixTense, tenseViolation } from '../src/tense.js';
import type { Card } from '@kitchen/domain';

// Знахідка A аудиту. Правило «пиши в майбутньому часі» писалось під рантайм,
// де КОЖНА картка чекала тапу. Пул-8 №2 і M13 01.09 зробили intake_diff і
// shopping автозастосовними — а правило лишилось у трьох копіях і жодна не
// пішла слідом. Цей файл прикріплює всі три до одного джерела
// (@kitchen/domain applyMode): промпт, пост-процесор і лічильник порушень.

const card = (type: Card['type']) => ({ type } as Card);

describe('пост-процесор: час дієслова слідує за режимом застосування', () => {
  it('auto-картка — минулий час ПРАВДА, не чіпаємо', () => {
    // Сервер поклав хліб у комору тим самим ходом; під карткою «Скасувати».
    expect(fixTense('Записав хліб і молоко.', card('intake_diff')))
      .toBe('Записав хліб і молоко.');
    expect(fixTense('Прибрав сіль зі списку.', card('shopping')))
      .toBe('Прибрав сіль зі списку.');
  });

  it('confirm-картка — минулий час БРЕХНЯ, переписуємо в майбутній', () => {
    expect(fixTense('Записав рецепт.', card('recipe'))).toBe('Запишу рецепт.');
    expect(fixTense('Додав веганство в профіль.', card('profile')))
      .toBe('Додам веганство в профіль.');
  });

  it('картка нічого не застосовує — правило не наше', () => {
    expect(fixTense('Записав.', card('proposal'))).toBe('Записав.');
    expect(fixTense('Записав.', null)).toBe('Записав.');
  });

  it('теперішній час при confirm теж стверджує дію, що вже йде', () => {
    expect(fixTense('Записую рецепт.', card('recipe'))).toBe('Запишу рецепт.');
  });

  // Крок 4 (ручний тест): заміна брала форму з таблиці як є, ігноруючи
  // регістр оригіналу — «пармезан прибрав» усередині речення виходило
  // «пармезан Приберу». Результат мусить повторювати регістр збіглого слова.
  it('регістр заміни повторює регістр збіглого слова, а не таблицю', () => {
    expect(fixTense('Пармезан прибрав.', card('recipe'))).toBe('Пармезан приберу.');
    expect(fixTense('Прибрав пармезан.', card('recipe'))).toBe('Приберу пармезан.');
  });
});

describe('лічильник порушень рахує тільки справжні', () => {
  it('минулий час там, де картка ще чекає тапу', () => {
    expect(tenseViolation('Записав рецепт.', card('recipe'))).toBe(true);
  });

  it('минулий час при auto-картці порушенням НЕ рахується', () => {
    // Саме тут лічильник псував дані: спрацьовував на правильних відповідях
    // найчастішого типу картки, і розбивка «картки про людину vs про речі»
    // ставала непридатною.
    expect(tenseViolation('Записав хліб.', card('intake_diff'))).toBe(false);
    expect(tenseViolation('Прибрав сіль.', card('shopping'))).toBe(false);
  });

  it('майбутній час і відсутність картки — не порушення', () => {
    expect(tenseViolation('Запишу рецепт.', card('recipe'))).toBe(false);
    expect(tenseViolation('Записав.', null)).toBe(false);
  });
});

describe('промпт: третя копія правила теж читає режим', () => {
  const contract = () => loadPrompt().blocks['card-contract']!;

  it('стара беззастережна заява про «ще не застосовану» картку зникла', () => {
    expect(contract()).not.toContain('картка ще НЕ застосована');
  });

  it('обидва режими названі явно, з типами карток', () => {
    const t = contract();
    expect(t).toContain('intake_diff');
    expect(t).toContain('shopping');
    expect(t).toContain('МИНУЛИЙ');
    expect(t).toContain('МАЙБУТНІЙ');
  });

  it('state-facts більше не обіцяє тап там, де його немає', () => {
    expect(loadPrompt().blocks['state-facts']!).not.toContain('тапає «Застосувати»');
  });
});
