import { describe, it, expect } from 'vitest';
import { buildChatHistory } from '../src/chat-history.js';
import type { MessageRow } from '@kitchen/domain';

// Аудит 04.09, раунд 2 (AUDIT-ROUND-2.md §2): мітка «[НЕ ЗАСТОСОВАНО]» стояла
// на кожній картці з applied === 0 — включно з proposal, де застосовувати
// нічого. У проді — 27 із 27 пропозицій. Мітка, яка стоїть усюди, не
// означає нічого; qa5-unapplied-card-truth флапав при правилі, яке було
// на місці в role.md.
//
// Тести на МЕЖУ: перевіряється рівно той рядок, що їде в модель.

function msg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    session_id: 's1',
    role: 'assistant',
    text: null,
    card: null,
    applied: 0,
    created_at: '2026-09-04T14:30:00.000Z',
    ...over,
  };
}

describe('статус картки в історії — лише там, де є стан', () => {
  it('proposal без суфікса: пропозицію не «застосовують», їй нема чого бути «не застосованою»', () => {
    const [turn] = buildChatHistory([
      msg({
        text: 'Три варіанти:',
        card: { type: 'proposal', items: [{ title: 'Шакшука' }, { title: 'Карбонара' }] } as never,
        applied: 0,
      }),
    ]);
    expect(turn!.content).toContain('[картка: пропозиції] Шакшука · Карбонара');
    expect(turn!.content).not.toMatch(/ЗАСТОСОВАНО/);
  });

  it('cook_go і cart_go — службові маркери, без суфікса', () => {
    const history = buildChatHistory([
      msg({ text: 'Тримай рецепт.', card: { type: 'cook_go', title: 'Шакшука' } as never }),
      msg({ id: 'm2', text: 'Зараз гляну ціни.', card: { type: 'cart_go' } as never }),
    ]);
    for (const t of history) expect(t.content).not.toMatch(/ЗАСТОСОВАНО/);
  });

  it('profile на підтвердженні: мітка називає справжню кнопку і каже, що людина її не натискала', () => {
    const [turn] = buildChatHistory([
      msg({
        text: 'Запишу кінзу.',
        card: { type: 'profile', ops: [{ op: 'add', kind: 'anti', label: 'кінза' }] } as never,
        applied: 0,
      }),
    ]);
    expect(turn!.content).toContain('[картка: профіль] add anti: кінза');
    // Починається тими самими словами, що й правило в role.md — префікс не правиться.
    expect(turn!.content).toMatch(/\[НЕ ЗАСТОСОВАНО — у профілі\/бібліотеці цього ще НЕМАЄ/);
    // CARD_BUTTON_LABEL.profile — те саме, що рендерить ProfileCard у cards.tsx.
    expect(turn!.content).toContain('кнопка «Записати»');
    expect(turn!.content).toMatch(/не натискала/);
  });

  it('традиції — виняток у профілі (auto): застосована → [ЗАСТОСОВАНО]', () => {
    const [turn] = buildChatHistory([
      msg({
        text: 'Записав: католицькі свята.',
        card: { type: 'profile', ops: [{ op: 'add', kind: 'tradition', label: 'catholic' }] } as never,
        applied: 1,
      }),
    ]);
    expect(turn!.content).toContain('[ЗАСТОСОВАНО]');
  });

  it('auto-картка, що нічого не записала: «не сталось», а не «чекає»', () => {
    const [turn] = buildChatHistory([
      msg({
        text: 'Записав молоко.',
        card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко' }] } as never,
        applied: 0,
      }),
    ]);
    expect(turn!.content).toMatch(/\[НЕ ЗАСТОСОВАНО — нічого не записано, у коморі\/списку цього НЕМАЄ\. Кнопки нема, чекати нічого/);
    expect(turn!.content).not.toMatch(/кнопка «/);
  });

  it('застосована intake-картка — без змін: попередження про подвійний облік лишається', () => {
    const [turn] = buildChatHistory([
      msg({
        text: 'Записав молоко.',
        card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко' }] } as never,
        applied: 1,
      }),
    ]);
    expect(turn!.content).toContain('[ЗАСТОСОВАНО — ефект уже врахований у поточному [КОМОРА], не додавай]');
  });

  it('dismissed_at: відхилено людиною — не пропонувати знову', () => {
    const [turn] = buildChatHistory([
      msg({
        text: 'Запишу кінзу.',
        card: { type: 'profile', ops: [{ op: 'add', kind: 'anti', label: 'кінза' }] } as never,
        applied: 0,
        dismissed_at: '2026-09-05T10:00:00.000Z',
      }),
    ]);
    expect(turn!.content).toMatch(/\[ВІДХИЛЕНО людиною — не записано; не пропонуй це знову/);
    expect(turn!.content).not.toMatch(/НЕ ЗАСТОСОВАНО/);
  });

  it('undone_at: скасовано після застосування — переважає над applied>0', () => {
    const [turn] = buildChatHistory([
      msg({
        text: 'Записав молоко.',
        card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко' }] } as never,
        // undoCard скидає message.applied назад у 0 — саме цей стан і мірить тест.
        applied: 0,
        undone_at: '2026-09-05T10:05:00.000Z',
      }),
    ]);
    expect(turn!.content).toMatch(/\[СКАСОВАНО людиною після застосування — у коморі\/списку цього вже НЕМАЄ\]/);
    expect(turn!.content).not.toMatch(/НЕ ЗАСТОСОВАНО/);
  });

  it('recipe_link — доконаний факт, без суфікса (як і було)', () => {
    const [turn] = buildChatHistory([
      msg({ card: { type: 'recipe_link', title: 'Шакшука', recipe: { ing: [] } } as never }),
    ]);
    expect(turn!.content).toContain('[рецепт у стрічці: «Шакшука»]');
    expect(turn!.content).not.toMatch(/ЗАСТОСОВАНО/);
  });
});
