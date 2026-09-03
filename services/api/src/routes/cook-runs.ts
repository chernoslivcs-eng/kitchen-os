// POST /v1/cook-runs { recipe, servings?, rating?, verdict? } → { id, recipe_id }
// GET  /v1/cook-runs → { runs: CookRunWithRecipe[] }
//
// «Готове» з Cook Mode робить один POST і замикає цикл: рецепт зберігається як
// заморожений знімок у recipe, а cook_run фіксує факт готування конкретною людиною.
// Пізніше додасться списання партій, поживність за складом, рейтинг post-hoc.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RecipeRow, Repo, CookRunBatchChange } from '@kitchen/domain';
import { catchesFor, traditionsFrom } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import type { Recipe } from '../model.js';
import { WRITEOFF_PROMPT } from '../post-cook.js';

// Приводимо (value, unit) з рецепта до одиниць, у яких зберігається партія.
// Ті ж самі правила, що в domain/apply.ts normalizeUnit: l→ml, kg→g. Якщо
// одиниці несумісні (партія в pcs, рецепт у g) — повертаємо null: тоді
// на верхньому рівні спрацює повна депляція.
function normalizeForBatch(value: number | null, unit: string | null, batchUnit: string | null): number | null {
  if (value == null || unit == null || batchUnit == null) return null;
  const u = unit.toLowerCase();
  if (batchUnit === 'ml') {
    if (u === 'ml' || u === 'мл') return value;
    if (u === 'l' || u === 'л') return value * 1000;
    return null;
  }
  if (batchUnit === 'g') {
    if (u === 'g' || u === 'г') return value;
    if (u === 'kg' || u === 'кг') return value * 1000;
    return null;
  }
  if (batchUnit === 'pcs') {
    if (u === 'pcs' || u === 'шт' || u === 'штук' || u === 'штука') return value;
    return null;
  }
  if (batchUnit === 'pack') {
    if (u === 'pack' || u === 'пач' || u === 'пачка') return value;
    return null;
  }
  return null;
}

interface CookRunBody {
  recipe?: Recipe;
  servings?: number;
  rating?: number;
  verdict?: string;
  // Партії, з яких «щось лишилось» — не депляцувати, а відкрити. Елемент —
  // id або {id, v}: v — опційне «лишилось ≈» з модалки (Бриф-2 п.4).
  keep?: (string | { id: string; v?: number })[];
  dry_run?: boolean; // тільки прогноз would_deplete, без запису
  // UX9-26: «Нічого не списувати» мусить означати НІЧОГО. Раніше клієнт слав
  // keep-на-всіх — і часткові віднімання плюс opened+value:null все одно
  // проходили (вершки втратили «200 мл» назавжди). skip_pantry пропускає весь
  // цикл списання: журнальний запис створюється, комора недоторкана.
  skip_pantry?: boolean;
  // UX9-11: рецепт зі стрічки вже персистований чернеткою (recipe_link.recipe_id).
  // Передали id — реюзаємо рядок, не плодимо другий («У рецепти» давало дубль).
  recipe_id?: string;
  // Правка №11: сесія, з якої запустили Cook Mode — журнал поведе назад у неї.
  session_id?: string;
  // Правка №6: пост-готування живе в чаті. «Приготували» шле skip_pantry +
  // ask_writeoff — сервер кладе в сесію детерміноване «Списати продукти?»
  // (0 токенів), а списання поїде звичайною intake_diff-карткою після «так».
  // Канони Бриф-2 п.4 (модалка зникнення) і п.7 (оцінка на фініш-екрані)
  // скасовано свідомо — див. post-cook.ts.
  ask_writeoff?: boolean;
}

export function cookRunsRoutes(app: FastifyInstance, repo: Repo) {
  app.post<{ Body: CookRunBody }>(
    '/v1/cook-runs',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id, household_id } = requireUser(req);
      const { recipe, servings, rating, verdict, keep, dry_run, skip_pantry, recipe_id: clientRecipeId, session_id, ask_writeoff } = req.body ?? {};
      // #7 (план 2026-08-30): «щось лишилось» — id партій, які людина зняла з
      // повного списання в модалці підтвердження. Замість depleted → opened із
      // невідомою кількістю: чесне «не знаю» замість вигаданого залишку.
      const keepMap = new Map<string, number | null>();
      for (const k of Array.isArray(keep) ? keep : []) {
        if (typeof k === 'string') keepMap.set(k, null);
        else if (k && typeof k.id === 'string') {
          keepMap.set(k.id, typeof k.v === 'number' && k.v > 0 ? k.v : null);
        }
      }
      if (!recipe || !recipe.t || !Array.isArray(recipe.ing)) {
        return reply.code(400).send({ error: 'recipe with t and ing[] required' });
      }
      const now = new Date().toISOString();
      // UX9-11: якщо клієнт показав на існуючу чернетку — реюзаємо її рядок.
      // Чужий або неіснуючий id мовчки ігноруємо (створюємо новий, як раніше).
      let existingRecipe: RecipeRow | null = null;
      if (clientRecipeId) {
        const row = await repo.getRecipe(clientRecipeId);
        if (row && row.owner_id === user_id) existingRecipe = row;
      }
      const recipe_id = existingRecipe?.id ?? randomUUID();

      // Enrich `ing.n` із коморних міток: модель показала пальцем через `ing.p`
      // (uuid партії), а на публічному /r/:id інший юзер уже не має цих партій.
      // Печемо назву в payload при збереженні — тоді SharedRecipe завжди показує
      // «моцарела», не голий uuid. Живе `ing.p` теж лишається — для алергічних
      // прапорців і для деплеції.
      const enrichedIng = await Promise.all(
        (recipe.ing ?? []).map(async (ing) => {
          if (ing.n || !ing.p) return ing;
          const b = await repo.getBatch(ing.p);
          if (b && b.household_id === household_id) return { ...ing, n: b.label };
          return ing;
        }),
      );
      const enrichedRecipe = { ...recipe, ing: enrichedIng };

      if (!existingRecipe) {
        const recipeRow: RecipeRow = {
          id: recipe_id,
          owner_id: user_id,
          origin: 'generated',
          title: recipe.t,
          descr: recipe.d ?? null,
          character: recipe.ch ?? null,
          risk: recipe.rk ?? null,
          base_servings: recipe.sv ?? servings ?? 2,
          time_total: recipe.tm ?? null,
          nutrition: recipe.nu ?? null,
          payload: enrichedRecipe,
          created_at: now,
          // Cook-run зберігає рецепт як побічний ефект — не як «збережений».
          // «Лишити на потім» ставить saved_at через POST /v1/recipes.
          saved_at: null,
        };
        await repo.saveRecipe(recipeRow);
      }

      const run_id = randomUUID();

      // Списання партій, на які модель поставила посилання (ing.p = batch id).
      // Часткове: якщо recipe.ing[i] має v/u сумісні з партією — віднімаємо. Якщо
      // після цього залишок ≤ 0 — партія депляцується. Одиниці конвертуємо
      // за тими ж правилами, що intake normalizeUnit: l→ml×1000, kg→g×1000.
      //
      // QA4-03: коли кількість невідома (модель віддала «q»:"400g" замість v/u,
      // або одиниці несумісні) — раніше депляцували ВСЮ партію. Для пляшки олії
      // й «2 ст.л» це знищувало пляшку. Тепер у такому разі просто позначаємо
      // партію відкритою: недосписання чесніше за тихе знищення.
      // Прогноз для модалки «Партія зникне з комори» — той самий прохід, що
      // нижче списує, тільки без запису. Рахувати це на фронті означало б
      // тримати копію normalizeForBatch, яка неминуче розійдеться.
      if (dry_run) {
        const would_deplete: { id: string; label: string; value: number | null; unit: string | null }[] = [];
        for (const ing of recipe.ing ?? []) {
          if (!ing.p) continue;
          const batch = await repo.getBatch(ing.p);
          if (!batch || batch.household_id !== household_id) continue;
          if (batch.state === 'depleted') continue;
          const used = normalizeForBatch(ing.v ?? null, ing.u ?? null, batch.unit);
          if (used == null) continue;                       // невідома кількість → opened, не deplete
          if (batch.value != null && batch.value > used) continue;  // часткове
          would_deplete.push({ id: batch.id, label: batch.label, value: batch.value, unit: batch.unit });
        }
        return reply.code(200).send({ would_deplete });
      }

      let depleted = 0;
      let partial = 0;
      let opened = 0;
      const depletedIds: string[] = [];
      // UX9-24: підсумок на «Готово» називає позиції, не лічильники.
      const depletedLabels: string[] = [];
      const partialLabels: string[] = [];
      const openedLabels: string[] = [];
      const changes: CookRunBatchChange[] = [];
      for (const ing of skip_pantry ? [] : (recipe.ing ?? [])) {
        if (!ing.p) continue;
        const batch = await repo.getBatch(ing.p);
        if (!batch || batch.household_id !== household_id) continue;
        if (batch.state === 'depleted') continue;

        const used = normalizeForBatch(ing.v ?? null, ing.u ?? null, batch.unit);

        if (used == null) {
          // Кількість невідома. Партію не чіпаємо крім стану — вона лишається
          // в коморі, юзер сам скоригує через шит партії, якщо треба.
          if (batch.state === 'sealed') {
            changes.push({
              id: batch.id,
              op: 'subtract',
              amount: 0,
              prev_state: batch.state,
              prev_value: batch.value,
              prev_opened_at: batch.opened_at,
            });
            await repo.updateBatch(batch.id, {
              state: 'opened',
              opened_at: now,
              last_by: user_id,
              last_action: 'cook',
            });
            opened++;
            openedLabels.push(batch.label);
          }
          continue;
        }

        if (batch.value != null && batch.value > used) {
          changes.push({
            id: batch.id,
            op: 'subtract',
            amount: used,
            prev_state: batch.state,
            prev_value: batch.value,
            prev_opened_at: batch.opened_at,
          });
          await repo.updateBatch(batch.id, {
            value: Math.round((batch.value - used) * 100) / 100,
            state: batch.state === 'sealed' ? 'opened' : batch.state,
            opened_at: batch.opened_at ?? now,
            last_by: user_id,
            last_action: 'cook',
          });
          partial++;
          partialLabels.push(batch.label);
        } else if (keepMap.has(batch.id)) {
          // Людина сказала «щось лишилось»: партія відкрита, кількість невідома.
          changes.push({
            id: batch.id,
            op: 'subtract',
            amount: 0,
            prev_state: batch.state,
            prev_value: batch.value,
            prev_opened_at: batch.opened_at,
          });
          await repo.updateBatch(batch.id, {
            state: 'opened',
            opened_at: batch.opened_at ?? now,
            // «Лишилось ≈ 100г» із модалки — або чесне «не знаю».
            value: keepMap.get(batch.id) ?? null,
            last_by: user_id,
            last_action: 'cook',
          });
          opened++;
          openedLabels.push(batch.label);
        } else {
          // Вжили не менше залишку → партія справді закінчилась.
          changes.push({
            id: batch.id,
            op: 'deplete',
            prev_state: batch.state,
            prev_depleted_at: batch.depleted_at,
          });
          await repo.updateBatch(batch.id, {
            state: 'depleted',
            depleted_at: now,
            last_by: user_id,
            last_action: 'cook',
          });
          depletedIds.push(batch.id);
          depleted++;
          depletedLabels.push(batch.label);
        }
      }

      // Чужу/неіснуючу сесію мовчки не пишемо — журнал важливіший за слід.
      const owned_session_id =
        session_id && (await repo.getSession(session_id))?.user_id === user_id ? session_id : null;

      await repo.saveCookRun({
        id: run_id,
        household_id,
        user_id,
        recipe_id,
        servings: servings ?? recipe.sv ?? 2,
        started_at: now,
        finished_at: now,
        rating: rating ?? null,
        verdict: verdict ?? null,
        photo_url: null,
        changes: changes.length ? { batches: changes } : null,
        undone_at: null,
        session_id: owned_session_id,
      });

      // Марка в паспорті. Пишеться МОВЧКИ: у щоденний потік вона не лізе, і
      // репліка про неї не згадує. Продукт свідомо позбувся лічильників —
      // «спіймав сезон грибів!» у відповідь на вечерю було б тим самим.
      // Помилка тут не має ламати готування: журнал важливіший за марку.
      try {
        const profile = await repo.getProfile(user_id);
        const hits = catchesFor(recipe, new Date(now), traditionsFrom(profile?.wishes ?? []));
        for (const h of hits) {
          await repo.recordOccasionCatch({
            household_id, occasion_id: h.occasion_id,
            year: new Date(now).getFullYear(),
            caught_at: now, by: h.by, run_id: run_id,
          });
        }
      } catch (err) {
        req.log.warn({ err }, 'occasion-catch failed');
      }

      // Правка №6: перше слово пост-готування — детерміноване питання в сесії
      // запуску. Далі все їде чатом (шорткати «так»/«ні» — див. chat.ts).
      if (ask_writeoff && owned_session_id) {
        await repo.saveMessage({
          id: randomUUID(), session_id: owned_session_id, role: 'assistant',
          text: WRITEOFF_PROMPT, card: null, applied: 0, created_at: new Date().toISOString(),
        });
      }

      return reply.code(201).send({
        id: run_id,
        recipe_id,
        depleted,
        partial,
        opened,
        depleted_batch_ids: depletedIds,
        depleted_labels: depletedLabels,
        partial_labels: partialLabels,
        opened_labels: openedLabels,
      });
    },
  );

  // Ретро-оцінка: юзер міг натиснути «Готово», а рейтинг поставити пізніше
  // (або взагалі пропустити). Тому PATCH окремо від POST.
  app.patch<{ Params: { id: string }; Body: { rating?: number | null; verdict?: string | null; photo_url?: string | null } }>(
    '/v1/cook-runs/:id',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const run = await repo.getCookRun(req.params.id);
      if (!run) return reply.code(404).send({ error: 'not_found' });
      if (run.user_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      const patch: Parameters<typeof repo.updateCookRun>[1] = {};
      if ('rating' in req.body) {
        if (req.body.rating != null && (typeof req.body.rating !== 'number' || req.body.rating < 1 || req.body.rating > 5)) {
          return reply.code(400).send({ error: 'rating_out_of_range' });
        }
        patch.rating = req.body.rating;
      }
      if ('verdict' in req.body) patch.verdict = req.body.verdict || null;
      if ('photo_url' in req.body) patch.photo_url = req.body.photo_url || null;
      await repo.updateCookRun(run.id, patch);
      const updated = await repo.getCookRun(run.id);
      return { updated: true, rating: updated?.rating ?? null, verdict: updated?.verdict ?? null, photo_url: updated?.photo_url ?? null };
    },
  );

  app.get('/v1/cook-runs', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    const runs = await repo.listCookRuns(user_id, 30);
    return { runs };
  });

  // Розкат назад: партіям, що були депляцовані — повертаємо попередній стан;
  // тим, у кого віднімали — повертаємо попередній value і opened_at. Ідемпотентно:
  // повторний виклик по вже undone-ному пробіжаному run поверне 200 з {already: true}.
  app.post<{ Params: { id: string } }>(
    '/v1/cook-runs/:id/undo',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id, household_id } = requireUser(req);
      const run = await repo.getCookRun(req.params.id);
      if (!run) return reply.code(404).send({ error: 'not_found' });
      if (run.user_id !== user_id) return reply.code(403).send({ error: 'not_yours' });
      if (run.undone_at) return reply.send({ undone: true, already: true, restored: 0 });
      if (!run.changes) return reply.code(400).send({ error: 'no_changes_to_undo' });

      const now = new Date().toISOString();
      let restored = 0;
      for (const ch of run.changes.batches) {
        const batch = await repo.getBatch(ch.id);
        if (!batch || batch.household_id !== household_id) continue;
        if (ch.op === 'deplete') {
          await repo.updateBatch(ch.id, {
            state: ch.prev_state,
            depleted_at: ch.prev_depleted_at,
            last_by: user_id,
            last_action: 'undo_cook',
          });
          restored++;
        } else {
          // 'subtract' — повертаємо попередню кількість і opened_at.
          // Якщо hindsight: партія вже інша (юзер щось редагував уручну),
          // все одно повертаємо декларативно — це undo саме cook-run-у.
          await repo.updateBatch(ch.id, {
            value: ch.prev_value,
            state: ch.prev_state,
            opened_at: ch.prev_opened_at,
            last_by: user_id,
            last_action: 'undo_cook',
          });
          restored++;
        }
      }
      await repo.markCookRunUndone(run.id, now);
      return reply.send({ undone: true, already: false, restored });
    },
  );
}
