import { describe, it, expect } from 'vitest';
import { buildVetoIndex } from './veto-index.js';
import { vetoCard, vetoRecipe, stripVetoMentions, VETO_EMPTY_REPLY, ALLERGY_EMPTY_REPLY } from './veto.js';
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
    expect(call.reply).toBe(VETO_EMPTY_REPLY);
  });

  it('усе відхилено рядком з allergy=true → репліка про алергію', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Тости', desc: 'з арахісовою пастою', rescues: [] }] };
    const call = { card, reply: 'Тости.' };
    const r = vetoCard(call, peanut);
    expect(r.emptied).toBe(true);
    expect(call.reply).toBe(ALLERGY_EMPTY_REPLY);
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

  it('відмінок у тексті кандидата: «кінзою» ловиться категорією кінза', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Салат', desc: 'Помідори з кінзою', rescues: [] }, { title: 'Суп', desc: 'Гарбузовий', rescues: [] }] };
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

describe('stripVetoMentions — тон', () => {
  it('allergy-рядок: речення з алергеном ріжеться, якщо людина сама його не називала', () => {
    const call = { card: proposal(), reply: 'Тримай. Арахісова паста теж лежить, але її не беру.' };
    const r = stripVetoMentions(call, peanut, 'що на сніданок');
    expect(r.stripped).toHaveLength(1);
    expect(call.reply).toBe('Тримай.');
  });

  it('прямий запит — репліка не чіпається', () => {
    const call = { card: proposal(), reply: 'У тебе алергія на арахіс — але зроблю, як просив.' };
    expect(stripVetoMentions(call, peanut, 'зроби арахісову пасту').stripped).toEqual([]);
  });

  it('рядок без прапорця алергії: репліку не чіпаємо і не попереджаємо', () => {
    const call = { card: proposal(), reply: 'Стейк не пропоную, ти ж мʼяса не їси.' };
    expect(stripVetoMentions(call, pesc, 'що на вечерю').stripped).toEqual([]);
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
    const out = serializePantry([batch('b1', 'Стейк рібай'), batch('b2', 'Арахісова паста'), batch('b3', 'Картопля')], Date.now(), [], false, 'none', 120, [], '', index);
    const lines = out.split('\n');
    expect(lines.find((l) => l.startsWith('Стейк рібай'))).toMatch(/⚠НЕ ЇСТЬ \(мʼясо\)/);
    expect(lines.find((l) => l.startsWith('Стейк рібай'))).not.toMatch(/АЛЕРГЕН/);
    expect(lines.find((l) => l.startsWith('Арахісова паста'))).toMatch(/⚠АЛЕРГЕН \(арахіс\)/);
    expect(lines.find((l) => l.startsWith('Картопля'))).not.toMatch(/⚠/);
  });

  it('межа власника — лише індекс; алергії їдців — за коренем у назві', () => {
    const index = buildVetoIndex('u1', 'no', 'кінзи');
    const eater = { id: 'e1', household_id: 'h1', name: 'Оксана', allergies: ['фундук'], wishes: [], antipatterns: [], created_at: '2026-09-01T00:00:00.000Z' };
    const out = serializePantry([batch('b1', 'Картопля'), batch('b2', 'Фундук'), batch('b3', 'Кінза свіжа')], Date.now(), [eater], false, 'none', 120, [], '', index);
    const lines = out.split('\n');
    expect(lines.find((l) => l.startsWith('Картопля'))).not.toMatch(/⚠/);
    expect(lines.find((l) => l.startsWith('Фундук'))).toMatch(/⚠АЛЕРГЕН \(фундук в Оксана\)/);
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

  it('allergy-рядок на прямий запит — як і був: кандидат знімається', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Тости з арахісовою пастою', desc: '', rescues: ['арахісова паста'] }] };
    const r = vetoCard({ card, reply: '' }, peanut, 'тости з арахісовою пастою');
    expect(r.emptied).toBe(true);
  });

  it('без згадки в репліці людини — вето як раніше', () => {
    const call = { card: proposal(), reply: '' };
    expect(vetoCard(call, pesc, 'що на вечерю').rejected.map((x) => x.title)).toEqual(['Стейк рібай', 'Курячі стегна в духовці']);
  });

  it('VETO_EMPTY_REPLY — без слова «пропозицію», у голосі', () => {
    expect(VETO_EMPTY_REPLY).not.toMatch(/пропозиці/i);
  });
});

describe('vetoRecipe — прямий запит', () => {
  it('named: рядки, названі людиною, не рахуються дієтним збігом', () => {
    const recipe = { t: 'Стейк', sv: 2, tm: 20, ing: [{ n: 'стейк рібай', v: 300, u: 'g' }, { n: 'курячі стегна', v: 300, u: 'g' }], st: [] } as unknown as Recipe;
    const hits = vetoRecipe(recipe, pesc, 'зроби мені стейк');
    expect(hits.map((h) => [h.ingredient, h.row.ref])).toEqual([['курячі стегна', 'мʼясо'], ['курячі стегна', 'птиця']]);
  });
});
