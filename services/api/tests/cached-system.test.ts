import { describe, it, expect } from 'vitest';
import { cachedSystem } from '../src/model.js';

// TOKEN_AUDIT п.1: системний промпт їде повним інпутом з кожним викликом.
// cache_control стоїть на СТАБІЛЬНОМУ префіксі; динаміка (комора, профіль) —
// окремим блоком без кешу. Межа ламається мовчки — тому тест.
describe('cachedSystem', () => {
  it('стабільний префікс — перший блок з cache_control ephemeral', () => {
    const blocks = cachedSystem('СТАБІЛЬНІ ПРАВИЛА', 'ДИНАМІЧНА КОМОРА');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'СТАБІЛЬНІ ПРАВИЛА',
      cache_control: { type: 'ephemeral' },
    });
    // Динаміка — БЕЗ cache_control: інакше кожен запит створює новий кеш-запис.
    expect(blocks[1]).toEqual({ type: 'text', text: 'ДИНАМІЧНА КОМОРА' });
  });

  it('без динаміки (attachment_parse) — один кешований блок', () => {
    const blocks = cachedSystem('ПОВНІСТЮ СТАТИЧНИЙ');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('порожня динаміка — не додає порожній блок', () => {
    expect(cachedSystem('X', '')).toHaveLength(1);
  });
});
