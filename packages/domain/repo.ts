// Repo — вузький порт до сховища. Дві реалізації: InMemoryRepo (для тестів
// і локального дев-режиму) і PostgresRepo (пізніше). Домен не знає про SQL.

import type {
  PantryBatch, PendingCard, Profile, AttachmentRecord,
  AuthChallenge, AuthSession, TokenUsageRow,
} from './types.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface Repo {
  // Комора
  listBatches(household_id: string): Promise<PantryBatch[]>;
  getBatch(id: string): Promise<PantryBatch | null>;
  findBatchByLabel(household_id: string, label: string): Promise<PantryBatch | null>;
  insertBatch(b: PantryBatch): Promise<void>;
  updateBatch(id: string, patch: Partial<PantryBatch>): Promise<void>;
  deleteBatch(id: string): Promise<void>;

  // Профіль
  getProfile(user_id: string): Promise<Profile | null>;
  upsertProfile(p: Profile): Promise<void>;

  // Картки на застосуванні
  savePending(pc: PendingCard): Promise<void>;
  getPending(id: string): Promise<PendingCard | null>;
  updatePending(id: string, patch: Partial<PendingCard>): Promise<void>;

  // Вкладення
  saveAttachment(a: AttachmentRecord): Promise<void>;
  getAttachment(id: string): Promise<AttachmentRecord | null>;
  updateAttachment(id: string, patch: Partial<AttachmentRecord>): Promise<void>;

  // Користувачі (обмежений набір: створити/знайти по email; без імені-тощо, це MVP)
  findUserByEmail(email: string): Promise<UserRow | null>;
  createUserWithHousehold(email: string, name: string): Promise<{ user_id: string; household_id: string }>;
  firstHouseholdOf(user_id: string): Promise<string | null>;

  // Автентифікація
  saveChallenge(c: AuthChallenge): Promise<void>;
  getChallengeByHash(token_hash: string): Promise<AuthChallenge | null>;
  consumeChallenge(id: string): Promise<void>;

  saveSession(s: AuthSession): Promise<void>;
  getSessionByCookieHash(cookie_hash: string): Promise<AuthSession | null>;
  touchSession(id: string, now: string, expires_at: string): Promise<void>;
  revokeSession(id: string): Promise<void>;

  // Облік токенів
  logTokenUsage(row: TokenUsageRow): Promise<void>;
  listTokenUsage(user_id: string, limit?: number): Promise<TokenUsageRow[]>;
}
