import { describe, it, expect } from 'vitest';
import { resolveLabelToKey, categoriesCompatible } from '../logic.js';
import { BY_KEY } from '../seed.js';

// Живий репро 01.09 (гілка prompt/role-layer): на кухонне питання «які ще
// опції в сільпо є по тоніках?» видача складалась ВИКЛЮЧНО з косметики —
// тонік для обличчя Equilibra, Dr.Sante, Hollyskin, засіб Nard від випадіння
// волосся. Жодного напою, хоча Schweppes у Сільпо є.
//
// Корінь — НЕ у фільтрі. Фільтр спроєктований правильно: 'нехарчове' уже
// стоїть у EXCLUSIVE_ROOTS саме після попереднього репро з косметикою. Він
// просто ніколи не спрацьовував, бо косметика приходила до нього ВЖЕ
// позначеною як напій: у каталозі є шампунь, гель для душу й крем для рук,
// але немає тоніка для обличчя — а слово «тонік» належить напою. Підстрокове
// правило резолвера (score 60 + довжина збігу) дає «тонік» 65 балів, і
// «Тонік для обличчя Equilibra» стає drink_tonic.
//
// Наслідок був ширший за пошук: той самий резолвер вирішує, що класти в
// комору з чеків (receipt-intake.ts). Куплений тонік для обличчя лягав у
// комору в зону drinks — асистент міг запропонувати його випити.

const FACE_TONICS = [
  'Тонік для обличчя Equilibra очищуючий з алое',
  'Тонік для обличчя Hollyskin з гліколевою кислотою',
  'Тонік для обличчя Izeze Hyper CMA Cica заспокійливий',
  'тонік для обличчя',
];

const HAIR_TONICS = [
  'Тонік Nard для контролю випадіння волосся',
  'тонік для волосся',
];

describe('косметичний тонік — не напій', () => {
  it('тонік для обличчя резолвиться в нехарчове, а не в drink_tonic', () => {
    for (const name of FACE_TONICS) {
      const key = resolveLabelToKey(name);
      expect(key, name).not.toBe('drink_tonic');
      expect(BY_KEY.get(key!)?.categories, name).toContain('нехарчове');
    }
  });

  it('тонік для волосся — так само', () => {
    for (const name of HAIR_TONICS) {
      const key = resolveLabelToKey(name);
      expect(key, name).not.toBe('drink_tonic');
      expect(BY_KEY.get(key!)?.categories, name).toContain('нехарчове');
    }
  });

  // Головне, заради чого все: фільтр видачі тепер має ЩО відсіювати.
  it('на запит про напій косметика відсіюється як категорично інший товар', () => {
    const drinkCats = BY_KEY.get(resolveLabelToKey('тонік')!)?.categories ?? [];
    for (const name of [...FACE_TONICS, ...HAIR_TONICS]) {
      const candCats = BY_KEY.get(resolveLabelToKey(name)!)?.categories ?? [];
      expect(categoriesCompatible(drinkCats, candCats), name).toBe(false);
    }
  });

  // Регресія: напій мусить лишитись напоєм. Довший аліас косметики не сміє
  // перетягнути на себе Schweppes чи звичайний тонік.
  it('справжні тоніки-напої не зачеплені', () => {
    expect(resolveLabelToKey('тонік')).toBe('drink_tonic');
    expect(resolveLabelToKey('Напій Schweppes Pink Tonic б/алк сил/газ скло')).toBe('drink_schweppes');
    expect(resolveLabelToKey('Schweppes Indian Tonic')).toBe('drink_schweppes');
    const drinkCats = BY_KEY.get('drink_tonic')?.categories ?? [];
    const schweppes = BY_KEY.get('drink_schweppes')?.categories ?? [];
    expect(categoriesCompatible(drinkCats, schweppes)).toBe(true);
  });
});
