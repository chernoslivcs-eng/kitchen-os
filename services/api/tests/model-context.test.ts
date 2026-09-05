import { describe, it, expect } from 'vitest';
import { buildChatSystem, type ChatArgs } from '../src/model.js';
import { emptyProfileText, buildVetoIndex, type ProfileText, type VetoRow } from '@kitchen/domain';
import type { PantryBatch, ShoppingItemRow } from '@kitchen/domain';

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

// Крок 11: профіль — сім речень; межа власника в коморі — індекс із no/ban,
// той самий витяг, що PATCH /v1/profile/:key.
function prof(over: Partial<Record<'no' | 'ban' | 'love' | 'kit', string>> = {}): { profileText: ProfileText; vetoIndex: VetoRow[] } {
  const p = emptyProfileText('u1');
  for (const [k, text] of Object.entries(over)) p.fields[k as keyof typeof over] = { text, status: 'filled', updated_at: null };
  const vetoIndex = [
    ...(over.no ? buildVetoIndex('u1', 'no', over.no) : []),
    ...(over.ban ? buildVetoIndex('u1', 'ban', over.ban) : []),
  ];
  return { profileText: p, vetoIndex };
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
      args(prof({ ban: 'арахісу, мигдалю' })),
      PROMPT,
    );
    expect(s).toContain('[ПРО ЛЮДИНУ');
    expect(s).toContain('арахісу');
    expect(s).toContain('мигдалю');
  });

  // Було «порожній профіль не додає порожнього блоку». Сторож QA4-02 — тест
  // вище (алергії доходять до моделі); цей рядок лише економив токени.
  // M13-ROLE-VOICE п.1: тут економія найдорожча. Без блока модель не може
  // відрізнити «обмежень немає» від «ще не питали» — а на порожньому профілі
  // саме вмикається онбординг stage 2, тобто питання ЩЕ НЕ ставили. Тиша,
  // прочитана як дозвіл, — це алерген у пропозиції.
  it('M13: порожній профіль присутній і не читається як дозвіл', () => {
    const s = buildChatSystem(args(prof()), PROMPT);
    expect(s).toContain('[ПРО ЛЮДИНУ');
    expect(s).toMatch(/не означає|ще не питали/i);
  });

  it('QA4-02: поля йдуть словами людини з початками речень', () => {
    const s = buildChatSystem(args(prof({ ban: 'горіхів', no: 'свинини', love: 'гостре' })), PROMPT);
    expect(s).toMatch(/Мені не можна горіхів/);
    expect(s).toMatch(/Я не їм свинини/);
    expect(s).toMatch(/Я люблю гостре/);
  });

  it('QA5-04: техніка — одним реченням, «Немає: …» лишається словами людини', () => {
    const s = buildChatSystem(args(prof({ kit: 'блендер. Немає: духовки' })), PROMPT);
    expect(s).toContain('блендер');
    expect(s).toContain('Немає: духовки');
  });

  it('QA5-01: алерген позначений ПРЯМО В РЯДКУ ПАРТІЇ (індекс із ban)', () => {
    const s = buildChatSystem(args({
      pantry: [batch({ label: 'Арахісова паста' })],
      ...prof({ ban: 'арахіс' }),
    }), PROMPT);
    // Мітка має стояти в тому ж рядку, що назва — інакше модель перелічує
    // вміст комори, не дійшовши до правила.
    const pantryLine = s.split('\n').find((l) => l.includes('Арахісова паста'));
    expect(pantryLine).toBeDefined();
    expect(pantryLine).toContain('⚠АЛЕРГЕН');
    expect(pantryLine).toContain('арахіс');
  });

  it('QA5-01: рядок no дає ⚠НЕ ЇСТЬ, не ⚠АЛЕРГЕН', () => {
    const s = buildChatSystem(args({
      pantry: [batch({ label: 'Стейк рібай' })],
      ...prof({ no: 'мʼяса' }),
    }), PROMPT);
    const line = s.split('\n').find((l) => l.includes('Стейк рібай'));
    expect(line).toContain('⚠НЕ ЇСТЬ');
    expect(line).not.toContain('⚠АЛЕРГЕН');
  });

  it('QA5-01: партія без алергену мітки не має', () => {
    const s = buildChatSystem(args({
      pantry: [batch({ label: 'Пелаті' })],
      ...prof({ ban: 'мигдаль' }),
    }), PROMPT);
    const line = s.split('\n').find((l) => l.includes('Пелаті'));
    expect(line).not.toContain('АЛЕРГЕН');
  });

  it('QA5-01: [ПРО ЛЮДИНУ] стоїть ПЕРЕД [КОМОРА]', () => {
    const s = buildChatSystem(args({
      pantry: [batch()],
      ...prof({ ban: 'арахіс' }),
    }), PROMPT);
    expect(s.indexOf('[ПРО ЛЮДИНУ')).toBeLessThan(s.indexOf('[КОМОРА]'));
  });

  it('QA6-04: список покупок потрапляє в промпт', () => {
    const s = buildChatSystem(args({
      shopping: [shoppingItem({ label: 'молоко' }), shoppingItem({ id: 's2', label: 'яйця' })],
    }), PROMPT);
    expect(s).toContain('[СПИСОК ПОКУПОК]');
    expect(s).toContain('молоко');
    expect(s).toContain('яйця');
  });

  // Було «порожній список не додає блоку» — економія токенів. M13-ROLE-VOICE
  // п.1 показав ціну цієї економії: role.md наказує «подивись у блок» і
  // забороняє казати «блок порожній», тож при відсутньому блоці модель не
  // мала ні джерела, ні права зізнатись — і добудовувала стан із розмови.
  // Порожній блок коштує ~10 токенів і є ВІДПОВІДДЮ; відсутній — тиша.
  it('M13: порожній список ПРИСУТНІЙ у промпті й каже, що порожньо', () => {
    const s = buildChatSystem(args({ shopping: [] }), PROMPT);
    expect(s).toContain('[СПИСОК ПОКУПОК]');
    expect(s).toMatch(/\[СПИСОК ПОКУПОК\] порожній/);
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
      ...prof({ ban: 'арахіс' }),
      shopping: [shoppingItem()],
      recentCookRuns: [{
        title: 'Паста', rating: 4, verdict: 'смачно',
        finished_at: new Date().toISOString(),
      }],
    }), PROMPT);
    for (const block of ['[ПРО ЛЮДИНУ', '[СЬОГОДНІ]', '[КОМОРА]', '[СПИСОК ПОКУПОК]', '[ОСТАННІ ГОТУВАННЯ]']) {
      expect(s, `блок ${block} зник`).toContain(block);
    }
  });
});
