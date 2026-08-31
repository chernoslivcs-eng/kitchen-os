// Черга Д (правка №2): «продукт дому» — трійка product·brand·variant.
// Суворий збіг: інший бренд = інший продукт. Видима назва ФОРМУЄТЬСЯ з
// трійки; нормалізація ловить регістр/пробіли, але не «схожість».

import { describe, it, expect } from 'vitest';
import { normalizeTriple, tripleKey, displayName, catalogGroupsToAllergens } from './product.js';

describe('normalizeTriple', () => {
  it('трімить, стискає пробіли, порожнє → null', () => {
    expect(normalizeTriple({ product: '  Пармезан  ', brand: ' Galbani ', variant: '' }))
      .toEqual({ product: 'Пармезан', brand: 'Galbani', variant: null });
    expect(normalizeTriple({ product: 'молоко  селянське', brand: undefined, variant: '  ' }))
      .toEqual({ product: 'молоко селянське', brand: null, variant: null });
  });
});

describe('tripleKey — суворий збіг без регістру', () => {
  it('той самий продукт у різному регістрі — один ключ', () => {
    const a = tripleKey({ product: 'Пармезан', brand: 'Galbani', variant: null });
    const b = tripleKey({ product: 'пармезан', brand: 'GALBANI', variant: null });
    expect(a).toBe(b);
  });
  it('інший бренд = інший продукт', () => {
    const a = tripleKey({ product: 'пармезан', brand: 'Galbani', variant: null });
    const b = tripleKey({ product: 'пармезан', brand: 'Dobriana', variant: null });
    const c = tripleKey({ product: 'пармезан', brand: null, variant: null });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
  it('інший variant = інший продукт', () => {
    expect(tripleKey({ product: 'пармезан', brand: 'Galbani', variant: 'тертий' }))
      .not.toBe(tripleKey({ product: 'пармезан', brand: 'Galbani', variant: null }));
  });
});

describe('displayName — назва формується з трійки', () => {
  it('склеює наявні частини', () => {
    expect(displayName({ product: 'пармезан', brand: 'Galbani', variant: 'тертий' }))
      .toBe('пармезан Galbani тертий');
    expect(displayName({ product: 'молоко', brand: null, variant: '2.5%' }))
      .toBe('молоко 2.5%');
    expect(displayName({ product: 'сіль', brand: null, variant: null })).toBe('сіль');
  });
});

describe('normalizeTriple: плейсхолдери моделі — це null', () => {
  it('«не видно», «невідомо», «-» не стають брендом', () => {
    for (const junk of ['не видно', 'невідомо', 'невідомий', 'unknown', 'null', '-', '—', 'n/a']) {
      expect(normalizeTriple({ product: 'молоко', brand: junk, variant: junk }).brand).toBe(null);
    }
    expect(normalizeTriple({ product: 'молоко', brand: 'Galbani' }).brand).toBe('Galbani');
  });
});

// Каталог, крок 3: групи каталогу → канонічні теги тегера. Словники трьох
// систем (каталог «молочне», тегер «молоко», профіль «лактоза») мусять
// бачити одне одного — місток зводить їх до тегерових канонів.
describe('catalogGroupsToAllergens', () => {
  it('зводить синоніми до канону тегера', () => {
    expect(catalogGroupsToAllergens(['молочне', 'лактоза'])).toEqual(['молоко']);
    expect(catalogGroupsToAllergens(['глютен', 'яйця'])).toEqual(['глютен', 'яйця']);
    expect(catalogGroupsToAllergens(['молюски', 'морепродукти', 'ракоподібні']))
      .toEqual(['молюски', 'морепродукти', 'ракоподібні']);
  });
  it('порожнє і невідоме — без вигадок', () => {
    expect(catalogGroupsToAllergens([])).toEqual([]);
    expect(catalogGroupsToAllergens(['щось-нове'])).toEqual(['щось-нове']);
  });
});
