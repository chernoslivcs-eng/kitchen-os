// Динамічна частина промпту складається в ОДНОМУ місці — і це перевіряється.
//
// 03.09 складань було два: buildChatSystem і копія всередині callChat. Копія
// не передавала modes, а serializeModes віддає блок завжди — тож прод слав
// моделі «[РЕЖИМ] нічого не відкрито» навіть із відкритим кошиком. Тести
// дивились на першу копію й нічого не бачили.
//
// Цей тест не про режими. Він про те, що прод і тест дивляться на один рядок.

import { describe, it, expect } from 'vitest';
import { buildChatSystem, buildDynamicContext } from '../src/model.js';
import type { KitchenMode, HouseholdEventRow } from '@kitchen/domain';

const base = {
  user_id: 'u1',
  session_id: 's1',
  text: 'що на вечерю?',
  pantry: [],
  history: [],
};

describe('динамічний контекст — одне джерело', () => {
  it('buildChatSystem = промпт + рівно той самий динамічний блок', () => {
    const args = { ...base, modes: [] as KitchenMode[] };
    expect(buildChatSystem(args, 'ПРАВИЛА')).toBe('ПРАВИЛА' + buildDynamicContext(args));
  });

  it('відкритий кошик доходить до моделі, а не тоне між копіями', () => {
    const modes: KitchenMode[] = [{ kind: 'cart_open', label: 'кошик у Сільпо, 9 позицій', at: new Date().toISOString() }];
    const withCart = buildDynamicContext({ ...base, modes });
    expect(withCart).toContain('кошик у Сільпо');
    expect(withCart).not.toContain('нічого не відкрито');

    // І зворотне: без режимів блок чесно каже, що нічого не відкрито.
    expect(buildDynamicContext({ ...base, modes: [] })).toContain('нічого не відкрито');
  });

  it('плани дому доходять із id, якими модель їх правитиме', () => {
    const events: HouseholdEventRow[] = [{
      id: 'abcdef12-3456-7890-abcd-ef1234567890',
      household_id: 'h1', kind: 'supply', title: 'мама привезе цибулю',
      note: 'тиждень готуємо з нею', rule: { t: 'once', at: '2026-09-10', days: 7 },
      force: 'hint', restricts: null, buy: [], recipe_id: null, servings: null,
      supply: null, created_by: 'u1', source: 'user',
      expires_at: null, done_at: null, created_at: new Date().toISOString(),
    }];
    const out = buildDynamicContext({ ...base, events });
    expect(out).toContain('[ТВОЇ ПЛАНИ]');
    expect(out).toContain('мама привезе цибулю');
    expect(out).toContain('[abcdef12]');
    // Повний uuid у динамічному блоці — це токени в кожному виклику.
    expect(out).not.toContain('abcdef12-3456-7890-abcd-ef1234567890');
  });

  it('закрита й згасла подія в контекст не йдуть', () => {
    const mk = (over: Partial<HouseholdEventRow>): HouseholdEventRow => ({
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      household_id: 'h1', kind: 'custom', title: 'гості', note: null,
      rule: { t: 'once', at: '2026-09-12' }, force: 'hint', restricts: null,
      buy: [], recipe_id: null, servings: null, supply: null,
      created_by: 'u1', source: 'user', expires_at: null, done_at: null,
      created_at: new Date().toISOString(), ...over,
    });
    expect(buildDynamicContext({ ...base, events: [mk({ done_at: new Date().toISOString() })] }))
      .not.toContain('[ТВОЇ ПЛАНИ]');
    expect(buildDynamicContext({ ...base, events: [mk({ expires_at: '2020-01-01T00:00:00.000Z' })] }))
      .not.toContain('[ТВОЇ ПЛАНИ]');
  });
});
