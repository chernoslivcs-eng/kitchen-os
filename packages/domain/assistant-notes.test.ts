import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from './in-memory-repo.js';
import { acceptAssistantNote, clampNoteText } from './assistant-notes.js';
import { noteHash } from './profile-text.js';

// Крок 8: межі нотаток асистента — детерміновано, без моделі.

const USER = 'u1';
const day = (h: number) => new Date(Date.UTC(2026, 8, 10, h, 0, 0));

describe('acceptAssistantNote', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('пише нотатку з source assistant, обрізану до 140 знаків', async () => {
    const long = 'а'.repeat(200);
    const r = await acceptAssistantNote(repo, USER, `  ${long}  `, day(10));
    expect(r.accepted).toBe(true);
    const [n] = await repo.listProfileNotes(USER);
    expect(n!.source).toBe('assistant');
    expect(Array.from(n!.text).length).toBe(140);
    expect(n!.norm_hash).toBe(noteHash(n!.text));
  });

  it('порожнє — не пише', async () => {
    expect((await acceptAssistantNote(repo, USER, '   ', day(10))).accepted).toBe(false);
    expect(await repo.listProfileNotes(USER)).toEqual([]);
  });

  it('дедуп по norm_hash проти останніх 30 (регістр і пунктуація не рахуються)', async () => {
    await acceptAssistantNote(repo, USER, 'Воду на пасту солити менше.', day(10));
    const r = await acceptAssistantNote(repo, USER, 'воду на пасту солити менше', day(11));
    expect(r).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(await repo.listProfileNotes(USER)).toHaveLength(1);
  });

  it('не більше 3 на день; наступного дня — знову можна', async () => {
    for (let i = 0; i < 3; i++) expect((await acceptAssistantNote(repo, USER, `нотатка ${i}`, day(10 + i))).accepted).toBe(true);
    expect(await acceptAssistantNote(repo, USER, 'четверта', day(14))).toMatchObject({ accepted: false, reason: 'daily_cap' });
    const next = new Date(Date.UTC(2026, 8, 11, 10));
    expect((await acceptAssistantNote(repo, USER, 'четверта', next)).accepted).toBe(true);
  });

  it('нотатки людини не рахуються в денний ліміт асистента', async () => {
    for (let i = 0; i < 3; i++) await repo.addProfileNote({ id: `h${i}`, user_id: USER, subject: null, text: `своя ${i}`, source: 'user', created_at: day(9).toISOString(), deleted_at: null, norm_hash: noteHash(`своя ${i}`) });
    expect((await acceptAssistantNote(repo, USER, 'від асистента', day(10))).accepted).toBe(true);
  });

  it('збіг із текстом поля профілю — не пише', async () => {
    await repo.patchProfileField(USER, 'no', { text: 'мʼяса, птиці' });
    expect(await acceptAssistantNote(repo, USER, 'Мʼяса, птиці', day(10))).toMatchObject({ accepted: false, reason: 'profile_text' });
  });

  it('видалена людиною за останні 30 днів — не повертається; старша за 30 днів — можна', async () => {
    const text = 'духовка гріє сильніше';
    await repo.addProfileNote({ id: 'd1', user_id: USER, subject: null, text, source: 'assistant', created_at: day(1).toISOString(), deleted_at: new Date(Date.UTC(2026, 8, 5)).toISOString(), norm_hash: noteHash(text) });
    expect(await acceptAssistantNote(repo, USER, text, day(10))).toMatchObject({ accepted: false, reason: 'deleted_recently' });
    const later = new Date(Date.UTC(2026, 9, 20));
    expect((await acceptAssistantNote(repo, USER, text, later)).accepted).toBe(true);
  });

  it('clampNoteText: пробіли згортаються, ліміт по символах', () => {
    expect(clampNoteText('  а   б \n в ')).toBe('а б в');
    expect(Array.from(clampNoteText('ї'.repeat(150))).length).toBe(140);
  });
});
