import { randomUUID } from 'node:crypto';
import type { Repo, UserRow, HouseholdRow, HouseholdMemberRow, UserStampField, AdminHouseholdRow, AdminBetaRow, AdminMoneyGroup, AdminMoneyAverages, DigestCandidateRow } from './repo.js';
import type {
  PantryBatch, PendingCard, AttachmentRecord,
  AuthChallenge, AuthSession, TokenUsageRow, HouseholdInvite, HouseholdRole,
  ShoppingItemRow, RecipeRow, RecipeListItem, CookRunRow, CookRunWithRecipe, RetailConnectionRow,
  HouseholdEventRow, OccasionCatchRow, AdminOccasionRow, Card,
  SessionRow, MessageRow, LastAppliedIntake, IntakeCard, AppEventRow,
  TelegramAccountRow, TelegramLinkTokenRow, TelegramWebTokenRow, MergeStats,
} from './types.js';
import { normalize } from '@kitchen/catalog';
import { tripleKey, type HouseholdProduct, type ProductTriple } from './product.js';
import {
  clampProfileText, emptyProfileText, NOTES_IN_PROMPT,
  type ProfileText, type ProfileFieldKey, type ProfileFieldValue, type ProfileNote, type VetoRow, type VetoField,
} from './profile-text.js';
import { BUILTIN_OCCASIONS, adminRowToOccasion, type OccasionRow } from './occasion-data.js';
import type { OccasionSubscriptionRow } from './periods.js';
import type { HouseholdSubscription, PaymentIntent, PaymentRow, SubscriptionState } from './subscription.js';

export class InMemoryRepo implements Repo {
  private batches = new Map<string, PantryBatch>();
  // Раунд 4: сім речень, нотатки, вето.
  private profileTexts = new Map<string, ProfileText>();
  private profileNotes = new Map<string, ProfileNote>();
  private vetoRows: VetoRow[] = [];
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
  private subscriptions = new Map<string, Map<string, OccasionSubscriptionRow>>();   // household_id → occasion_id → рядок
  private catches = new Map<string, OccasionCatchRow>();
  private adminOccasions = new Map<string, AdminOccasionRow>();
  private recipes = new Map<string, RecipeRow>();
  private cookRuns = new Map<string, CookRunRow>();
  private chatSessions = new Map<string, SessionRow>();
  private chatSessionsByUserDay = new Map<string, string>();   // `${user_id}:${day}` → session_id
  private messages = new Map<string, MessageRow[]>();          // session_id → messages
  private telegramTokens = new Map<string, TelegramLinkTokenRow>();   // Р147: token → рядок
  private telegramWebTokens = new Map<string, TelegramWebTokenRow>(); // E: id → рядок
  private telegramAccounts = new Map<number, TelegramAccountRow>();  // Р147: telegram_user_id → рядок
  private digest = new Map<string, { enabled: boolean; sent_on: string | null; tz: string | null }>(); // дайджест: user_id → налаштування

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
    // А1: `depleted_reason` нормалізуємо до null, як це робить rowToBatch у
    // Postgres. Інакше два репозиторії відповідають по-різному на те саме
    // питання — «причини нема»: тут `undefined`, там `null`, — і контрактний
    // тест перестає бути контрактом.
    this.batches.set(b.id, { depleted_reason: null, ...b });
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
  // Ім'я НЕ `subscriptions`: воно вже зайняте підписками на приводи
  // (OccasionSubscriptionRow, міграція 0027). Це підписка дому на продукт.
  private householdSubs = new Map<string, HouseholdSubscription>();
  private payments: PaymentRow[] = [];
  private intents = new Map<string, PaymentIntent>();

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


  // ----- Раунд 4: профіль як сім речень ------------------------------------

  async getProfileText(user_id: string): Promise<ProfileText> {
    const cur = this.profileTexts.get(user_id) ?? emptyProfileText(user_id);
    const fields = {} as ProfileText['fields'];
    for (const k of Object.keys(cur.fields) as ProfileFieldKey[]) fields[k] = { ...cur.fields[k] };
    return { user_id, fields };
  }

  async patchProfileField(
    user_id: string, key: ProfileFieldKey, patch: { text: string } | { status: 'none' },
  ): Promise<ProfileFieldValue> {
    const cur = this.profileTexts.get(user_id) ?? emptyProfileText(user_id);
    const next: ProfileFieldValue = 'status' in patch
      ? { text: '', status: 'none', updated_at: new Date().toISOString() }
      : (() => {
          const text = clampProfileText(key, patch.text);
          return { text, status: text ? 'filled' : 'empty', updated_at: new Date().toISOString() };
        })();
    cur.fields[key] = next;
    this.profileTexts.set(user_id, cur);
    return { ...next };
  }

  async listProfileNotes(user_id: string, opts: { limit?: number; include_deleted?: boolean } = {}): Promise<ProfileNote[]> {
    const { limit = NOTES_IN_PROMPT, include_deleted = false } = opts;
    return [...this.profileNotes.values()]
      .filter((n) => n.user_id === user_id && (include_deleted || !n.deleted_at))
      .reverse()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((n) => ({ ...n }));
  }

  async addProfileNote(n: ProfileNote): Promise<void> {
    this.profileNotes.set(n.id, { ...n });
  }

  async deleteProfileNote(id: string): Promise<void> {
    const n = this.profileNotes.get(id);
    if (n && !n.deleted_at) n.deleted_at = new Date().toISOString();
  }

  async restoreProfileNote(id: string): Promise<void> {
    const n = this.profileNotes.get(id);
    if (n) n.deleted_at = null;
  }

  // Порядок: спершу `no`, потім `ban`; всередині поля — як у тексті (порядок
  // вставки). Так само читає PostgresRepo (ORDER BY field='ban', id).
  async getVetoIndex(user_id: string): Promise<VetoRow[]> {
    return this.vetoRows
      .filter((r) => r.user_id === user_id)
      .sort((a, b) => Number(a.field === 'ban') - Number(b.field === 'ban'))
      .map((r) => ({ ...r }));
  }

  async setVetoIndex(user_id: string, field: VetoField, rows: VetoRow[]): Promise<void> {
    this.vetoRows = this.vetoRows.filter((r) => !(r.user_id === user_id && r.field === field));
    for (const r of rows) this.vetoRows.push({ ...r, user_id, field });
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
      if (pc.applied_at || pc.undone_at || pc.dismissed_at) continue;
      const msg = await this.getMessage(pc.message_id);
      out.push({ ...pc, session_id: msg?.session_id ?? null, created_at: msg?.created_at ?? null });
    }
    out.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    return out.slice(0, limit);
  }

  async listRecentResolved(
    household_id: string,
    opts: { since: Date; limit: number; exclude_session_id?: string },
  ): Promise<PendingCard[]> {
    const sinceMs = opts.since.getTime();
    const out: (PendingCard & { resolvedMs: number })[] = [];
    for (const pc of this.pending.values()) {
      if (pc.household_id !== household_id) continue;
      const resolvedMs = Math.max(
        pc.applied_at ? new Date(pc.applied_at).getTime() : -Infinity,
        pc.undone_at ? new Date(pc.undone_at).getTime() : -Infinity,
        pc.dismissed_at ? new Date(pc.dismissed_at).getTime() : -Infinity,
      );
      if (resolvedMs === -Infinity || resolvedMs <= sinceMs) continue;
      if (opts.exclude_session_id) {
        const msg = await this.getMessage(pc.message_id);
        if (msg?.session_id === opts.exclude_session_id) continue;
      }
      out.push({ ...pc, resolvedMs });
    }
    out.sort((a, b) => b.resolvedMs - a.resolvedMs);
    return out.slice(0, opts.limit).map(({ resolvedMs: _resolvedMs, ...pc }) => pc);
  }

  // Крок Ш1: те саме, що робить вузький SQL у PostgresRepo — найсвіжіша
  // застосована, не скасована intake-картка з джерелом. Тут це фільтр по мапі:
  // джерело істини одне, форма відповіді спільна.
  async lastAppliedIntake(household_id: string, since: Date): Promise<LastAppliedIntake | null> {
    const sinceMs = since.getTime();
    let best: PendingCard | null = null;
    for (const pc of this.pending.values()) {
      if (pc.household_id !== household_id) continue;
      if (!pc.applied_at || pc.undone_at) continue;
      if (new Date(pc.applied_at).getTime() <= sinceMs) continue;
      if (pc.card?.type !== 'intake_diff') continue;
      const src = (pc.card as IntakeCard).source;
      // `!src` того самого змісту, що jsonb_typeof(...) = 'object' у SQL:
      // картка без джерела пропускається, найсвіжішою стає наступна.
      if (!src) continue;
      if (!best || new Date(pc.applied_at).getTime() > new Date(best.applied_at!).getTime()) best = pc;
    }
    if (!best) return null;
    return {
      applied_at: best.applied_at!,
      source: (best.card as IntakeCard).source!,
      created_batch_ids: best.undo_snapshot?.before.created_batch_ids ?? [],
    };
  }

  // Крок О1а: події. Масив, а не мапа — читання завжди по часу, не по id.
  private appEvents: AppEventRow[] = [];

  async saveAppEvents(rows: AppEventRow[]): Promise<void> {
    this.appEvents.push(...rows.map((r) => ({ ...r })));
  }

  async listAppEvents(user_id: string, opts: { from: Date; to: Date; limit: number }): Promise<AppEventRow[]> {
    return this.eventsWhere((e) => e.user_id === user_id, opts);
  }
  async listAppEventsForHousehold(household_id: string, opts: { from: Date; to: Date; limit: number }): Promise<AppEventRow[]> {
    return this.eventsWhere((e) => e.household_id === household_id, opts);
  }
  private eventsWhere(pick: (e: AppEventRow) => boolean, opts: { from: Date; to: Date; limit: number }): AppEventRow[] {
    return this.appEvents
      .filter(pick)
      .filter((e) => {
        const t = new Date(e.created_at).getTime();
        return t >= opts.from.getTime() && t < opts.to.getTime();
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, opts.limit);
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

  async touchUser(user_id: string, field: UserStampField, at: string): Promise<void> {
    const u = this.users.get(user_id);
    if (u) u[field] = at;
  }

  async updateUserEmail(user_id: string, email: string): Promise<void> {
    const u = this.users.get(user_id);
    if (!u) throw new Error(`user not found: ${user_id}`);
    const key = email.toLowerCase();
    if (u.email) this.usersByEmail.delete(u.email.toLowerCase());
    u.email = key;
    this.usersByEmail.set(key, user_id);
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
    this.users.set(user_id, { id: user_id, name, email: key, created_at: now, plan: 'beta', welcome_seen_at: null, profile_onboarding_at: null });
    this.usersByEmail.set(key, user_id);
    this.households.set(household_id, { id: household_id, name: `Дім ${name}`, created_at: now });
    this.members.push({ household_id, user_id, role: 'owner', joined_at: now });
    return { user_id, household_id };
  }

  async createUserOnly(email: string, name: string): Promise<string> {
    const key = email.toLowerCase();
    if (this.usersByEmail.has(key)) throw new Error(`user exists: ${email}`);
    const user_id = randomUUID();
    this.users.set(user_id, { id: user_id, name, email: key, created_at: new Date().toISOString(), plan: 'beta', welcome_seen_at: null, profile_onboarding_at: null });
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

  /**
   * Крок А2: та сама семантика, що в SQL-версії — доми з агрегатами, і доми
   * без жодної активності присутні нарівні з рештою.
   */
  async adminBetaRows(now: Date): Promise<AdminBetaRow[]> {
    const out: AdminBetaRow[] = [];
    const weekAgo = now.getTime() - 7 * 86_400_000;
    for (const u of this.users.values()) {
      const mem = [...this.members].filter((m) => m.user_id === u.id).sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0];
      if (!mem) continue;
      const hh = this.households.get(mem.household_id);
      const tg = [...this.telegramAccounts.values()].find((a) => a.user_id === u.id && !a.revoked_at) ?? null;
      const hadMagic = !!u.email && [...this.challenges.values()].some((c) => (c.kind ?? 'email') === 'email' && c.email === u.email && c.consumed_at);
      const source: AdminBetaRow['source'] = !u.email ? 'telegram' : hadMagic ? 'email' : tg ? 'telegram' : 'google';
      const sessions = [...this.chatSessions.values()].filter((s) => s.user_id === u.id);
      const msgs = sessions.flatMap((s) => this.messages.get(s.id) ?? []);
      const userMsgs = msgs.filter((m) => m.role === 'user').sort((a, b) => a.created_at.localeCompare(b.created_at));
      const profile = this.profileTexts.get(u.id);
      const runs = [...this.cookRuns.values()].filter((r) => r.user_id === u.id && !r.undone_at);
      const seen = [...this.sessions.values()].filter((a) => a.user_id === u.id).map((a) => a.last_seen_at).sort();
      const days = new Set<string>();
      for (const e of this.appEvents) if (e.user_id === u.id && new Date(e.created_at).getTime() >= weekAgo) days.add(e.created_at.slice(0, 10));
      for (const m of userMsgs) if (new Date(m.created_at).getTime() >= weekAgo) days.add(m.created_at.slice(0, 10));
      out.push({
        user_id: u.id, name: u.name, email: u.email, household_id: mem.household_id, household_name: hh?.name ?? '',
        started_at: u.created_at, source, telegram_user_id: tg?.telegram_user_id ?? null,
        pantry: [...this.batches.values()].filter((b) => b.household_id === mem.household_id && b.state !== 'depleted').length,
        profile_filled: profile ? Object.values(profile.fields).filter((f) => f.status !== 'empty').length : 0,
        dinner_asks: msgs.filter((m) => m.role === 'assistant' && m.card?.type === 'proposal').length,
        cooks: runs.filter((r) => r.finished_at).length,
        feedback: runs.filter((r) => r.rating != null || (r.verdict && r.verdict.trim())).length,
        periods: [...this.pending.values()].filter((p) => p.user_id === u.id && p.applied_at && (p.card.type === 'period' || p.card.type === 'event')).length,
        invites: [...this.invites.values()].filter((i) => i.invited_by === u.id).length,
        silpo: [...this.retail.values()].some((r) => r.user_id === u.id && r.provider === 'silpo' && r.status === 'active'),
        last_seen_at: seen.at(-1) ?? null,
        last_channel: userMsgs.length ? (userMsgs.at(-1)!.channel ?? 'web') : null,
        active_days_7: days.size,
      });
    }
    return out;
  }

  async listAdminHouseholds(): Promise<AdminHouseholdRow[]> {
    const out: AdminHouseholdRow[] = [];
    for (const h of this.households.values()) {
      const mem = this.members.filter((m) => m.household_id === h.id);
      const userIds = new Set(mem.map((m) => m.user_id));
      const sessionIds = [...this.chatSessions.values()]
        .filter((s) => userIds.has(s.user_id)).map((s) => s.id);
      const msgs = sessionIds.flatMap((id) => this.messages.get(id) ?? []);
      const seen = [...this.sessions.values()]
        .filter((a) => userIds.has(a.user_id)).map((a) => a.last_seen_at);
      const ownerMem = [...mem].sort((a, b) => a.joined_at.localeCompare(b.joined_at))
        .find((m) => m.role === 'owner');
      const owner = ownerMem ? this.users.get(ownerMem.user_id) : undefined;
      out.push({
        id: h.id,
        name: h.name,
        created_at: h.created_at,
        people: mem.length,
        last_turn_at: msgs.length ? msgs.map((m) => m.created_at).sort().at(-1)! : null,
        turns: msgs.filter((m) => m.role === 'user').length,
        last_seen_at: seen.length ? seen.slice().sort().at(-1)! : null,
        owner_id: owner?.id ?? null,
        owner_name: owner?.name ?? null,
        owner_email: owner?.email ?? null,
        telegram: [...this.telegramAccounts.values()].some((a) => userIds.has(a.user_id) && !a.revoked_at),
      });
    }
    return out.sort((a, b) => {
      if (a.last_turn_at && b.last_turn_at) return b.last_turn_at.localeCompare(a.last_turn_at);
      if (a.last_turn_at) return -1;
      if (b.last_turn_at) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }

  /** Крок А4: та сама семантика, що в SQL-версії — групи, не сирі рядки. */
  async adminMoneyGroups(q: {
    now: { from: Date; to: Date };
    prev: { from: Date; to: Date };
    technicalLike: string | null;
  }): Promise<AdminMoneyGroup[]> {
    const inRange = (iso: string, b: { from: Date; to: Date }) => {
      const t = new Date(iso).getTime();
      return t >= b.from.getTime() && t < b.to.getTime();
    };
    const buckets = new Map<string, AdminMoneyGroup>();
    for (const r of this.tokenUsage) {
      const period = inRange(r.created_at, q.now) ? 'now'
        : inRange(r.created_at, q.prev) ? 'prev' : null;
      if (!period) continue;
      if (this.isTechnicalHousehold(r.household_id, q.technicalLike)) continue;
      const has_turn = r.message_id !== null;
      const hasActual = r.usd_actual != null;
      const key = [period, r.household_id, r.user_id, r.call, r.model, r.profile, r.mode, has_turn, hasActual].join('\u0000');
      let g = buckets.get(key);
      if (!g) {
        g = {
          period, household_id: r.household_id, user_id: r.user_id,
          call: r.call, model: r.model, profile: r.profile, mode: r.mode, has_turn,
          calls: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0,
          cache_write_tokens: 0, rows_without_write: 0,
          latency_sum_ms: 0, latency_n: 0,
          usd_actual: hasActual ? 0 : null,
        };
        buckets.set(key, g);
      }
      g.calls += 1;
      if (hasActual) g.usd_actual = (g.usd_actual ?? 0) + (r.usd_actual ?? 0);
      g.input_tokens += r.input_tokens;
      g.output_tokens += r.output_tokens;
      g.cached_tokens += r.cached_tokens;
      if (r.cache_write_tokens === null) g.rows_without_write += 1;
      else g.cache_write_tokens += r.cache_write_tokens;
      if (r.latency_ms !== null) { g.latency_sum_ms += r.latency_ms; g.latency_n += 1; }
    }
    return [...buckets.values()];
  }

  async listTokenUsageWithoutActual(limit: number): Promise<{ id: string; generation_id: string }[]> {
    return this.tokenUsage
      .filter((r) => r.generation_id && r.usd_actual == null && r.mode === 'live')
      .slice(-limit)
      .map((r) => ({ id: r.id, generation_id: r.generation_id! }));
  }
  async setTokenUsageActual(id: string, usd_actual: number): Promise<void> {
    const r = this.tokenUsage.find((x) => x.id === id);
    if (r) r.usd_actual = usd_actual;
  }

  async adminMoneyAverages(q: {
    now: { from: Date; to: Date };
    technicalLike: string | null;
    tz: string;
  }): Promise<AdminMoneyAverages> {
    const live = this.tokenUsage.filter((r) => {
      const t = new Date(r.created_at).getTime();
      if (t < q.now.from.getTime() || t >= q.now.to.getTime()) return false;
      if (r.mode !== 'live') return false;
      return !this.isTechnicalHousehold(r.household_id, q.technicalLike);
    });
    const lat = live.map((r) => r.latency_ms).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const turns = new Set(live.filter((r) => r.message_id).map((r) => r.message_id));
    // Пари «людина × місцевий день, у який вона писала» — знаменник для ходів.
    const personDays = new Set(
      live.filter((r) => r.message_id)
        .map((r) => {
          const d = new Date(r.created_at);
          return `${r.user_id}:${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        }),
    );
    const all = this.tokenUsage.filter((r) => r.mode === 'live').map((r) => r.created_at).sort();
    return {
      turns: turns.size,
      latency_avg_ms: lat.length ? Math.round(lat.reduce((n, x) => n + x, 0) / lat.length) : null,
      latency_p95_ms: lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]! : null,
      latency_n: lat.length,
      person_days: personDays.size,
      first_usage_at: all[0] ?? null,
      cache_write_since: this.tokenUsage
        .filter((r) => r.mode === 'live' && r.cache_write_tokens !== null)
        .map((r) => r.created_at).sort()[0] ?? null,
    };
  }

  /** Дім вважається технічним за поштою власника — те саме правило, що в SQL. */
  private isTechnicalHousehold(household_id: string | null, like: string | null): boolean {
    if (!like || !household_id) return false;
    const suffix = like.replace(/^%/, '').toLowerCase();
    const owner = this.members
      .filter((m) => m.household_id === household_id && m.role === 'owner')
      .map((m) => this.users.get(m.user_id))
      .find(Boolean);
    return !!owner && !!owner.email && owner.email.toLowerCase().endsWith(suffix);
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

  async attachChallengeUser(id: string, user_id: string): Promise<void> {
    for (const [hash, c] of this.challenges) {
      if (c.id === id) {
        this.challenges.set(hash, { ...c, user_id });
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
  async listTokenUsageForHousehold(household_id: string, limit = 100): Promise<TokenUsageRow[]> {
    return this.tokenUsage
      .filter((r) => r.household_id === household_id)
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
  // ── Р147: Telegram ──
  async saveTelegramLinkToken(row: TelegramLinkTokenRow): Promise<void> {
    this.telegramTokens.set(row.token, { ...row });
  }
  async consumeTelegramLinkToken(token: string, now: string): Promise<TelegramLinkTokenRow | null> {
    const row = this.telegramTokens.get(token);
    if (!row || row.consumed_at || row.expires_at <= now) return null;
    const next = { ...row, consumed_at: now };
    this.telegramTokens.set(token, next);
    return { ...next };
  }
  async saveTelegramWebToken(row: TelegramWebTokenRow): Promise<void> {
    this.telegramWebTokens.set(row.id, { ...row });
  }
  async getLiveTelegramWebToken(user_id: string, now: string): Promise<TelegramWebTokenRow | null> {
    const live = [...this.telegramWebTokens.values()]
      .filter((t) => t.user_id === user_id && !t.revoked_at && t.expires_at > now)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return live[0] ? { ...live[0] } : null;
  }
  async getTelegramWebTokenByHash(token_hash: string): Promise<TelegramWebTokenRow | null> {
    const row = [...this.telegramWebTokens.values()].find((t) => t.token_hash === token_hash);
    return row ? { ...row } : null;
  }
  async revokeTelegramWebTokens(user_id: string, now: string): Promise<void> {
    for (const [id, t] of this.telegramWebTokens) {
      if (t.user_id === user_id && !t.revoked_at) this.telegramWebTokens.set(id, { ...t, revoked_at: now });
    }
  }
  async linkTelegram(row: TelegramAccountRow): Promise<void> {
    this.telegramAccounts.set(row.telegram_user_id, { ...row, revoked_at: null });
  }
  async getTelegramByUser(user_id: string): Promise<TelegramAccountRow | null> {
    const rows = [...this.telegramAccounts.values()].filter((a) => a.user_id === user_id && !a.revoked_at)
      .sort((a, b) => b.linked_at.localeCompare(a.linked_at));
    return rows[0] ? { ...rows[0] } : null;
  }
  async getTelegramByTelegramUser(telegram_user_id: number): Promise<TelegramAccountRow | null> {
    const a = this.telegramAccounts.get(telegram_user_id);
    return a ? { ...a } : null;
  }
  async revokeTelegram(user_id: string, at: string): Promise<void> {
    for (const [k, a] of this.telegramAccounts) if (a.user_id === user_id && !a.revoked_at) this.telegramAccounts.set(k, { ...a, revoked_at: at });
  }
  // PR 1 (TELEGRAM-AUTH-PAY-PLAN-0915): акаунт із Telegram-id, без пошти.
  async getUserByTelegramId(telegram_user_id: number): Promise<UserRow | null> {
    const a = this.telegramAccounts.get(telegram_user_id);
    if (!a || a.revoked_at) return null;
    const u = this.users.get(a.user_id);
    return u ? { ...u } : null;
  }
  async createUserFromTelegram(tg: { telegram_user_id: number; chat_id: number | null; name: string }): Promise<{ user_id: string; household_id: string }> {
    const user_id = randomUUID();
    const household_id = randomUUID();
    const now = new Date().toISOString();
    this.users.set(user_id, { id: user_id, name: tg.name, email: null, created_at: now, plan: 'beta', welcome_seen_at: null, profile_onboarding_at: null });
    this.households.set(household_id, { id: household_id, name: `Дім ${tg.name}`, created_at: now });
    this.members.push({ household_id, user_id, role: 'owner', joined_at: now });
    this.telegramAccounts.set(tg.telegram_user_id, { telegram_user_id: tg.telegram_user_id, user_id, chat_id: tg.chat_id, linked_at: now, revoked_at: null });
    return { user_id, household_id };
  }

  async saveMessage(msg: MessageRow): Promise<void> {
    const arr = this.messages.get(msg.session_id) ?? [];
    arr.push({ ...msg });
    this.messages.set(msg.session_id, arr);
  }
  async listMessages(session_id: string): Promise<MessageRow[]> {
    // Аудит раунд 3: undone_at/dismissed_at не зберігаються на message —
    // приєднуються з card_pending за спільним id (message.id === pending.id),
    // те саме, що робить PostgresRepo LEFT JOIN'ом.
    // Пул-9 №2: вкладення ходу приєднуються так само — за attachment.message_id.
    const attByMsg = new Map<string, { id: string; mime: string | null }[]>();
    for (const a of this.attachments.values()) {
      if (!a.message_id) continue;
      const list = attByMsg.get(a.message_id) ?? [];
      list.push({ id: a.id, mime: a.content_type ?? null });
      attByMsg.set(a.message_id, list);
    }
    return (this.messages.get(session_id) ?? []).map((m) => {
      const pc = this.pending.get(m.id);
      const att = attByMsg.get(m.id);
      return {
        ...m,
        undone_at: pc?.undone_at ?? null,
        dismissed_at: pc?.dismissed_at ?? null,
        ...(att ? { attachments: att } : {}),
      };
    });
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

  // ── Намір оплати (спек біллінгу §4) ──
  async insertIntent(i: PaymentIntent): Promise<void> { this.intents.set(i.order_id, { ...i }); }
  async getIntent(order_id: string): Promise<PaymentIntent | null> { return this.intents.get(order_id) ?? null; }
  async updateIntent(order_id: string, patch: Partial<Pick<PaymentIntent, 'state' | 'card_mask' | 'card_token' | 'household_id' | 'bound_at'>>): Promise<void> {
    const cur = this.intents.get(order_id);
    if (cur) this.intents.set(order_id, { ...cur, ...patch });
  }
  async listIntentsExpiring(before: Date): Promise<PaymentIntent[]> {
    return [...this.intents.values()].filter((i) => (i.state === 'pending' || i.state === 'subscribed') && new Date(i.expires_at) <= before);
  }

  // ── Підписка дому (спек 2026-09-25 §6) ──
  async getSubscription(household_id: string): Promise<HouseholdSubscription | null> {
    return this.householdSubs.get(household_id) ?? null;
  }
  async saveSubscription(sub: HouseholdSubscription): Promise<void> {
    this.householdSubs.set(sub.household_id, { ...sub });
  }
  async findSubscriptionByOrder(order_id: string): Promise<HouseholdSubscription | null> {
    return [...this.householdSubs.values()].find((s) => s.provider_order_id === order_id) ?? null;
  }
  async listSubscriptionsByState(states: SubscriptionState[]): Promise<HouseholdSubscription[]> {
    return [...this.householdSubs.values()].filter((s) => states.includes(s.state));
  }
  async insertPayment(p: Omit<PaymentRow, 'id'>): Promise<boolean> {
    if (p.provider_payment_id && this.payments.some((x) => x.provider_payment_id === p.provider_payment_id)) return false;
    this.payments.push({ id: randomUUID(), ...p });
    return true;
  }
  async listPayments(household_id: string): Promise<PaymentRow[]> {
    return this.payments.filter((p) => p.household_id === household_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async householdLastSeenAt(household_id: string): Promise<string | null> {
    const users = new Set(this.members.filter((m) => m.household_id === household_id).map((m) => m.user_id));
    const seen = [...this.sessions.values()].filter((a) => users.has(a.user_id)).map((a) => a.last_seen_at);
    return seen.length ? seen.slice().sort().at(-1)! : null;
  }
  /**
   * Дім цілком. Акаунти членів лишаються — їх прибирає окреме правило
   * (`deleteUserAccount`). Порядок тут не важить: усе в памʼяті процесу.
   */
  async deleteHousehold(household_id: string): Promise<void> {
    this.households.delete(household_id);
    this.householdSubs.delete(household_id);
    this.payments = this.payments.filter((p) => p.household_id !== household_id);
    this.members = this.members.filter((m) => m.household_id !== household_id);
    for (const [id, b] of this.batches) if (b.household_id === household_id) this.batches.delete(id);
    for (const [id, p] of this.products) if (p.household_id === household_id) this.products.delete(id);
    // Рецепти НЕ належать дому: у схемі (recipe.owner_id) вони висять на
    // людині, і видалення дому їх не чіпає — акаунт лишається, рецепти з ним.
    for (const [id, c] of this.cookRuns) if (c.household_id === household_id) this.cookRuns.delete(id);
    for (const [id, e] of this.events) if (e.household_id === household_id) this.events.delete(id);
    for (const [id, i] of this.shopping) if (i.household_id === household_id) this.shopping.delete(id);
    for (const [id, i] of this.invites) if (i.household_id === household_id) this.invites.delete(id);
    for (const [id, c] of this.pending) if (c.household_id === household_id) this.pending.delete(id);
    for (const [id, a] of this.attachments) if (a.household_id === household_id) this.attachments.delete(id);
    this.subscriptions.delete(household_id);
    for (const [id, c] of this.catches) if (c.household_id === household_id) this.catches.delete(id);
    this.appEvents = this.appEvents.filter((e) => e.household_id !== household_id);
    this.tokenUsage = this.tokenUsage.map((t) => (t.household_id === household_id ? { ...t, household_id: null } : t));
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
    if (u?.email) this.usersByEmail.delete(u.email);
    this.users.delete(user_id);
    for (const [hash, s] of this.sessions) if (s.user_id === user_id) this.sessions.delete(hash);
    this.profileTexts.delete(user_id);
    for (const [id, n] of this.profileNotes) if (n.user_id === user_id) this.profileNotes.delete(id);
    this.vetoRows = this.vetoRows.filter((r) => r.user_id !== user_id);
  }

  // ── Дайджест (DIGEST-PLAN-0917) ──
  private digestOf(user_id: string) {
    let d = this.digest.get(user_id);
    if (!d) { d = { enabled: true, sent_on: null, tz: null }; this.digest.set(user_id, d); }
    return d;
  }
  /** Тестовий шов: пояс людини (колонка user.tz). */
  setUserTz(user_id: string, tz: string | null): void { this.digestOf(user_id).tz = tz; }
  async listDigestCandidates(): Promise<DigestCandidateRow[]> {
    const out: DigestCandidateRow[] = [];
    for (const a of this.telegramAccounts.values()) {
      if (a.revoked_at || a.chat_id == null || !this.users.has(a.user_id)) continue;
      const household_id = await this.firstHouseholdOf(a.user_id);
      if (!household_id) continue;
      const d = this.digestOf(a.user_id);
      out.push({ user_id: a.user_id, household_id, chat_id: a.chat_id, tz: d.tz, digest_enabled: d.enabled, digest_sent_on: d.sent_on });
    }
    return out;
  }
  async setDigestSentOn(user_id: string, day: string): Promise<void> { this.digestOf(user_id).sent_on = day; }
  async setDigestEnabled(user_id: string, enabled: boolean): Promise<void> { this.digestOf(user_id).enabled = enabled; }
  async getDigestEnabled(user_id: string): Promise<boolean> { return this.digestOf(user_id).enabled; }
  async hasUserMessageSince(user_id: string, since: string): Promise<boolean> {
    for (const [sid, s] of this.chatSessions) {
      if (s.user_id !== user_id) continue;
      if ((this.messages.get(sid) ?? []).some((m) => m.role === 'user' && m.created_at >= since)) return true;
    }
    return false;
  }

  // ── Злиття акаунтів (15.09) ──
  async setChallengeStatus(id: string, status: 'no_account'): Promise<void> {
    for (const c of this.challenges.values()) if (c.id === id) c.status = status;
  }
  async setChallengeConflict(id: string, conflict_user_id: string): Promise<void> {
    for (const c of this.challenges.values()) if (c.id === id) c.conflict_user_id = conflict_user_id;
  }
  async setTelegramLinkConflict(token: string, conflict_user_id: string): Promise<void> {
    const t = this.telegramTokens.get(token);
    if (t) t.conflict_user_id = conflict_user_id;
  }
  async findConflictProof(user_id: string, since: string): Promise<{ kind: 'telegram' | 'email'; from_user_id: string; proven_at: string } | null> {
    const found: { kind: 'telegram' | 'email'; from_user_id: string; proven_at: string }[] = [];
    for (const t of this.telegramTokens.values()) {
      if (t.user_id === user_id && t.conflict_user_id && t.consumed_at && t.consumed_at >= since) found.push({ kind: 'telegram', from_user_id: t.conflict_user_id, proven_at: t.consumed_at });
    }
    for (const c of this.challenges.values()) {
      if (c.user_id === user_id && c.conflict_user_id && c.consumed_at && c.consumed_at >= since) found.push({ kind: 'email', from_user_id: c.conflict_user_id, proven_at: c.consumed_at });
    }
    found.sort((a, b) => b.proven_at.localeCompare(a.proven_at));
    return found[0] ?? null;
  }
  async clearConflictProof(user_id: string): Promise<void> {
    for (const t of this.telegramTokens.values()) if (t.user_id === user_id) t.conflict_user_id = null;
    for (const c of this.challenges.values()) if (c.user_id === user_id) c.conflict_user_id = null;
  }
  async revokeAllSessionsOfUser(user_id: string, now: string): Promise<void> {
    for (const s of this.sessions.values()) if (s.user_id === user_id && !s.revoked_at) s.revoked_at = now;
  }
  async mergeAccounts(from_user_id: string, into_user_id: string, into_household_id: string, now: string): Promise<MergeStats> {
    const stats: MergeStats = { batches: 0, products: 0, recipes: 0, sessions: 0, email_moved: false };
    const fromHouseholds = this.members.filter((m) => m.user_id === from_user_id).map((m) => m.household_id);
    for (const hh of fromHouseholds) {
      // Продукти: та сама трійка — перевісити партії на продукт нового дому; інакше переїхати.
      const remap = new Map<string, string>();
      for (const [id, p] of this.products) {
        if (p.household_id !== hh) continue;
        const dup = await this.findProductByTriple(into_household_id, p);
        if (dup) { remap.set(id, dup.id); this.products.delete(id); }
        else { p.household_id = into_household_id; stats.products++; }
      }
      for (const b of this.batches.values()) {
        if (b.household_id !== hh) continue;
        b.household_id = into_household_id;
        if (b.product_id && remap.has(b.product_id)) b.product_id = remap.get(b.product_id)!;
        stats.batches++;
      }
      for (const it of this.shopping.values()) if (it.household_id === hh) it.household_id = into_household_id;
      for (const e of this.events.values()) if (e.household_id === hh) e.household_id = into_household_id;
      const subs = this.subscriptions.get(hh);
      if (subs) {
        const target = this.subscriptions.get(into_household_id) ?? new Map<string, OccasionSubscriptionRow>();
        for (const [k, v] of subs) if (!target.has(k)) target.set(k, { ...v, household_id: into_household_id });
        this.subscriptions.set(into_household_id, target);
        this.subscriptions.delete(hh);
      }
      for (const c of this.catches.values()) if (c.household_id === hh) c.household_id = into_household_id;
      for (const c of this.cookRuns.values()) if (c.household_id === hh) { c.household_id = into_household_id; if (c.user_id === from_user_id) c.user_id = into_user_id; }
      for (const pc of this.pending.values()) if (pc.household_id === hh) { pc.household_id = into_household_id; if (pc.user_id === from_user_id) pc.user_id = into_user_id; }
      for (const a of this.attachments.values()) if (a.household_id === hh) { a.household_id = into_household_id; if (a.user_id === from_user_id) a.user_id = into_user_id; }
      for (const e of this.appEvents) if (e.household_id === hh) e.household_id = into_household_id;
      for (const r of this.tokenUsage) if (r.household_id === hh) r.household_id = into_household_id;
      this.households.delete(hh);
    }
    this.members = this.members.filter((m) => m.user_id !== from_user_id);
    for (const r of this.recipes.values()) if (r.owner_id === from_user_id) { r.owner_id = into_user_id; stats.recipes++; }
    for (const [key, s] of this.chatSessions) {
      if (s.user_id !== from_user_id) continue;
      s.user_id = into_user_id; stats.sessions++;
      // Індекс «user:day» — переписати окремо (не мутувати Map під час обходу).
      const days = [...this.chatSessionsByUserDay].filter(([, v]) => v === key);
      for (const [k] of days) { this.chatSessionsByUserDay.delete(k); this.chatSessionsByUserDay.set(k.replace(from_user_id, into_user_id), key); }
    }
    for (const e of this.appEvents) if (e.user_id === from_user_id) e.user_id = into_user_id;
    for (const r of this.tokenUsage) if (r.user_id === from_user_id) r.user_id = into_user_id;
    for (const [k, r] of this.retail) if (r.user_id === from_user_id) {
      const nk = `${into_user_id}:${r.provider}`;
      if (!this.retail.has(nk)) this.retail.set(nk, { ...r, user_id: into_user_id });
      this.retail.delete(k);
    }
    for (const a of this.telegramAccounts.values()) if (a.user_id === from_user_id) { a.user_id = into_user_id; a.linked_at = now; a.revoked_at = null; }
    // Решта особистого (профіль, нотатки, вето, сесії) — з користувачем.
    for (const [hash, se] of this.sessions) if (se.user_id === from_user_id) this.sessions.delete(hash);
    this.profileTexts.delete(from_user_id);
    for (const [id, n] of this.profileNotes) if (n.user_id === from_user_id) this.profileNotes.delete(id);
    this.vetoRows = this.vetoRows.filter((r) => r.user_id !== from_user_id);
    // Пошта: у поточного її нема (Telegram-акаунт, «Додати пошту») — переїжджає
    // з дубля; інакше лишається своя, а пошта дубля звільняється.
    const u = this.users.get(from_user_id);
    const into = this.users.get(into_user_id);
    if (u?.email) this.usersByEmail.delete(u.email.toLowerCase());
    if (u?.email && into && !into.email) {
      into.email = u.email.toLowerCase();
      this.usersByEmail.set(into.email, into_user_id);
      stats.email_moved = true;
    }
    this.users.delete(from_user_id);
    return stats;
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
      'title' | 'note' | 'rule' | 'buy' | 'servings' | 'supply' | 'expires_at' | 'done_at'
      | 'from' | 'to' | 'rule_text' | 'strict' | 'force' | 'restricts' | 'kind'>>,
  ): Promise<void> {
    const e = this.events.get(id);
    if (!e) return;
    this.events.set(id, { ...e, ...patch });
  }

  async deleteHouseholdEvent(id: string): Promise<void> {
    this.events.delete(id);
  }

  async listOccasionSubscriptions(household_id: string): Promise<OccasionSubscriptionRow[]> {
    return [...(this.subscriptions.get(household_id)?.values() ?? [])].map((r) => ({ ...r }));
  }

  async setOccasionSubscription(household_id: string, occasion_id: string, enabled: boolean | null): Promise<void> {
    const m = this.subscriptions.get(household_id) ?? new Map<string, OccasionSubscriptionRow>();
    if (enabled === null) m.delete(occasion_id);
    else m.set(occasion_id, { household_id, occasion_id, enabled, updated_at: new Date().toISOString() });
    this.subscriptions.set(household_id, m);
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
