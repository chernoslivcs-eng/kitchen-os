// GET   /v1/profile        → { profile, notes }
// PATCH /v1/profile        → правки руками: додати/прибрати алергію, побажання, обмеження, техніку
// DELETE /v1/notes/:id     → прибрати висновок із готування
//
// Правка руками не суперечить головному правилу продукту. Правило каже, що в
// стан не пише МОДЕЛЬ — вона показує картку, натискає людина. Тут стан змінює
// сама людина у своєму профілі, і це рівно «дія — інтерфейс».
//
// Без цього екрана профіль був доступний лише для читання: якщо модель записала
// «не люблю кінзу» як алергію, виправити це можна було тільки ще однією
// розмовою — і сподіватись, що цього разу вона зрозуміє правильно.

import type { FastifyInstance } from 'fastify';
import type { Profile, ProfileKind, Repo } from '@kitchen/domain';
import { applyProfileOp } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

const empty = (user_id: string): Profile => ({
  user_id, allergies: [], wishes: [], antipatterns: [], equipment: {},
});

const KINDS: ProfileKind[] = ['allergy', 'wish', 'anti', 'equip'];

interface PatchOp {
  op?: 'add' | 'remove';
  kind?: string;
  label?: string;
  has?: boolean;
}

export function profileRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/profile', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const profile = (await repo.getProfile(user_id)) ?? empty(user_id);
    const notes = await repo.listNotes(user_id, 50);
    return { profile, notes };
  });

  app.patch<{ Body: { ops?: PatchOp[] } }>(
    '/v1/profile',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const ops = req.body?.ops;
      if (!Array.isArray(ops) || ops.length === 0) {
        return reply.code(400).send({ error: 'no_ops' });
      }
      if (ops.length > 20) return reply.code(400).send({ error: 'too_many_ops' });

      for (const op of ops) {
        if (!op.kind || !KINDS.includes(op.kind as ProfileKind)) {
          return reply.code(400).send({ error: 'bad_kind', kind: op.kind });
        }
        // Висновки живуть окремою таблицею — їх знімає DELETE /v1/notes/:id.
        if (typeof op.label !== 'string' || !op.label.trim()) {
          return reply.code(400).send({ error: 'empty_label' });
        }
        if (op.label.length > 200) return reply.code(400).send({ error: 'label_too_long' });
      }

      const next = (await repo.getProfile(user_id)) ?? empty(user_id);
      let applied = 0;
      for (const op of ops) {
        if (applyProfileOp(next, op as Parameters<typeof applyProfileOp>[1])) applied++;
      }
      await repo.upsertProfile(next);
      return { profile: next, applied };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/notes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const mine = await repo.listNotes(user_id, 200);
      if (!mine.some((n) => n.id === req.params.id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await repo.deleteNote(req.params.id);
      return reply.code(204).send();
    },
  );
}
