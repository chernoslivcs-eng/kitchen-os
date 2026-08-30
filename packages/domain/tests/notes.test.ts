import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, undoCard } from '../apply.js';
import { serializeNotes } from '../context.js';
import type { ProfileCard, MemoryNote } from '../types.js';
import { randomUUID } from 'node:crypto';

// Висновок із готування — «фует знімати, щойно краї хрусткі». Тип `note` існував
// у ProfileKind від першого дня, таблиця memory_note — від першої міграції,
// а applyProfileOp повертав на нього false. Тобто продукт мовчки викидав
// єдине, що людина сама дізналась про свою кухню.

const HOUSE = randomUUID();
const USER = randomUUID();

async function apply(repo: InMemoryRepo, card: ProfileCard, selected: number[] = []) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id: HOUSE, user_id: USER, card });
  return applyCard(repo, message_id, selected, USER);
}

const note = (label: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'profile', ops: [{ op: 'add' as const, kind: 'note' as const, label, ...extra }] }) as ProfileCard;

describe('висновки з готування', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('картка з kind:note справді пише висновок', async () => {
    const r = await apply(repo, note('фует знімати, щойно краї хрусткі'));
    expect(r.applied).toBe(1);
    const notes = await repo.listNotes(USER);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('фует знімати, щойно краї хрусткі');
  });

  it('додаткові поля картки доїжджають', async () => {
    await apply(repo, note('менше солі', { recipe_title: 'Різото з білими', rating: 4, pin: true }));
    const [n] = await repo.listNotes(USER);
    expect(n!.recipe_title).toBe('Різото з білими');
    expect(n!.rating).toBe(4);
    expect(n!.pinned).toBe(true);
  });

  // QA4-05 у чистому вигляді: applied мусить рахувати те, що СПРАВДІ лягло.
  it('той самий висновок удруге не рахується як застосований', async () => {
    await apply(repo, note('менше солі'));
    const second = await apply(repo, note('менше солі'));
    expect(second.applied).toBe(0);
    expect(await repo.listNotes(USER)).toHaveLength(1);
  });

  it('регістр і пробіли не роблять дубля', async () => {
    await apply(repo, note('Менше Солі'));
    const second = await apply(repo, note('  менше солі  '));
    expect(second.applied).toBe(0);
  });

  it('порожній текст — не висновок', async () => {
    const r = await apply(repo, note('   '));
    expect(r.applied).toBe(0);
    expect(await repo.listNotes(USER)).toHaveLength(0);
  });

  it('remove знімає висновок', async () => {
    await apply(repo, note('менше солі'));
    const r = await apply(repo, {
      type: 'profile',
      ops: [{ op: 'remove', kind: 'note', label: 'менше солі' }],
    });
    expect(r.applied).toBe(1);
    expect(await repo.listNotes(USER)).toHaveLength(0);
  });

  it('remove неіснуючого нічого не рахує', async () => {
    const r = await apply(repo, {
      type: 'profile',
      ops: [{ op: 'remove', kind: 'note', label: 'такого не було' }],
    });
    expect(r.applied).toBe(0);
  });

  it('закріплені згори, далі найсвіжіші', async () => {
    await apply(repo, note('перший'));
    await apply(repo, note('другий'));
    await apply(repo, note('третій', { pin: true }));
    expect((await repo.listNotes(USER)).map((n) => n.text)).toEqual(['третій', 'другий', 'перший']);
  });

  it('undo видаляє саме той висновок, а не всі', async () => {
    await apply(repo, note('старий висновок'));
    const message_id = randomUUID();
    await createPending(repo, {
      message_id, household_id: HOUSE, user_id: USER, card: note('новий висновок'),
    });
    const applied = await applyCard(repo, message_id, [], USER);
    expect(await repo.listNotes(USER)).toHaveLength(2);

    await undoCard(repo, message_id, applied.undo_token!, USER);
    const left = await repo.listNotes(USER);
    expect(left).toHaveLength(1);
    expect(left[0]!.text).toBe('старий висновок');
  });

  // Головна причина не класти висновки в документ профілю: undo профілю
  // замінює документ цілком, і висновок, що приїхав пізніше, зникав би разом
  // із відкотом алергії, до якої не має стосунку.
  it('undo алергії не чіпає висновки', async () => {
    await apply(repo, note('фует знімати рано'));
    const message_id = randomUUID();
    await createPending(repo, {
      message_id, household_id: HOUSE, user_id: USER,
      card: { type: 'profile', ops: [{ op: 'add', kind: 'allergy', label: 'мигдаль' }] },
    });
    const applied = await applyCard(repo, message_id, [], USER);
    await undoCard(repo, message_id, applied.undo_token!, USER);

    expect((await repo.getProfile(USER))!.allergies).toEqual([]);
    expect(await repo.listNotes(USER)).toHaveLength(1);
  });

  it('змішана картка: алергія і висновок в одній', async () => {
    const r = await apply(repo, {
      type: 'profile',
      ops: [
        { op: 'add', kind: 'allergy', label: 'мигдаль' },
        { op: 'add', kind: 'note', label: 'духовка гріє сильніше за шкалу' },
      ],
    });
    expect(r.applied).toBe(2);
    expect((await repo.getProfile(USER))!.allergies).toEqual(['мигдаль']);
    expect(await repo.listNotes(USER)).toHaveLength(1);
  });

  it('вибіркове застосування: беремо тільки висновок', async () => {
    const message_id = randomUUID();
    await createPending(repo, {
      message_id, household_id: HOUSE, user_id: USER,
      card: {
        type: 'profile',
        ops: [
          { op: 'add', kind: 'allergy', label: 'мигдаль' },
          { op: 'add', kind: 'note', label: 'духовка гріє сильніше' },
        ],
      },
    });
    const r = await applyCard(repo, message_id, [1], USER);
    expect(r.applied).toBe(1);
    expect((await repo.getProfile(USER))!.allergies).toEqual([]);
    expect(await repo.listNotes(USER)).toHaveLength(1);
  });

  it('чужі висновки не видно', async () => {
    await apply(repo, note('мій висновок'));
    expect(await repo.listNotes(randomUUID())).toHaveLength(0);
  });
});

describe('серіалізація висновків для моделі', () => {
  const base: MemoryNote = {
    id: 'n1', user_id: USER, text: 'фует знімати, щойно краї хрусткі',
    recipe_title: null, rating: null, pinned: false, created_at: '2026-08-01T10:00:00.000Z',
  };

  it('порожньо — жодного токена', () => {
    expect(serializeNotes([])).toBe('');
  });

  it('має заголовок і текст', () => {
    const s = serializeNotes([base]);
    expect(s).toContain('[ВИСНОВКИ З ГОТУВАННЯ]');
    expect(s).toContain('фует знімати, щойно краї хрусткі');
  });

  it('страва і закріплення показані', () => {
    const s = serializeNotes([{ ...base, recipe_title: 'Фует', pinned: true }]);
    expect(s).toContain('до «Фует»');
    expect(s).toContain('закріплено');
  });
});
