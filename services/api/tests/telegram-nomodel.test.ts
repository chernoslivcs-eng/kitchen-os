// Р152 (TELEGRAM-PLAN-0913, PR 5 «Подивитись без моделі»): чотири команди читають
// Repo напряму, без ходу чату (0 $). Розпізнавання трьох форм, рендер комори/
// списку/рецептів/дому на голих фікстурах (без InMemoryRepo) — окремо від
// інтеграційних тестів у telegram.test.ts (там же — тогл через callback).
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  matchQuickCommand, renderPantryText, renderShoppingText, renderRecipesText, renderHomeText, renderCalendarText,
} from '../src/telegram-nomodel.js';
import type { PantryBatch } from '@kitchen/domain';

const DAY = 86_400_000;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const batch = (patch: Partial<PantryBatch>): PantryBatch => ({
  id: randomUUID(), household_id: 'h', catalog_key: patch.catalog_key ?? 'x', label: 'товар', zone: 'fridge',
  value: null, unit: null, state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: null,
  added_at: new Date().toISOString(), depleted_at: null, confidence: 1, provenance: 'user_statement',
  staple: false, last_by: null, last_action: null, ...patch,
});

describe('Р152 · /pantry /list /recipes /home — розпізнавання команди', () => {
  it('латиниця з меню, українська команда, слово з клавіатури — усі три форми, без регістру й пробілів', () => {
    for (const s of ['/pantry', '/PANTRY', '/комора', '/Комора', 'комора', 'Комора', '  Комора  ']) expect(matchQuickCommand(s), s).toBe('pantry');
    for (const s of ['/list', '/список', 'Список']) expect(matchQuickCommand(s), s).toBe('list');
    for (const s of ['/recipes', '/рецепти', 'Рецепти']) expect(matchQuickCommand(s), s).toBe('recipes');
    for (const s of ['/home', '/дім', 'Дім зараз', 'дім']) expect(matchQuickCommand(s), s).toBe('home');
    for (const s of ['купив молоко', '/start', '/stop', 'комора вже', '']) expect(matchQuickCommand(s), s).toBeNull();
  });
});

describe('Р152 · /pantry — текст', () => {
  it('порожня комора', () => {
    expect(renderPantryText([], Date.now())).toBe('Комора порожня. Кинь чек — розберу.');
  });
  it('«Горить» зверху (без кепу 3), потім зони; спливаюче без catalog_key — не горить (hasScale)', () => {
    const batches = [
      batch({ label: 'помідори', zone: 'fresh', catalog_key: 'tomato', expires_at: iso(-1) }),
      batch({ label: 'йогурт', zone: 'fridge', catalog_key: 'yogurt', expires_at: iso(1) }),
      batch({ label: 'сир', zone: 'fridge', catalog_key: 'cheese', expires_at: iso(2) }),
      batch({ label: 'молоко', zone: 'fridge', catalog_key: 'milk', expires_at: iso(2.5) }),
      batch({ label: 'хліб', zone: 'dry', catalog_key: null, expires_at: iso(-5) }),   // без каталогу — не горить
      batch({ label: 'рис', zone: 'dry', catalog_key: 'rice', expires_at: iso(300) }),
    ];
    const text = renderPantryText(batches, Date.now());
    expect(text).toContain('<b>Комора · 6</b>');
    // isSoon: days <= SOON_CUT_DAYS (3) — помідори/йогурт/сир/молоко (-1/1/2/3), хліб без каталогу не горить.
    expect(text).toContain('<b>🔥 Горить · 4</b>');
    const burningIdx = text.indexOf('Горить');
    expect(text.indexOf('помідори')).toBeLessThan(text.indexOf('молоко'));
    expect(text.indexOf('помідори')).toBeGreaterThan(burningIdx);
    expect(text).toMatch(/помідори[^\n]*· прострочено/);   // days < 0 — слово, не «-1 дн»
    expect(text).toContain('<b>🥬 Свіже · 1</b>');
    expect(text).toContain('<b>🧊 Холодильник · 3</b>');
    expect(text).toContain('<b>🥫 Суха шафа · 2</b>');
    expect(text).not.toMatch(/хліб[^\n]*дн/);   // без catalog_key — рядок є, мітки «N дн» нема
  });
  it('«Спливає» — лише горить; нічого — «Нічого не спливає.»', () => {
    const calm = [batch({ label: 'рис', catalog_key: 'rice', expires_at: iso(300) })];
    expect(renderPantryText(calm, Date.now(), 'soon')).toBe('Нічого не спливає.');
    const hot = [batch({ label: 'йогурт', catalog_key: 'yogurt', expires_at: iso(1) })];
    expect(renderPantryText(hot, Date.now(), 'soon')).toContain('<b>🔥 Горить · 1</b>');
  });
  it('депонований (списаний) батч не рахується', () => {
    const text = renderPantryText([batch({ state: 'depleted', label: 'старе' })], Date.now());
    expect(text).toBe('Комора порожня. Кинь чек — розберу.');
  });
});

describe('Р152 · /list — текст', () => {
  it('порожній', () => { expect(renderShoppingText([])).toBe('Список порожній.'); });
  it('рядки ☐/☑ з кількістю', () => {
    const text = renderShoppingText([
      { id: '1', label: 'яйця', value: 10, unit: 'pcs', checked: false },
      { id: '2', label: 'сіль', value: null, unit: null, checked: true },
    ]);
    expect(text).toBe('<b>🛒 Список · 2</b>\n☐ яйця · 10 шт\n☑ сіль');
  });
});

describe('Р152 · /recipes — текст', () => {
  it('порожньо', () => { expect(renderRecipesText([])).toBe('Збережених рецептів ще нема.'); });
  it('назва · час · порції', () => {
    const text = renderRecipesText([{ id: '1', title: 'Паста', time_total: 20, base_servings: 2 }, { id: '2', title: 'Без часу', time_total: null, base_servings: 1 }]);
    expect(text).toBe('<b>📖 Рецепти · 2</b>\n• Паста · 20 хв · 2 порц.\n• Без часу · 1 порц.');
  });
});

describe('Р152 · /home — текст', () => {
  it('спокійний дім', () => {
    expect(renderHomeText({ overdue: 0, burning: [], strict: null, shoppingCount: 0 })).toBe('Дім спокійний. Нічого не горить.');
  });
  it('усі рядки разом', () => {
    const text = renderHomeText({
      overdue: 1, burning: [{ label: 'йогурт', qty: '', days: -1, tone: 'danger' }, { label: 'сир', qty: '', days: 1, tone: 'amber' }],
      strict: { kind: 'tradition', title: 'Піст', from: '2026-01-01', to: '2026-04-19', strict: true, source: 'catalog' },
      shoppingCount: 3,
    });
    expect(text).toBe('<b>🏠 Дім зараз</b>\nПрострочено 1\nГорить: йогурт, сир\nПіст · до 19 кві\nСписок · 3');
  });
});

// Власник 15.09: емодзі — знаки розділів у заголовках бота.
describe('емодзі-заголовки', () => {
  it('/pantry: зони і «Горить» зі знаками', () => {
    const b = (label: string, zone: string, d: number): PantryBatch => ({
      id: randomUUID(), household_id: 'h', catalog_key: null, label, zone: zone as PantryBatch['zone'], value: 1, unit: 'pcs', state: 'sealed',
      opened_at: null, expires_at: iso(d), expires_source: 'manual', best_before_opened_days: null, added_at: iso(-1), source: 'user', product_id: null,
    } as unknown as PantryBatch);
    const t = renderPantryText([b('Салат', 'fresh', 10), b('Йогурт', 'fridge', 0), b('Сіль', 'spices', 300)], Date.now(), 'all');
    expect(t).toContain('<b>🥬 Свіже · 1</b>');
    expect(t).toContain('<b>🧂 Спеції · 1</b>');
  });
  it('/list, /recipes, /home, /calendar — заголовки зі знаками', () => {
    expect(renderShoppingText([{ id: 'a', label: 'Молоко', checked: false, value: null, unit: null }])).toContain('<b>🛒 Список · 1</b>');
    expect(renderRecipesText([{ id: 'r', title: 'Паста', time_total: 20, base_servings: 2 }])).toContain('<b>📖 Рецепти · 1</b>');
    expect(renderCalendarText({ now: [{ kind: 'diet', title: 'x', from: '2026-09-15', to: '2026-09-20', strict: true, source: 'chat' }], seasons: ['Полуниця'], upcoming: [{ at: Date.now() + 86_400_000, title: 'y', kind: 'tradition' }] }, Date.now()))
      .toMatch(/<b>🔴 Триває<\/b>[\s\S]*<b>🌿 Сезони<\/b>[\s\S]*<b>📌 Далі<\/b>/);
    expect(renderHomeText({ overdue: 1, burning: [], strict: null, shoppingCount: 0 })).toContain('<b>🏠 Дім зараз</b>');
  });
});
