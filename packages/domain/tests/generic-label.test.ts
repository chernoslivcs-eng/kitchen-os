// «Купив мʼясо» — це не продукт, а категорія: під нею 560 позицій каталогу.
// Модель писала таку партію в комору як факт, і далі пропонувала страви з
// тим самим знанням — бо ніщо не позначало, що конкретики бракує.
//
// Позначка «?рід» у рядку партії — той самий механізм, що двічі рятував із
// алергенами й постом: правило їде РАЗОМ ІЗ ДАНИМИ, а не окремим списком
// вище. Рахує її каталог, не модель, тож ознака однакова завжди.
//
// Чого тут НЕМАЄ навмисно: рішення, коли саме питати. Це політика, вона
// живе в промпті. Тут лише вимірювання.

import { describe, it, expect } from 'vitest';
import { serializePantry, buildKitchenContext } from '../context.js';
import { categoryBreadth } from '@kitchen/catalog';
import type { PantryBatch } from '../types.js';
import type { HouseholdProduct } from '../product.js';

const HH = 'h1';
let n = 0;
function batch(label: string, product_id: string | null): PantryBatch {
  return {
    id: `b${++n}`, household_id: HH, catalog_key: null, label, zone: 'fridge',
    value: 400, unit: 'g', state: 'sealed', opened_at: null, expires_at: null,
    best_before_opened_days: null, added_at: new Date().toISOString(),
    depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false,
    last_by: null, last_action: 'add', product_id,
  };
}
function product(id: string, name: string): HouseholdProduct {
  return {
    id, household_id: HH, product: name, brand: null, variant: null,
    unit: 'g', pack_size: null, tags: {}, catalog_key: null,
    created_at: new Date().toISOString(),
  };
}

describe('міра широти назви', () => {
  it('родові слова дають кількість позицій, конкретні — null', () => {
    expect(categoryBreadth('мʼясо')).toBeGreaterThan(500);
    expect(categoryBreadth('сир')).toBeGreaterThan(200);
    // «Свинина» вужча за «мʼясо» більш ніж удвічі — саме це дає порівнювати
    // відповідь людини з тим, що було, замість «впізнано / не впізнано».
    expect(categoryBreadth('свинина')!).toBeLessThan(categoryBreadth('мʼясо')!);
    expect(categoryBreadth('камбоцола'), 'конкретний продукт').toBeNull();
    expect(categoryBreadth('крем-брускетта')).toBeNull();
  });

  it('слово, яке водночас є товаром, категорією не вважається', () => {
    // «Курка» — і категорія на 85 позицій, і «Курка ціла» в каталозі.
    // Питати «яка саме курка?» — прискіпливість, а не брак даних.
    expect(categoryBreadth('курка')).toBeNull();
  });
});

describe('позначка ?рід у рядку комори', () => {
  it('стоїть на родовій назві й відсутня на конкретній', () => {
    const prods = [product('p1', 'мʼясо'), product('p2', 'камбоцола')];
    const out = serializePantry(
      [batch('мʼясо', 'p1'), batch('камбоцола 70%', 'p2')],
      null, Date.now(), [], false, 'none', 120, prods,
    );
    const lines = out.split('\n').filter((l) => l.includes('·'));
    expect(lines.find((l) => l.includes('мʼясо')), 'родова партія').toContain('?рід');
    expect(lines.find((l) => l.includes('камбоцола')), 'конкретна партія').not.toContain('?рід');
  });

  it('міряє БАЗУ трійки, а не видиму назву з брендом', () => {
    // Видима назва «Крем-брускетта Ponti з чорних оливок» не є категорією
    // ні за яких умов; важливо, що ми дивимось саме на product трійки.
    const prods = [product('p1', 'крем-брускетта')];
    const out = serializePantry(
      [batch('Крем-брускетта Ponti з чорних оливок', 'p1')],
      null, Date.now(), [], false, 'none', 120, prods,
    );
    expect(out).not.toContain('?рід');
  });

  it('вузькі категорії не позначаються — це вже прискіпливість', () => {
    // «Ковбаса» 58 позицій, «олія» 49 — нижче порога.
    const prods = [product('p1', 'ковбаса'), product('p2', 'олія')];
    const out = serializePantry(
      [batch('ковбаса', 'p1'), batch('олія', 'p2')],
      null, Date.now(), [], false, 'none', 120, prods,
    );
    expect(out).not.toContain('?рід');
  });

  it('партія без продукту не позначається: ми просто не знаємо', () => {
    // Старі партії до трійки мають product_id: null. Мовчання чесніше за
    // здогад — інакше вся дотрійкова комора спалахнула б позначками.
    const out = serializePantry([batch('мʼясо', null)], null, Date.now(), [], false, 'none', 120, []);
    expect(out).not.toContain('?рід');
  });

  it('шапка [КОМОРА] пояснює позначку і забороняє перепитувати двічі', () => {
    // Правило мусить їхати РАЗОМ із даними — інакше воно не працює (QA5-01,
    // QA7-06, flap calendar-lent). Перевіряємо через повний контекст, бо
    // шапку збирає саме buildKitchenContext, а не serializePantry.
    const s = buildKitchenContext({
      pantry: [batch('мʼясо', 'p1')],
      products: [product('p1', 'мʼясо')],
      now: new Date('2026-09-02T12:00:00'),
    });
    expect(s, 'позначка в рядку').toContain('?рід');
    expect(s, 'пояснення в шапці').toMatch(/родовим словом/);
    expect(s, 'запобіжник від повторного питання').toMatch(/ще не питав|не питав у цій розмові/);
  });
});
