import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, undoCard } from '../apply.js';
import { serializeEaters } from '../context.js';
import type { ProfileCard, EaterRow } from '../types.js';
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
    expect(await repo.getProfile(USER)).toBeNull();
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

  it('порожньо — жодного токена', () => {
    expect(serializeEaters([])).toBe('');
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
