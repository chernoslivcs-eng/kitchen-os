import { randomUUID } from 'node:crypto';
import type { Repo, UserRow } from './repo.js';
import type {
  PantryBatch, PendingCard, Profile, AttachmentRecord,
  AuthChallenge, AuthSession, TokenUsageRow, HouseholdInvite, HouseholdRole,
} from './types.js';
import { normalize } from '@kitchen/catalog';

export class InMemoryRepo implements Repo {
  private batches = new Map<string, PantryBatch>();
  private profiles = new Map<string, Profile>();
  private pending = new Map<string, PendingCard>();
  private attachments = new Map<string, AttachmentRecord>();
  private users = new Map<string, UserRow>();                 // by id
  private usersByEmail = new Map<string, string>();           // email → id
  private members = new Map<string, string[]>();              // user_id → [household_id]
  private challenges = new Map<string, AuthChallenge>();      // by token_hash
  private sessions = new Map<string, AuthSession>();          // by cookie_hash
  private tokenUsage: TokenUsageRow[] = [];
  private invites = new Map<string, HouseholdInvite>();          // by id
  private inviteByHash = new Map<string, string>();              // token_hash → id

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

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const id = this.usersByEmail.get(email.toLowerCase());
    if (!id) return null;
    return this.users.get(id) ?? null;
  }

  async createUserWithHousehold(email: string, name: string): Promise<{ user_id: string; household_id: string }> {
    const key = email.toLowerCase();
    if (this.usersByEmail.has(key)) throw new Error(`user exists: ${email}`);
    const user_id = randomUUID();
    const household_id = randomUUID();
    this.users.set(user_id, { id: user_id, name, email: key, created_at: new Date().toISOString() });
    this.usersByEmail.set(key, user_id);
    this.members.set(user_id, [household_id]);
    return { user_id, household_id };
  }

  async firstHouseholdOf(user_id: string): Promise<string | null> {
    return this.members.get(user_id)?.[0] ?? null;
  }

  async saveChallenge(c: AuthChallenge): Promise<void> {
    this.challenges.set(c.token_hash, { ...c });
  }

  async getChallengeByHash(token_hash: string): Promise<AuthChallenge | null> {
    return this.challenges.get(token_hash) ?? null;
  }

  async consumeChallenge(id: string): Promise<void> {
    for (const [hash, c] of this.challenges) {
      if (c.id === id) {
        this.challenges.set(hash, { ...c, consumed_at: new Date().toISOString() });
        return;
      }
    }
  }

  async saveSession(s: AuthSession): Promise<void> {
    this.sessions.set(s.cookie_hash, { ...s });
  }

  async getSessionByCookieHash(cookie_hash: string): Promise<AuthSession | null> {
    return this.sessions.get(cookie_hash) ?? null;
  }

  async touchSession(id: string, now: string, expires_at: string): Promise<void> {
    for (const [hash, s] of this.sessions) {
      if (s.id === id) {
        this.sessions.set(hash, { ...s, last_seen_at: now, expires_at });
        return;
      }
    }
  }

  async revokeSession(id: string): Promise<void> {
    for (const [hash, s] of this.sessions) {
      if (s.id === id) {
        this.sessions.set(hash, { ...s, revoked_at: new Date().toISOString() });
        return;
      }
    }
  }

  async logTokenUsage(row: TokenUsageRow): Promise<void> {
    this.tokenUsage.push({ ...row });
  }

  async listTokenUsage(user_id: string, limit = 100): Promise<TokenUsageRow[]> {
    return this.tokenUsage
      .filter((r) => r.user_id === user_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async isMember(household_id: string, user_id: string): Promise<boolean> {
    return (this.members.get(user_id) ?? []).includes(household_id);
  }

  async addMember(household_id: string, user_id: string, _role: HouseholdRole): Promise<void> {
    const arr = this.members.get(user_id) ?? [];
    if (!arr.includes(household_id)) {
      arr.push(household_id);
      this.members.set(user_id, arr);
    }
  }

  async saveInvite(inv: HouseholdInvite): Promise<void> {
    this.invites.set(inv.id, { ...inv });
    this.inviteByHash.set(inv.token_hash, inv.id);
  }

  async getInviteByHash(token_hash: string): Promise<HouseholdInvite | null> {
    const id = this.inviteByHash.get(token_hash);
    if (!id) return null;
    return this.invites.get(id) ?? null;
  }

  async getInvite(id: string): Promise<HouseholdInvite | null> {
    return this.invites.get(id) ?? null;
  }

  async consumeInvite(id: string, consumed_by: string): Promise<void> {
    const cur = this.invites.get(id);
    if (!cur) return;
    this.invites.set(id, { ...cur, consumed_at: new Date().toISOString(), consumed_by });
  }

  async revokeInvite(id: string): Promise<void> {
    const cur = this.invites.get(id);
    if (!cur) return;
    this.invites.set(id, { ...cur, revoked_at: new Date().toISOString() });
  }

  async listInvitesForHousehold(household_id: string): Promise<HouseholdInvite[]> {
    return [...this.invites.values()]
      .filter((i) => i.household_id === household_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((i) => ({ ...i }));
  }
}
