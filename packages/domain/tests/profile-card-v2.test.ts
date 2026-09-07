import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '../in-memory-repo.js';
import { createPending, applyCard, undoCard, dismissCard, NOTHING_APPLICABLE } from '../apply.js';
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

  // Крок П3 (1): усе, що нижче було про запис поля профілю з чату, померло
  // разом із формою. Лишились дві перевірки — що застосувати її вже не можна
  // і що вона нічого не змінює.
  it('картку поля профілю більше не застосувати — вона лишається відкритою', async () => {
    const id = await pend(repo, field());
    await expect(applyCard(repo, id, [], USER)).rejects.toThrow(NOTHING_APPLICABLE);
    const pc = await repo.getPending(id);
    expect(pc!.applied_at).toBeNull();
    expect(pc!.undo_token).toBeNull();
    // Профіль не змінився: продукт у нього більше не пише.
    expect((await repo.getProfileText(USER)).fields.no).toMatchObject({ text: '', status: 'empty' });
  });

  it('«Нічого такого» на ban теж більше не проходить через картку', async () => {
    const id = await pend(repo, field({ field: 'ban', text: '' }));
    await expect(applyCard(repo, id, [], USER, { none: true })).rejects.toThrow(NOTHING_APPLICABLE);
    expect((await repo.getProfileText(USER)).fields.ban.status).toBe('empty');
  });

  it('«Пропустити» на історичній картці — dismissed_at, поле не чіпається', async () => {
    const id = await pend(repo, field({ onboarding: true } as never));
    await dismissCard(repo, id, USER);
    expect((await repo.getPending(id))!.dismissed_at).not.toBeNull();
    expect((await repo.getProfileText(USER)).fields.no.status).toBe('empty');
  });


  it('ops-картка з kind:note (стара форма) нічого не пише і не закривається', async () => {
    const card = { type: 'profile', ops: [{ op: 'add', kind: 'note', label: 'воду солити менше' }] } as unknown as ProfileCard;
    const id = await pend(repo, card);
    await expect(applyCard(repo, id, [], USER)).rejects.toThrow(NOTHING_APPLICABLE);
    expect(await repo.listProfileNotes(USER)).toEqual([]);
    expect((await repo.getPending(id))!.applied_at).toBeNull();
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
