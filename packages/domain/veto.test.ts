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
