import { randomUUID } from 'node:crypto';
import type { Repo, UserRow, HouseholdRow, HouseholdMemberRow } from './repo.js';
import type {
  PantryBatch, PendingCard, Profile, AttachmentRecord,
  AuthChallenge, AuthSession, TokenUsageRow, HouseholdInvite, HouseholdRole,
  ShoppingItemRow, RecipeRow, CookRunRow, CookRunWithRecipe,
  SessionRow, MessageRow,
} from './types.js';
import { normalize } from '@kitchen/catalog';

export class InMemoryRepo implements Repo {
  private batches = new Map<string, PantryBatch>();
  private profiles = new Map<string, Profile>();
  private pending = new Map<string, PendingCard>();
  private attachments = new Map<string, AttachmentRecord>();
  private users = new Map<string, UserRow>();                 // by id
  private usersByEmail = new Map<string, string>();           // email → id
  private households = new Map<string, HouseholdRow>();       // by id
  private members: {
    household_id: string; user_id: string; role: HouseholdRole; joined_at: string;
  }[] = [];
  private challenges = new Map<string, AuthChallenge>();      // by token_hash
  private sessions = new Map<string, AuthSession>();          // by cookie_hash
  private tokenUsage: TokenUsageRow[] = [];
  private invites = new Map<string, HouseholdInvite>();          // by id
  private inviteByHash = new Map<string, string>();              // token_hash → id
  private shopping = new Map<string, ShoppingItemRow>();          // by id
  private recipes = new Map<string, RecipeRow>();
  private cookRuns = new Map<string, CookRunRow>();
  private chatSessions = new Map<string, SessionRow>();
  private chatSessionsByUserDay = new Map<string, string>();   // `${user_id}:${day}` → session_id
  private messages = new Map<string, MessageRow[]>();          // session_id → messages

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

  async getUser(id: string): Promise<UserRow | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async createUserWithHousehold(email: string, name: string): Promise<{ user_id: string; household_id: string }> {
    const key = email.toLowerCase();
    if (this.usersByEmail.has(key)) throw new Error(`user exists: ${email}`);
    const user_id = randomUUID();
    const household_id = randomUUID();
    const now = new Date().toISOString();
    this.users.set(user_id, { id: user_id, name, email: key, created_at: now });
    this.usersByEmail.set(key, user_id);
    this.households.set(household_id, { id: household_id, name: `Дім ${name}`, created_at: now });
    this.members.push({ household_id, user_id, role: 'owner', joined_at: now });
    return { user_id, household_id };
  }

  async createUserOnly(email: string, name: string): Promise<string> {
    const key = email.toLowerCase();
    if (this.usersByEmail.has(key)) throw new Error(`user exists: ${email}`);
    const user_id = randomUUID();
    this.users.set(user_id, { id: user_id, name, email: key, created_at: new Date().toISOString() });
    this.usersByEmail.set(key, user_id);
    return user_id;
  }

  async firstHouseholdOf(user_id: string): Promise<string | null> {
    const mine = this.members.filter((m) => m.user_id === user_id).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    return mine[0]?.household_id ?? null;
  }

  async getHousehold(id: string): Promise<HouseholdRow | null> {
    const h = this.households.get(id);
    return h ? { ...h } : null;
  }

  async listMembersOfHousehold(household_id: string): Promise<HouseholdMemberRow[]> {
    const out: HouseholdMemberRow[] = [];
    for (const m of this.members) {
      if (m.household_id !== household_id) continue;
      const u = this.users.get(m.user_id);
      if (!u) continue;
      out.push({
        user_id: u.id, name: u.name, email: u.email,
        role: m.role, joined_at: m.joined_at,
      });
    }
    return out.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  }

  async roleOf(household_id: string, user_id: string): Promise<HouseholdRole | null> {
    const m = this.members.find((x) => x.household_id === household_id && x.user_id === user_id);
    return m?.role ?? null;
  }
  async removeMember(household_id: string, user_id: string): Promise<void> {
    this.members = this.members.filter((m) => !(m.household_id === household_id && m.user_id === user_id));
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

  async getOrCreateSessionForDay(user_id: string, day: string): Promise<SessionRow> {
    const key = `${user_id}:${day}`;
    const existingId = this.chatSessionsByUserDay.get(key);
    if (existingId) {
      const s = this.chatSessions.get(existingId);
      if (s) return { ...s };
    }
    const id = randomUUID();
    const s: SessionRow = { id, user_id, title: null, day, created_at: new Date().toISOString() };
    this.chatSessions.set(id, s);
    this.chatSessionsByUserDay.set(key, id);
    this.messages.set(id, []);
    return { ...s };
  }
  async createFreshSession(user_id: string, day: string): Promise<SessionRow> {
    // Не переприв'язуємо мапу «user:day → session_id» — вона показує *останню*
    // сесію дня для гідратації, а нова стає такою.
    const id = randomUUID();
    const s: SessionRow = { id, user_id, title: null, day, created_at: new Date().toISOString() };
    this.chatSessions.set(id, s);
    this.chatSessionsByUserDay.set(`${user_id}:${day}`, id);
    this.messages.set(id, []);
    return { ...s };
  }
  async getSession(id: string): Promise<SessionRow | null> {
    const s = this.chatSessions.get(id);
    return s ? { ...s } : null;
  }
  async saveMessage(msg: MessageRow): Promise<void> {
    const arr = this.messages.get(msg.session_id) ?? [];
    arr.push({ ...msg });
    this.messages.set(msg.session_id, arr);
  }
  async listMessages(session_id: string): Promise<MessageRow[]> {
    return (this.messages.get(session_id) ?? []).map((m) => ({ ...m }));
  }
  async markMessageApplied(id: string, applied: number): Promise<void> {
    for (const arr of this.messages.values()) {
      const m = arr.find((x) => x.id === id);
      if (m) { m.applied = applied; return; }
    }
  }

  async saveRecipe(recipe: RecipeRow): Promise<void> {
    this.recipes.set(recipe.id, { ...recipe });
  }
  async getRecipe(id: string): Promise<RecipeRow | null> {
    return this.recipes.get(id) ?? null;
  }
  async saveCookRun(run: CookRunRow): Promise<void> {
    this.cookRuns.set(run.id, { ...run });
  }
  async getCookRun(id: string): Promise<CookRunRow | null> {
    const r = this.cookRuns.get(id);
    return r ? { ...r } : null;
  }
  async markCookRunUndone(id: string, undone_at: string): Promise<void> {
    const cur = this.cookRuns.get(id);
    if (cur) this.cookRuns.set(id, { ...cur, undone_at });
  }
  async updateCookRun(id: string, patch: Partial<Pick<CookRunRow, 'rating' | 'verdict' | 'photo_url'>>): Promise<void> {
    const cur = this.cookRuns.get(id);
    if (cur) this.cookRuns.set(id, { ...cur, ...patch });
  }
  async listCookRuns(user_id: string, limit = 20): Promise<CookRunWithRecipe[]> {
    return [...this.cookRuns.values()]
      .filter((r) => r.user_id === user_id)
      .sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at))
      .slice(0, limit)
      .map((r) => ({ ...r, recipe: this.recipes.get(r.recipe_id)! }))
      .filter((r) => r.recipe);
  }

  async listShoppingItems(household_id: string): Promise<ShoppingItemRow[]> {
    return [...this.shopping.values()]
      .filter((it) => it.household_id === household_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((it) => ({ ...it }));
  }
  async insertShoppingItem(item: ShoppingItemRow): Promise<void> {
    this.shopping.set(item.id, { ...item });
  }
  async toggleShoppingItem(id: string, checked: boolean): Promise<void> {
    const cur = this.shopping.get(id);
    if (cur) this.shopping.set(id, { ...cur, checked });
  }
  async deleteShoppingItem(id: string): Promise<void> {
    this.shopping.delete(id);
  }
  async findShoppingItemByLabel(household_id: string, label: string): Promise<ShoppingItemRow | null> {
    for (const it of this.shopping.values()) {
      if (it.household_id === household_id && it.label.toLowerCase() === label.toLowerCase()) return it;
    }
    return null;
  }

  async isMember(household_id: string, user_id: string): Promise<boolean> {
    return this.members.some((m) => m.household_id === household_id && m.user_id === user_id);
  }

  async addMember(household_id: string, user_id: string, role: HouseholdRole): Promise<void> {
    if (this.members.some((m) => m.household_id === household_id && m.user_id === user_id)) return;
    this.members.push({ household_id, user_id, role, joined_at: new Date().toISOString() });
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
