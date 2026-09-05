// Раунд 4 (AUDIT-ROUND-4.md §6): профіль як сім речень. Живе за прапором
// PROFILE_V2; без нього server.ts реєструє profile.ts (v1) як раніше.
//
// GET    /v1/profile                    → { fields, notes, defaults: { kit } }
// PATCH  /v1/profile/:key               { text } | { status: 'none' } — автозбереження
// DELETE /v1/profile/notes/:id          → мʼяке видалення (для «Повернути»)
// POST   /v1/profile/notes/:id/restore  → повернути; вікно 5 с — на клієнті, тут без обмеження
//
// Старі ендпоінти профілю (PATCH /v1/profile з ops, DELETE /v1/notes/:id)
// під прапором віддають 410 — одна дорога в одне поле.

import type { FastifyInstance } from 'fastify';
import {
  KIT_DEFAULTS, PROFILE_FIELD_KEYS, NOTES_IN_PROMPT, rebuildVetoIndex,
  type ProfileFieldKey, type Repo,
} from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

const isKey = (k: string): k is ProfileFieldKey => (PROFILE_FIELD_KEYS as readonly string[]).includes(k);

export function profileV2Routes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/profile', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const [text, notes] = await Promise.all([
      repo.getProfileText(user_id),
      repo.listProfileNotes(user_id, { limit: NOTES_IN_PROMPT }),
    ]);
    return {
      fields: text.fields,
      notes: notes.map((n) => ({ id: n.id, text: n.text, source: n.source, created_at: n.created_at })),
      defaults: { kit: [...KIT_DEFAULTS] },
    };
  });

  app.patch<{ Params: { key: string }; Body: { text?: unknown; status?: unknown } }>(
    '/v1/profile/:key',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const { key } = req.params;
      if (!isKey(key)) return reply.code(404).send({ error: 'unknown_field', key });
      const body = req.body ?? {};
      let patch: { text: string } | { status: 'none' };
      if (typeof body.text === 'string') patch = { text: body.text };
      else if (body.status === 'none') patch = { status: 'none' };
      else return reply.code(400).send({ error: 'bad_patch' });

      const field = await repo.patchProfileField(user_id, key, patch);
      // Крок 4: індекс поля перебудовується при кожному записі в no/ban
      // (§2.3); для решти полів — порожньо.
      const veto_index = await rebuildVetoIndex(repo, user_id, key);
      return { field, veto_index };
    },
  );

  // Нотатка — особиста; чужа не видна і не правиться, для клієнта її «нема».
  const own = async (user_id: string, id: string) =>
    (await repo.listProfileNotes(user_id, { limit: 1000, include_deleted: true })).find((n) => n.id === id) ?? null;

  app.delete<{ Params: { id: string } }>(
    '/v1/profile/notes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      if (!(await own(user_id, req.params.id))) return reply.code(404).send({ error: 'not_found' });
      await repo.deleteProfileNote(req.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/profile/notes/:id/restore',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      if (!(await own(user_id, req.params.id))) return reply.code(404).send({ error: 'not_found' });
      await repo.restoreProfileNote(req.params.id);
      const note = await own(user_id, req.params.id);
      return { note: note && { id: note.id, text: note.text, source: note.source, created_at: note.created_at } };
    },
  );

  // v1 — пішов. 410, а не 404: клієнт зі старим кодом має побачити різницю
  // між «не туди» і «цього більше нема».
  const gone = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(410).send({ error: 'profile_v1_gone' });
  app.patch('/v1/profile', { preHandler: authenticated(repo) }, gone);
  app.delete('/v1/notes/:id', { preHandler: authenticated(repo) }, gone);
}
