// Postgres реалізація Repo. Той самий контракт, що InMemoryRepo.
// SQL підходить під міграцію migrations/0001_init.sql.
//
// Свідомі спрощення для MVP:
// - findBatchByLabel виконує нормалізацію в JS (той самий normalize із @kitchen/catalog).
//   Причина: SQL нормалізацію апострофів/тире доведеться дублювати, і синхронність із JS-логікою
//   ламатиметься непомітно. Для дому зі 135 партіями швидкість не проблема.
// - jsonb-поля (card, undo_snapshot) записуємо через JSON.stringify — pg сам понесе як jsonb.

import type { Pool } from './pool.js';
import type {
  Repo, UserRow, HouseholdRow, HouseholdMemberRow,
  PantryBatch, PendingCard, Profile, AttachmentRecord, AttachmentKind,
  AuthChallenge, AuthSession, TokenUsageRow, CallName, ModelProfile, CallMode,
  HouseholdInvite, HouseholdRole, ShoppingItemRow, RetailConnectionRow,
  RecipeRow, RecipeListItem, CookRunRow, CookRunChanges, CookRunWithRecipe,
  SessionRow, MessageRow, MemoryNote, EaterRow,
  Zone, Unit, BatchState, Provenance, Card, UndoSnapshot,
  HouseholdProduct, ProductTriple,
  HouseholdEventRow, OccasionCatchRow, AdminOccasionRow, OccasionRow, Rule,
  ProfileText, ProfileFieldKey, ProfileFieldValue, ProfileNote, VetoRow, VetoField,
} from '@kitchen/domain';
import { clampProfileText, emptyProfileText, NOTES_IN_PROMPT } from '@kitchen/domain';
import { normalize } from '@kitchen/catalog';

type Row = Record<string, unknown>;


// QA8-19: pg віддає date-колонку як JS Date опівночі ЛОКАЛЬНОГО часу, а
// toISOString() зсуває в UTC — для UTC+3 «2026-08-30» ставав «2026-08-29».
// Форматуємо локально, без подорожей через часові пояси.
function dayString(d: unknown): string {
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d);
}

function rowToRecipe(r: Row): RecipeRow {
  return {
    id: r.id as string,
    owner_id: r.owner_id as string,
    origin: r.origin as RecipeRow['origin'],
    title: r.title as string,
    requested_title: (r.requested_title as string | null) ?? null,
    descr: (r.descr as string | null) ?? null,
    character: (r.character as string | null) ?? null,
    risk: (r.risk as string | null) ?? null,
    base_servings: r.base_servings as number,
    time_total: (r.time_total as number | null) ?? null,
    nutrition: r.nutrition,
    payload: r.payload,
    created_at: new Date(r.created_at as string).toISOString(),
    saved_at: r.saved_at ? new Date(r.saved_at as string).toISOString() : null,
    hidden_at: r.hidden_at ? new Date(r.hidden_at as string).toISOString() : null,
  };
}

function rowToCookRun(r: Row): CookRunRow {
  return {
    id: r.id as string,
    household_id: r.household_id as string,
    user_id: r.user_id as string,
    recipe_id: r.recipe_id as string,
    servings: r.servings as number,
    started_at: new Date(r.started_at as string).toISOString(),
    finished_at: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
    rating: (r.rating as number | null) ?? null,
    verdict: (r.verdict as string | null) ?? null,
    photo_url: (r.photo_url as string | null) ?? null,
    changes: (r.changes as CookRunChanges | null) ?? null,
    undone_at: r.undone_at ? new Date(r.undone_at as string).toISOString() : null,
    session_id: (r.session_id as string | null) ?? null,
  };
}

function rowToShopping(r: Row): ShoppingItemRow {
  return {
    id: r.id as string,
    household_id: r.household_id as string,
    label: r.label as string,
    reason: (r.reason as string | null) ?? null,
    value: r.value == null ? null : Number(r.value),
    unit: (r.unit as string | null) ?? null,
    zone: (r.zone as string | null) ?? null,
    checked: r.checked as boolean,
    added_by: (r.added_by as string | null) ?? null,
    source: r.source as ShoppingItemRow['source'],
    created_at: new Date(r.created_at as string).toISOString(),
  };
}

function eaterRow(r: Row): EaterRow {
  return {
    id: r.id as string,
    household_id: r.household_id as string,
    name: r.name as string,
    allergies: (r.allergies as string[] | null) ?? [],
    wishes: (r.wishes as string[] | null) ?? [],
    antipatterns: (r.antipatterns as string[] | null) ?? [],
    created_at: new Date(r.created_at as string).toISOString(),
  };
}

function profileNoteRow(r: Row): ProfileNote {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    subject: (r.subject as string | null) ?? null,
    text: r.text as string,
    source: r.source as ProfileNote['source'],
    created_at: new Date(r.created_at as string).toISOString(),
    deleted_at: r.deleted_at ? new Date(r.deleted_at as string).toISOString() : null,
    norm_hash: r.norm_hash as string,
  };
}

function vetoRow(r: Row): VetoRow {
  return {
    user_id: r.user_id as string,
    field: r.field as VetoField,
    kind: r.kind as VetoRow['kind'],
    ref: (r.ref as string | null) ?? null,
    label: r.label as string,
    allergy: r.allergy as boolean,
    subject: (r.subject as string | null) ?? null,
  };
}

function noteRow(r: Row): MemoryNote {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    text: r.text as string,
    recipe_title: (r.recipe_title as string | null) ?? null,
    rating: r.rating == null ? null : Number(r.rating),
    pinned: r.pinned as boolean,
    created_at: new Date(r.created_at as string).toISOString(),
    kind: (r.kind as 'lesson' | 'intent' | null) ?? 'lesson',
  };
}

function rowToInvite(r: Row): HouseholdInvite {
  return {
    id: r.id as string,
    household_id: r.household_id as string,
    invited_by: r.invited_by as string,
    email: r.email as string,
    role: r.role as HouseholdRole,
    token_hash: r.token_hash as string,
    created_at: new Date(r.created_at as string).toISOString(),
    expires_at: new Date(r.expires_at as string).toISOString(),
    consumed_at: r.consumed_at ? new Date(r.consumed_at as string).toISOString() : null,
    consumed_by: (r.consumed_by as string | null) ?? null,
    revoked_at: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : null,
  };
}

function rowToBatch(r: Row): PantryBatch {
  return {
    id: r.id as string,
    household_id: r.household_id as string,
    catalog_key: (r.catalog_key as string | null) ?? null,
    label: r.label as string,
    zone: r.zone as Zone,
    value: r.value == null ? null : Number(r.value),
    unit: (r.unit as Unit | null) ?? null,
    state: r.state as BatchState,
    opened_at: r.opened_at ? new Date(r.opened_at as string).toISOString() : null,
    expires_at: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
    best_before_opened_days: (r.best_before_opened_days as number | null) ?? null,
    added_at: new Date(r.added_at as string).toISOString(),
    depleted_at: r.depleted_at ? new Date(r.depleted_at as string).toISOString() : null,
    confidence: Number(r.confidence),
    provenance: r.provenance as Provenance,
    staple: r.staple as boolean,
    last_by: (r.last_by as string | null) ?? null,
    last_action: (r.last_action as string | null) ?? null,
    product_id: (r.product_id as string | null) ?? null,
  };
}

function rowToProduct(r: Row): HouseholdProduct {
  return {
    id: r.id as string,
    household_id: r.household_id as string,
    product: r.product as string,
    brand: (r.brand as string | null) ?? null,
    variant: (r.variant as string | null) ?? null,
    unit: (r.unit as HouseholdProduct['unit']) ?? null,
    pack_size: r.pack_size == null ? null : Number(r.pack_size),
    tags: (r.tags as HouseholdProduct['tags']) ?? {},
    catalog_key: (r.catalog_key as string | null) ?? null,
    created_at: new Date(r.created_at as string).toISOString(),
  };
}

// Рядок довідника → доменний обʼєднаний тип. Розділення не косметичне: у
// якорів (Рамадан, Песах) немає meaning і вікна, і давати їм порожній рядок
// означало б збрехати — вони точки, а не сезони.
function rowToOccasion(r: Row): OccasionRow {
  const rule = r.rule as Rule;
  const base = {
    id: r.id as string,
    type: r.kind as 'season' | 'tradition',
    title: r.title as string,
    ...(r.tradition ? { tradition: r.tradition as OccasionRow['tradition'] } : {}),
    ...(r.source ? { source: r.source as string } : {}),
  };
  if (rule.t === 'window' || rule.t === 'easter' || rule.t === 'dates') {
    return {
      ...base,
      rule,
      ...(r.approx ? { approx: true } : {}),
      meaning: (r.meaning as string | null) ?? '',
      buy: (r.buy as string[]) ?? [],
      seeds: (r.seeds as string[]) ?? [],
      ...(r.restricts ? { restricts: r.restricts as string } : {}),
      ...(r.upcoming_title ? { upcomingTitle: r.upcoming_title as string } : {}),
    };
  }
  return { ...base, rule: rule as Extract<Rule, { t: 'lunar' | 'solar' }>, approx: true };
}

function rowToAdminOccasion(r: Row): AdminOccasionRow {
  return {
    id: r.id as string,
    kind: 'editorial',
    title: r.title as string,
    meaning: (r.meaning as string | null) ?? '',
    rule: r.rule as AdminOccasionRow['rule'],
    buy: (r.buy as string[]) ?? [],
    seeds: (r.seeds as string[]) ?? [],
    upcoming_title: (r.upcoming_title as string | null) ?? null,
    source: (r.source as string | null) ?? '',
    published_at: r.published_at ? new Date(r.published_at as string).toISOString() : null,
    created_at: new Date(r.created_at as string).toISOString(),
  };
}

function rowToEvent(r: Row): HouseholdEventRow {
  return {
    id: r.id as string,
    household_id: r.household_id as string,
    kind: r.kind as HouseholdEventRow['kind'],
    title: r.title as string,
    note: (r.note as string | null) ?? null,
    rule: r.rule as Rule,
    force: r.force as HouseholdEventRow['force'],
    restricts: (r.restricts as string | null) ?? null,
    buy: (r.buy as string[]) ?? [],
    recipe_id: (r.recipe_id as string | null) ?? null,
    servings: r.servings == null ? null : Number(r.servings),
    supply: (r.supply as HouseholdEventRow['supply']) ?? null,
    created_by: (r.created_by as string | null) ?? null,
    source: r.source as HouseholdEventRow['source'],
    expires_at: r.expires_at == null ? null : new Date(r.expires_at as string).toISOString(),
    done_at: r.done_at == null ? null : new Date(r.done_at as string).toISOString(),
    created_at: new Date(r.created_at as string).toISOString(),
  };
}

function rowToPending(r: Row): PendingCard {
  return {
    id: r.id as string,
    message_id: r.message_id as string,
    household_id: r.household_id as string,
    user_id: r.user_id as string,
    card: r.card as Card,
    applied_at: r.applied_at ? new Date(r.applied_at as string).toISOString() : null,
    applied_ops: (r.applied_ops as number[] | null) ?? null,
    undo_token: (r.undo_token as string | null) ?? null,
    undo_snapshot: (r.undo_snapshot as UndoSnapshot | null) ?? null,
    undone_at: r.undone_at ? new Date(r.undone_at as string).toISOString() : null,
    dismissed_at: r.dismissed_at ? new Date(r.dismissed_at as string).toISOString() : null,
  };
}

export class PostgresRepo implements Repo {
  constructor(private pool: Pool) {}

  async listBatches(household_id: string): Promise<PantryBatch[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM pantry_batch WHERE household_id = $1 ORDER BY added_at',
      [household_id],
    );
    return rows.map(rowToBatch);
  }

  async getBatch(id: string): Promise<PantryBatch | null> {
    const { rows } = await this.pool.query('SELECT * FROM pantry_batch WHERE id = $1', [id]);
    return rows[0] ? rowToBatch(rows[0]) : null;
  }

  async findBatchByLabel(household_id: string, label: string): Promise<PantryBatch | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM pantry_batch WHERE household_id = $1 AND state <> 'depleted'",
      [household_id],
    );
    const norm = normalize(label);
    // 1) точний нормалізований збіг
    for (const r of rows) {
      if (normalize(r.label as string) === norm) return rowToBatch(r);
    }
    // 2) часткове входження — той самий запасний шлях, що в InMemoryRepo
    for (const r of rows) {
      const bn = normalize(r.label as string);
      if (bn.includes(norm) || norm.includes(bn)) return rowToBatch(r);
    }
    return null;
  }

  async insertBatch(b: PantryBatch): Promise<void> {
    await this.pool.query(
      `INSERT INTO pantry_batch (
         id, household_id, catalog_key, label, zone, value, unit, state,
         opened_at, expires_at, best_before_opened_days, added_at, depleted_at,
         confidence, provenance, staple, last_by, last_action, product_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        b.id, b.household_id, b.catalog_key, b.label, b.zone, b.value, b.unit, b.state,
        b.opened_at, b.expires_at, b.best_before_opened_days, b.added_at, b.depleted_at,
        b.confidence, b.provenance, b.staple, b.last_by, b.last_action, b.product_id ?? null,
      ],
    );
  }

  // ----- Продукти дому (черга Д, №2) -------------------------------------

  async insertProduct(p: HouseholdProduct): Promise<void> {
    await this.pool.query(
      `INSERT INTO household_product (id, household_id, product, brand, variant, unit, pack_size, tags, catalog_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.household_id, p.product, p.brand, p.variant, p.unit, p.pack_size, JSON.stringify(p.tags ?? {}), p.catalog_key, p.created_at],
    );
  }

  async getProduct(id: string): Promise<HouseholdProduct | null> {
    const { rows } = await this.pool.query('SELECT * FROM household_product WHERE id = $1', [id]);
    return rows[0] ? rowToProduct(rows[0]) : null;
  }

  async findProductByTriple(household_id: string, t: ProductTriple): Promise<HouseholdProduct | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM household_product
        WHERE household_id = $1
          AND lower(product) = lower($2)
          AND coalesce(lower(brand), '') = coalesce(lower($3), '')
          AND coalesce(lower(variant), '') = coalesce(lower($4), '')`,
      [household_id, t.product, t.brand, t.variant],
    );
    return rows[0] ? rowToProduct(rows[0]) : null;
  }

  async listProducts(household_id: string): Promise<HouseholdProduct[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM household_product WHERE household_id = $1 ORDER BY created_at',
      [household_id],
    );
    return rows.map(rowToProduct);
  }

  async updateProduct(id: string, patch: Partial<Omit<HouseholdProduct, 'id' | 'household_id' | 'created_at'>>): Promise<void> {
    const cols: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${k} = $${i++}`);
      vals.push(k === 'tags' ? JSON.stringify(v) : v);
    }
    if (!cols.length) return;
    vals.push(id);
    await this.pool.query(`UPDATE household_product SET ${cols.join(', ')} WHERE id = $${i}`, vals);
  }

  async updateBatch(id: string, patch: Partial<PantryBatch>): Promise<void> {
    const cols: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id') continue;
      cols.push(`${k} = $${i++}`);
      vals.push(v);
    }
    if (!cols.length) return;
    vals.push(id);
    await this.pool.query(
      `UPDATE pantry_batch SET ${cols.join(', ')} WHERE id = $${i}`,
      vals,
    );
  }

  async deleteBatch(id: string): Promise<void> {
    await this.pool.query('DELETE FROM pantry_batch WHERE id = $1', [id]);
  }

  async getProfile(user_id: string): Promise<Profile | null> {
    const { rows } = await this.pool.query('SELECT * FROM profile WHERE user_id = $1', [user_id]);
    const r = rows[0];
    if (!r) return null;
    return {
      user_id: r.user_id,
      allergies: r.allergies ?? [],
      wishes: r.wishes ?? [],
      antipatterns: r.antipatterns ?? [],
      equipment: r.equipment ?? {},
      traditions: (r.traditions as Profile['traditions']) ?? null,
    };
  }

  async upsertProfile(p: Profile): Promise<void> {
    await this.pool.query(
      `INSERT INTO profile (user_id, allergies, wishes, antipatterns, equipment, traditions)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         allergies = EXCLUDED.allergies,
         wishes = EXCLUDED.wishes,
         antipatterns = EXCLUDED.antipatterns,
         equipment = EXCLUDED.equipment,
         traditions = EXCLUDED.traditions,
         updated_at = now()`,
      [p.user_id, p.allergies, p.wishes, p.antipatterns, p.equipment, p.traditions ?? null],
    );
  }

  // ----- Раунд 4: профіль як сім речень ------------------------------------

  async getProfileText(user_id: string): Promise<ProfileText> {
    const p = emptyProfileText(user_id);
    const { rows } = await this.pool.query(
      'SELECT key, text, status, updated_at FROM profile_text WHERE user_id = $1',
      [user_id],
    );
    for (const r of rows as Row[]) {
      const key = r.key as ProfileFieldKey;
      if (!(key in p.fields)) continue;
      p.fields[key] = {
        text: r.text as string,
        status: r.status as ProfileFieldValue['status'],
        updated_at: new Date(r.updated_at as string).toISOString(),
      };
    }
    return p;
  }

  async patchProfileField(
    user_id: string, key: ProfileFieldKey, patch: { text: string } | { status: 'none' },
  ): Promise<ProfileFieldValue> {
    const text = 'status' in patch ? '' : clampProfileText(key, patch.text);
    const status: ProfileFieldValue['status'] = 'status' in patch ? 'none' : text ? 'filled' : 'empty';
    const { rows } = await this.pool.query(
      `INSERT INTO profile_text (user_id, key, text, status, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, key) DO UPDATE SET
         text = EXCLUDED.text, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
       RETURNING text, status, updated_at`,
      [user_id, key, text, status, new Date().toISOString()],
    );
    const r = rows[0] as Row;
    return {
      text: r.text as string,
      status: r.status as ProfileFieldValue['status'],
      updated_at: new Date(r.updated_at as string).toISOString(),
    };
  }

  async listProfileNotes(user_id: string, opts: { limit?: number; include_deleted?: boolean } = {}): Promise<ProfileNote[]> {
    const { limit = NOTES_IN_PROMPT, include_deleted = false } = opts;
    const { rows } = await this.pool.query(
      `SELECT * FROM profile_note WHERE user_id = $1 ${include_deleted ? '' : 'AND deleted_at IS NULL'}
       ORDER BY created_at DESC LIMIT $2`,
      [user_id, limit],
    );
    return rows.map(profileNoteRow);
  }

  async addProfileNote(n: ProfileNote): Promise<void> {
    await this.pool.query(
      `INSERT INTO profile_note (id, user_id, subject, text, source, created_at, deleted_at, norm_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [n.id, n.user_id, n.subject, n.text, n.source, n.created_at, n.deleted_at, n.norm_hash],
    );
  }

  async deleteProfileNote(id: string): Promise<void> {
    await this.pool.query('UPDATE profile_note SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
  }

  async restoreProfileNote(id: string): Promise<void> {
    await this.pool.query('UPDATE profile_note SET deleted_at = NULL WHERE id = $1', [id]);
  }

  // Порядок як в InMemoryRepo: спершу `no`, потім `ban`; всередині — за id
  // (bigserial = порядок вставки = порядок у тексті).
  async getVetoIndex(user_id: string): Promise<VetoRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM veto_index WHERE user_id = $1 ORDER BY (field = 'ban'), id`,
      [user_id],
    );
    return rows.map(vetoRow);
  }

  async setVetoIndex(user_id: string, field: VetoField, rows: VetoRow[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM veto_index WHERE user_id = $1 AND field = $2', [user_id, field]);
      for (const r of rows) {
        await client.query(
          `INSERT INTO veto_index (user_id, field, kind, ref, label, allergy, subject)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [user_id, field, r.kind, r.ref, r.label, r.allergy, r.subject],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async insertEater(e: EaterRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO eater (id, household_id, name, allergies, wishes, antipatterns, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.id, e.household_id, e.name, e.allergies, e.wishes, e.antipatterns, e.created_at],
    );
  }

  async listEaters(household_id: string): Promise<EaterRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM eater WHERE household_id = $1 ORDER BY created_at',
      [household_id],
    );
    return rows.map(eaterRow);
  }

  async findEaterByName(household_id: string, name: string): Promise<EaterRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM eater WHERE household_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1',
      [household_id, name],
    );
    return rows[0] ? eaterRow(rows[0]) : null;
  }

  async deleteEater(id: string): Promise<void> {
    await this.pool.query('DELETE FROM eater WHERE id = $1', [id]);
  }

  async insertNote(n: MemoryNote): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory_note (id, user_id, text, recipe_title, rating, pinned, created_at, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [n.id, n.user_id, n.text, n.recipe_title, n.rating, n.pinned, n.created_at, n.kind ?? 'lesson'],
    );
  }

  async listNotes(user_id: string, limit = 20): Promise<MemoryNote[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM memory_note WHERE user_id = $1
       ORDER BY pinned DESC, created_at DESC LIMIT $2`,
      [user_id, limit],
    );
    return rows.map(noteRow);
  }

  async findNoteByText(user_id: string, text: string): Promise<MemoryNote | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM memory_note WHERE user_id = $1 AND lower(btrim(text)) = lower(btrim($2)) LIMIT 1',
      [user_id, text],
    );
    return rows[0] ? noteRow(rows[0]) : null;
  }

  async deleteNote(id: string): Promise<void> {
    await this.pool.query('DELETE FROM memory_note WHERE id = $1', [id]);
  }

  async savePending(pc: PendingCard): Promise<void> {
    // ON CONFLICT DO NOTHING — createPending уже перевіряє існування, це другий пояс безпеки.
    await this.pool.query(
      `INSERT INTO card_pending (id, message_id, household_id, user_id, card, applied_at, applied_ops, undo_token, undo_snapshot, undone_at, dismissed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        pc.id, pc.message_id, pc.household_id, pc.user_id,
        JSON.stringify(pc.card),
        pc.applied_at, pc.applied_ops ? JSON.stringify(pc.applied_ops) : null,
        pc.undo_token, pc.undo_snapshot ? JSON.stringify(pc.undo_snapshot) : null,
        pc.undone_at, pc.dismissed_at,
      ],
    );
  }

  async listOpenPending(household_id: string, limit = 20): Promise<Array<PendingCard & { session_id: string | null; created_at: string | null }>> {
    const { rows } = await this.pool.query(
      `SELECT cp.*, m.session_id AS msg_session_id, m.created_at AS msg_created_at
         FROM card_pending cp
         LEFT JOIN message m ON m.id = cp.message_id
        WHERE cp.household_id = $1 AND cp.applied_at IS NULL AND cp.undone_at IS NULL AND cp.dismissed_at IS NULL
        ORDER BY m.created_at DESC NULLS LAST
        LIMIT $2`,
      [household_id, limit],
    );
    return rows.map((r) => ({
      ...rowToPending(r),
      session_id: r.msg_session_id ?? null,
      created_at: r.msg_created_at ? new Date(r.msg_created_at).toISOString() : null,
    }));
  }

  async listRecentResolved(
    household_id: string,
    opts: { since: Date; limit: number; exclude_session_id?: string },
  ): Promise<PendingCard[]> {
    // GREATEST ігнорує NULL лише через COALESCE до сентинела в минулому —
    // сирий GREATEST(a,b,c) повертає NULL, якщо хоч один аргумент NULL.
    const { rows } = await this.pool.query(
      `SELECT cp.*
         FROM card_pending cp
         JOIN message m ON m.id = cp.message_id
        WHERE cp.household_id = $1
          AND (cp.applied_at IS NOT NULL OR cp.undone_at IS NOT NULL OR cp.dismissed_at IS NOT NULL)
          AND GREATEST(
                COALESCE(cp.applied_at, '-infinity'), COALESCE(cp.undone_at, '-infinity'), COALESCE(cp.dismissed_at, '-infinity')
              ) > $2
          AND ($3::uuid IS NULL OR m.session_id <> $3)
        ORDER BY GREATEST(
                COALESCE(cp.applied_at, '-infinity'), COALESCE(cp.undone_at, '-infinity'), COALESCE(cp.dismissed_at, '-infinity')
              ) DESC
        LIMIT $4`,
      [household_id, opts.since, opts.exclude_session_id ?? null, opts.limit],
    );
    return rows.map(rowToPending);
  }

  async getPending(id: string): Promise<PendingCard | null> {
    const { rows } = await this.pool.query('SELECT * FROM card_pending WHERE id = $1', [id]);
    return rows[0] ? rowToPending(rows[0]) : null;
  }

  async updatePending(id: string, patch: Partial<PendingCard>): Promise<void> {
    const cols: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id') continue;
      cols.push(`${k} = $${i++}`);
      // jsonb-поля треба серіалізувати
      if (k === 'card' || k === 'applied_ops' || k === 'undo_snapshot') {
        vals.push(v == null ? null : JSON.stringify(v));
      } else {
        vals.push(v);
      }
    }
    if (!cols.length) return;
    vals.push(id);
    await this.pool.query(
      `UPDATE card_pending SET ${cols.join(', ')} WHERE id = $${i}`,
      vals,
    );
  }

  async saveAttachment(a: AttachmentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO attachment (id, message_id, household_id, user_id, kind, url, content_type, bytes, hint, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        a.id, a.message_id, a.household_id, a.user_id, a.kind,
        a.url, a.content_type, a.bytes, a.hint, a.created_at,
      ],
    );
  }

  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM attachment WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      message_id: r.message_id ?? null,
      household_id: r.household_id,
      user_id: r.user_id,
      kind: r.kind as AttachmentKind,
      url: r.url,
      content_type: r.content_type ?? null,
      bytes: r.bytes ?? null,
      hint: r.hint ?? null,
      created_at: new Date(r.created_at).toISOString(),
    };
  }

  async updateAttachment(id: string, patch: Partial<AttachmentRecord>): Promise<void> {
    const cols: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id') continue;
      cols.push(`${k} = $${i++}`);
      vals.push(v);
    }
    if (!cols.length) return;
    vals.push(id);
    await this.pool.query(
      `UPDATE attachment SET ${cols.join(', ')} WHERE id = $${i}`,
      vals,
    );
  }

  // ----- Користувачі й дом-контекст ---------------------------------------

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM "user" WHERE lower(email) = $1', [email.toLowerCase()]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      created_at: new Date(r.created_at).toISOString(),
      plan: (r.plan as string | null) ?? 'beta',
    };
  }

  async createUserWithHousehold(email: string, name: string): Promise<{ user_id: string; household_id: string }> {
    // Атомарно: юзер + дім + membership. Дім робимо named за email — можна перейменувати згодом.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query<{ id: string }>(
        'INSERT INTO "user" (name, email) VALUES ($1, $2) RETURNING id',
        [name, email.toLowerCase()],
      );
      const user_id = u.rows[0]!.id;
      const h = await client.query<{ id: string }>(
        'INSERT INTO household (name) VALUES ($1) RETURNING id',
        [`Дім ${name}`],
      );
      const household_id = h.rows[0]!.id;
      await client.query(
        'INSERT INTO household_member (household_id, user_id, role) VALUES ($1, $2, $3)',
        [household_id, user_id, 'owner'],
      );
      await client.query('COMMIT');
      return { user_id, household_id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async createUserOnly(email: string, name: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      'INSERT INTO "user" (name, email) VALUES ($1, $2) RETURNING id',
      [name, email.toLowerCase()],
    );
    return rows[0]!.id;
  }

  async getUser(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM "user" WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, name: r.name, email: r.email, created_at: new Date(r.created_at).toISOString(), plan: (r.plan as string | null) ?? 'beta' };
  }

  async getHousehold(id: string): Promise<HouseholdRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM household WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, name: r.name, created_at: new Date(r.created_at).toISOString() };
  }

  async listMembersOfHousehold(household_id: string): Promise<HouseholdMemberRow[]> {
    const { rows } = await this.pool.query(
      `SELECT hm.user_id, u.name, u.email, hm.role, hm.joined_at
         FROM household_member hm
         JOIN "user" u ON u.id = hm.user_id
        WHERE hm.household_id = $1
        ORDER BY hm.joined_at`,
      [household_id],
    );
    return rows.map((r): HouseholdMemberRow => ({
      user_id: r.user_id,
      name: r.name,
      email: r.email,
      role: r.role as HouseholdRole,
      joined_at: new Date(r.joined_at).toISOString(),
    }));
  }

  async roleOf(household_id: string, user_id: string): Promise<HouseholdRole | null> {
    const { rows } = await this.pool.query<{ role: HouseholdRole }>(
      'SELECT role FROM household_member WHERE household_id = $1 AND user_id = $2',
      [household_id, user_id],
    );
    return rows[0]?.role ?? null;
  }

  async removeMember(household_id: string, user_id: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM household_member WHERE household_id = $1 AND user_id = $2',
      [household_id, user_id],
    );
  }

  async setMemberRole(household_id: string, user_id: string, role: HouseholdRole): Promise<void> {
    await this.pool.query(
      'UPDATE household_member SET role = $1 WHERE household_id = $2 AND user_id = $3',
      [role, household_id, user_id],
    );
  }

  async firstHouseholdOf(user_id: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ household_id: string }>(
      'SELECT household_id FROM household_member WHERE user_id = $1 ORDER BY joined_at LIMIT 1',
      [user_id],
    );
    return rows[0]?.household_id ?? null;
  }

  // ----- Автентифікація ---------------------------------------------------

  async saveChallenge(c: AuthChallenge): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_challenge (id, email, token_hash, created_at, expires_at, consumed_at, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (token_hash) DO NOTHING`,
      [c.id, c.email, c.token_hash, c.created_at, c.expires_at, c.consumed_at, c.ip, c.user_agent],
    );
  }

  async getChallengeByHash(token_hash: string): Promise<AuthChallenge | null> {
    const { rows } = await this.pool.query('SELECT * FROM auth_challenge WHERE token_hash = $1', [token_hash]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      email: r.email,
      token_hash: r.token_hash,
      created_at: new Date(r.created_at).toISOString(),
      expires_at: new Date(r.expires_at).toISOString(),
      consumed_at: r.consumed_at ? new Date(r.consumed_at).toISOString() : null,
      ip: r.ip ?? null,
      user_agent: r.user_agent ?? null,
    };
  }

  async consumeChallenge(id: string): Promise<void> {
    await this.pool.query('UPDATE auth_challenge SET consumed_at = now() WHERE id = $1', [id]);
  }

  async saveSession(s: AuthSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_session (id, user_id, cookie_hash, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [s.id, s.user_id, s.cookie_hash, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at, s.ip, s.user_agent],
    );
  }

  async getSessionByCookieHash(cookie_hash: string): Promise<AuthSession | null> {
    const { rows } = await this.pool.query('SELECT * FROM auth_session WHERE cookie_hash = $1', [cookie_hash]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      user_id: r.user_id,
      cookie_hash: r.cookie_hash,
      created_at: new Date(r.created_at).toISOString(),
      last_seen_at: new Date(r.last_seen_at).toISOString(),
      expires_at: new Date(r.expires_at).toISOString(),
      revoked_at: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      ip: r.ip ?? null,
      user_agent: r.user_agent ?? null,
    };
  }

  async touchSession(id: string, now: string, expires_at: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_session SET last_seen_at = $1, expires_at = $2 WHERE id = $3',
      [now, expires_at, id],
    );
  }

  async revokeSession(id: string): Promise<void> {
    await this.pool.query('UPDATE auth_session SET revoked_at = now() WHERE id = $1', [id]);
  }

  // ----- Облік токенів ---------------------------------------------------

  async logTokenUsage(row: TokenUsageRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO token_usage
         (id, user_id, household_id, call, profile, model, prompt_version, mode,
          input_tokens, output_tokens, cached_tokens, latency_ms,
          prompt_hash, prompt_chars, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.id, row.user_id, row.household_id, row.call, row.profile, row.model,
        row.prompt_version, row.mode,
        row.input_tokens, row.output_tokens, row.cached_tokens,
        row.latency_ms, row.prompt_hash, row.prompt_chars, row.created_at,
      ],
    );
  }

  // ----- Сесії й повідомлення --------------------------------------------

  async getOrCreateSessionForDay(user_id: string, day: string): Promise<SessionRow> {
    // Найсвіжіша сесія цього дня — це «поточна» для гідратації.
    const { rows: existing } = await this.pool.query(
      'SELECT * FROM session WHERE user_id = $1 AND day = $2 ORDER BY created_at DESC LIMIT 1',
      [user_id, day],
    );
    if (existing[0]) {
      const r = existing[0];
      return {
        id: r.id, user_id: r.user_id, title: r.title ?? null,
        day: dayString(r.day),
        created_at: new Date(r.created_at).toISOString(),
      };
    }
    return this.createFreshSession(user_id, day);
  }

  async createFreshSession(user_id: string, day: string): Promise<SessionRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO session (user_id, day) VALUES ($1, $2)
       RETURNING id, user_id, title, day, created_at`,
      [user_id, day],
    );
    const r = rows[0]!;
    return {
      id: r.id, user_id: r.user_id, title: r.title ?? null,
      day: dayString(r.day),
      created_at: new Date(r.created_at).toISOString(),
    };
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM session WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id, user_id: r.user_id, title: r.title ?? null,
      day: dayString(r.day),
      created_at: new Date(r.created_at).toISOString(),
    };
  }

  async setSessionTitle(id: string, title: string): Promise<void> {
    // Тільки якщо ще порожня: назву дає перша репліка й більше ніхто.
    await this.pool.query('UPDATE session SET title = $2 WHERE id = $1 AND title IS NULL', [id, title]);
  }

  async listSessionsForUser(user_id: string, limit = 30): Promise<Array<SessionRow & { message_count: number }>> {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.user_id, s.title, s.day, s.created_at,
              COUNT(m.id)::int AS message_count
         FROM session s
         LEFT JOIN message m ON m.session_id = s.id
        WHERE s.user_id = $1
        GROUP BY s.id
        ORDER BY s.created_at DESC
        LIMIT $2`,
      [user_id, limit],
    );
    return rows.map((r) => ({
      id: r.id, user_id: r.user_id, title: r.title ?? null,
      day: dayString(r.day),
      created_at: new Date(r.created_at).toISOString(),
      message_count: Number(r.message_count),
    }));
  }

  async saveMessage(msg: MessageRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO message (id, session_id, role, text, card, applied, created_at, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        msg.id, msg.session_id, msg.role, msg.text,
        msg.card == null ? null : JSON.stringify(msg.card),
        msg.applied, msg.created_at,
        // NULL = написала модель; підпис ставиться лише винятком (серверна проза).
        msg.source ?? null,
      ],
    );
  }

  async listMessages(session_id: string): Promise<MessageRow[]> {
    // Аудит раунд 3: undone_at/dismissed_at не зберігаються на message —
    // приєднуються з card_pending за спільним id (message.id === pending.id,
    // те саме, що deleteSession нижче вже покладається).
    const { rows } = await this.pool.query(
      `SELECT m.*, cp.undone_at AS pc_undone_at, cp.dismissed_at AS pc_dismissed_at
         FROM message m
         LEFT JOIN card_pending cp ON cp.id = m.id
        WHERE m.session_id = $1
        ORDER BY m.created_at`,
      [session_id],
    );
    return rows.map((r): MessageRow => ({
      id: r.id,
      session_id: r.session_id,
      role: r.role as 'user' | 'assistant',
      text: r.text ?? null,
      card: r.card ?? null,
      applied: r.applied ?? 0,
      created_at: new Date(r.created_at).toISOString(),
      // Поле опційне: NULL у базі → undefined у типі, а не null. Інакше
      // `m.source ?` в chat-history.ts брав би порожню гілку правильно, але
      // рядок віз би зайве null у кожному ході історії.
      ...(r.source ? { source: r.source as MessageRow['source'] } : {}),
      undone_at: r.pc_undone_at ? new Date(r.pc_undone_at as string).toISOString() : null,
      dismissed_at: r.pc_dismissed_at ? new Date(r.pc_dismissed_at as string).toISOString() : null,
    }));
  }

  async deleteSession(id: string): Promise<void> {
    // pending без FK на message — чистимо вручну; message і cook_run
    // прибирає/відвʼязує схема (CASCADE / SET NULL).
    await this.pool.query(
      'DELETE FROM card_pending WHERE message_id IN (SELECT id FROM message WHERE session_id = $1)',
      [id],
    );
    await this.pool.query('DELETE FROM session WHERE id = $1', [id]);
  }

  async recordExitSurvey(s: { email: string; reason: string; comment?: string | null }): Promise<void> {
    await this.pool.query(
      'INSERT INTO account_exit_survey (email, reason, comment) VALUES ($1, $2, $3)',
      [s.email, s.reason, s.comment ?? null],
    );
  }

  async listExitSurveys() {
    const { rows } = await this.pool.query<{ email: string; reason: string; comment: string | null; created_at: string }>(
      'SELECT email, reason, comment, created_at FROM account_exit_survey ORDER BY created_at',
    );
    return rows;
  }

  async deleteUserAccount(user_id: string): Promise<void> {
    // Той самий патерн, що ганявся руками на проді при обміні акаунтів:
    // доми, де юзер — єдиний член, ідуть із ним; каскади прибирають решту.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM household h
         WHERE EXISTS (SELECT 1 FROM household_member m
                       WHERE m.household_id = h.id AND m.user_id = $1)
           AND NOT EXISTS (SELECT 1 FROM household_member m2
                           WHERE m2.household_id = h.id AND m2.user_id <> $1)`,
        [user_id],
      );
      // card_pending без FK на message — підчистити картки юзера вручну.
      await client.query('DELETE FROM card_pending WHERE user_id = $1', [user_id]);
      await client.query('DELETE FROM "user" WHERE id = $1', [user_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getMessage(id: string): Promise<MessageRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM message WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      session_id: r.session_id,
      role: r.role as 'user' | 'assistant',
      text: r.text ?? null,
      card: r.card ?? null,
      applied: r.applied ?? 0,
      created_at: new Date(r.created_at).toISOString(),
    };
  }

  async markMessageApplied(id: string, applied: number): Promise<void> {
    await this.pool.query('UPDATE message SET applied = $2 WHERE id = $1', [id, applied]);
  }

  async updateMessageCard(id: string, card: Card): Promise<void> {
    await this.pool.query('UPDATE message SET card = $2 WHERE id = $1', [id, JSON.stringify(card)]);
  }

  // ----- Рецепти й приготування ------------------------------------------

  async saveRecipe(recipe: RecipeRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO recipe
         (id, owner_id, origin, title, requested_title, descr, character, risk, base_servings,
          time_total, nutrition, payload, created_at, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        recipe.id, recipe.owner_id, recipe.origin, recipe.title,
        recipe.requested_title ?? null, recipe.descr,
        recipe.character, recipe.risk, recipe.base_servings, recipe.time_total,
        recipe.nutrition == null ? null : JSON.stringify(recipe.nutrition),
        JSON.stringify(recipe.payload),
        recipe.created_at,
        recipe.saved_at,
      ],
    );
  }

  // Бібліотека: збережені «на потім» + ті, які готували, з лічильником.
  // Побічні артефакти cook-run без saved_at і без готувань не показуємо.
  async listRecipes(user_id: string, limit = 50): Promise<RecipeListItem[]> {
    const { rows } = await this.pool.query(
      `SELECT r.*,
              COUNT(c.id) FILTER (WHERE c.undone_at IS NULL)::int AS cooked_count,
              MAX(COALESCE(c.finished_at, c.started_at))
                FILTER (WHERE c.undone_at IS NULL)              AS last_cooked_at
         FROM recipe r
         LEFT JOIN cook_run c ON c.recipe_id = r.id
        WHERE r.owner_id = $1
          AND r.hidden_at IS NULL
        GROUP BY r.id
       HAVING r.saved_at IS NOT NULL
           OR COUNT(c.id) FILTER (WHERE c.undone_at IS NULL) > 0
        ORDER BY COALESCE(r.saved_at, r.created_at) DESC
        LIMIT $2`,
      [user_id, limit],
    );
    return rows.map((r): RecipeListItem => ({
      ...rowToRecipe(r),
      cooked_count: Number(r.cooked_count ?? 0),
      last_cooked_at: r.last_cooked_at ? new Date(r.last_cooked_at as string).toISOString() : null,
    }));
  }

  async listRecentRecipes(user_id: string, limit = 5): Promise<RecipeRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM recipe WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2',
      [user_id, limit],
    );
    return rows.map(rowToRecipe);
  }

  async setRecipeSaved(id: string, saved_at: string | null): Promise<void> {
    await this.pool.query('UPDATE recipe SET saved_at = $1 WHERE id = $2', [saved_at, id]);
  }

  async setRecipeHidden(id: string, hidden_at: string | null): Promise<void> {
    await this.pool.query('UPDATE recipe SET hidden_at = $1 WHERE id = $2', [hidden_at, id]);
  }

  async deleteRecipe(id: string): Promise<void> {
    await this.pool.query('DELETE FROM recipe WHERE id = $1', [id]);
  }

  async getRecipe(id: string): Promise<RecipeRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM recipe WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return rowToRecipe(r);
  }

  async saveCookRun(run: CookRunRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO cook_run
         (id, household_id, user_id, recipe_id, servings, started_at, finished_at,
          rating, verdict, photo_url, changes, undone_at, session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        run.id, run.household_id, run.user_id, run.recipe_id, run.servings,
        run.started_at, run.finished_at, run.rating, run.verdict, run.photo_url,
        run.changes ? JSON.stringify(run.changes) : null,
        run.undone_at, run.session_id ?? null,
      ],
    );
  }

  async getCookRun(id: string): Promise<CookRunRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM cook_run WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return rowToCookRun(r);
  }

  async markCookRunUndone(id: string, undone_at: string): Promise<void> {
    await this.pool.query('UPDATE cook_run SET undone_at = $1 WHERE id = $2', [undone_at, id]);
  }

  async updateCookRun(id: string, patch: Partial<Pick<CookRunRow, 'rating' | 'verdict' | 'photo_url'>>): Promise<void> {
    const parts: string[] = [];
    const vals: unknown[] = [];
    if ('rating' in patch) { parts.push(`rating = $${parts.length + 1}`); vals.push(patch.rating ?? null); }
    if ('verdict' in patch) { parts.push(`verdict = $${parts.length + 1}`); vals.push(patch.verdict ?? null); }
    if ('photo_url' in patch) { parts.push(`photo_url = $${parts.length + 1}`); vals.push(patch.photo_url ?? null); }
    if (!parts.length) return;
    vals.push(id);
    await this.pool.query(`UPDATE cook_run SET ${parts.join(', ')} WHERE id = $${vals.length}`, vals);
  }

  async listCookRuns(user_id: string, limit = 20): Promise<CookRunWithRecipe[]> {
    const { rows } = await this.pool.query(
      `SELECT cr.*,
              row_to_json(r.*) AS recipe_row
         FROM cook_run cr
         JOIN recipe r ON r.id = cr.recipe_id
        WHERE cr.user_id = $1
        ORDER BY COALESCE(cr.finished_at, cr.started_at) DESC
        LIMIT $2`,
      [user_id, limit],
    );
    return rows.map((r): CookRunWithRecipe => ({
      ...rowToCookRun(r),
      recipe: rowToRecipe(r.recipe_row),
    }));
  }

  // ----- Список покупок ---------------------------------------------------

  async listShoppingItems(household_id: string): Promise<ShoppingItemRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM shopping_item WHERE household_id = $1 ORDER BY created_at',
      [household_id],
    );
    return rows.map(rowToShopping);
  }

  async insertShoppingItem(item: ShoppingItemRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO shopping_item
         (id, household_id, label, reason, value, unit, zone, checked, added_by, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        item.id, item.household_id, item.label, item.reason,
        item.value, item.unit, item.zone, item.checked,
        item.added_by, item.source, item.created_at,
      ],
    );
  }

  async toggleShoppingItem(id: string, checked: boolean): Promise<void> {
    await this.pool.query('UPDATE shopping_item SET checked = $2 WHERE id = $1', [id, checked]);
  }

  async deleteShoppingItem(id: string): Promise<void> {
    await this.pool.query('DELETE FROM shopping_item WHERE id = $1', [id]);
  }

  async findShoppingItemByLabel(household_id: string, label: string): Promise<ShoppingItemRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM shopping_item WHERE household_id = $1 AND lower(label) = lower($2) LIMIT 1',
      [household_id, label],
    );
    return rows[0] ? rowToShopping(rows[0]) : null;
  }

  // ----- Мережі (M13) ------------------------------------------------------

  async upsertRetailConnection(c: RetailConnectionRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO retail_connection
         (id, user_id, provider, access_token_enc, refresh_token_enc, expires_at, status, connected_at, updated_at, last_receipt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         expires_at = EXCLUDED.expires_at,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at,
         last_receipt_at = EXCLUDED.last_receipt_at`,
      [c.id, c.user_id, c.provider, c.access_token_enc, c.refresh_token_enc,
       c.expires_at, c.status, c.connected_at, c.updated_at, c.last_receipt_at],
    );
  }

  async getRetailConnection(user_id: string, provider: string): Promise<RetailConnectionRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM retail_connection WHERE user_id = $1 AND provider = $2',
      [user_id, provider],
    );
    const r = rows[0] as Row | undefined;
    if (!r) return null;
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      provider: r.provider as string,
      access_token_enc: r.access_token_enc as string,
      refresh_token_enc: (r.refresh_token_enc as string | null) ?? null,
      expires_at: new Date(r.expires_at as string).toISOString(),
      status: r.status as RetailConnectionRow['status'],
      connected_at: new Date(r.connected_at as string).toISOString(),
      updated_at: new Date(r.updated_at as string).toISOString(),
      last_receipt_at: r.last_receipt_at == null ? null : new Date(r.last_receipt_at as string).toISOString(),
    };
  }

  async deleteRetailConnection(user_id: string, provider: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM retail_connection WHERE user_id = $1 AND provider = $2',
      [user_id, provider],
    );
  }

  // ----- Календар ----------------------------------------------------------

  async listOccasionCatalog(): Promise<OccasionRow[]> {
    // Чернетки назовні не йдуть: published_at IS NULL означає «ще не показуємо».
    const { rows } = await this.pool.query(
      'SELECT * FROM occasion_catalog WHERE published_at IS NOT NULL ORDER BY id',
    );
    return (rows as Row[]).map(rowToOccasion);
  }

  // Адмінка v0 (фаза 4). WHERE kind='editorial' навмисно: сезони й свята
  // лишаються кодом (BUILTIN_OCCASIONS/seedOccasions), ця форма їх не чіпає.
  async listAdminOccasions(): Promise<AdminOccasionRow[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM occasion_catalog WHERE kind = 'editorial' ORDER BY id",
    );
    return (rows as Row[]).map(rowToAdminOccasion);
  }

  async upsertAdminOccasion(row: AdminOccasionRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO occasion_catalog
         (id, kind, title, meaning, rule, force, restricts, tradition,
          buy, seeds, approx, upcoming_title, source, audience, published_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, meaning = EXCLUDED.meaning, rule = EXCLUDED.rule,
         buy = EXCLUDED.buy, seeds = EXCLUDED.seeds, upcoming_title = EXCLUDED.upcoming_title,
         source = EXCLUDED.source`,
      // Усі 15 значень параметрами, навіть сталі (kind, force, approx):
      // статичний сторож sql-arity рахує колонки проти плейсхолдерів, і
      // літерали в VALUES ламали йому рахунок.
      [
        row.id, 'editorial', row.title, row.meaning, JSON.stringify(row.rule),
        'hint', null, null, row.buy, row.seeds, false, row.upcoming_title,
        row.source, null, row.published_at,
      ],
    );
  }

  async setOccasionPublished(id: string, published: boolean): Promise<void> {
    await this.pool.query(
      'UPDATE occasion_catalog SET published_at = $2 WHERE id = $1',
      [id, published ? new Date().toISOString() : null],
    );
  }

  async deleteAdminOccasion(id: string): Promise<void> {
    await this.pool.query("DELETE FROM occasion_catalog WHERE id = $1 AND kind = 'editorial'", [id]);
  }

  async listOwnEvents(household_id: string, user_id: string): Promise<HouseholdEventRow[]> {
    // Дім у WHERE лишається попри created_by: він звужує до індексу, і без
    // нього подія пішла б за людиною в інший дім.
    const { rows } = await this.pool.query(
      `SELECT * FROM household_event
        WHERE household_id = $1 AND created_by = $2
        ORDER BY created_at`,
      [household_id, user_id],
    );
    return (rows as Row[]).map(rowToEvent);
  }

  async getHouseholdEvent(id: string): Promise<HouseholdEventRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM household_event WHERE id = $1', [id]);
    const r = rows[0] as Row | undefined;
    return r ? rowToEvent(r) : null;
  }

  async insertHouseholdEvent(e: HouseholdEventRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO household_event
         (id, household_id, kind, title, note, rule, force, restricts, buy,
          recipe_id, servings, supply, created_by, source, expires_at, done_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17)`,
      [
        e.id, e.household_id, e.kind, e.title, e.note,
        JSON.stringify(e.rule), e.force, e.restricts, e.buy,
        e.recipe_id, e.servings,
        e.supply == null ? null : JSON.stringify(e.supply),
        e.created_by, e.source, e.expires_at, e.done_at, e.created_at,
      ],
    );
  }

  async updateHouseholdEvent(
    id: string,
    patch: Partial<Pick<HouseholdEventRow,
      'title' | 'note' | 'rule' | 'buy' | 'servings' | 'supply' | 'expires_at' | 'done_at'>>,
  ): Promise<void> {
    // COALESCE тут не годиться: null — легальне значення для note, supply,
    // expires_at і done_at, і «зняти дату» має відрізнятись від «не чіпати».
    // Тому збираємо SET лише з переданих ключів.
    const sets: string[] = [];
    const vals: unknown[] = [];
    const put = (col: string, v: unknown, cast = '') => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}${cast}`);
    };
    if ('title' in patch) put('title', patch.title);
    if ('note' in patch) put('note', patch.note);
    if ('rule' in patch) put('rule', JSON.stringify(patch.rule), '::jsonb');
    if ('buy' in patch) put('buy', patch.buy);
    if ('servings' in patch) put('servings', patch.servings);
    if ('supply' in patch) put('supply', patch.supply == null ? null : JSON.stringify(patch.supply), '::jsonb');
    if ('expires_at' in patch) put('expires_at', patch.expires_at);
    if ('done_at' in patch) put('done_at', patch.done_at);
    if (!sets.length) return;
    vals.push(id);
    await this.pool.query(
      `UPDATE household_event SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals,
    );
  }

  async deleteHouseholdEvent(id: string): Promise<void> {
    await this.pool.query('DELETE FROM household_event WHERE id = $1', [id]);
  }

  async listMutedOccasions(user_id: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      'SELECT occasion_id FROM user_occasion_mute WHERE user_id = $1',
      [user_id],
    );
    return (rows as Row[]).map((r) => r.occasion_id as string);
  }

  async muteOccasion(user_id: string, occasion_id: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_occasion_mute (user_id, occasion_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [user_id, occasion_id],
    );
  }

  async unmuteOccasion(user_id: string, occasion_id: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM user_occasion_mute WHERE user_id = $1 AND occasion_id = $2',
      [user_id, occasion_id],
    );
  }

  async recordOccasionCatch(c: OccasionCatchRow): Promise<void> {
    // Перше ловіння важить, повторне — ні: вікно ловиться раз на рік.
    await this.pool.query(
      `INSERT INTO household_occasion_catch (household_id, occasion_id, year, caught_at, by_label, run_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [c.household_id, c.occasion_id, c.year, c.caught_at, c.by, c.run_id],
    );
  }

  async listOccasionCatches(household_id: string, year?: number): Promise<OccasionCatchRow[]> {
    const { rows } = year === undefined
      ? await this.pool.query('SELECT * FROM household_occasion_catch WHERE household_id = $1', [household_id])
      : await this.pool.query(
        'SELECT * FROM household_occasion_catch WHERE household_id = $1 AND year = $2',
        [household_id, year],
      );
    return (rows as Row[]).map((r) => ({
      household_id: r.household_id as string,
      occasion_id: r.occasion_id as string,
      year: Number(r.year),
      caught_at: new Date(r.caught_at as string).toISOString(),
      by: (r.by_label as string | null) ?? null,
      run_id: (r.run_id as string | null) ?? null,
    }));
  }

  // ----- Дом-membership і запрошення --------------------------------------

  async isMember(household_id: string, user_id: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM household_member WHERE household_id = $1 AND user_id = $2 LIMIT 1',
      [household_id, user_id],
    );
    return rows.length > 0;
  }

  async addMember(household_id: string, user_id: string, role: HouseholdRole): Promise<void> {
    await this.pool.query(
      `INSERT INTO household_member (household_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (household_id, user_id) DO NOTHING`,
      [household_id, user_id, role],
    );
  }

  async saveInvite(inv: HouseholdInvite): Promise<void> {
    await this.pool.query(
      `INSERT INTO household_invite
         (id, household_id, invited_by, email, role, token_hash, created_at, expires_at, consumed_at, consumed_by, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        inv.id, inv.household_id, inv.invited_by, inv.email.toLowerCase(), inv.role,
        inv.token_hash, inv.created_at, inv.expires_at,
        inv.consumed_at, inv.consumed_by, inv.revoked_at,
      ],
    );
  }

  async getInviteByHash(token_hash: string): Promise<HouseholdInvite | null> {
    const { rows } = await this.pool.query('SELECT * FROM household_invite WHERE token_hash = $1', [token_hash]);
    return rows[0] ? rowToInvite(rows[0]) : null;
  }

  async getInvite(id: string): Promise<HouseholdInvite | null> {
    const { rows } = await this.pool.query('SELECT * FROM household_invite WHERE id = $1', [id]);
    return rows[0] ? rowToInvite(rows[0]) : null;
  }

  async consumeInvite(id: string, consumed_by: string): Promise<void> {
    await this.pool.query(
      'UPDATE household_invite SET consumed_at = now(), consumed_by = $2 WHERE id = $1',
      [id, consumed_by],
    );
  }

  async revokeInvite(id: string): Promise<void> {
    await this.pool.query('UPDATE household_invite SET revoked_at = now() WHERE id = $1', [id]);
  }

  async listInvitesForHousehold(household_id: string): Promise<HouseholdInvite[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM household_invite WHERE household_id = $1 ORDER BY created_at DESC',
      [household_id],
    );
    return rows.map(rowToInvite);
  }

  async listTokenUsage(user_id: string, limit = 100): Promise<TokenUsageRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM token_usage WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [user_id, limit],
    );
    return rows.map((r): TokenUsageRow => ({
      id: r.id,
      user_id: r.user_id,
      household_id: r.household_id ?? null,
      call: r.call as CallName,
      profile: r.profile as ModelProfile,
      model: r.model,
      prompt_version: r.prompt_version,
      mode: r.mode as CallMode,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cached_tokens: r.cached_tokens,
      latency_ms: r.latency_ms ?? null,
      prompt_hash: r.prompt_hash ?? null,
      prompt_chars: r.prompt_chars ?? null,
      created_at: new Date(r.created_at).toISOString(),
    }));
  }
}
