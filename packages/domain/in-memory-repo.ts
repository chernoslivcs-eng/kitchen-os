import type { Repo } from './repo.js';
import type { PantryBatch, PendingCard, Profile, AttachmentRecord } from './types.js';
import { normalize } from '@kitchen/catalog';

export class InMemoryRepo implements Repo {
  private batches = new Map<string, PantryBatch>();
  private profiles = new Map<string, Profile>();
  private pending = new Map<string, PendingCard>();
  private attachments = new Map<string, AttachmentRecord>();

  async listBatches(household_id: string): Promise<PantryBatch[]> {
    return [...this.batches.values()]
      .filter((b) => b.household_id === household_id)
      .sort((a, b) => a.added_at.localeCompare(b.added_at));
  }

  async getBatch(id: string): Promise<PantryBatch | null> {
    return this.batches.get(id) ?? null;
  }

  async findBatchByLabel(household_id: string, label: string): Promise<PantryBatch | null> {
    const norm = normalize(label);
    for (const b of this.batches.values()) {
      if (b.household_id !== household_id) continue;
      if (b.state === 'depleted') continue;
      if (normalize(b.label) === norm) return b;
    }
    // запасний шлях — часткове входження
    for (const b of this.batches.values()) {
      if (b.household_id !== household_id) continue;
      if (b.state === 'depleted') continue;
      if (normalize(b.label).includes(norm) || norm.includes(normalize(b.label))) return b;
    }
    return null;
  }

  async insertBatch(b: PantryBatch): Promise<void> {
    this.batches.set(b.id, { ...b });
  }

  async updateBatch(id: string, patch: Partial<PantryBatch>): Promise<void> {
    const cur = this.batches.get(id);
    if (!cur) throw new Error(`batch not found: ${id}`);
    this.batches.set(id, { ...cur, ...patch });
  }

  async deleteBatch(id: string): Promise<void> {
    this.batches.delete(id);
  }

  async getProfile(user_id: string): Promise<Profile | null> {
    return this.profiles.get(user_id) ?? null;
  }

  async upsertProfile(p: Profile): Promise<void> {
    this.profiles.set(p.user_id, { ...p });
  }

  async savePending(pc: PendingCard): Promise<void> {
    this.pending.set(pc.id, { ...pc });
  }

  async getPending(id: string): Promise<PendingCard | null> {
    return this.pending.get(id) ?? null;
  }

  async updatePending(id: string, patch: Partial<PendingCard>): Promise<void> {
    const cur = this.pending.get(id);
    if (!cur) throw new Error(`pending not found: ${id}`);
    this.pending.set(id, { ...cur, ...patch });
  }

  async saveAttachment(a: AttachmentRecord): Promise<void> {
    this.attachments.set(a.id, { ...a });
  }

  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    return this.attachments.get(id) ?? null;
  }

  async updateAttachment(id: string, patch: Partial<AttachmentRecord>): Promise<void> {
    const cur = this.attachments.get(id);
    if (!cur) throw new Error(`attachment not found: ${id}`);
    this.attachments.set(id, { ...cur, ...patch });
  }
}
