// Живий репро (01.09): модель повертає {"type":"shopping","ops":[...]}
// замість items (плутанина з intake_diff/profile). Клік «У список» на такій
// картці мусить деградувати чемно (нуль застосованих, а не 500), а не кидати
// TypeError на .map().
//
// Крок П3 (6): для профілю «чемно» більше не означає «нуль і закрито».
// Картка, з якої нема чого застосувати, лишається ВІДКРИТОЮ: штамп
// «застосовано» на нічого — гірше за видиму невдачу.

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, NOTHING_APPLICABLE } from '../apply.js';
import type { IntakeCard, ShoppingCard, ProfileCard } from '../types.js';

describe('applyCard переживає малформлену картку (поле переплутане з іншого типу)', () => {
  async function pend(repo: InMemoryRepo, card: unknown) {
    const household_id = randomUUID();
    const user_id = randomUUID();
    const message_id = randomUUID();
    await createPending(repo, { message_id, household_id, user_id, card: card as ShoppingCard });
    return { household_id, user_id, message_id };
  }

  it('shopping без items (є тільки ops) — apply не падає, 0 застосовано', async () => {
    const repo = new InMemoryRepo();
    const malformed = { type: 'shopping', ops: [{ op: 'remove', label: 'x' }] };
    const { message_id, user_id } = await pend(repo, malformed);
    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(0);
  });

  it('intake_diff без ops (є тільки items) — apply не падає', async () => {
    const repo = new InMemoryRepo();
    const malformed = { type: 'intake_diff', items: [{ op: 'add', label: 'молоко' }] };
    const { message_id, user_id } = await pend(repo, malformed as unknown as IntakeCard);
    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(0);
  });

  it('profile без ops — картка лишається ВІДКРИТОЮ, а не «застосованою з нулем»', async () => {
    // Крок П3 (6): раніше тут стояло «apply не падає, applied 0» — і саме це
    // давало штамп applied_at на картці, яка нічого не зробила. Тепер apply
    // відмовляється, і людина бачить картку відкритою.
    const repo = new InMemoryRepo();
    const malformed = { type: 'profile', items: [{ op: 'add', kind: 'note', label: 'x' }] };
    const { message_id, user_id } = await pend(repo, malformed as unknown as ProfileCard);
    await expect(applyCard(repo, message_id, [], user_id)).rejects.toThrow(NOTHING_APPLICABLE);
    const pc = await repo.getPending(message_id);
    expect(pc!.applied_at).toBeNull();
    expect(pc!.undo_token).toBeNull();
  });
});
