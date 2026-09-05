import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, undoCard } from '../apply.js';
import { buildVetoIndex } from '../veto-index.js';
import { serializeEaters, serializePantry, buildKitchenContext } from '../context.js';
import type { ProfileCard, EaterRow, PantryBatch } from '../types.js';
import { randomUUID } from 'node:crypto';

// «Зі мною живе Оксана, вона веганка» — їдець без акаунта. Прототип тримав
// таких у household-масиві; прод шість QA-прогонів казав промптом «kind:member
// не використовуй, не збережеться» і радив розмазувати людину по анти-полю
// власника: «на двох: Оксана не їсть мʼяса». Тобто окрема людина існувала
// як шматок чужого рядка.

const HOUSE = randomUUID();
const USER = randomUUID();

async function apply(repo: InMemoryRepo, card: ProfileCard, selected: number[] = []) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id: HOUSE, user_id: USER, card });
  return { message_id, ...(await applyCard(repo, message_id, selected, USER)) };
}

const member = (label: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'profile', ops: [{ op: 'add' as const, kind: 'member' as const, label, ...extra }] }) as ProfileCard;

describe('їдці дому (kind: member)', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('картка додає їдця в дім', async () => {
    const r = await apply(repo, member('Оксана', { diet: 'веганство' }));
    expect(r.applied).toBe(1);
    const eaters = await repo.listEaters(HOUSE);
    expect(eaters).toHaveLength(1);
    expect(eaters[0]!.name).toBe('Оксана');
    expect(eaters[0]!.wishes).toContain('веганство');
  });

  it('обмеження їдця лежать у його записі, не в профілі власника', async () => {
    await apply(repo, member('Оксана', {
      allergies: ['арахіс'], antipatterns: ['не їсть мʼяса'],
    }));
    const [e] = await repo.listEaters(HOUSE);
    expect(e!.allergies).toEqual(['арахіс']);
    expect(e!.antipatterns).toEqual(['не їсть мʼяса']);
  });

  it('той самий їдець двічі — не подія', async () => {
    await apply(repo, member('Оксана'));
    const second = await apply(repo, member('оксана '));
    expect(second.applied).toBe(0);
    expect(await repo.listEaters(HOUSE)).toHaveLength(1);
  });

  it('remove прибирає їдця', async () => {
    await apply(repo, member('Оксана'));
    const r = await apply(repo, {
      type: 'profile', ops: [{ op: 'remove', kind: 'member', label: 'Оксана' }],
    });
    expect(r.applied).toBe(1);
    expect(await repo.listEaters(HOUSE)).toHaveLength(0);
  });

  it('undo додавання прибирає саме цього їдця', async () => {
    await apply(repo, member('Оксана'));
    const r = await apply(repo, member('Тарас'));
    await undoCard(repo, r.message_id, r.undo_token!, USER);
    const names = (await repo.listEaters(HOUSE)).map((e) => e.name);
    expect(names).toEqual(['Оксана']);
  });

  it('undo видалення повертає їдця з усіма обмеженнями', async () => {
    await apply(repo, member('Оксана', { allergies: ['арахіс'] }));
    const r = await apply(repo, {
      type: 'profile', ops: [{ op: 'remove', kind: 'member', label: 'Оксана' }],
    });
    await undoCard(repo, r.message_id, r.undo_token!, USER);
    const [e] = await repo.listEaters(HOUSE);
    expect(e!.name).toBe('Оксана');
    expect(e!.allergies).toEqual(['арахіс']);
  });

  it('їдці живуть у домі, не в юзері — сусідній дім їх не бачить', async () => {
    await apply(repo, member('Оксана'));
    expect(await repo.listEaters(randomUUID())).toHaveLength(0);
  });
});

describe('їдці в контексті моделі', () => {
  const eater = (over: Partial<EaterRow> = {}): EaterRow => ({
    id: 'e1', household_id: HOUSE, name: 'Оксана',
    allergies: [], wishes: [], antipatterns: [],
    created_at: '2026-08-01T10:00:00.000Z', ...over,
  });

  // Було «жодного токена». M13-ROLE-VOICE п.1: відсутній блок читається як
  // брак даних, а не як «нікого немає» — і модель добудовує склад дому сама.
  it('порожньо — блок є і каже, що крім власника нікого не записано', () => {
    const s = serializeEaters([]);
    expect(s).toContain('[ДОМАШНІ]');
    expect(s).toMatch(/не записано/i);
  });

  it('імʼя й обмеження в одному рядку', () => {
    const s = serializeEaters([eater({ wishes: ['веганство'], antipatterns: ['не їсть мʼяса'] })]);
    expect(s).toContain('[ДОМАШНІ]');
    expect(s).toContain('Оксана');
    expect(s).toContain('веганство');
    expect(s).toContain('не їсть мʼяса');
  });

  // Алергія їдця — така сама тверда межа, як алергія власника: страва
  // готується на всіх, хто за столом.
  it('алергія їдця позначена як тверда межа', () => {
    const s = serializeEaters([eater({ allergies: ['арахіс'] })]);
    expect(s).toContain('АЛЕРГІЯ');
    expect(s).toContain('арахіс');
  });
});

// QA7-06: алергія домашнього не позначалась у рядку партії — ⚠АЛЕРГЕН ставився
// тільки за алергіями власника, а блок [ДОМАШНІ] приклеювався останнім, після
// комори. Наслідок на живому: Оксана з алергією на арахіс у eaters, арахісова
// паста в коморі → «зроби нам сніданок» → «рисова каша з арахісовою пастою»
// першим пунктом. Рівно та сама конструкція, яку QA-5 визнав неробочою для
// власника, — фікс тоді не продублювали для їдців.
describe('алергія їдця в рядку партії (QA7-06)', () => {
  const batch = (label: string): PantryBatch => ({
    id: 'p1', household_id: HOUSE, catalog_key: null, label, zone: 'dry',
    value: 350, unit: 'g', state: 'sealed', opened_at: null, expires_at: null,
    best_before_opened_days: null, added_at: '2026-08-01T10:00:00.000Z',
    depleted_at: null, confidence: 1, provenance: 'user_statement',
    staple: false, last_by: null, last_action: null,
  });
  const oksana = (): EaterRow => ({
    id: 'e1', household_id: HOUSE, name: 'Оксана',
    allergies: ['арахіс'], wishes: [], antipatterns: [],
    created_at: '2026-08-01T10:00:00.000Z',
  });

  it('партія з алергеном їдця несе ⚠АЛЕРГЕН з імʼям', () => {
    const s = serializePantry([batch('Арахісова паста')], Date.now(), [oksana()]);
    expect(s).toContain('⚠АЛЕРГЕН');
    expect(s).toContain('Оксан');       // «в Оксани» — відмінок
    expect(s).toContain('арахіс');
  });

  it('відмінок не ховає збіг: «з арахісом» теж ловиться', () => {
    const s = serializePantry([batch('Шоколад з арахісом')], Date.now(), [oksana()]);
    expect(s).toContain('⚠АЛЕРГЕН');
  });

  it('алергії власника (індекс) і їдця зливаються в одну мітку', () => {
    const index = buildVetoIndex(USER, 'ban', 'селера');
    const s = serializePantry(
      [batch('Селера'), batch('Арахісова паста')], Date.now(), [oksana()], false, 'uuid', 120, [], '', index,
    );
    expect(s).toContain('селера');
    expect(s).toContain('Оксан');
  });

  it('без збігу мітки немає', () => {
    const s = serializePantry([batch('Рис')], Date.now(), [oksana()]);
    expect(s).not.toContain('⚠АЛЕРГЕН');
  });

  it('buildKitchenContext прокидає їдців у комору', () => {
    const s = buildKitchenContext({
      pantry: [batch('Арахісова паста')],
      eaters: [oksana()],
      now: new Date('2026-06-10'),
    });
    // Мітка мусить стояти В РЯДКУ ПАРТІЇ (блок [КОМОРА]), а не тільки в [ДОМАШНІ].
    const pantryBlock = s.split('[КОМОРА]')[1]!.split('[ДОМАШНІ]')[0]!;
    expect(pantryBlock).toContain('⚠АЛЕРГЕН');
  });
});
