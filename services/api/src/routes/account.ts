// Злиття акаунтів (власник 15.09). Контракт для профілю, за кукою kos:
//   GET  /v1/account/conflict         → AccountConflict | null — акаунт-дубль,
//        володіння ключем якого щойно доведено (Telegram із профілю або лист
//        «Додати пошту»), і що в ньому є; sole_member=false — злиття заборонене.
//   POST /v1/account/merge { from_user_id } → { ok, stats, kind } |
//        409 { error: 'not_sole_member', message } | 403 { error: 'no_proof' }
//   POST /v1/account/conflict/dismiss → { ok: true } — «Ні, лишити окремо».
import type { FastifyInstance } from 'fastify';
import { mergeAccount, pendingConflict, type Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

export function accountRoutes(app: FastifyInstance, repo: Repo): void {
  app.get('/v1/account/conflict', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    return await pendingConflict(repo, user_id);
  });

  app.post<{ Body: { from_user_id?: string } }>('/v1/account/merge', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const from = req.body?.from_user_id;
    if (!from) return reply.code(400).send({ error: 'from_user_id required' });
    const out = await mergeAccount(repo, user_id, from);
    if (!out.ok) {
      if (out.reason === 'not_sole_member') {
        return reply.code(409).send({ error: 'not_sole_member', message: `Спершу вийди з дому «${out.household_name ?? 'Дім'}» — тоді обʼєднаємо` });
      }
      return reply.code(403).send({ error: out.reason });
    }
    return { ok: true, stats: out.stats, kind: out.kind };
  });

  app.post('/v1/account/conflict/dismiss', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    await repo.clearConflictProof(user_id);
    return { ok: true };
  });
}
