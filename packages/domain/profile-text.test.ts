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

// ----- Крок 3: серіалізація §3 ----------------------------------------------

import { serializeProfileText, profileTextFromLegacy, profileNotesFromLegacy, appendProfileText } from './profile-text.js';

const owner = (): ReturnType<typeof emptyProfileText> => {
  const p = emptyProfileText('u1');
  const f = (text: string) => ({ text, status: 'filled' as const, updated_at: '2026-09-05T00:00:00.000Z' });
  p.fields.name = f('Пилип');
  p.fields.no = f('мʼяса, птиці, риби, яєць і молочного. Кінзу не беру');
  p.fields.ban = { text: '', status: 'none', updated_at: '2026-09-05T00:00:00.000Z' };
  p.fields.love = f('тайську кухню, помідори, супи');
  p.fields.meh = f('готувати великими порціями. Гостре — без фанатизму');
  p.fields.kit = f('гриль, блендер, занурювальний блендер, тостер, фритюрниця');
  p.fields.when = f('ввечері, на одного-двох, з того, що є. До години — норм, довше — тільки на вихідних');
  return p;
};

describe('serializeProfileText (§3 дослівно)', () => {
  it('блок [ПРО ЛЮДИНУ] і [НОТАТКИ] — рядок у рядок як у контракті', () => {
    const notes = [
      { id: 'n2', user_id: 'u1', subject: null, text: 'Феттучіне вийшли пересолені: пармезан сам солоний, воду солити менше.', source: 'assistant' as const, created_at: '2026-09-04T10:00:00.000Z', deleted_at: null, norm_hash: 'x' },
      { id: 'n1', user_id: 'u1', subject: null, text: 'Духовка гріє градусів на 20 сильніше, ніж показує.', source: 'assistant' as const, created_at: '2026-09-02T10:00:00.000Z', deleted_at: null, norm_hash: 'y' },
    ];
    expect(serializeProfileText(owner(), notes)).toBe(
      '\n\n[ПРО ЛЮДИНУ — її власні слова]\n'
      + 'Мене звати Пилип.\n'
      + 'Я не їм мʼяса, птиці, риби, яєць і молочного. Кінзу не беру.\n'
      + 'Мені не можна — нічого такого.\n'
      + 'Я люблю тайську кухню, помідори, супи.\n'
      + 'Я не дуже люблю готувати великими порціями. Гостре — без фанатизму.\n'
      + 'У мене на кухні є гриль, блендер, занурювальний блендер, тостер, фритюрниця. (Плита, духовка, мікрохвильовка, холодильник — є за замовчуванням.)\n'
      + 'Я зазвичай готую ввечері, на одного-двох, з того, що є. До години — норм, довше — тільки на вихідних.\n'
      + '\n[НОТАТКИ — записав сам після розмов і готувань]\n'
      + '04.09 — Феттучіне вийшли пересолені: пармезан сам солоний, воду солити менше.\n'
      + '02.09 — Духовка гріє градусів на 20 сильніше, ніж показує.',
    );
  });

  it('empty пропускається; порожній профіль — блок присутній і каже, що не питали', () => {
    const p = emptyProfileText('u1');
    p.fields.love = { text: 'супи', status: 'filled', updated_at: null };
    const s = serializeProfileText(p, []);
    expect(s).toContain('[ПРО ЛЮДИНУ — її власні слова]\nЯ люблю супи.\n');
    expect(s).not.toContain('Мене звати');
    expect(s).not.toContain('Я не їм');
    expect(s).toContain('[НОТАТКИ — записав сам після розмов і готувань] порожньо');

    const e = serializeProfileText(emptyProfileText('u1'), []);
    expect(e).toContain('[ПРО ЛЮДИНУ — її власні слова] порожньо');
    expect(e).toContain('ще не питали');
  });

  it('kit: дужка про базу — завжди, і тільки в kit; текст із крапкою в кінці не подвоює крапку', () => {
    const p = emptyProfileText('u1');
    p.fields.kit = { text: 'гриль.', status: 'filled', updated_at: null };
    p.fields.no = { text: 'кінзи.', status: 'filled', updated_at: null };
    const s = serializeProfileText(p, []);
    expect(s).toContain('У мене на кухні є гриль. (Плита, духовка, мікрохвильовка, холодильник — є за замовчуванням.)');
    expect(s).toContain('Я не їм кінзи.\n');
    expect(s).not.toContain('кінзи..');
  });

  it('у промт ідуть не більше 10 нотаток, видалені — ні', () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`, user_id: 'u1', subject: null, text: `нотатка ${i}`, source: 'assistant' as const,
      created_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), deleted_at: i === 11 ? '2026-09-05T00:00:00.000Z' : null, norm_hash: `h${i}`,
    })).reverse();
    const s = serializeProfileText(emptyProfileText('u1'), notes);
    expect(s).not.toContain('нотатка 11');
    expect(s).toContain('нотатка 10');
    expect(s).toMatch(/нотатка 1$/m);
    expect(s).not.toMatch(/нотатка 0$/m);
  });
});

describe('profileTextFromLegacy — TS-двійник міграції 0023', () => {
  it('прод-профіль власника → ті самі поля, що дала SQL-міграція', () => {
    const p = profileTextFromLegacy({
      user_id: 'u1', allergies: [], wishes: ['веганство', 'весь наступний тиждень їсти рибу'],
      antipatterns: ['кінза', 'не їм мʼяса, птиці, риби, яєць і молочного', 'не їм риби'],
      equipment: { 'гриль': 'has', 'блендер': 'has', 'мікрохвильовка': 'has', 'занурювальний блендер': 'has' },
      traditions: null,
    });
    expect(p.fields.no).toMatchObject({ text: 'кінза. не їм мʼяса, птиці, риби, яєць і молочного. не їм риби. веганство', status: 'filled' });
    expect(p.fields.love).toMatchObject({ text: 'весь наступний тиждень їсти рибу', status: 'filled' });
    expect(p.fields.kit).toMatchObject({ text: 'блендер, гриль, занурювальний блендер, мікрохвильовка', status: 'filled' });
    expect(p.fields.ban.status).toBe('empty');
    expect(p.fields.name.status).toBe('empty');
  });

  it('алергії через кому в ban; lacks → «Немає: …»; порожній профіль → усе empty', () => {
    const p = profileTextFromLegacy({
      user_id: 'u1', allergies: ['арахіс', 'селера'], wishes: [], antipatterns: [],
      equipment: { 'гриль': 'has', 'духовка': 'lacks' },
    });
    expect(p.fields.ban.text).toBe('арахіс, селера');
    expect(p.fields.kit.text).toBe('гриль. Немає: духовка');
    const e = profileTextFromLegacy(null);
    for (const k of PROFILE_FIELD_KEYS) expect(e.fields[k].status).toBe('empty');
  });

  it('нотатки: lesson → як є, intent → «хотів: …», хеш той самий', () => {
    const ns = profileNotesFromLegacy([
      { id: 'a', user_id: 'u1', text: 'менше солі', recipe_title: null, rating: null, pinned: false, created_at: '2026-09-01T00:00:00.000Z' },
      { id: 'b', user_id: 'u1', text: 'тунець → seared', recipe_title: null, rating: null, pinned: true, created_at: '2026-09-02T00:00:00.000Z', kind: 'intent' },
    ]);
    expect(ns.map((n) => n.text)).toEqual(['менше солі', 'хотів: тунець → seared']);
    expect(ns[1]).toMatchObject({ id: 'b', source: 'user', deleted_at: null, norm_hash: noteHash('хотів: тунець → seared') });
  });
});

describe('appendProfileText', () => {
  it('дописує через «. », не подвоює крапку, ріже по ліміту й каже, що не влізло', () => {
    expect(appendProfileText('no', 'кінзи.', 'селери')).toEqual({ text: 'кінзи. селери', truncated: false });
    expect(appendProfileText('no', '', 'селери')).toEqual({ text: 'селери', truncated: false });
    const r = appendProfileText('name', 'Пилип', 'Білянський-Дуже-Довге-Прізвище-Понад-Ліміт');
    expect(r.text).toBe(clampProfileText('name', 'Пилип. Білянський-Дуже-Довге-Прізвище-Понад-Ліміт'));
    expect(r.truncated).toBe(true);
  });
});

// ----- Крок 4 (a): адаптер картки поля → ops-картка v1 під вимкненим прапором

import { legacyOpsFromFieldCard } from './profile-text.js';

describe('legacyOpsFromFieldCard — прапор як відкат на проді', () => {
  const ops = (field: string, text: string) => legacyOpsFromFieldCard({ type: 'profile', field: field as never, mode: 'append', text }).ops;

  it('no і meh → anti; ban → allergy; love → wish', () => {
    expect(ops('no', 'мʼяса й птиці')).toEqual([{ op: 'add', kind: 'anti', label: 'мʼяса й птиці' }]);
    expect(ops('meh', 'гостре')).toEqual([{ op: 'add', kind: 'anti', label: 'гостре' }]);
    expect(ops('ban', 'арахіс, селера')).toEqual([{ op: 'add', kind: 'allergy', label: 'арахіс' }, { op: 'add', kind: 'allergy', label: 'селера' }]);
    expect(ops('love', 'тайську кухню')).toEqual([{ op: 'add', kind: 'wish', label: 'тайську кухню' }]);
  });

  it('kit → equip по комах; «Немає: …» → note', () => {
    expect(ops('kit', 'гриль, блендер. Немає: духовка')).toEqual([
      { op: 'add', kind: 'equip', label: 'гриль', has: true },
      { op: 'add', kind: 'equip', label: 'блендер', has: true },
      { op: 'add', kind: 'note', label: 'Немає: духовка' },
    ]);
  });

  it('name, when → note з початком речення', () => {
    expect(ops('name', 'Пилип')).toEqual([{ op: 'add', kind: 'note', label: 'Мене звати Пилип' }]);
    expect(ops('when', 'ввечері')).toEqual([{ op: 'add', kind: 'note', label: 'Я зазвичай готую ввечері' }]);
  });

  it('порожній текст → порожні ops', () => {
    expect(ops('no', '  ')).toEqual([]);
  });
});
