// Живий репро (01.09): модель повертає {"type":"shopping","ops":[...]}
// замість items (плутанина з intake_diff/profile) — нічого не валідує
// форму на вході, тож малформлена картка доходить до applyCard. Клік
// «У список»/«Застосувати» на такій картці мусить деградувати чемно
// (нуль застосованих, а не 500), а не кидати TypeError на .map().

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard } from '../apply.js';
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

  it('profile без ops — apply не падає', async () => {
    const repo = new InMemoryRepo();
    const malformed = { type: 'profile', items: [{ op: 'add', kind: 'note', label: 'x' }] };
    const { message_id, user_id } = await pend(repo, malformed as unknown as ProfileCard);
    const r = await applyCard(repo, message_id, [], user_id);
    expect(r.applied).toBe(0);
  });
});
