// Раунд 4 (AUDIT-ROUND-4.md §6): профіль як сім речень. Крок 11: єдиний
// профіль — v1 (allergy/wish/anti/equip) і прапор PROFILE_V2 прибрано.
//
// GET    /v1/profile                    → { fields, notes, defaults: { kit }, veto, eaters }
// PATCH  /v1/profile/traditions         { traditions: Tradition[] | null } — перемикач календаря
// PATCH  /v1/profile/:key               { text } | { status: 'none' } — автозбереження
// DELETE /v1/profile/notes/:id          → мʼяке видалення (для «Повернути»)
// POST   /v1/profile/notes/:id/restore  → повернути; вікно 5 с — на клієнті, тут без обмеження
//
// Старі ендпоінти профілю (PATCH /v1/profile з ops, DELETE /v1/notes/:id)
// віддають 410 — одна дорога в одне поле.

import type { FastifyInstance } from 'fastify';
import {
  KIT_DEFAULTS, PROFILE_FIELD_KEYS, NOTES_IN_PROMPT, rebuildVetoIndex, resolveTraditions,
  type ProfileFieldKey, type Repo, type Tradition,
} from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';

const isKey = (k: string): k is ProfileFieldKey => (PROFILE_FIELD_KEYS as readonly string[]).includes(k);

export function profileRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/profile', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id, household_id } = requireUser(req);
    const [text, notes, veto, eaters] = await Promise.all([
      repo.getProfileText(user_id),
      repo.listProfileNotes(user_id, { limit: NOTES_IN_PROMPT }),
      repo.getVetoIndex(user_id),
      repo.listEaters(household_id),
    ]);
    const user = await repo.getUser(user_id);
    return {
      fields: text.fields,
      notes: notes.map((n) => ({ id: n.id, text: n.text, source: n.source, created_at: n.created_at })),
      defaults: { kit: [...KIT_DEFAULTS] },
      // Явний вибір (null — ще не обирала) і те, що календар показує зараз.
      traditions: user?.traditions ?? null,
      effective_traditions: await resolveTraditions(repo, user_id),
      // Крок 11: сторінка рецепта позначає інгредієнти — межа власника з
      // індексу (label — слово людини, allergy — з ban), домашніх — з їдців.
      veto: veto.map((r) => ({ field: r.field, kind: r.kind, ref: r.ref, label: r.label, allergy: r.allergy })),
      eaters: eaters.map((e) => ({ id: e.id, name: e.name, allergies: e.allergies, wishes: e.wishes, antipatterns: e.antipatterns })),
    };
  });

  // Крок 11: традиції живуть на user, а не в полі тексту. null — «не обирала»
  // (календар вгадує зі слів), [] — «вимкнула все». Реєструється ДО /:key,
  // інакше «traditions» читалось би як назва поля.
  const TRADITIONS: readonly Tradition[] = ['orthodox', 'catholic', 'islamic', 'jewish'];
  app.patch<{ Body: { traditions?: unknown } }>(
    '/v1/profile/traditions',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const t = req.body?.traditions;
      let next: Tradition[] | null;
      if (t === null) next = null;
      else if (Array.isArray(t) && t.every((x) => typeof x === 'string' && (TRADITIONS as readonly string[]).includes(x))) {
        next = TRADITIONS.filter((x) => (t as string[]).includes(x));
      } else return reply.code(400).send({ error: 'bad_traditions' });
      await repo.setTraditions(user_id, next);
      return { traditions: next, effective: await resolveTraditions(repo, user_id) };
    },
  );

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

  // v1 — пішов (крок 11 прибрав і код). 410, а не 404: клієнт зі старим
  // кодом має побачити різницю між «не туди» і «цього більше нема».
  const gone = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(410).send({ error: 'profile_v1_gone' });
  app.patch('/v1/profile', { preHandler: authenticated(repo) }, gone);
  app.delete('/v1/notes/:id', { preHandler: authenticated(repo) }, gone);
}

// Їдці — раунд 5, не профіль v1.
export function eaterRoutes(app: FastifyInstance, repo: Repo) {
  // Їдець живе в домі, тож право на видалення — членство в домі, не авторство.
  app.delete<{ Params: { id: string } }>(
    '/v1/eaters/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { household_id } = requireUser(req);
      const mine = await repo.listEaters(household_id);
      if (!mine.some((e) => e.id === req.params.id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await repo.deleteEater(req.params.id);
      return reply.code(204).send();
    },
  );
}
