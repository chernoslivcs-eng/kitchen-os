import { describe, it, expect } from 'vitest';
import { shelfSealedDays } from '../shelf-life.js';
import { BY_KEY, CATALOG } from '@kitchen/catalog/seed';
import { GENERIC_0915 } from '@kitchen/catalog/generic-0915';

// GENERIC-0915 (власник 15.09): строк швидкопсувних загальних записів —
// консервативний, не довший за найкоротший видовий варіант групи. Правило
// строку живе в домені, тому тест тут, а не в каталозі.
describe('загальні записи · строк консервативний', () => {
  it('швидкопсувні: строк консервативний — не довший за найкоротший видовий варіант групи (sealed)', () => {
    const EXCL = new Set(['фарш', 'субпродукти', 'домашня ковбаса', 'вуха', 'напівфабрикат']);
    for (const g of GENERIC_0915.filter((x) => x.shelfGroup)) {
      const item = BY_KEY.get(g.key)!;
      const re = new RegExp(g.shelfGroup!);
      const z = item.zone_default;
      const grp = CATALOG.filter((i) => !i.key.startsWith('gen_') && re.test(i.key) && i.zone_default === z && typeof shelfSealedDays(i.key, z) === 'number' && !(g.key !== 'gen_liver' && i.categories.some((c) => EXCL.has(c))));
      expect(grp.length, g.key).toBeGreaterThan(0);
      const minSealed = Math.min(...grp.map((i) => shelfSealedDays(i.key, z) as number));
      expect(shelfSealedDays(g.key, z), `${g.key} sealed`).toBeLessThanOrEqual(minSealed);
      // opened: строк після відкриття в каталозі не живе (tags.shelf_open_days від моделі на продукті) — тут лише sealed.
    }
    // приклад власника: «Сир Моцарела» з чека не має отримати 30+ днів твердого сиру
    expect(shelfSealedDays('gen_cheese', 'fridge')).toBeLessThanOrEqual(21);
  });
});
