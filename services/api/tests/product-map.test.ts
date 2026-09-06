import { describe, it, expect } from 'vitest';
import { buildDynamicContext, buildChatSystem } from '../src/model.js';
import { loadPrompt, compose } from '@kitchen/prompts';
import { productMapFor } from '@kitchen/domain';

// Раунд 5, крок К1. [ПРО ДОДАТОК] — не в кожному виклику: тільки коли репліка
// схожа на питання про додаток. Перевіряємо на рядку промпту, без мережі:
// блок є на спрацюванні й відсутній без нього; стоїть після [ПРО ЛЮДИНУ] і
// перед [КОМОРА]; у стабільний (кешований) префікс не потрапляє.

const prompt = loadPrompt();
const map = prompt.blocks['product-map'];

const base = { user_id: 'u1', session_id: 's1', pantry: [], history: [] };

describe('[ПРО ДОДАТОК] у промпті', () => {
  it('карта є у версії промпту і задекларована як inject для chat', () => {
    expect(map).toBeTruthy();
    expect(map).toMatch(/^\[ПРО ДОДАТОК\]/);
    expect(prompt.manifest.calls.chat.inject).toEqual(['product-map']);
  });

  it('є на питанні про додаток', () => {
    const text = 'як підключити сільпо?';
    const dyn = buildDynamicContext({ ...base, text }, productMapFor(text, map));
    expect(dyn).toContain('[ПРО ДОДАТОК]');
    expect(dyn).toContain('Мережі');
  });

  it('нема на питанні про їжу і на звичайному ході', () => {
    for (const text of ['як приготувати рибу', 'що на вечерю?', 'купив молоко і яйця']) {
      const dyn = buildDynamicContext({ ...base, text }, productMapFor(text, map));
      expect(dyn, text).not.toContain('[ПРО ДОДАТОК]');
    }
  });

  it('стоїть після [ПРО ЛЮДИНУ] і перед [КОМОРА]', () => {
    const text = 'де подивитись калорії?';
    const dyn = buildDynamicContext({ ...base, text }, productMapFor(text, map));
    const person = dyn.indexOf('[ПРО ЛЮДИНУ');
    const app = dyn.indexOf('[ПРО ДОДАТОК]');
    const pantry = dyn.indexOf('[КОМОРА]');
    expect(person).toBeGreaterThanOrEqual(0);
    expect(app).toBeGreaterThan(person);
    expect(pantry).toBeGreaterThan(app);
  });

  it('не потрапляє в стабільний префікс (compose chat)', () => {
    // Правило в kitchen-policy згадує назву блока — це нормально; тіла карти в префіксі бути не має.
    const body = 'усередині Kitchen OS';
    expect(map).toContain(body);
    expect(compose('chat', prompt)).not.toContain(body);
    expect(compose('chat', prompt, { stage: 1 })).not.toContain(body);
  });

  it('buildChatSystem = промпт + той самий динамічний блок із картою', () => {
    const text = 'як прибрати нотатку?';
    const pm = productMapFor(text, map);
    expect(buildChatSystem({ ...base, text }, 'ПРАВИЛА', pm)).toBe('ПРАВИЛА' + buildDynamicContext({ ...base, text }, pm));
  });
});
