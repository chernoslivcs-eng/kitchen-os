// resolveTripleKey: вид ЗАВЖДИ бʼє загальний запис.
//
// CI packages/db (decideKey) після GENERIC-0915: база трійки «вершки» тепер
// резолвиться в gen_cream і повна назва «вершки 33%» уже не читалась — а вона
// дає вид. Той самий шлях у ensureProduct, бекфілі й rekey.
import { describe, expect, it } from 'vitest';
import { resolveTripleKey, resolveLabelToKey } from '../logic.js';

describe('resolveTripleKey: вид після бази з gen_*', () => {
  it.each([
    ['вершки', 'вершки 33%', 'cream_33'],
    ['пиво', 'пиво Kronenbourg Blanc', 'alc_beer_wheat'],
    ['рис', 'рис арборіо', 'grain_rice_arborio'],
    ['сир плавлений', 'сир плавлений Viola', 'cheese_processed_tub'],
  ])('%s + «%s» → %s', (product, dn, key) => {
    expect(resolveLabelToKey(product)?.startsWith('gen_'), 'база дає gen_*').toBe(true);
    expect(resolveTripleKey(product, dn)).toBe(key);
  });

  it('база мовчить — повна назва дає вид', () => {
    expect(resolveLabelToKey('чіпси')).toBeNull();
    expect(resolveTripleKey('чіпси', "чіпси Lay's сир")).toBe('chips_cheese');
  });

  it('повна назва без виду — лишається загальний запис бази', () => {
    expect(resolveTripleKey('вершки', 'вершки Ферма')).toBe('gen_cream');
    expect(resolveTripleKey('рис', 'рис')).toBe('gen_rice');
  });

  it('база дала вид — повна назва не переважує', () => {
    expect(resolveTripleKey('помідори чері', 'помідори чері Гордій')).toBe('veg_tomato_cherry');
  });

  it('нічого не впізнано — null', () => {
    expect(resolveTripleKey('щось незрозуміле', 'щось незрозуміле Brand')).toBeNull();
  });

  it('тир generic — та сама перевага виду', () => {
    expect(resolveTripleKey('вершки', 'вершки 33%', 'generic')).toBe('cream_33');
  });
});
