import { randomUUID } from 'node:crypto';
import type { Repo, UserRow, HouseholdRow, HouseholdMemberRow } from './repo.js';
import type {
  PantryBatch, PendingCard, Profile, AttachmentRecord,
  AuthChallenge, AuthSession, TokenUsageRow, HouseholdInvite, HouseholdRole,
  ShoppingItemRow, RecipeRow, RecipeListItem, CookRunRow, CookRunWithRecipe, RetailConnectionRow,
  HouseholdEventRow, OccasionCatchRow, AdminOccasionRow, Card,
  SessionRow, MessageRow, MemoryNote, EaterRow,
} from './types.js';
import { normalize } from '@kitchen/catalog';
import { tripleKey, type HouseholdProduct, type ProductTriple } from './product.js';
import { BUILTIN_OCCASIONS, adminRowToOccasion, type OccasionRow } from './occasion-data.js';

export class InMemoryRepo implements Repo {
  private batches = new Map<string, PantryBatch>();
  private profiles = new Map<string, Profile>();
  private notes = new Map<string, MemoryNote>();
  private eaters = new Map<string, EaterRow>();
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
  private retail = new Map<string, RetailConnectionRow>();        // `${user_id}:${provider}`
  private events = new Map<string, HouseholdEventRow>();
  private muted = new Map<string, Set<string>>();   // household_id → occasion_id
  private catches = new Map<string, OccasionCatchRow>();
  private adminOccasions = new Map<string, AdminOccasionRow>();
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

  // ----- Продукти дому (черга Д, №2) -------------------------------------

  private products = new Map<string, HouseholdProduct>();

  async insertProduct(p: HouseholdProduct): Promise<void> {
    this.products.set(p.id, { ...p, tags: { ...p.tags } });
  }
  async getProduct(id: string): Promise<HouseholdProduct | null> {
    const p = this.products.get(id);
    return p ? { ...p, tags: { ...p.tags } } : null;
  }
  async findProductByTriple(household_id: string, t: ProductTriple): Promise<HouseholdProduct | null> {
    const key = tripleKey(t);
    for (const p of this.products.values()) {
      if (p.household_id === household_id && tripleKey(p) === key) {
        return { ...p, tags: { ...p.tags } };
      }
    }
    return null;
  }
  async listProducts(household_id: string): Promise<HouseholdProduct[]> {
    return [...this.products.values()]
      .filter((p) => p.household_id === household_id)
      .map((p) => ({ ...p, tags: { ...p.tags } }));
  }
  async updateProduct(id: string, patch: Partial<Omit<HouseholdProduct, 'id' | 'household_id' | 'created_at'>>): Promise<void> {
    const cur = this.products.get(id);
    if (!cur) throw new Error(`product not found: ${id}`);
    this.products.set(id, { ...cur, ...patch, tags: { ...(patch.tags ?? cur.tags) } });
  }

  async getProfile(user_id: string): Promise<Profile | null> {
    return this.profiles.get(user_id) ?? null;
  }

  async insertEater(e: EaterRow): Promise<void> {
    this.eaters.set(e.id, { ...e });
  }
  async listEaters(household_id: string): Promise<EaterRow[]> {
    return [...this.eaters.values()]
      .filter((e) => e.household_id === household_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async findEaterByName(household_id: string, name: string): Promise<EaterRow | null> {
    const n = name.trim().toLowerCase();
    return [...this.eaters.values()]
      .find((e) => e.household_id === household_id && e.name.trim().toLowerCase() === n) ?? null;
  }
  async deleteEater(id: string): Promise<void> {
    this.eaters.delete(id);
  }

  async insertNote(n: MemoryNote): Promise<void> {
    this.notes.set(n.id, { ...n });
  }

  // Порядок як в індексі memory_note: закріплені згори, далі найсвіжіші.
  // reverse() перед сортуванням — бо два висновки в одну мілісекунду дають
  // нічию за created_at, і тоді порядок вставки має читатись як «пізніший
  // згори». Map тримає порядок вставки, sort у V8 стабільний.
  async listNotes(user_id: string, limit = 20): Promise<MemoryNote[]> {
    return [...this.notes.values()]
      .filter((n) => n.user_id === user_id)
      .reverse()
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  async findNoteByText(user_id: string, text: string): Promise<MemoryNote | null> {
    const t = text.trim().toLowerCase();
    return [...this.notes.values()]
      .find((n) => n.user_id === user_id && n.text.trim().toLowerCase() === t) ?? null;
  }

  async deleteNote(id: string): Promise<void> {
    this.notes.delete(id);
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

  async listOpenPending(household_id: string, limit = 20): Promise<Array<PendingCard & { session_id: string | null; created_at: string | null }>> {
    const out: Array<PendingCard & { session_id: string | null; created_at: string | null }> = [];
    for (const pc of this.pending.values()) {
      if (pc.household_id !== household_id) continue;
      if (pc.applied_at || pc.undone_at) continue;
      const msg = await this.getMessage(pc.message_id);
      out.push({ ...pc, session_id: msg?.session_id ?? null, created_at: msg?.created_at ?? null });
    }
    out.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    return out.slice(0, limit);
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
  async setMemberRole(household_id: string, user_id: string, role: HouseholdRole): Promise<void> {
    this.members = this.members.map((m) =>
      (m.household_id === household_id && m.user_id === user_id) ? { ...m, role } : m
    );
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
  async listSessionsForUser(user_id: string, limit = 30): Promise<Array<SessionRow & { message_count: number }>> {
    return [...this.chatSessions.values()]
      .filter((s) => s.user_id === user_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((s) => ({ ...s, message_count: (this.messages.get(s.id) ?? []).length }));
  }
  async setSessionTitle(id: string, title: string): Promise<void> {
    const s = this.chatSessions.get(id);
    if (s) this.chatSessions.set(id, { ...s, title });
  }
  async saveMessage(msg: MessageRow): Promise<void> {
    const arr = this.messages.get(msg.session_id) ?? [];
    arr.push({ ...msg });
    this.messages.set(msg.session_id, arr);
  }
  async listMessages(session_id: string): Promise<MessageRow[]> {
    return (this.messages.get(session_id) ?? []).map((m) => ({ ...m }));
  }
  async deleteSession(id: string): Promise<void> {
    const msgs = this.messages.get(id) ?? [];
    for (const m of msgs) this.pending.delete(m.id);
    this.messages.delete(id);
    const sess = this.chatSessions.get(id);
    if (sess) this.chatSessionsByUserDay.delete(`${sess.user_id}:${sess.day}`);
    this.chatSessions.delete(id);
    for (const [rid, run] of this.cookRuns) {
      if (run.session_id === id) this.cookRuns.set(rid, { ...run, session_id: null });
    }
  }

  private exitSurveys: { email: string; reason: string; comment: string | null; created_at: string }[] = [];

  async recordExitSurvey(s: { email: string; reason: string; comment?: string | null }): Promise<void> {
    this.exitSurveys.push({ email: s.email, reason: s.reason, comment: s.comment ?? null, created_at: new Date().toISOString() });
  }

  async listExitSurveys() {
    return [...this.exitSurveys];
  }

  async deleteUserAccount(user_id: string): Promise<void> {
    // Доми, де юзер — єдиний член.
    const own = new Set(
      this.members.filter((m) => m.user_id === user_id).map((m) => m.household_id)
        .filter((hh) => this.members.every((m) => m.household_id !== hh || m.user_id === user_id)),
    );
    this.members = this.members.filter((m) => m.user_id !== user_id);
    for (const hh of own) {
      this.households.delete(hh);
      for (const [id, b] of this.batches) if (b.household_id === hh) this.batches.delete(id);
    }
    // Чат-сесії йдуть за юзером (SessionRow прив'язана до user_id, не до дому).
    for (const [id, s] of this.chatSessions) {
      if (s.user_id === user_id) await this.deleteSession(id);
    }
    const u = this.users.get(user_id);
    if (u) this.usersByEmail.delete(u.email);
    this.users.delete(user_id);
    for (const [hash, s] of this.sessions) if (s.user_id === user_id) this.sessions.delete(hash);
    this.profiles.delete(user_id);
  }

  async getMessage(id: string): Promise<MessageRow | null> {
    for (const arr of this.messages.values()) {
      const m = arr.find((x) => x.id === id);
      if (m) return { ...m };
    }
    return null;
  }
  async markMessageApplied(id: string, applied: number): Promise<void> {
    for (const arr of this.messages.values()) {
      const m = arr.find((x) => x.id === id);
      if (m) { m.applied = applied; return; }
    }
  }

  async updateMessageCard(id: string, card: Card): Promise<void> {
    for (const arr of this.messages.values()) {
      const m = arr.find((x) => x.id === id);
      if (m) { m.card = card; return; }
    }
  }

  async saveRecipe(recipe: RecipeRow): Promise<void> {
    this.recipes.set(recipe.id, { ...recipe });
  }
  async getRecipe(id: string): Promise<RecipeRow | null> {
    return this.recipes.get(id) ?? null;
  }
  async listRecipes(user_id: string, limit = 50): Promise<RecipeListItem[]> {
    const runs = [...this.cookRuns.values()].filter((r) => r.user_id === user_id && !r.undone_at);
    return [...this.recipes.values()]
      .filter((r) => r.owner_id === user_id)
      .map((r) => {
        const mine = runs.filter((c) => c.recipe_id === r.id);
        const last = mine
          .map((c) => c.finished_at ?? c.started_at)
          .sort()
          .pop() ?? null;
        return { ...r, cooked_count: mine.length, last_cooked_at: last };
      })
      // Збережені «на потім» і приготовані — решта (побічні артефакти) не показуємо.
      // QA9-08: сховані (hidden_at) не показуємо ніколи.
      .filter((r) => !r.hidden_at && (r.saved_at || r.cooked_count > 0))
      .sort((a, b) => (b.saved_at ?? b.created_at).localeCompare(a.saved_at ?? a.created_at))
      .slice(0, limit);
  }
  async listRecentRecipes(user_id: string, limit = 5): Promise<RecipeRow[]> {
    return [...this.recipes.values()]
      .filter((r) => r.owner_id === user_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async setRecipeSaved(id: string, saved_at: string | null): Promise<void> {
    const cur = this.recipes.get(id);
    if (cur) this.recipes.set(id, { ...cur, saved_at });
  }
  async setRecipeHidden(id: string, hidden_at: string | null): Promise<void> {
    const cur = this.recipes.get(id);
    if (cur) this.recipes.set(id, { ...cur, hidden_at });
  }
  async deleteRecipe(id: string): Promise<void> {
    this.recipes.delete(id);
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

  async upsertRetailConnection(c: RetailConnectionRow): Promise<void> {
    this.retail.set(`${c.user_id}:${c.provider}`, { ...c });
  }
  async getRetailConnection(user_id: string, provider: string): Promise<RetailConnectionRow | null> {
    const c = this.retail.get(`${user_id}:${provider}`);
    return c ? { ...c } : null;
  }
  async deleteRetailConnection(user_id: string, provider: string): Promise<void> {
    this.retail.delete(`${user_id}:${provider}`);
  }

  // ----- Календар ----------------------------------------------------------
  // Довідник у памʼяті — це константи домену. Іншого джерела в неї немає й не
  // мусить бути: Postgres віддає засіяну таблицю з тих самих рядків.
  async listOccasionCatalog(): Promise<OccasionRow[]> {
    const published = [...this.adminOccasions.values()]
      .filter((r) => r.published_at)
      .map(adminRowToOccasion);
    return [...BUILTIN_OCCASIONS.map((o) => ({ ...o })), ...published];
  }

  async listOwnEvents(household_id: string, user_id: string): Promise<HouseholdEventRow[]> {
    return [...this.events.values()]
      .filter((e) => e.household_id === household_id && e.created_by === user_id)
      .map((e) => ({ ...e }));
  }

  async getHouseholdEvent(id: string): Promise<HouseholdEventRow | null> {
    const e = this.events.get(id);
    return e ? { ...e } : null;
  }

  async insertHouseholdEvent(e: HouseholdEventRow): Promise<void> {
    this.events.set(e.id, { ...e });
  }

  async updateHouseholdEvent(
    id: string,
    patch: Partial<Pick<HouseholdEventRow,
      'title' | 'note' | 'rule' | 'buy' | 'servings' | 'supply' | 'expires_at' | 'done_at'>>,
  ): Promise<void> {
    const e = this.events.get(id);
    if (!e) return;
    this.events.set(id, { ...e, ...patch });
  }

  async deleteHouseholdEvent(id: string): Promise<void> {
    this.events.delete(id);
  }

  async listMutedOccasions(user_id: string): Promise<string[]> {
    return [...(this.muted.get(user_id) ?? [])];
  }

  async muteOccasion(user_id: string, occasion_id: string): Promise<void> {
    const set = this.muted.get(user_id) ?? new Set<string>();
    set.add(occasion_id);
    this.muted.set(user_id, set);
  }

  async unmuteOccasion(user_id: string, occasion_id: string): Promise<void> {
    this.muted.get(user_id)?.delete(occasion_id);
  }

  async listAdminOccasions(): Promise<AdminOccasionRow[]> {
    return [...this.adminOccasions.values()].map((r) => ({ ...r })).sort((a, b) => a.id.localeCompare(b.id));
  }

  async upsertAdminOccasion(row: AdminOccasionRow): Promise<void> {
    // Той самий контракт, що SQL ON CONFLICT DO UPDATE у PostgresRepo:
    // published_at на вставці — з переданого рядка (чернетка), на апдейті —
    // не чіпається. Публікація й правка — дві окремі дії, і правка не має
    // випадково скидати чи піднімати published_at лише тому, що викликач
    // передав старе значення поля.
    const existing = this.adminOccasions.get(row.id);
    this.adminOccasions.set(row.id, { ...row, published_at: existing ? existing.published_at : row.published_at });
  }

  async setOccasionPublished(id: string, published: boolean): Promise<void> {
    const row = this.adminOccasions.get(id);
    if (!row) return;
    row.published_at = published ? new Date().toISOString() : null;
  }

  async deleteAdminOccasion(id: string): Promise<void> {
    this.adminOccasions.delete(id);
  }

  async recordOccasionCatch(c: OccasionCatchRow): Promise<void> {
    const key = `${c.household_id}:${c.occasion_id}:${c.year}`;
    if (this.catches.has(key)) return;   // перше ловіння важить, повторне — ні
    this.catches.set(key, { ...c });
  }

  async listOccasionCatches(household_id: string, year?: number): Promise<OccasionCatchRow[]> {
    return [...this.catches.values()]
      .filter((c) => c.household_id === household_id && (year === undefined || c.year === year))
      .map((c) => ({ ...c }));
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
