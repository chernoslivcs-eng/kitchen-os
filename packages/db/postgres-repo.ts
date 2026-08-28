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
  Repo, PantryBatch, PendingCard, Profile, AttachmentRecord, AttachmentKind,
  Zone, Unit, BatchState, Provenance, Card, UndoSnapshot,
} from '@kitchen/domain';
import { normalize } from '@kitchen/catalog';

type Row = Record<string, unknown>;

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
         confidence, provenance, staple, last_by, last_action
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        b.id, b.household_id, b.catalog_key, b.label, b.zone, b.value, b.unit, b.state,
        b.opened_at, b.expires_at, b.best_before_opened_days, b.added_at, b.depleted_at,
        b.confidence, b.provenance, b.staple, b.last_by, b.last_action,
      ],
    );
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
    };
  }

  async upsertProfile(p: Profile): Promise<void> {
    await this.pool.query(
      `INSERT INTO profile (user_id, allergies, wishes, antipatterns, equipment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         allergies = EXCLUDED.allergies,
         wishes = EXCLUDED.wishes,
         antipatterns = EXCLUDED.antipatterns,
         equipment = EXCLUDED.equipment,
         updated_at = now()`,
      [p.user_id, p.allergies, p.wishes, p.antipatterns, p.equipment],
    );
  }

  async savePending(pc: PendingCard): Promise<void> {
    // ON CONFLICT DO NOTHING — createPending уже перевіряє існування, це другий пояс безпеки.
    await this.pool.query(
      `INSERT INTO card_pending (id, message_id, household_id, user_id, card, applied_at, applied_ops, undo_token, undo_snapshot, undone_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        pc.id, pc.message_id, pc.household_id, pc.user_id,
        JSON.stringify(pc.card),
        pc.applied_at, pc.applied_ops ? JSON.stringify(pc.applied_ops) : null,
        pc.undo_token, pc.undo_snapshot ? JSON.stringify(pc.undo_snapshot) : null,
        pc.undone_at,
      ],
    );
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
}
