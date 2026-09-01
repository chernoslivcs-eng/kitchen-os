import { describe, it, expect } from 'vitest';
import { detectModes, serializeModes } from '../modes.js';
import type { MessageRow } from '../types.js';
import type { RecentCookRunSummary } from '../context.js';

// №4 з дорожньої карти. M13-ROLE-VOICE п.3, живий репро: посеред збірки
// кошика людина каже «хочу колу додати» — система веде це через список
// покупок і пропонує зібрати кошик заново, замість розширити відкритий.
//
// Корінь: модель не знає, в якій ситуації вона є. Стенограма розмови в неї є,
// відчуття «що ми зараз робимо» — немає. Сервер при цьому знає: рядок
// `listMessages(...).some(m => m.card?.type === 'cart')` уже існує в chat.ts,
// але живе всередині гілки видалення й нікому не повідомляється.
//
// Патерн у системі вже працює двічі — `stage` в онбордингу і детермінований
// пост-готування автомат. Це третє застосування перевіреного.

// Локальний час: рендер у modes.ts іде через getHours(), як усі мітки часу
// в цьому репозиторії. Фікстура в UTC давала б зсув на таймзону машини.
const T = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 8, 2, h!, m!).toISOString();
};

function msg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1', session_id: 's1', role: 'assistant',
    text: null, card: null, applied: 0, created_at: T('12:00'),
    ...over,
  };
}

const cart = (id: string, at: string, found = 9) => msg({
  id, created_at: at,
  card: { type: 'cart', provider: 'silpo', list_label: null, rows: [], total: 412, found, of: found, cart_url: 'https://silpo.ua' },
});

const recipeLink = (id: string, at: string, title: string) => msg({
  id, created_at: at,
  card: { type: 'recipe_link', recipe_id: 'r1', title, recipe: { t: title, sv: 2, tm: 30, ch: 'швидко', d: 'смак', rk: 'помилка', ing: [], st: [] } },
});

function run(over: Partial<RecentCookRunSummary> = {}): RecentCookRunSummary {
  return { title: 'Паста', rating: null, verdict: null, finished_at: T('09:00'), ...over };
}

const NOW = new Date(T('18:00'));

describe('детекція режимів', () => {
  it('нічого не відкрито — жодного режиму', () => {
    expect(detectModes([], [], NOW)).toEqual([]);
  });

  it('кошик у сесії — режим cart_open з часом збірки', () => {
    const m = detectModes([msg({ text: 'привіт' }), cart('c1', T('17:40'))], [], NOW);
    expect(m).toHaveLength(1);
    expect(m[0]!.kind).toBe('cart_open');
    expect(m[0]!.ref).toBe('c1');
    expect(m[0]!.at).toBe(T('17:40'));
  });

  it('кілька кошиків — відкритий лише ОСТАННІЙ', () => {
    const m = detectModes([cart('c1', T('14:00')), cart('c2', T('17:40'))], [], NOW);
    expect(m.filter((x) => x.kind === 'cart_open')).toHaveLength(1);
    expect(m[0]!.ref).toBe('c2');
  });

  it('рецепт у стрічці — режим recipe_fresh із назвою', () => {
    const m = detectModes([recipeLink('r1', T('16:00'), 'Карі з куркою')], [], NOW);
    expect(m[0]!.kind).toBe('recipe_fresh');
    expect(m[0]!.label).toContain('Карі з куркою');
  });

  // Власник: режими накладаються «завжди», впорядковані за свіжістю.
  it('кошик і рецепт разом — новіший перший', () => {
    const m = detectModes([cart('c1', T('17:40')), recipeLink('r1', T('16:00'), 'Карі')], [], NOW);
    expect(m.map((x) => x.kind)).toEqual(['cart_open', 'recipe_fresh']);
  });

  // Це живило блок «ОЦІНИ ВЧОРАШНЄ» в панелі; панель зрізу позбувається,
  // тож факт мусить дійти до моделі, інакше він просто зникне з продукту.
  it('незакрите готування молодше 48 год — режим unrated_run', () => {
    const m = detectModes([], [run({ title: 'Різото', finished_at: T('09:00') })], NOW);
    expect(m[0]!.kind).toBe('unrated_run');
    expect(m[0]!.label).toContain('Різото');
  });

  it('оцінене готування режиму не дає', () => {
    expect(detectModes([], [run({ rating: 4 })], NOW)).toEqual([]);
  });

  it('готування старше 48 год режиму не дає', () => {
    expect(detectModes([], [run({ finished_at: new Date(2026, 7, 28, 9, 0).toISOString() })], NOW)).toEqual([]);
  });
});

describe('серіалізація режимів', () => {
  it('порожньо — блок ПРИСУТНІЙ і каже, що нічого не відкрито', () => {
    const s = serializeModes([]);
    expect(s).toContain('[РЕЖИМ]');
    expect(s).toMatch(/нічого не відкрито|порожн/i);
  });

  it('кошик — правило розширення сказане прямо, не натяком', () => {
    const s = serializeModes(detectModes([cart('c1', T('17:40'))], [], NOW));
    expect(s).toContain('[РЕЖИМ]');
    expect(s).toMatch(/розширю/i);
    expect(s).toMatch(/не.*заново/i);
  });

  it('час збірки видно — модель сама зважує свіжість', () => {
    const s = serializeModes(detectModes([cart('c1', T('17:40'))], [], NOW));
    expect(s).toContain('17:40');
  });
});

// 8b/дизайн панелі: «оціни вчорашнє» переїжджає зі зрізу правої панелі в
// розмову. Асистент першим НЕ пише (перевірено: механізму немає), тож єдине
// місце, де це може прозвучати, — його перша відповідь у сесії. Там правило
// сильніше; далі в розмові — м'якше, щоб не нудити.
describe('unrated_run на початку сесії', () => {
  const NOW2 = new Date(T('18:00'));

  // Маркер навмисно однозначний: перша версія тесту ловила слово «першим» із
  // шапки блока й була зеленою без жодної реалізації.
  it('сесія щойно почалась — правило вимагає спитати', () => {
    const s = serializeModes(detectModes([], [run({ title: 'Різото' })], NOW2));
    expect(s).toContain('ПОЧАТОК СЕСІЇ');
  });

  it('розмова вже йде — вимоги немає, лише дозвіл', () => {
    const s = serializeModes(detectModes([msg({ text: 'привіт' })], [run({ title: 'Різото' })], NOW2));
    expect(s).toContain('Різото');
    expect(s).not.toContain('ПОЧАТОК СЕСІЇ');
  });
});
