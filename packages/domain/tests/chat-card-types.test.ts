// П4-Т5. Список типів, які парсер приймає за картку, жив у двох копіях —
// тут і в services/api/src/model.ts — і копії розійшлись: домен знав
// `recipe` та `cook_photo`, прод знав `recipe_edit`. Розійшовшись, вони
// давали різні відповіді на те саме питання, і eval перевіряв не той
// набір, що працює в проді.
//
// Тепер джерело одне. Цей тест стереже його СКЛАД: не «щоб не було
// розбіжності» (це ловить сусідній тест у services/api), а щоб набір не
// поповз мовчки. Кожне число тут — рішення, а не наслідок.

import { describe, it, expect } from 'vitest';
import { CHAT_CARD_TYPES, parseModelResponse } from '../model-response.js';

describe('склад чатового списку типів', () => {
  it('рівно вісім, і саме ці', () => {
    expect([...CHAT_CARD_TYPES].sort()).toEqual([
      'event', 'intake_diff', 'period', 'profile',
      'proposal', 'recipe', 'recipe_edit', 'shopping',
    ]);
  });

  it('cook_photo сюди не входить: його не віддає жодна модель', () => {
    // Сервер конструює його сам після готування (routes/chat.ts). У переліку
    // РОЗБОРУ він був зайвий за побудовою — розбирати нема чого.
    expect(CHAT_CARD_TYPES).not.toContain('cook_photo');
    expect(parseModelResponse('{"type":"cook_photo","run_id":"r1"}').card).toBeNull();
  });

  it('три маркери ходу сюди не входять — свідомо, до заміни на intent', () => {
    // cook_go / cart_go / retail_search_go промпт дозволяє, але вони не
    // картки, а маркери. Прибрати їх на користь поля `intent` неможливо без
    // правки промпту — отже окреме рішення й окремий бриф.
    for (const t of ['cook_go', 'cart_go', 'retail_search_go']) {
      expect(CHAT_CARD_TYPES).not.toContain(t);
    }
  });

  it('recipe_edit приймається — раніше його знав тільки прод', () => {
    const { card } = parseModelResponse('{"type":"recipe_edit","title":"Борщ","instruction":"менше солі"}');
    expect(card?.type).toBe('recipe_edit');
  });

  it('recipe приймається — раніше його знав тільки домен', () => {
    const { card } = parseModelResponse('{"type":"recipe","recipe":{"t":"Борщ"}}');
    expect(card?.type).toBe('recipe');
  });
});
