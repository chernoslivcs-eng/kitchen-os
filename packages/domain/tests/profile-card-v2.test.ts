import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, undoCard, dismissCard } from '../apply.js';
import { applyModeFor, CARD_BUTTON_LABEL } from '../card-modes.js';
import { renderRecentActions } from '../context.js';
import type { ProfileCard, PendingCard } from '../types.js';

// Раунд 4, крок 3 (AUDIT-ROUND-4.md §4): картка профілю — {field, mode, text}.
// append дописує через «. » з обрізкою по ліміту, replace — для онбордингу
// й «поправ: …», undo повертає попередній текст поля, «Нічого такого» на
// ban → status none і картка вважається застосованою.

const HOUSE = randomUUID();
const USER = randomUUID();

async function pend(repo: InMemoryRepo, card: ProfileCard) {
  const message_id = randomUUID();
  await createPending(repo, { message_id, household_id: HOUSE, user_id: USER, card });
  return message_id;
}

const field = (over: Partial<Extract<ProfileCard, { field: unknown }>> = {}): ProfileCard =>
  ({ type: 'profile', field: 'no', mode: 'append', text: 'селери', ...over }) as ProfileCard;

describe('картка профілю v2', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('кнопка одна — «Записати»; режим — confirm', () => {
    expect(CARD_BUTTON_LABEL.profile).toBe('Записати');
    expect(applyModeFor(field())).toBe('confirm');
  });

  it('append у порожнє поле → текст як є, status filled; applied = 1', async () => {
    const id = await pend(repo, field());
    const r = await applyCard(repo, id, [], USER);
    expect(r.applied).toBe(1);
    expect(r.truncated).toBe(false);
    expect((await repo.getProfileText(USER)).fields.no).toMatchObject({ text: 'селери', status: 'filled' });
  });

  it('append дописує (крок 4в: список іменників — через «, »); undo повертає попередній текст', async () => {
    await repo.patchProfileField(USER, 'no', { text: 'кінзи' });
    const id = await pend(repo, field({ text: 'селери' }));
    const r = await applyCard(repo, id, [], USER);
    expect((await repo.getProfileText(USER)).fields.no.text).toBe('кінзи, селери');
    await undoCard(repo, id, r.undo_token, USER);
    expect((await repo.getProfileText(USER)).fields.no).toMatchObject({ text: 'кінзи', status: 'filled' });
  });

  it('append понад ліміт — картка застосовується, текст обрізано, truncated: true', async () => {
    await repo.patchProfileField(USER, 'name', { text: 'П'.repeat(25) });
    const id = await pend(repo, field({ field: 'name', text: 'Білянський' }));
    const r = await applyCard(repo, id, [], USER);
    expect(r.applied).toBe(1);
    expect(r.truncated).toBe(true);
    const got = (await repo.getProfileText(USER)).fields.name.text;
    expect(Array.from(got).length).toBe(30);
    expect(got.startsWith('П'.repeat(25) + '. ')).toBe(true);
  });

  it('replace замінює поле цілком; undo повертає', async () => {
    await repo.patchProfileField(USER, 'love', { text: 'супи' });
    const id = await pend(repo, field({ field: 'love', mode: 'replace', text: 'тайську кухню' }));
    const r = await applyCard(repo, id, [], USER);
    expect((await repo.getProfileText(USER)).fields.love.text).toBe('тайську кухню');
    await undoCard(repo, id, r.undo_token, USER);
    expect((await repo.getProfileText(USER)).fields.love.text).toBe('супи');
  });

  it('undo на поле, що було none, повертає none; на поле, що було empty — empty', async () => {
    await repo.patchProfileField(USER, 'ban', { status: 'none' });
    const id = await pend(repo, field({ field: 'ban', text: 'арахіс' }));
    const r = await applyCard(repo, id, [], USER);
    expect((await repo.getProfileText(USER)).fields.ban).toMatchObject({ text: 'арахіс', status: 'filled' });
    await undoCard(repo, id, r.undo_token, USER);
    expect((await repo.getProfileText(USER)).fields.ban).toMatchObject({ text: '', status: 'none' });

    const id2 = await pend(repo, field({ field: 'meh', text: 'гостре' }));
    const r2 = await applyCard(repo, id2, [], USER);
    await undoCard(repo, id2, r2.undo_token, USER);
    expect((await repo.getProfileText(USER)).fields.meh).toMatchObject({ text: '', status: 'empty' });
  });

  it('«Нічого такого» на ban → status none, картка застосована (applied_at), undo повертає', async () => {
    const id = await pend(repo, field({ field: 'ban', mode: 'replace', text: '', onboarding: true }));
    const r = await applyCard(repo, id, [], USER, { none: true });
    expect(r.applied).toBe(1);
    expect((await repo.getProfileText(USER)).fields.ban.status).toBe('none');
    expect((await repo.getPending(id))?.applied_at).toBeTruthy();
    await undoCard(repo, id, r.undo_token, USER);
    expect((await repo.getProfileText(USER)).fields.ban.status).toBe('empty');
  });

  it('«Нічого такого» не для ban — помилка', async () => {
    const id = await pend(repo, field({ field: 'no', onboarding: true }));
    await expect(applyCard(repo, id, [], USER, { none: true })).rejects.toThrow(/ban/);
  });

  it('«Пропустити» на онбординг-картці — dismissed_at, поле не чіпається', async () => {
    const id = await pend(repo, field({ field: 'when', mode: 'replace', text: '', onboarding: true }));
    await dismissCard(repo, id, USER);
    expect((await repo.getPending(id))?.dismissed_at).toBeTruthy();
    expect((await repo.getProfileText(USER)).fields.when.status).toBe('empty');
  });

  it('порожній текст в append — нічого не лягло, applied 0', async () => {
    const id = await pend(repo, field({ text: '   ' }));
    const r = await applyCard(repo, id, [], USER);
    expect(r.applied).toBe(0);
    expect((await repo.getProfileText(USER)).fields.no.status).toBe('empty');
  });

  // Крок 11: ops-картка знає лише традиції й домашніх. Стара kind:note нікуди
  // не лягає і не рахується як застосована (QA4-05).
  it('ops-картка з kind:note (стара форма) нічого не пише', async () => {
    const card = { type: 'profile', ops: [{ op: 'add', kind: 'note', label: 'воду солити менше' }] } as unknown as ProfileCard;
    const r = await applyCard(repo, await pend(repo, card), [], USER);
    expect(r.applied).toBe(0);
    expect(await repo.listProfileNotes(USER)).toEqual([]);
  });
});

describe('[ОСТАННІ ДІЇ] для картки v2', () => {
  const pending = (card: ProfileCard, over: Partial<PendingCard> = {}): PendingCard => ({
    id: 'p1', message_id: 'p1', household_id: HOUSE, user_id: USER, card,
    applied_at: '2026-09-10T17:20:00', applied_ops: [0], undo_token: null, undo_snapshot: null,
    undone_at: null, dismissed_at: null, ...over,
  });
  const now = new Date('2026-09-10T18:00:00');

  it('«записав у „Я не їм": …»', () => {
    const out = renderRecentActions([pending(field({ text: 'селери' }))], now);
    expect(out).toContain('• 40 хв тому · записав у „Я не їм": селери — застосовано');
  });

  it('«Нічого такого» і пропуск читаються як такі', () => {
    const none = renderRecentActions([pending(field({ field: 'ban', mode: 'replace', text: '', onboarding: true }))], now);
    expect(none).toContain('записав у „Мені не можна": нічого такого — застосовано');
    const skipped = renderRecentActions([pending(field({ field: 'when', text: '', onboarding: true }), { applied_at: null, applied_ops: null, dismissed_at: '2026-09-10T17:20:00' })], now);
    expect(skipped).toContain('онбординг „Я зазвичай готую" — відхилено');
  });
});
