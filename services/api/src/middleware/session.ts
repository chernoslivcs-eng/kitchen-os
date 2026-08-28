// PreHandler: дістає cookie, резолвить сесію, кладе UserContext у req.user.
// На захищених ендпоінтах — 401 без сесії.
//
// Не глобальний — реєструємо як onRequest hook саме для роутів, які його потребують.
// /v1/auth/* ходить окремо: request і verify мають бути доступні без сесії.

import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { Repo, UserContext } from '@kitchen/domain';
import { resolveSession } from '@kitchen/domain';
import { COOKIE_NAME } from '../routes/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserContext;
  }
}

export function authenticated(repo: Repo): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = (req.cookies as Record<string, string | undefined>)[COOKIE_NAME];
    const ctx = await resolveSession(repo, raw ?? null);
    if (!ctx) {
      reply.code(401).send({ error: 'unauthorized' });
      return reply;
    }
    req.user = ctx;
  };
}

// Хелпер для типізованого доступу — гарантує, що ми в захищеному обробнику.
export function requireUser(req: FastifyRequest): UserContext {
  if (!req.user) throw new Error('requireUser called outside authenticated route');
  return req.user;
}
