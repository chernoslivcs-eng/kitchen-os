// Б0: коли строки зʼявились на ВСІХ партіях, ярус «термінові» розростається —
// і може зʼїсти кеп 120 раніше, ніж до нього дійде ярус «квота залежаним»
// (10 найстаріших позицій, `context.ts`). Саме від них будуються мости
// «що купити?»: сортування за свіжістю ховало їх першими, тому квоту й завели.
//
// Тест стереже одне твердження: на коморі реального розміру квота ЖИВА.
// Абсолютна кількість термінових тут навмисно не закріплюється — вона попливе
// від таблиці зон, і тест почав би падати від правильних змін. Цінне тут те,
// що залежані доїжджають, а не скільки саме позицій горить.
//
// Виміряний обрив (борг №18, не лікується всередині цієї задачі): 400 позицій
// — квота ціла, 500 — лишається 2 з 10, 600 — нуль. Симуляція рахувала нуль
// позначених (⚠алерген/⚠піст), а вони йдуть поза кепом, тож справжній обрив
// ближчий.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { serializePantry } from '../context.js';
import type { PantryBatch, Zone } from '../types.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const CAP = 120;
const IDLE_QUOTA = 10;

// Частки зон — з живої комори проду (246 активних партій, 09.09.2026).
const ZONE_MIX: [Zone, number][] = [
  ['dry', 98 / 246], ['fridge', 62 / 246], ['drinks', 31 / 246],
  ['fresh', 24 / 246], ['freezer', 20 / 246], ['spices', 11 / 246],
];

// Скільки живе запечатана партія в зоні. Числа тут — САМОСТІЙНІ від
// ZONE_SHELF_DAYS: тест перевіряє відбір під кеп, а не таблицю. Інакше правка
// таблиці мовчки міняла б те, що стереже цей тест.
const SIM_SHELF: Record<Zone, number> = {
  fresh: 7, fridge: 21, freezer: 270, dry: 540, spices: 1095, drinks: 365,
};

function pantry(n: number): PantryBatch[] {
  // Детермінований ГПВЧ — комора та сама в кожному прогоні.
  let seed = 20260909;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pickZone = (): Zone => {
    const r = rnd();
    let acc = 0;
    for (const [z, p] of ZONE_MIX) { acc += p; if (r < acc) return z; }
    return 'dry';
  };

  const out: PantryBatch[] = [];
  for (let i = 0; i < n; i++) {
    const zone = pickZone();
    // Усталений режим: партія рівномірна по власному строку життя. Сіль лежить
    // рік, салат тиждень — це дає більше термінових, ніж молода комора проду,
    // тобто перевіряємо складніший бік.
    const age = Math.floor(rnd() * SIM_SHELF[zone]);
    const added_at = new Date(NOW - age * DAY).toISOString();
    const opened = rnd() < 0.05;                       // ~5%, як у проді
    out.push({
      id: randomUUID(), household_id: 'h', catalog_key: null,
      label: `позиція ${i}`, zone, value: 100, unit: 'g',
      state: opened ? 'opened' : 'sealed',
      opened_at: opened ? added_at : null,
      expires_at: new Date(NOW + (SIM_SHELF[zone] - age) * DAY).toISOString(),
      best_before_opened_days: null, added_at, depleted_at: null, depleted_reason: null,
      confidence: 1, provenance: 'receipt_line', staple: false,
      last_by: null, last_action: 'add', product_id: null,
    });
  }
  return out;
}

/** Скільки з 10 найстаріших партій доїхало до кепа — читаємо з ВИВОДУ. */
function idleSurvivors(bs: PantryBatch[]): number {
  const out = serializePantry(bs, NOW, false, 'uuid', CAP);
  const shown = new Set(
    out.split('\n').map((l) => l.split(' · ')[0] ?? '').filter((s) => s.includes('-')),
  );
  const oldest = [...bs].sort((a, b) => a.added_at.localeCompare(b.added_at)).slice(0, IDLE_QUOTA);
  return oldest.filter((b) => shown.has(b.id)).length;
}

describe('кеп контексту: квота залежаним переживає появу строків', () => {
  for (const n of [150, 300]) {
    it(`на коморі ${n} ярус залежаних дістає свої ${IDLE_QUOTA}`, () => {
      const bs = pantry(n);
      expect(bs.length).toBe(n);
      expect(idleSurvivors(bs)).toBe(IDLE_QUOTA);
    });
  }

  it('кеп справді тисне — інакше попередні перевірки нічого не стережуть', () => {
    // Без цього тести вище лишились би зеленими й тоді, коли кеп перестав
    // відбирати взагалі: 150 позицій без кепа теж дали б 10 із 10.
    const out = serializePantry(pantry(150), NOW, false, 'uuid', CAP);
    const shown = out.split('\n').filter((l) => (l.split(' · ')[0] ?? '').includes('-'));
    expect(shown.length).toBe(CAP);
    expect(out).toContain('…і ще 30 позицій');
  });
});
