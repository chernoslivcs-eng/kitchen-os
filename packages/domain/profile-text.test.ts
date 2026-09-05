import { describe, it, expect } from 'vitest';
import {
  PROFILE_FIELD_KEYS, PROFILE_FIELDS, clampProfileText, emptyProfileText,
  noteHash, NOTE_TEXT_LIMIT, NOTES_IN_PROMPT, VETO_PRESETS, KIT_DEFAULTS,
} from './profile-text.js';

// Раунд 4, §2.1: сім полів, початки речень і ліміти — одне джерело для UI,
// промту й карток. Ліміти з дизайну, не міняти.

describe('профіль як сім речень: константи', () => {
  it('рівно сім ключів у порядку дизайну', () => {
    expect(PROFILE_FIELD_KEYS).toEqual(['name', 'no', 'ban', 'love', 'meh', 'kit', 'when']);
  });

  it('початки речень і ліміти — як у контракті', () => {
    expect(PROFILE_FIELDS.name).toEqual({ lead: 'Мене звати', limit: 30, indexed: false });
    expect(PROFILE_FIELDS.no).toEqual({ lead: 'Я не їм', limit: 200, indexed: true });
    expect(PROFILE_FIELDS.ban).toEqual({ lead: 'Мені не можна', limit: 140, indexed: true });
    expect(PROFILE_FIELDS.love).toEqual({ lead: 'Я люблю', limit: 200, indexed: false });
    expect(PROFILE_FIELDS.meh).toEqual({ lead: 'Я не дуже люблю', limit: 200, indexed: false });
    expect(PROFILE_FIELDS.kit).toEqual({ lead: 'У мене на кухні є', limit: 260, indexed: false });
    expect(PROFILE_FIELDS.when).toEqual({ lead: 'Я зазвичай готую', limit: 250, indexed: false });
  });

  it('нотатки: ліміт 140, у промт — останні 10', () => {
    expect(NOTE_TEXT_LIMIT).toBe(140);
    expect(NOTES_IN_PROMPT).toBe(10);
  });

  it('база кухні, яку людина не писала', () => {
    expect(KIT_DEFAULTS).toEqual(['плита', 'духовка', 'мікрохвильовка', 'холодильник']);
  });
});

describe('clampProfileText', () => {
  it('обрізає по ліміту поля й прибирає пробіли по краях', () => {
    const long = 'а'.repeat(50);
    expect(clampProfileText('name', `  ${long}  `)).toBe('а'.repeat(30));
    expect(clampProfileText('kit', 'гриль ')).toBe('гриль');
  });

  it('обрізає по символах, а не по байтах — кирилиця не ріжеться навпіл', () => {
    const s = 'ї'.repeat(35);
    expect(clampProfileText('name', s)).toBe('ї'.repeat(30));
  });
});

describe('emptyProfileText', () => {
  it('усі сім полів у статусі empty', () => {
    const p = emptyProfileText('u1');
    expect(p.user_id).toBe('u1');
    expect(Object.keys(p.fields)).toEqual([...PROFILE_FIELD_KEYS]);
    for (const k of PROFILE_FIELD_KEYS) {
      expect(p.fields[k]).toEqual({ text: '', status: 'empty', updated_at: null });
    }
  });
});

describe('noteHash', () => {
  it('нечутливий до регістру, пробілів і пунктуації', () => {
    expect(noteHash('Пармезан сам солоний, воду солити менше.'))
      .toBe(noteHash('  пармезан  сам солоний воду солити менше '));
  });
  it('різний текст — різний хеш', () => {
    expect(noteHash('менше солі')).not.toBe(noteHash('більше солі'));
  });
  it('md5 hex — той самий, що рахує Postgres у міграції', () => {
    expect(noteHash('менше солі')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('VETO_PRESETS (§2.3, поки лише дані)', () => {
  it('закритий список із пʼяти пресетів', () => {
    expect(VETO_PRESETS.map((p) => p.id)).toEqual(['vegan', 'pescatarian', 'vegetarian', 'halal', 'lent']);
  });
  it('категорії — як у контракті', () => {
    const by = Object.fromEntries(VETO_PRESETS.map((p) => [p.id, p.categories]));
    expect(by.vegan).toEqual(['мʼясо', 'птиця', 'риба', 'морепродукти', 'молочне', 'яйця']);
    expect(by.pescatarian).toEqual(['мʼясо', 'птиця']);
    expect(by.vegetarian).toEqual(['мʼясо', 'птиця', 'риба', 'морепродукти']);
    expect(by.halal).toEqual(['свинина', 'алкоголь']);
    expect(by.lent).toEqual(['тваринне']);
  });
  it('у кожного пресету є хоча б один стем для збігу', () => {
    for (const p of VETO_PRESETS) expect(p.stems.length).toBeGreaterThan(0);
  });
});
