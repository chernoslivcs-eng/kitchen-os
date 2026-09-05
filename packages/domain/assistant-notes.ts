// Раунд 4, крок 8 (AUDIT-ROUND-4.md §7): нотатки від асистента. Модель віддає
// у відповіді необовʼязкове поле `note`; сервер вирішує, чи писати. Це зона
// асистента — без картки й підтвердження, тому межі тримає сервер:
// ≤140 знаків; дедуп по norm_hash проти останніх 30; не більше 3 на день;
// не писати, якщо текст збігається з полем профілю або з нотаткою, яку
// людина видалила за останні 30 днів.

import { randomUUID } from 'node:crypto';
import type { Repo } from './repo.js';
import { NOTE_TEXT_LIMIT, noteHash, normalizeNoteText, PROFILE_FIELD_KEYS, type ProfileNote } from './profile-text.js';

export const ASSISTANT_NOTE_DAILY_CAP = 3;
export const ASSISTANT_NOTE_DEDUP_WINDOW = 30;
export const DELETED_NOTE_BLOCK_DAYS = 30;

export type NoteRejectReason = 'empty' | 'duplicate' | 'daily_cap' | 'profile_text' | 'deleted_recently';
export type NoteDecision =
  | { accepted: true; note: ProfileNote }
  | { accepted: false; reason: NoteRejectReason; text: string };

// Крок 11 (прод-тест): обрізка до 140 — по останньому слову або розділовому
// знаку, не посеред слова: «…анчоуси дають усю сі» читалось як помилка.
// Якщо в межах ліміту немає жодного пробілу чи розділового (одне суцільне
// слово) — ріжемо по символу, як раніше.
export function clampNoteText(raw: string): string {
  const chars = Array.from(raw.replace(/\s+/g, ' ').trim());
  if (chars.length <= NOTE_TEXT_LIMIT) return chars.join('');
  const head = chars.slice(0, NOTE_TEXT_LIMIT);
  // Символ одразу за межею — пробіл або розділовий: межа вже на слові.
  const nextIsBoundary = /[\s.,;:!?…)»"']/.test(chars[NOTE_TEXT_LIMIT]!);
  let cut = head.length;
  if (!nextIsBoundary) {
    cut = -1;
    for (let i = head.length - 1; i > 0; i--) {
      if (/[\s.,;:!?…]/.test(head[i]!)) { cut = i; break; }
    }
    if (cut === -1) cut = head.length;
  }
  return head.slice(0, cut).join('').replace(/[\s,;:]+$/, '').trim();
}

const sameDay = (a: string, b: Date) => new Date(a).toDateString() === b.toDateString();

export async function acceptAssistantNote(repo: Repo, user_id: string, raw: string, now = new Date()): Promise<NoteDecision> {
  const text = clampNoteText(raw ?? '');
  if (!text) return { accepted: false, reason: 'empty', text };
  const hash = noteHash(text);
  const norm = normalizeNoteText(text);

  const all = await repo.listProfileNotes(user_id, { limit: 200, include_deleted: true });
  const live = all.filter((n) => !n.deleted_at);
  if (live.slice(0, ASSISTANT_NOTE_DEDUP_WINDOW).some((n) => n.norm_hash === hash)) {
    return { accepted: false, reason: 'duplicate', text };
  }
  const blockSince = now.getTime() - DELETED_NOTE_BLOCK_DAYS * 86_400_000;
  if (all.some((n) => n.deleted_at && new Date(n.deleted_at).getTime() >= blockSince && n.norm_hash === hash)) {
    return { accepted: false, reason: 'deleted_recently', text };
  }
  if (live.filter((n) => n.source === 'assistant' && sameDay(n.created_at, now)).length >= ASSISTANT_NOTE_DAILY_CAP) {
    return { accepted: false, reason: 'daily_cap', text };
  }
  const profile = await repo.getProfileText(user_id);
  if (PROFILE_FIELD_KEYS.some((k) => profile.fields[k].status === 'filled' && normalizeNoteText(profile.fields[k].text) === norm)) {
    return { accepted: false, reason: 'profile_text', text };
  }

  const note: ProfileNote = {
    id: randomUUID(), user_id, subject: null, text, source: 'assistant',
    created_at: now.toISOString(), deleted_at: null, norm_hash: hash,
  };
  await repo.addProfileNote(note);
  return { accepted: true, note };
}
