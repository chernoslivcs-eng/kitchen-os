// Адмінка v0 — не роль у БД, а список пошт у оточенні.
//
// Це свідомо мінімальний, а не тимчасовий вибір: продукт має одного власника
// сьогодні, і таблиця ролей під одного оператора була б чистою підготовкою до
// нікому не потрібного майбутнього. Патерн узятий той самий, що в
// retail.ts — фіча існує лише тоді, коли налаштована ззовні (SILPO_CLIENT_ID
// там, ADMIN_EMAILS тут), а не хардкодом і не БД-роллю.
//
// 404, а не 403: чужий не мусить знати, що адмінка взагалі існує. Той самий
// принцип, що в подіях («чужий дім не мусить знати, що вона є»).

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { requireUser } from './session.js';

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Реєструється ПІСЛЯ authenticated(repo) у тому самому route — читає req.user.
export function requireAdmin(repo: Repo): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const emails = adminEmails();
    if (emails.size === 0) {
      reply.code(404).send({ error: 'not_found' });
      return reply;
    }
    const { user_id } = requireUser(req);
    const user = await repo.getUser(user_id);
    if (!user || !emails.has(user.email.toLowerCase())) {
      reply.code(404).send({ error: 'not_found' });
      return reply;
    }
  };
}
