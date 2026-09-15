// GENERIC-0915: разовий бекфіл ключів на проді — з адмінки, бо прод-базу
// локально не читаємо. Dry-run без ?apply=1; повертає той самий лог, що скрипт.
import type { FastifyInstance } from 'fastify';
import { backfillGenericKeys, formatBackfillLog, type Repo } from '@kitchen/domain';
import { authenticated } from '../middleware/session.js';
import { requireAdmin } from '../middleware/admin.js';

export function adminBackfillRoutes(app: FastifyInstance, repo: Repo) {
  app.post<{ Querystring: { apply?: string } }>('/v1/admin/backfill-generic-keys', { preHandler: [authenticated(repo), requireAdmin(repo)] }, async (req) => {
    const apply = req.query.apply === '1';
    const log = await backfillGenericKeys(repo, { apply });
    req.log.info({ apply, without_key: log.without_key, filled: log.filled.length, left: log.left }, 'backfill-generic-keys');
    return { ...log, summary: formatBackfillLog(log) };
  });
}
