import { describe, it, expect } from 'vitest';
import {
  serializeShopping, serializeEaters,
  serializeRecentRecipes, buildKitchenContext,
} from '../context.js';
import { serializeProfileText, emptyProfileText } from '../profile-text.js';
import type { ShoppingItemRow } from '../types.js';

// M13-ROLE-VOICE п.1. Порожній блок і ВІДСУТНІЙ блок — різні речі.
//
// «Скільки води в склянці?» — «склянка порожня» це відповідь. Склянки немає
// взагалі — питання втрачає ґрунт, і модель добудовує стан із розмови.
//
// [КОМОРА] присутня завжди і несе шапку «ПОВНИЙ перелік станом на зараз».
// Решта блоків при порожньому значенні зникали безслідно — і найсильніший
// захист від вигадок стояв рівно на єдиному блоці, який ніколи не зникає.
// role.md при цьому наказує «подивись у блок» і забороняє казати «блок
// порожній»: модель посилали до джерела, якого немає, і забороняли зізнатись.

function item(over: Partial<ShoppingItemRow> = {}): ShoppingItemRow {
  return {
    id: 's1', household_id: 'h1', label: 'молоко', reason: null,
    value: 1, unit: 'l', zone: null, checked: false, added_by: null,
    source: 'user', created_at: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

describe('[СПИСОК ПОКУПОК] присутній завжди', () => {
  it('порожній список — блок є і прямо каже, що порожньо', () => {
    const s = serializeShopping([]);
    expect(s).toContain('[СПИСОК ПОКУПОК]');
    expect(s).toMatch(/порожн/i);
  });

  it('непорожній список серіалізується як раніше', () => {
    const s = serializeShopping([item()]);
    expect(s).toContain('[СПИСОК ПОКУПОК]');
    expect(s).toContain('молоко');
    expect(s).not.toMatch(/порожн/i);
  });
});

// Профіль — окремо від решти блоків, бо тут порожнеча коштує найдорожче.
// «Ще не записано» і «обмежень немає» — різні твердження, і друге модель не
// має права вивести з першого: людину могли просто не встигти спитати (саме
// на порожньому профілі вмикається онбординг stage 2). Ціна помилки — алерген
// у пропозиції.
describe('[ПРО ЛЮДИНУ] присутній завжди', () => {
  it('профілю ще немає — блок є і каже, що порожньо', () => {
    const s = buildKitchenContext({ pantry: [], now: new Date('2026-09-01T12:00:00') });
    expect(s).toContain('[ПРО ЛЮДИНУ');
    expect(s).toMatch(/порожн|не казала/i);
  });

  it('усі поля порожні — той самий результат', () => {
    const s = serializeProfileText(emptyProfileText('u1'), []);
    expect(s).toContain('[ПРО ЛЮДИНУ');
    expect(s).toMatch(/порожн|не казала/i);
  });

  it('порожній профіль НЕ читається як підтверджена відсутність обмежень', () => {
    const s = serializeProfileText(emptyProfileText('u1'), []);
    expect(s).toMatch(/ще не питали|не означає/i);
  });

  it('заповнене поле серіалізується словами людини', () => {
    const p = emptyProfileText('u1');
    p.fields.ban = { text: 'арахісу', status: 'filled', updated_at: null };
    const s = serializeProfileText(p, []);
    expect(s).toContain('арахісу');
    expect(s).not.toMatch(/\[ПРО ЛЮДИНУ[^\]]*\] порожн/i);
  });
});

describe('решта стан-блоків присутні завжди', () => {
  it('[ДОМАШНІ] — порожньо означає «крім власника нікого не записано»', () => {
    const s = serializeEaters([]);
    expect(s).toContain('[ДОМАШНІ]');
    expect(s).toMatch(/не записано/i);
  });

  it('[ЗГЕНЕРОВАНІ РЕЦЕПТИ] — порожньо', () => {
    const s = serializeRecentRecipes([]);
    expect(s).toContain('[ЗГЕНЕРОВАНІ РЕЦЕПТИ]');
    expect(s).toMatch(/не генерував|порожн/i);
  });

  // kitchen-policy наказує не дублювати те, що вже в [НОТАТКИ]. Без блока
  // модель не мала з чим звірятись — і пропонувала дублі.
  it('[НОТАТКИ] — порожньо при порожньому вході', () => {
    const s = serializeProfileText(emptyProfileText('u1'), []);
    expect(s).toContain('[НОТАТКИ');
    expect(s).toMatch(/нотаток ще немає|порожн/i);
  });

  it('[ОСТАННІ ГОТУВАННЯ] — порожньо в повному контексті', () => {
    const s = buildKitchenContext({ pantry: [], now: new Date('2026-09-01T12:00:00') });
    expect(s).toContain('[ОСТАННІ ГОТУВАННЯ]');
    expect(s).toMatch(/жодного|ще не готув|порожн/i);
  });
});

// 8b: мовчазне обрізання. Комора чесна — показує 120 рядків і додає «…і ще N
// позицій — спитай, якщо треба». Рецепти капляться на 5, і модель бачить
// обрізане як ПОВНЕ.
describe('обрізані блоки кажуть, що вони обрізані', () => {
  it('[ЗГЕНЕРОВАНІ РЕЦЕПТИ] — хвіст, коли є ще', () => {
    const row = { id: 'r1', owner_id: 'u1', origin: 'generated', title: 'Карі', payload: null } as never;
    expect(serializeRecentRecipes([row], true)).toMatch(/є й інші|ще|спитай/i);
    expect(serializeRecentRecipes([row], false)).not.toMatch(/є й інші|спитай/i);
  });
});
