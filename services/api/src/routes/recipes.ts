// POST /v1/recipes/generate  { title, context? }
//   → { recipe, meta, usage }
// Персистенції рецепта поки нема — фронт тримає його в стані React-Router до
// перезавантаження. Коли зʼявиться таблиця recipe і CookRun — додамо GET/POST /v1/recipes/:id.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { recipeStaleByNotes } from '../recipe-dedup.js';
import { randomUUID } from 'node:crypto';
import { maskHistoryQuantities, matchRecipe, resolveRecipeLabels, type RecipeIngredient } from '@kitchen/domain';
import type { Repo } from '@kitchen/domain';
import { callRecipe } from '../model.js';
import type { Recipe, RecipeIng } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';
import { makeRateLimiter } from '../rate-limit.js';

export function recipesRoutes(app: FastifyInstance, repo: Repo) {
  // Публічний рецепт — без auth. Обмежуємо по IP щоб не могли скраулити всі UUID
  // (їх ~10^38 варіантів, але навіть спроба — це витрата ресурсів). 60/хв на IP
  // достатньо для реального юзера, замало для сканера.
  const publicLimiter = makeRateLimiter({ max: 60, windowMs: 60_000 });
  const publicLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!publicLimiter.check(req.ip)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  // Recipe generation — теж дорогий model call. Ліміт нижчий, ніж у chat, бо
  // юзер клікає «Рецепт →» рідше, ніж пише в композитор. 10/хв per user_id.
  const genLimiter = makeRateLimiter({ max: 10, windowMs: 60_000 });
  const genLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = requireUser(req);
    if (!genLimiter.check(ctx.user_id)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  app.post<{
    Body: { title?: string; context?: string; session_id?: string; regenerate?: boolean };
  }>('/v1/recipes/generate', { preHandler: [authenticated(repo), genLimit] }, async (req, reply) => {
    const ctx = requireUser(req);
    const { title, context, session_id, regenerate } = req.body ?? {};
    if (!title || !title.trim()) return reply.code(400).send({ error: 'title required' });

    // Ідемпотентність: та сама назва в межах доби → той самий рецепт, без
    // виклику моделі. Інакше кожен тап «Рецепт» вигадує страву заново — два
    // «Бабусин борщ» з різним мʼясом і різними калоріями на сусідніх скрінах.
    // regenerate: true — свідомий «дай інший підхід».
    if (!regenerate) {
      const dayAgo = Date.now() - 24 * 3600_000;
      // QA8-01: людина тапає назву ПРОПОЗИЦІЇ, а рядок збережено під назвою
      // МОДЕЛІ — звіряємо обидві. Вікно 40: 20 обрізало добу активного дня.
      const recent = await repo.listRecentRecipes(ctx.user_id, 40);
      const wanted = title.trim().toLowerCase();
      const same = recent.find((r) =>
        (r.title.trim().toLowerCase() === wanted
          || r.requested_title?.trim().toLowerCase() === wanted)
        && new Date(r.created_at).getTime() > dayAgo);
      // Ручний тест 04.09: нотатка, новіша за кешований рецепт, робить його
      // застарілим — інакше «менше вершків» ніколи не дійде до кроків.
      if (same && !recipeStaleByNotes(same, await repo.listNotes(ctx.user_id, 20))) {
        return { id: same.id, recipe: same.payload, reused: true, meta: null, usage: null };
      }
    }

    const pantry = await repo.listBatches(ctx.household_id);
    const products = await repo.listProducts(ctx.household_id);
    const profile = await repo.getProfile(ctx.user_id);
    // Г-1: висновки людини йдуть у генерацію — «урок вбудовується в крок».
    const notes = await repo.listNotes(ctx.user_id, 20);
    // Пул-4 №4б: хвіст розмови в генерацію — «Буде» на «Арборіо є?» не
    // губиться між викликами. Кількості маскуються, як у чат-історії.
    let conversation: string | undefined;
    const sid = (req.body as { session_id?: string })?.session_id;
    if (sid) {
      const sess = await repo.getSession(sid);
      if (sess && sess.user_id === ctx.user_id) {
        const tail = (await repo.listMessages(sid)).slice(-6);
        conversation = tail
          .filter((m) => m.text)
          .map((m) => `${m.role === 'user' ? 'людина' : 'кухар'}: ${maskHistoryQuantities(m.text!)}`)
          .join('\n') || undefined;
      }
    }
    const started = Date.now();
    // UX9-02: падіння моделі → 502 з кодом, не сирий 500.
    let call: Awaited<ReturnType<typeof callRecipe>>;
    try {
      call = await callRecipe({ title: title.trim(), context, pantry, profile, notes, products, conversation });
    } catch (err) {
      req.log.error({ err }, 'recipe-model-call-failed');
      return reply.code(502).send({ error: 'model_unavailable' });
    }
    await recordUsage(repo, ctx, 'recipe_gen', call.meta, call.usage, started);

    if (!call.recipe) {
      // QA4-06: раніше тут був 502, і людина бачила помилку там, де модель
      // правильно сказала, що завдання неоднозначне («400 г лосося — це мало
      // на шістьох»). Тепер це діалог: клієнт покаже reply як репліку кухаря.
      req.log.info({ raw: call.raw.slice(0, 200) }, 'recipe-returned-prose-not-json');
      // QA5-06: `raw` — сирий текст моделі, а цей канал обходить контракт із
      // card-rules.md. Зачищаємо маркдаун, інакше юзер бачить зірочки як текст.
      const clean = call.raw
        .replace(/\*\*/g, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/`/g, '')
        .replace(/\n{2,}/g, ' ')
        .trim()
        .slice(0, 400);
      return reply.send({ recipe: null, reply: clean, meta: call.meta, usage: call.usage });
    }

    // QA4-03: модель вигадує схему `ing`, коли промпт її не описує. Логуємо
    // порушення — це сигнал, що правило в recipe-generator.md знову поїхало.
    const bad = call.recipe.ing.filter(
      (i: RecipeIng) => 'q' in (i as object) || (i.v != null && typeof i.v !== 'number'),
    );
    if (bad.length) req.log.warn({ bad, title }, 'recipe-ing-schema-violation');

    // QA9-01: назва партії вморожується в payload зараз — рендер більше не
    // залежить від живої комори. Партію спишуть чи перейменують — рецепт
    // читається як і читався: «Багет», а не «з комори» / «Інгредієнт».
    call.recipe = resolveRecipeLabels(call.recipe, pantry);

    // Р-3 (design-audit-2): рецепт одразу пишеться чернеткою і отримує адресу.
    // saved_at: null → у бібліотеці не видно; «☆ На потім» стає PATCH saved,
    // тобто з «рятування» перетворюється на «впорядкування». F5 на /recipe/:id
    // більше нічого не губить.
    // TODO(прибирання): чернетки, не збережені й не приготовані за 30 днів,
    // можна чистити — політика узгоджена в звіті, крон буде після деплою.
    const draft_id = randomUUID();
    await repo.saveRecipe({
      id: draft_id,
      owner_id: ctx.user_id,
      origin: 'generated',
      title: call.recipe.t,
      requested_title: title.trim(),
      descr: call.recipe.d ?? null,
      character: call.recipe.ch ?? null,
      risk: call.recipe.rk ?? null,
      base_servings: call.recipe.sv ?? 2,
      time_total: call.recipe.tm ?? null,
      nutrition: call.recipe.nu ?? null,
      payload: call.recipe,
      created_at: new Date().toISOString(),
      saved_at: null,
    });

    // Слід у розмові: «Рецепт →» більше не зникає зі стрічки (DA2-30).
    // Чужу чи неіснуючу сесію мовчки ігноруємо — рецепт важливіший за слід.
    if (session_id) {
      const session = await repo.getSession(session_id);
      if (session && session.user_id === ctx.user_id) {
        await repo.saveMessage({
          id: randomUUID(), session_id: session.id, role: 'assistant',
          text: null,
          card: { type: 'recipe_link', recipe_id: draft_id, title: call.recipe.t, recipe: call.recipe },
          applied: 0, created_at: new Date().toISOString(),
        });
      }
    }

    return { id: draft_id, recipe: call.recipe, meta: call.meta, usage: call.usage };
  });

  // Р-3: адреса рецепта. 404 і для чужого — не підтверджуємо існування id.
  app.get<{ Params: { id: string } }>(
    '/v1/recipes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const row = await repo.getRecipe(req.params.id);
      if (!row || row.owner_id !== user_id) return reply.code(404).send({ error: 'not_found' });
      return {
        id: row.id, origin: row.origin, saved_at: row.saved_at,
        created_at: row.created_at, recipe: row.payload,
      };
    },
  );

  // Правка №11: журнал/бібліотека ведуть у СЕСІЮ рецепта. Шукаємо найсвіжішу
  // сесію юзера, де цей рецепт лежить recipe_link-ходом; немає — клієнт
  // створить нову через POST /v1/session {recipe_id}.
  app.get<{ Params: { id: string } }>(
    '/v1/recipes/:id/session',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const row = await repo.getRecipe(req.params.id);
      if (!row || row.owner_id !== user_id) return reply.code(404).send({ error: 'not_found' });
      const sessions = await repo.listSessionsForUser(user_id, 50);
      for (const s of sessions) {
        const msgs = await repo.listMessages(s.id);
        if (msgs.some((m) => m.card?.type === 'recipe_link' && (m.card as { recipe_id?: string }).recipe_id === row.id)) {
          return { session_id: s.id };
        }
      }
      return { session_id: null };
    },
  );

  // «На потім» для рецепта, який уже має адресу: не плодимо другий рядок.
  app.patch<{ Params: { id: string }; Body: { saved?: boolean } }>(
    '/v1/recipes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const row = await repo.getRecipe(req.params.id);
      if (!row || row.owner_id !== user_id) return reply.code(404).send({ error: 'not_found' });
      const saved = req.body?.saved === true;
      await repo.setRecipeSaved(row.id, saved ? new Date().toISOString() : null);
      return { id: row.id, saved };
    },
  );

  // ---- Бібліотека рецептів (екран 07 із прототипу) ----------------------
  //
  // До цього рецепт народжувався ТІЛЬКИ в POST /v1/cook-runs: не приготував —
  // зник назавжди. QA-6 намацав це через відчуття «двічі отримав різото й
  // обидва рази втратив». У прототипі екран був, у прод не доїхав.

  // «Лишити на потім» під карткою пропозиції.
  app.post<{ Body: { recipe?: Recipe } }>(
    '/v1/recipes',
    { preHandler: [authenticated(repo), genLimit] },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const recipe = req.body?.recipe;
      if (!recipe?.t || !Array.isArray(recipe.ing)) {
        return reply.code(400).send({ error: 'recipe with t and ing[] required' });
      }
      // П.6 pre-deploy: payload їде в БД і в кожне recipe_link-повідомлення —
      // 64KB вистачає будь-якій страві, але зупиняє сміттєвоз.
      if (JSON.stringify(recipe).length > 64_000) {
        return reply.code(413).send({ error: 'recipe_too_large' });
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      await repo.saveRecipe({
        id,
        owner_id: user_id,
        origin: 'generated',
        title: recipe.t,
        descr: recipe.d ?? null,
        character: recipe.ch ?? null,
        risk: recipe.rk ?? null,
        base_servings: recipe.sv ?? 2,
        time_total: recipe.tm ?? null,
        nutrition: recipe.nu ?? null,
        payload: recipe,
        created_at: now,
        saved_at: now,
      });
      return reply.code(201).send({ id });
    },
  );

  // Список із готовністю проти поточної комори: ready / near / far.
  app.get('/v1/recipes', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id, household_id } = requireUser(req);
    const [rows, pantry] = await Promise.all([
      repo.listRecipes(user_id, 50),
      repo.listBatches(household_id),
    ]);
    const recipes = rows.map((r) => {
      const payload = r.payload as { ing?: RecipeIngredient[] } | null;
      const match = matchRecipe(payload?.ing ?? [], pantry);
      return {
        id: r.id,
        title: r.title,
        descr: r.descr,
        character: r.character,
        time_total: r.time_total,
        base_servings: r.base_servings,
        saved_at: r.saved_at,
        cooked_count: r.cooked_count,
        last_cooked_at: r.last_cooked_at,
        payload: r.payload,
        status: match.status,
        have: match.have,
        total: match.total,
        // Назви, не uuid — на екрані має бути «бракує: яйця, бекон».
        missing: match.missing.map((m) => m.n ?? 'інгредієнт'),
        rescues: match.rescues.map((b) => b.label),
      };
    });
    return { recipes };
  });

  // Прибрати з бібліотеки. Рядок не видаляємо (журнал тримає recipe_id через
  // ON DELETE CASCADE — жорстке видалення знесло б готування), а знімаємо
  // saved_at і ставимо hidden_at: QA9-08 — рецепт «готував, не зберіг» інакше
  // висів у списку назавжди без жодного ✕.
  app.delete<{ Params: { id: string } }>(
    '/v1/recipes/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const r = await repo.getRecipe(req.params.id);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      if (r.owner_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      await repo.setRecipeSaved(r.id, null);
      await repo.setRecipeHidden(r.id, new Date().toISOString());
      return reply.code(204).send();
    },
  );

  // Публічний read-only рецепт для sharing. Без auth: хто отримав лінк, той бачить.
  // Це саме payload з recipe — той самий, що в БД, без owner/created_at. Плюс на клієнті
  // ми не дозволяємо Cook Mode без логіну — тільки перегляд і "Готуй у себе".
  app.get<{ Params: { id: string } }>(
    '/v1/r/:id',
    { preHandler: publicLimit },
    async (req, reply) => {
      const r = await repo.getRecipe(req.params.id);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      return {
        id: r.id,
        title: r.title,
        recipe: r.payload,
        created_at: r.created_at,
      };
    },
  );
}
