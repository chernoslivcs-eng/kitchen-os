import { describe, it, expect } from 'vitest';
import { buildChatSystem, type ChatArgs } from '../src/model.js';
import type { PantryBatch, Profile, ShoppingItemRow } from '@kitchen/domain';

// Тести на МЕЖУ, а не на функцію.
//
// 128 тестів були зелені, коли QA-4 знайшов, що модель не бачить ні історії,
// ні профілю. Жоден тест не перевіряв, що потрапляє в системний промпт — вони
// перевіряли логіку, яка й так була правильна.
//
// Тут перевіряється рівно одне: чи доходять дані до моделі. Без мережі, без
// ключа, за мілісекунди. Кожен кейс названий за багом, який він ловить.

const PROMPT = '[SYSTEM PROMPT]';

function batch(over: Partial<PantryBatch> = {}): PantryBatch {
  return {
    id: 'b1', household_id: 'h1', catalog_key: null,
    label: 'моцарела', zone: 'fridge', value: 250, unit: 'g',
    state: 'sealed', opened_at: null, expires_at: null,
    best_before_opened_days: null, added_at: new Date().toISOString(),
    depleted_at: null, confidence: 1, provenance: 'user_statement',
    staple: false, last_by: null, last_action: null,
    ...over,
  };
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    user_id: 'u1', allergies: [], wishes: [], antipatterns: [], equipment: {},
    ...over,
  };
}

function shoppingItem(over: Partial<ShoppingItemRow> = {}): ShoppingItemRow {
  return {
    id: 's1', household_id: 'h1', label: 'молоко', reason: null,
    value: 1, unit: 'l', zone: null, checked: false, added_by: null,
    source: 'user', created_at: new Date().toISOString(),
    ...over,
  };
}

function args(over: Partial<ChatArgs> = {}): ChatArgs {
  return {
    user_id: 'u1', session_id: 's1', text: 'привіт', pantry: [],
    ...over,
  };
}

describe('buildChatSystem · що доходить до моделі', () => {
  it('QA4-02: профіль потрапляє в промпт', () => {
    const s = buildChatSystem(
      args({ profile: profile({ allergies: ['арахіс', 'мигдаль'] }) }),
      PROMPT,
    );
    expect(s).toContain('[ПРОФІЛЬ]');
    expect(s).toContain('арахіс');
    expect(s).toContain('мигдаль');
  });

  it('QA4-02: порожній профіль не додає порожнього блоку', () => {
    const s = buildChatSystem(args({ profile: profile() }), PROMPT);
    expect(s).not.toContain('[ПРОФІЛЬ]');
  });

  it('QA4-02: профіль розрізняє алергії, anti й wishes', () => {
    const s = buildChatSystem(args({
      profile: profile({
        allergies: ['горіхи'],
        antipatterns: ['не їм свинину'],
        wishes: ['люблю гостре'],
      }),
    }), PROMPT);
    expect(s).toMatch(/АЛЕРГІЇ.*горіхи/s);
    expect(s).toMatch(/НЕ ЇСТЬ.*свинину/s);
    expect(s).toMatch(/ЛЮБИТЬ.*гостре/s);
  });

  it('QA5-04: техніка розрізняє has і lacks', () => {
    const s = buildChatSystem(args({
      profile: profile({ equipment: { духовка: 'lacks', блендер: 'has' } }),
    }), PROMPT);
    expect(s).toMatch(/НЕМАЄ ТЕХНІКИ.*духовка/s);
    expect(s).toMatch(/Є ТЕХНІКА.*блендер/s);
  });

  it('QA5-01: алерген позначений ПРЯМО В РЯДКУ ПАРТІЇ', () => {
    const s = buildChatSystem(args({
      pantry: [batch({ label: 'Шоколад з мигдалем' })],
      profile: profile({ allergies: ['мигдаль'] }),
    }), PROMPT);
    // Мітка має стояти в тому ж рядку, що назва — інакше модель перелічує
    // вміст комори, не дійшовши до правила.
    const pantryLine = s.split('\n').find((l) => l.includes('Шоколад з мигдалем'));
    expect(pantryLine).toBeDefined();
    expect(pantryLine).toContain('⚠АЛЕРГЕН');
    expect(pantryLine).toContain('мигдаль');
  });

  // Знайдено цим самим тестом: `.includes()` не бачить відмінка, і мітка не
  // спрацьовувала саме на прикладі, через який її робили.
  it.each([
    ['Шоколад з мигдалем', 'мигдаль'],
    ['Паста з горіхами', 'горіхи'],
    ['Арахісова паста', 'арахіс'],
    ['Молоко кокосове', 'кокос'],
  ])('QA5-01: «%s» ловиться алергією «%s» попри відмінок', (label, allergy) => {
    const s = buildChatSystem(args({
      pantry: [batch({ label })],
      profile: profile({ allergies: [allergy] }),
    }), PROMPT);
    const line = s.split('\n').find((l) => l.includes(label));
    expect(line, `мітка не спрацювала на «${label}» / «${allergy}»`).toContain('⚠АЛЕРГЕН');
  });

  it('QA5-01: партія без алергену мітки не має', () => {
    const s = buildChatSystem(args({
      pantry: [batch({ label: 'Пелаті' })],
      profile: profile({ allergies: ['мигдаль'] }),
    }), PROMPT);
    const line = s.split('\n').find((l) => l.includes('Пелаті'));
    expect(line).not.toContain('АЛЕРГЕН');
  });

  it('QA5-01: [ПРОФІЛЬ] стоїть ПЕРЕД [КОМОРА]', () => {
    const s = buildChatSystem(args({
      pantry: [batch()],
      profile: profile({ allergies: ['арахіс'] }),
    }), PROMPT);
    expect(s.indexOf('[ПРОФІЛЬ]')).toBeLessThan(s.indexOf('[КОМОРА]'));
  });

  it('QA6-04: список покупок потрапляє в промпт', () => {
    const s = buildChatSystem(args({
      shopping: [shoppingItem({ label: 'молоко' }), shoppingItem({ id: 's2', label: 'яйця' })],
    }), PROMPT);
    expect(s).toContain('[СПИСОК ПОКУПОК]');
    expect(s).toContain('молоко');
    expect(s).toContain('яйця');
  });

  it('QA6-04: порожній список не додає блоку', () => {
    const s = buildChatSystem(args({ shopping: [] }), PROMPT);
    expect(s).not.toContain('[СПИСОК ПОКУПОК]');
  });

  it('QA6-04: куплені позиції позначені', () => {
    const s = buildChatSystem(args({
      shopping: [shoppingItem({ label: 'молоко', checked: true })],
    }), PROMPT);
    expect(s).toMatch(/молоко.*куплено/);
  });

  it('QA5-07: дата в промпті', () => {
    const s = buildChatSystem(args(), PROMPT);
    expect(s).toContain('[СЬОГОДНІ]');
    // uk-UA локаль дає назву місяця словом
    expect(s).toMatch(/\[СЬОГОДНІ\].*\d{4}/);
  });

  it('QA4-08: свіже готування — «сьогодні», не «0дн тому»', () => {
    const s = buildChatSystem(args({
      recentCookRuns: [{
        title: 'Паста', rating: 5, verdict: null,
        finished_at: new Date().toISOString(),
      }],
    }), PROMPT);
    expect(s).toContain('[ОСТАННІ ГОТУВАННЯ]');
    expect(s).toContain('сьогодні');
    expect(s).not.toContain('0дн');
  });

  it('QA4-08: вчорашнє готування — «вчора»', () => {
    const s = buildChatSystem(args({
      recentCookRuns: [{
        title: 'Паста', rating: null, verdict: null,
        finished_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
      }],
    }), PROMPT);
    expect(s).toContain('вчора');
  });

  it('термін догоряння ≤7 днів позначається', () => {
    const s = buildChatSystem(args({
      pantry: [batch({
        label: 'кефір',
        expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      })],
    }), PROMPT);
    expect(s).toMatch(/кефір.*!2дн/);
  });

  it('depleted партії в промпт не йдуть', () => {
    const s = buildChatSystem(args({
      pantry: [batch({ label: 'зʼїдене', state: 'depleted' })],
    }), PROMPT);
    expect(s).not.toContain('зʼїдене');
  });

  it('усі блоки разом — жоден не витісняє інший', () => {
    const s = buildChatSystem(args({
      pantry: [batch()],
      profile: profile({ allergies: ['арахіс'] }),
      shopping: [shoppingItem()],
      recentCookRuns: [{
        title: 'Паста', rating: 4, verdict: 'смачно',
        finished_at: new Date().toISOString(),
      }],
    }), PROMPT);
    for (const block of ['[ПРОФІЛЬ]', '[СЬОГОДНІ]', '[КОМОРА]', '[СПИСОК ПОКУПОК]', '[ОСТАННІ ГОТУВАННЯ]']) {
      expect(s, `блок ${block} зник`).toContain(block);
    }
  });
});
