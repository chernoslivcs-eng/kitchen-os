// Repo — вузький порт до сховища. Дві реалізації: InMemoryRepo (для тестів
// і локального дев-режиму) і PostgresRepo (пізніше). Домен не знає про SQL.

import type {
  PantryBatch, PendingCard, Profile, AttachmentRecord,
  AuthChallenge, AuthSession, TokenUsageRow, HouseholdInvite, HouseholdRole,
} from './types.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface HouseholdRow {
  id: string;
  name: string;
  created_at: string;
}

export interface HouseholdMemberRow {
  user_id: string;
  name: string;
  email: string;
  role: HouseholdRole;
  joined_at: string;
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

  // Користувачі.
  // createUserWithHousehold — «оформив підписку»: новий юзер + власний дім, він у ньому власник.
  // createUserOnly — «гість»: тільки user-рядок. Далі його вручну додають у чужий дім
  // через addMember. Своєї комори гість не має за визначенням — це те, за що платить хазяїн.
  findUserByEmail(email: string): Promise<UserRow | null>;
  getUser(id: string): Promise<UserRow | null>;
  createUserWithHousehold(email: string, name: string): Promise<{ user_id: string; household_id: string }>;
  createUserOnly(email: string, name: string): Promise<string>;
  firstHouseholdOf(user_id: string): Promise<string | null>;
  getHousehold(id: string): Promise<HouseholdRow | null>;
  listMembersOfHousehold(household_id: string): Promise<HouseholdMemberRow[]>;
  roleOf(household_id: string, user_id: string): Promise<HouseholdRole | null>;

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

  // Дом-membership і запрошення
  isMember(household_id: string, user_id: string): Promise<boolean>;
  addMember(household_id: string, user_id: string, role: HouseholdRole): Promise<void>;
  saveInvite(inv: HouseholdInvite): Promise<void>;
  getInviteByHash(token_hash: string): Promise<HouseholdInvite | null>;
  getInvite(id: string): Promise<HouseholdInvite | null>;
  consumeInvite(id: string, consumed_by: string): Promise<void>;
  revokeInvite(id: string): Promise<void>;
  listInvitesForHousehold(household_id: string): Promise<HouseholdInvite[]>;
}
