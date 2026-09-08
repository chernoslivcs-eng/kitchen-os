import { describe, it, expect } from 'vitest';
import { buildVetoIndex } from './veto-index.js';
import { vetoCard, vetoRecipe } from './veto.js';
import type { Card, Recipe } from './types.js';

// Раунд 4, крок 4 (§5): вето по індексу. Кандидат відхиляється, якщо будь-який
// інгредієнт належить до категорії з індексу (через ієрархію каталогу) або
// збігається з продуктом з індексу. free-рядки вето не читає.

const pesc = buildVetoIndex('u1', 'no', 'мʼяса й птиці');
const vegan = buildVetoIndex('u1', 'no', 'нічого тваринного');
const peanut = buildVetoIndex('u1', 'ban', 'арахіс');
const cilantro = buildVetoIndex('u1', 'no', 'кінзи');

const proposal = (): Card => ({
  type: 'proposal',
  items: [
    { title: 'Стейк рібай', desc: 'Яловичина на грилі', rescues: ['стейк рібай'], needs: [] },
    { title: 'Паста з тунцем', desc: 'Тунець, каперси, лимон', rescues: ['тунець'], needs: ['каперси'] },
    { title: 'Курячі стегна в духовці', desc: 'Стегна з розмарином', rescues: ['курячі стегна'], needs: [] },
  ],
});

describe('vetoCard (proposal)', () => {
  it('пескетаріанець: мʼясо і птиця відхилені через ієрархію, риба лишилась; рядок індексу в результаті', () => {
    const call = { card: proposal(), reply: 'Три варіанти.' };
    const r = vetoCard(call, pesc);
    expect(r.rejected.map((x) => x.title)).toEqual(['Стейк рібай', 'Курячі стегна в духовці']);
    expect(r.rejected[0]!.rows.map((x) => x.ref)).toEqual(['мʼясо']);
    // Курка — і мʼясо, і птиця: спрацьовують обидва рядки, лог покаже обидва.
    expect(r.rejected[1]!.rows.map((x) => x.ref).sort()).toEqual(['мʼясо', 'птиця']);
    expect((call.card as { items: unknown[] }).items).toHaveLength(1);
    expect(call.reply).toBe('Три варіанти.');
  });

  it('прихований інгредієнт у needs/desc: рибний соус для вегана — відхилено', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Овочевий пад тай', desc: 'Рисова локшина, овочі, рибний соус', rescues: ['рисова локшина'], needs: ['рибний соус'] }] };
    const call = { card, reply: 'Пад тай.' };
    const r = vetoCard(call, vegan);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.rows.some((x) => x.ref === 'риба')).toBe(true);
    expect(r.emptied).toBe(true);
    expect(call.card).toBeNull();
    // П5-В6: службової відмови замість репліки більше немає — репліка як була.
    expect(call.reply).toBe('Пад тай.');
  });

  it('усе відхилено рядком з allergy=true → картки немає, репліка ціла', () => {
    // П1а: вето читає лише інгредієнти (rescues/needs), не desc.
    const card: Card = { type: 'proposal', items: [{ title: 'Тости', desc: 'з арахісовою пастою', rescues: [], needs: ['арахісова паста'] }] };
    const call = { card, reply: 'Тости.' };
    const r = vetoCard(call, peanut);
    expect(r.emptied).toBe(true);
    expect(call.card).toBeNull();
    expect(call.reply).toBe('Тости.');
  });

  it('free-рядки і meh не діють; порожній індекс — нічого не робить; не proposal — нічого', () => {
    const free = buildVetoIndex('u1', 'no', 'готувати великими порціями');
    const call = { card: proposal(), reply: 'x' };
    expect(vetoCard(call, free).rejected).toEqual([]);
    expect(vetoCard(call, []).rejected).toEqual([]);
    expect((call.card as { items: unknown[] }).items).toHaveLength(3);
    const intake = { card: { type: 'intake_diff', ops: [{ op: 'add', label: 'стейк' }] } as Card, reply: 'x' };
    expect(vetoCard(intake, pesc).rejected).toEqual([]);
  });

  it('відмінок у інгредієнті: «кінзою» ловиться категорією кінза; desc не сканується', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Салат', desc: 'Помідори', rescues: [], needs: ['пучок з кінзою'] }, { title: 'Суп', desc: 'Гарбузовий з кінзою', rescues: [] }] };
    const r = vetoCard({ card, reply: '' }, cilantro);
    expect(r.rejected.map((x) => x.title)).toEqual(['Салат']);
  });
});

describe('vetoRecipe (згенерований рецепт, по всіх інгредієнтах)', () => {
  const recipe = (ings: string[]): Recipe => ({ t: 'Пад тай', sv: 2, tm: 30, ing: ings.map((n) => ({ n, v: 100, u: 'g' })), st: [{ t: 'крок', c: 'дія', s: 60 }] }) as Recipe;

  it('рибний соус у ing → hit з рядком індексу; без нього — чисто', () => {
    const hit = vetoRecipe(recipe(['рисова локшина', 'рибний соус', 'арахіс']), vegan);
    expect(hit.map((h) => [h.ingredient, h.row.ref])).toEqual([['рибний соус', 'риба']]);
    expect(vetoRecipe(recipe(['рисова локшина', 'тофу', 'соєвий соус']), vegan)).toEqual([]);
  });

  it('назва страви не перевіряється — тільки інгредієнти', () => {
    const r = { ...recipe(['тофу']), t: 'Стейк з тофу' } as Recipe;
    expect(vetoRecipe(r, pesc)).toEqual([]);
  });
});

// ----- Крок 4б (a): ⚠-мітка в рядках [КОМОРА] за індексом -----------------

import { serializePantry } from './context.js';
import type { PantryBatch } from './types.js';

const batch = (id: string, label: string): PantryBatch => ({
  id, household_id: 'h1', catalog_key: null, label, zone: 'fridge', value: 400, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: '2026-09-05T00:00:00.000Z',
  depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: 'add',
});

describe('serializePantry з veto_index', () => {
  it('рядок з allergy=true — та сама мітка ⚠АЛЕРГЕН; без прапорця — ⚠НЕ ЇСТЬ; чисте — без мітки', () => {
    const index = [...buildVetoIndex('u1', 'no', 'мʼяса'), ...buildVetoIndex('u1', 'ban', 'арахіс')];
    const out = serializePantry([batch('b1', 'Стейк рібай'), batch('b2', 'Арахісова паста'), batch('b3', 'Картопля')], Date.now(), false, 'none', 120, [], '', index);
    const lines = out.split('\n');
    expect(lines.find((l) => l.startsWith('Стейк рібай'))).toMatch(/⚠НЕ ЇСТЬ \(мʼясо\)/);
    expect(lines.find((l) => l.startsWith('Стейк рібай'))).not.toMatch(/АЛЕРГЕН/);
    expect(lines.find((l) => l.startsWith('Арахісова паста'))).toMatch(/⚠АЛЕРГЕН \(арахіс\)/);
    expect(lines.find((l) => l.startsWith('Картопля'))).not.toMatch(/⚠/);
  });

  // П5-В5: їдців дому немає — джерело ⚠ лишилось одне, індекс власника.
  it('межа власника — лише індекс, і мітки лишаються на місці', () => {
    const index = [...buildVetoIndex('u1', 'no', 'кінзи'), ...buildVetoIndex('u1', 'ban', 'фундук')];
    const out = serializePantry([batch('b1', 'Картопля'), batch('b2', 'Фундук'), batch('b3', 'Кінза свіжа')], Date.now(), false, 'none', 120, [], '', index);
    const lines = out.split('\n');
    expect(lines.find((l) => l.startsWith('Картопля'))).not.toMatch(/⚠/);
    expect(lines.find((l) => l.startsWith('Фундук'))).toMatch(/⚠АЛЕРГЕН \(фундук\)/);
    expect(lines.find((l) => l.startsWith('Кінза'))).toMatch(/⚠НЕ ЇСТЬ \(кінза\)/);
  });
});

// ----- Крок 4в (1): прямий запит і «не їм» ---------------------------------

describe('vetoCard — прямий запит', () => {
  it('людина сама назвала продукт із «Я не їм» → рядок no для цього ходу не діє, кандидат лишається', () => {
    const call = { card: proposal(), reply: 'Стейк.' };
    const r = vetoCard(call, pesc, 'зроби мені стейк');
    expect(r.rejected.map((x) => x.title)).toEqual(['Курячі стегна в духовці']);
    expect((call.card as { items: { title: string }[] }).items.map((i) => i.title)).toContain('Стейк рібай');
  });

  it('allergy-рядок на прямий запит більше НЕ знімає страву (В6)', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Тости з арахісовою пастою', desc: '', rescues: ['арахісова паста'] }] };
    const call = { card, reply: 'Тости.' };
    const r = vetoCard(call, peanut, 'тости з арахісовою пастою');
    expect(r.rejected).toEqual([]);
    expect(r.emptied).toBe(false);
    expect((call.card as { items: unknown[] }).items).toHaveLength(1);
  });

  it('без згадки в репліці людини — вето як раніше', () => {
    const call = { card: proposal(), reply: '' };
    expect(vetoCard(call, pesc, 'що на вечерю').rejected.map((x) => x.title)).toEqual(['Стейк рібай', 'Курячі стегна в духовці']);
  });

  // Живий випадок 07.09, заради якого написана В6: у вето категорія «риба» з
  // allergy=true, людина просить лосося — і отримує його. Другий тест — та сама
  // фраза довша за чотири слова: до В6 (2) footprint на ній каталог не питав,
  // і виняток мовчки не спрацьовував саме на живій мові.
  it('лосось при алергійному вето «риба»: коротка фраза', () => {
    const fish = buildVetoIndex('u1', 'ban', 'рибу');
    expect(fish.some((r) => r.allergy && r.ref === 'риба')).toBe(true);
    const card: Card = { type: 'proposal', items: [{ title: 'Стейк з лосося', desc: '', rescues: ['лосось'] }] };
    const call = { card, reply: 'Тримай.' };
    const r = vetoCard(call, fish, 'Може стейк з лосося?');
    expect(r.rejected).toEqual([]);
    expect(call.card).not.toBeNull();
  });

  it('лосось при алергійному вето «риба»: фраза понад чотири слова', () => {
    const fish = buildVetoIndex('u1', 'ban', 'рибу');
    const card: Card = { type: 'proposal', items: [{ title: 'Стейк з лосося', desc: '', rescues: ['лосось'] }] };
    const call = { card, reply: 'Тримай.' };
    const r = vetoCard(call, fish, 'а може зробимо стейк з лосося на вечерю');
    expect(r.rejected).toEqual([]);
    expect(call.card).not.toBeNull();
  });

  it('сам не пропоную: те саме вето без прохання людини — страву знято', () => {
    const fish = buildVetoIndex('u1', 'ban', 'рибу');
    const card: Card = { type: 'proposal', items: [{ title: 'Стейк з лосося', desc: '', rescues: ['лосось'] }] };
    const call = { card, reply: 'Тримай.' };
    expect(vetoCard(call, fish, 'що на вечерю').emptied).toBe(true);
    expect(call.card).toBeNull();
    expect(call.reply).toBe('Тримай.');
  });
});

describe('vetoRecipe — прямий запит', () => {
  it('named: рядки, названі людиною, не рахуються дієтним збігом', () => {
    const recipe = { t: 'Стейк', sv: 2, tm: 20, ing: [{ n: 'стейк рібай', v: 300, u: 'g' }, { n: 'курячі стегна', v: 300, u: 'g' }], st: [] } as unknown as Recipe;
    const hits = vetoRecipe(recipe, pesc, 'зроби мені стейк');
    expect(hits.map((h) => [h.ingredient, h.row.ref])).toEqual([['курячі стегна', 'мʼясо'], ['курячі стегна', 'птиця']]);
  });
});
