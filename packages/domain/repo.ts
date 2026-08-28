// Repo — вузький порт до сховища. Дві реалізації: InMemoryRepo (для тестів
// і локального дев-режиму) і PostgresRepo (пізніше). Домен не знає про SQL.

import type { PantryBatch, PendingCard, Profile, AttachmentRecord } from './types.js';

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
}
