import { describe, it, expect } from 'vitest';
import { vetoAllergens, ALLERGEN_VETO_REPLY, stripAllergenMentionsFromReply, ALLERGEN_REPLY_FALLBACK } from '../src/allergen-veto.js';
import type { Card, EaterRow, Profile } from '@kitchen/domain';

// Еval 04.09 після 1.2: shared-meal-allergen — арахісова паста в rescues на
// спільний сніданок при алергії Оксани, попри ⚠ у рядку комори. Межа
// продукту не має залежати від уваги моделі: сервер прибирає страву.

const oksana: EaterRow = {
  id: 'e1', household_id: 'h1', name: 'Оксана',
  allergies: ['арахіс', 'арахісова паста'], wishes: [], antipatterns: [],
  created_at: '2026-08-01T10:00:00.000Z',
} as EaterRow;
const noProfile: Profile = { user_id: 'u1', allergies: [], wishes: [], antipatterns: [], equipment: {} } as Profile;

const proposal = (): Card => ({
  type: 'proposal',
  items: [
    { title: 'Омлет з черрі', desc: 'Яйця, помідори черрі, базилік', rescues: ['яйця', 'помідори чері'], needs: ['молоко'] },
    { title: 'Французькі тости з багета', desc: 'Багет у яйцях з молоком. Подається з арахісовою пастою.', rescues: ['багет', 'яйця', 'арахісова паста'], needs: ['кориця'] },
  ],
});

describe('vetoAllergens', () => {
  it('страва з алергеном їдця прибирається, решта лишається, reply не чіпається', () => {
    const call = { card: proposal(), reply: 'Омлет або тости.' };
    const r = vetoAllergens(call, noProfile, [oksana]);
    expect(r.removed.map((x) => x.title)).toEqual(['Французькі тости з багета']);
    expect(r.removed[0]!.hits.join(' ')).toMatch(/арахіс/);
    expect(r.emptied).toBe(false);
    expect((call.card as { items: unknown[] }).items).toHaveLength(1);
    expect(call.reply).toBe('Омлет або тости.');
  });

  it('алерген у desc, не лише в rescues — теж вето (згадка = пропозиція)', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Тости', desc: 'з арахісовою пастою', rescues: ['багет'] }] };
    const call = { card, reply: 'Тости.' };
    const r = vetoAllergens(call, noProfile, [oksana]);
    expect(r.emptied).toBe(true);
    expect(call.card).toBeNull();
    expect(call.reply).toBe(ALLERGEN_VETO_REPLY);
  });

  it('алергія власника з профілю — так само', () => {
    const profile = { ...noProfile, allergies: ['фундук'] } as Profile;
    const card: Card = { type: 'proposal', items: [{ title: 'Салат', desc: 'з фундуком', rescues: [] }, { title: 'Омлет', desc: 'яйця', rescues: [] }] };
    const call = { card, reply: '' };
    const r = vetoAllergens(call, profile, []);
    expect(r.removed[0]!.title).toBe('Салат');
    expect((call.card as { items: unknown[] }).items).toHaveLength(1);
  });

  it('без алергій — нічого не робить; не proposal — нічого не робить', () => {
    const call = { card: proposal(), reply: 'x' };
    expect(vetoAllergens(call, noProfile, []).removed).toEqual([]);
    expect((call.card as { items: unknown[] }).items).toHaveLength(2);
    const intake = { card: { type: 'intake_diff', ops: [{ op: 'add', label: 'арахіс' }] } as Card, reply: 'x' };
    expect(vetoAllergens(intake, noProfile, [oksana]).removed).toEqual([]);
  });

  it('корінь не ловить чуже: «курка» при алергії на «куркуму» не зникає', () => {
    const profile = { ...noProfile, allergies: ['куркума'] } as Profile;
    const card: Card = { type: 'proposal', items: [{ title: 'Курка з рисом', desc: 'куряче філе', rescues: ['курка'] }] };
    const call = { card, reply: '' };
    const r = vetoAllergens(call, profile, []);
    expect(r.removed).toEqual([]);
  });
});

// Крок 6з: qa5-allergen-proactive 3/3 — модель ігнорує voice v3.1 і сама
// згадує алерген, якого ніхто не питав («Молочний з мигдалем теж є, але там
// алерген — його не беру»). Промпт межу не тримає, тож ріже сервер.
describe('stripAllergenMentionsFromReply', () => {
  const mygdal = { ...noProfile, allergies: ['мигдаль'] } as Profile;

  it('непрямий запит: людина алерген не називала — речення вирізається, картка не чіпається', () => {
    const card: Card = {
      type: 'proposal',
      items: [{ title: 'Булочки з корицею', desc: 'мʼякі', rescues: ['булочки з корицею'] }],
    };
    const call = {
      card,
      reply: 'Булочки з корицею — саме під чай. Молочний з мигдалем теж є, але там алерген — його не беру.',
    };
    const r = stripAllergenMentionsFromReply(call, mygdal, [], 'Що солодкого до чаю з того, що є вдома?');
    expect(r.stripped).toHaveLength(1);
    expect(r.stripped[0]).toMatch(/мигдал/);
    expect(call.reply).toBe('Булочки з корицею — саме під чай.');
    expect((call.card as { items: unknown[] }).items).toHaveLength(1);
  });

  it('прямий запит: людина сама назвала алерген у своїй репліці — reply не чіпається', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Локшина з арахісовим соусом', desc: 'з арахісом', rescues: ['локшина'] }] };
    const call = { card, reply: 'У тебе алергія на арахіс — це небезпечно. Ось рецепт локшини з арахісовим соусом.' };
    const r = stripAllergenMentionsFromReply(call, { ...noProfile, allergies: ['арахіс'] } as Profile, [], 'Дай рецепт локшини з арахісовим соусом');
    expect(r.stripped).toEqual([]);
    expect(call.reply).toBe('У тебе алергія на арахіс — це небезпечно. Ось рецепт локшини з арахісовим соусом.');
  });

  it('reply повністю з алергену і є картка — фолбек «Тримай варіанти.»', () => {
    const card: Card = { type: 'proposal', items: [{ title: 'Булочки з корицею', desc: 'мʼякі', rescues: [] }] };
    const call = { card, reply: 'Молочний з мигдалем теж є, але там алерген — його не беру.' };
    const r = stripAllergenMentionsFromReply(call, mygdal, [], 'Що солодкого до чаю?');
    expect(r.stripped).toHaveLength(1);
    expect(call.reply).toBe(ALLERGEN_REPLY_FALLBACK);
  });
});
