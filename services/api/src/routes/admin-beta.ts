// Власник 15.09, BETA-PLAN-0915: таблиця «Бета» — рядок на людину, сім справ
// лічильниками. GET /v1/admin/beta за адмін-гейтом. Дані — з наявних таблиць
// (repo.adminBetaRows); технічні доми (адмінські) не показуємо — те саме
// правило, що в списку домів.
import type { FastifyInstance } from 'fastify';
import type { Repo, AdminBetaRow } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { requireAdmin } from '../middleware/admin.js';
import { TECHNICAL_DOMAIN } from './admin-households.js';

export const BETA_PANTRY_MIN = 10;
export const BETA_PROFILE_MIN = 2;

export interface AdminBetaItem extends AdminBetaRow {
  pantry_ok: boolean;
  profile_ok: boolean;
}

export function adminBetaRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/admin/beta', { preHandler: [authenticated(repo), requireAdmin(repo)] }, async (req) => {
    const me = requireUser(req);
    const rows = await repo.adminBetaRows(new Date());
    const technical = (r: AdminBetaRow) => !!r.email && r.email.toLowerCase().endsWith(TECHNICAL_DOMAIN);
    const admins = new Set((process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
    const items: AdminBetaItem[] = rows
      .filter((r) => r.household_id !== me.household_id && !technical(r) && !(r.email && admins.has(r.email.toLowerCase())))
      .map((r) => ({ ...r, pantry_ok: r.pantry >= BETA_PANTRY_MIN, profile_ok: r.profile_filled >= BETA_PROFILE_MIN }))
      .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '') || b.started_at.localeCompare(a.started_at));
    return { rows: items, thresholds: { pantry: BETA_PANTRY_MIN, profile: BETA_PROFILE_MIN } };
  });
}
