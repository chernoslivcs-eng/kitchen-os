// GET /v1/profile → { profile } (порожній, якщо ще нема запису)

import type { FastifyInstance } from 'fastify';
import type { Profile, Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

const empty = (user_id: string): Profile => ({
  user_id, allergies: [], wishes: [], antipatterns: [], equipment: {},
});

export function profileRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/profile', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const profile = (await repo.getProfile(user_id)) ?? empty(user_id);
    return { profile };
  });
}
