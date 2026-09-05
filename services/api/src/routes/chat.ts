import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { callChat, callAttachmentParse, callRecipe, type AttachmentPayload } from '../model.js';
import { mergeAttachmentCalls } from '../attachment-merge.js';
import { detectRepeat, repeatReply } from '../repeat-guard.js';
import { recipeStaleByNotes } from '../recipe-dedup.js';
import { isProfileFieldCard, legacyOpsFromFieldCard } from '@kitchen/domain';
import { createPending, applyCard, applyMode, applyModeFor, deriveSessionTitle, resolveRecipeLabels, buildAliasMap, aliasRecipeIds, detectModes, type Repo, type Card, type Recipe, type MessageRow } from '@kitchen/domain';
import { buildChatHistory } from '../chat-history.js';
import type { AttachmentStore } from '../attachment-store.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';
import { resolveWhen } from '../event-when.js';
import {
  isYes, isNo, extractRating, buildWriteoffOps, latestRunInSession,
  WRITEOFF_PROMPT, WRITEOFF_CARD_REPLY, WRITEOFF_DECLINED_REPLY, WRITEOFF_EMPTY_REPLY,
  FEEDBACK_MARKERS, FEEDBACK_PROMPT,
} from '../post-cook.js';
import { looksLikeModelDebris, stripHistoryStamps, INTAKE_TOO_BIG_REPLY } from '../reply-guard.js';
import { fixTense, tenseViolation } from '../tense.js';
import type { RetailCartAttempt, RetailSearchAttempt } from './retail.js';
import { localDay } from '../local-day.js';
import { stampChatReceipt } from '../receipt-source.js';
import { composeIntakeLabels } from '../intake-labels.js';
import { vetoNonfood } from '../nonfood-veto.js';
import { vetoAllergens, stripAllergenMentionsFromReply } from '../allergen-veto.js';

// POST /v1/chat
//   { text?, attachments?: [{id}] } → { reply, card, card_id, usage, meta }
//
// Побічних ефектів на комору НЕ застосовує. Картка йде як пропозиція,
// клієнт натискає apply. Обидва повідомлення (user + assistant) пишуться
// в message/session — щоб чат переживав F5 і перезапуск сервера.

export interface ChatRouteOpts {
  rateLimit?: RateLimitCfg;
  // Раунд 4: профіль як сім речень — [ПРО ЛЮДИНУ]+[НОТАТКИ] у контексті,
  // note/intent → profile_note, картка поля через applyCard.
  profileV2?: boolean;
  // M13: «асистент повинен мати руки» — та сама дія, що кнопка «Зібрати
  // кошик», доступна словами. Інʼєкція з retailRoutes() (server.ts) —
  // chat.ts не знає нічого про Сільпо, цифри/крипту/withRetryAuth, тільки
  // «спробуй, скажи як пройшло».
  retailCart?: (user_id: string, household_id: string, explicitItems?: string[]) => Promise<RetailCartAttempt>;
  // 01.09: «що є в наявності по X» — read-only пошук, той самий принцип
  // ін'єкції, що retailCart.
  retailSearch?: (user_id: string, query: string) => Promise<RetailSearchAttempt>;
  /** Відкриті джерела без підключення (Стейки Карпат) — для блоку [МЕРЕЖІ]. */
  retailKarpaty?: boolean;
  // №4: «додай X» при відкритому кошику — дописати рядок у ТУ САМУ картку,
  // а не перезбирати кошик і не підміняти його однією позицією.
  retailCartExtend?: (user_id: string, card_id: string, items: string[]) => Promise<RetailCartAttempt>;
}

export function chatRoute(app: FastifyInstance, repo: Repo, store: AttachmentStore, opts: ChatRouteOpts = {}) {
  // Ліміт для чату — щоб залогінений юзер (свідомо чи ні) не наспамив у модель тисячу
  // запитів за хвилину. 30 запитів/хв — це «людина активно спілкується» на верхній межі,
  // явно замало для ліберпетлі. Ключ — user_id, не IP: розділяємо кухні в спільній мережі.
  const cfg = opts.rateLimit ?? { max: 30, windowMs: 60_000 };
  const limiter = makeRateLimiter(cfg);
  const limitCheck = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = requireUser(req);
    if (!limiter.check(ctx.user_id)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  app.post<{
    Body: {
      session_id?: string;
      text?: string;
      attachments?: { id: string }[];
    };
  }>('/v1/chat', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const ctx = requireUser(req);
    const { user_id, household_id } = ctx;
    const { text, attachments, session_id: clientSessionId } = req.body ?? {};
    if (!text && !attachments?.length) {
      return reply.code(400).send({ error: 'text or attachments required' });
    }

    // Якщо клієнт передав конкретний session_id (напр. після «Новий чат»),
    // валідуємо володіння й використовуємо його. Інакше — сесія дня.
    let session = clientSessionId ? await repo.getSession(clientSessionId) : null;
    if (session && session.user_id !== user_id) session = null;
    if (!session) session = await repo.getOrCreateSessionForDay(user_id, localDay());

    if (attachments?.length) {
      const payloads: AttachmentPayload[] = [];
      for (const { id } of attachments) {
        const rec = await repo.getAttachment(id);
        if (!rec) return reply.code(404).send({ error: `attachment not found: ${id}` });
        if (rec.user_id !== user_id) return reply.code(403).send({ error: `forbidden attachment: ${id}` });
        const { buffer, content_type } = await store.get(rec.url);
        payloads.push({ kind: rec.kind, buffer, content_type, hint: rec.hint ?? undefined });
      }
      // Спершу записуємо user-message (текст + факт вкладень).
      const userMsgText = text?.trim() || (attachments.length === 1 ? '[вкладення]' : `[${attachments.length} вкладення]`);
      await repo.saveMessage({
        id: randomUUID(), session_id: session.id, role: 'user',
        text: userMsgText, card: null, applied: 0, created_at: new Date().toISOString(),
      });
      if (!session.title) {
        const title = deriveSessionTitle(userMsgText);
        if (title) await repo.setSessionTitle(session.id, title);
      }

      const started = Date.now();
      // UX9-02: падіння моделі → 502 з кодом, не сирий 500.
      let call: Awaited<ReturnType<typeof callAttachmentParse>>;
      try {
        // Аудит 04.09 (3.1): по одному виклику на вкладення, паралельно —
        // два чеки в одному виклику давали 97 с (прод s41).
        call = mergeAttachmentCalls(await Promise.all(payloads.map((p) => callAttachmentParse([p]))));
      } catch (err) {
        req.log.error({ err, user_id }, 'attachment-model-call-failed');
        return reply.code(502).send({ error: 'model_unavailable' });
      }
      await recordUsage(repo, ctx, 'attachment_parse', call.meta, call.usage, started);

      // Пул-2 №5: нерозібрана/обірвана відповідь — чесний фолбек, не нутрощі.
      if (!call.card && looksLikeModelDebris(call.reply ?? '')) {
        req.log.warn({ user_id, raw: (call.reply ?? '').slice(0, 300) }, 'attachment-reply-debris');
        call.reply = INTAKE_TOO_BIG_REPLY;
      }

      // #5: фото готової страви. Якщо є недавнє готування без фото — картка
      // cook_photo: тап, і фото в журналі. Старше доби не чіпаємо (це вже не
      // «щойно приготував»), наявне фото мовчки не перезаписуємо.
      if (call.raw_kind === 'dish' && !call.card && attachments.length === 1) {
        const runs = await repo.listCookRuns(user_id, 5);
        const fresh = runs.find((r) =>
          !r.undone_at && !r.photo_url
          && Date.now() - new Date(r.finished_at ?? r.started_at).getTime() < 24 * 3600_000);
        if (fresh) {
          call.card = {
            type: 'cook_photo',
            run_id: fresh.id,
            recipe_title: fresh.recipe.title,
            attachment_id: attachments[0]!.id,
          };
          call.reply = `Гарний вигляд. Це «${fresh.recipe.title}» — прикріпити фото до запису в журналі?`;
        }
      }

      stampChatReceipt(call.card, call.raw_kind);
      vetoNonfood(call.card);
      composeIntakeLabels(call.card);
      const card_id = call.card ? randomUUID() : null;
      if (call.card && card_id) {
        await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
      }
      await repo.saveMessage({
        id: card_id ?? randomUUID(), session_id: session.id, role: 'assistant',
        text: call.reply ?? null, card: call.card, applied: 0, created_at: new Date().toISOString(),
      });
      // Пул-8 №2: розібраний чек/фото полиці — теж одразу в комору, undo є.
      let att_auto = false;
      let att_undo: string | undefined;
      if (call.card?.type === 'intake_diff' && card_id) {
        const r = await applyCard(repo, card_id, [], user_id, { profileV2: opts.profileV2 });

      // Промах операції: ціль не знайдено, стан не змінився. Логуємо, бо
      // частоти цього ми не знаємо — а без числа неможливо вирішити, чи це
      // взагалі проблема в житті, чи лише в підстроєному випадку.
      if (r.missed?.length) {
        req.log.warn({ user_id, card_id: card_id, missed: r.missed }, 'intake-op-missed');
      }

      // Промах операції: ціль не знайдено, стан не змінився. Логуємо, бо
      // частоти цього ми не знаємо — а без числа неможливо вирішити, чи це
      // взагалі проблема в житті, чи лише в підстроєному випадку.
      if (r.missed?.length) {
        req.log.warn({ user_id, card_id: card_id, missed: r.missed }, 'intake-op-missed');
      }
        att_auto = true;
        att_undo = r.undo_token;
      }
      return {
        reply: call.reply, card: call.card, card_id,
        auto_applied: att_auto, undo_token: att_undo,
        raw_kind: call.raw_kind, usage: call.usage, meta: call.meta,
      };
    }

    // Правка №6: детерміновані пост-кук ходи. Якщо останнє слово асистента —
    // наше службове питання, коротка відповідь людини обробляється БЕЗ моделі
    // (0 токенів). Все, що складніше за «так»/«ні», падає у звичайний чат.
    const preMessages = await repo.listMessages(session.id);
    const lastMsg = preMessages[preMessages.length - 1];
    const detMeta = { promptVersion: 'post-cook', model: 'deterministic', mode: 'stub' as const };
    const zeroUsage = { input: 0, output: 0 };
    // Аудит 04.09 (3.1): та сама репліка вдруге після застосованої картки —
    // відповідаємо без моделі (прод s41: повтор дав +58 партій-дублів).
    const repeat = text ? detectRepeat(text, preMessages) : null;
    if (repeat && text) {
      const reply_text = repeatReply(repeat);
      await repo.saveMessage({
        id: randomUUID(), session_id: session.id, role: 'user',
        text, card: null, applied: 0, created_at: new Date().toISOString(),
      });
      await repo.saveMessage({
        id: randomUUID(), session_id: session.id, role: 'assistant',
        text: reply_text, card: null, applied: 0, created_at: new Date().toISOString(),
      });
      req.log.info({ user_id, card_type: repeat.card_type, ops: repeat.ops }, 'repeat-guard');
      return { reply: reply_text, card: null, card_id: null, usage: zeroUsage, meta: { ...detMeta, promptVersion: 'repeat-guard' } };
    }
    if (text && lastMsg?.role === 'assistant' && !lastMsg.card && lastMsg.text === WRITEOFF_PROMPT) {
      const saveTurn = async (reply_text: string, card: Card | null, card_id: string | null) => {
        await repo.saveMessage({
          id: randomUUID(), session_id: session.id, role: 'user',
          text, card: null, applied: 0, created_at: new Date().toISOString(),
        });
        await repo.saveMessage({
          id: card_id ?? randomUUID(), session_id: session.id, role: 'assistant',
          text: reply_text, card, applied: 0, created_at: new Date().toISOString(),
        });
      };
      if (isNo(text)) {
        await saveTurn(WRITEOFF_DECLINED_REPLY, null, null);
        return { reply: WRITEOFF_DECLINED_REPLY, card: null, card_id: null, usage: zeroUsage, meta: detMeta };
      }
      if (isYes(text)) {
        const run = await latestRunInSession(repo, user_id, session.id);
        const payload = run?.recipe?.payload as Recipe | undefined;
        const ops = payload ? await buildWriteoffOps(repo, household_id, payload) : [];
        if (!ops.length) {
          await saveTurn(WRITEOFF_EMPTY_REPLY, null, null);
          return { reply: WRITEOFF_EMPTY_REPLY, card: null, card_id: null, usage: zeroUsage, meta: detMeta };
        }
        const card: Card = { type: 'intake_diff', ops };
        const card_id = randomUUID();
        await createPending(repo, { message_id: card_id, household_id, user_id, card });
        await saveTurn(WRITEOFF_CARD_REPLY, card, card_id);
        // Пул-8 №2: списання застосовується одразу; «Як вийшло?» (раніше
        // followup ручного apply в cards.ts) їде тим самим ходом.
        const applied = await applyCard(repo, card_id, [], user_id, { profileV2: opts.profileV2 });

      // Промах операції: ціль не знайдено, стан не змінився. Логуємо, бо
      // частоти цього ми не знаємо — а без числа неможливо вирішити, чи це
      // взагалі проблема в житті, чи лише в підстроєному випадку.
      if (applied.missed?.length) {
        req.log.warn({ user_id, card_id: card_id, missed: applied.missed }, 'intake-op-missed');
      }
        await repo.saveMessage({
          id: randomUUID(), session_id: session.id, role: 'assistant',
          text: FEEDBACK_PROMPT, card: null, applied: 0, created_at: new Date().toISOString(),
        });
        return {
          reply: WRITEOFF_CARD_REPLY, card, card_id,
          auto_applied: true, undo_token: applied.undo_token, followup: FEEDBACK_PROMPT,
          usage: zeroUsage, meta: detMeta,
        };
      }
      // складна відповідь → модель (питання лишиться в історії — вона побачить контекст)
    }
    // Відповідь на «Як вийшло?» — сервер сам пише verdict/оцінку в останній
    // run цієї сесії; сама репліка далі йде звичайним чатом (фідбек-діагност).
    if (text && lastMsg?.role === 'assistant' && !lastMsg.card && lastMsg.text && FEEDBACK_MARKERS.has(lastMsg.text)) {
      const run = await latestRunInSession(repo, user_id, session.id);
      if (run) {
        await repo.updateCookRun(run.id, {
          verdict: text.slice(0, 200),
          rating: extractRating(text) ?? run.rating,
        });
      }
    }

    const pantry = await repo.listBatches(household_id);
    // Черга Д (№2): продукти дому — теги в серіалізацію (⚠, «~строк≈»).
    const products = await repo.listProducts(household_id);
    const profile = await repo.getProfile(user_id);
    // Раунд 4: під прапором — сім речень і нотатки. `profile` (v1) лишається
    // для календаря (традиції) і алерген-вето до кроку 4.
    const profileText = opts.profileV2 ? await repo.getProfileText(user_id) : undefined;
    const profileNotes = opts.profileV2 ? await repo.listProfileNotes(user_id) : undefined;
    // QA6-04: список у контекст — інакше в новій сесії модель каже «порожній»
    // при двох позиціях і додає дубль.
    const shopping = await repo.listShoppingItems(household_id);
    // Онбординг: stage 1, поки в коморі порожньо; stage 2, коли комора наповнена,
    // а профіль ще не має відповіді на «алергії/дім/традиції» (як проксі — порожні три блоки).
    let stage: 1 | 2 | undefined;
    const activeBatches = pantry.filter((b) => b.state !== 'depleted').length;
    if (activeBatches === 0) {
      stage = 1;
    } else if (activeBatches >= 3) {
      const empty = profileText
        ? (['no', 'ban', 'love'] as const).every((k) => profileText.fields[k].status === 'empty')
        : !profile
          || (profile.allergies.length === 0 && profile.wishes.length === 0 && profile.antipatterns.length === 0);
      if (empty) stage = 2;
    }

    // Історія розмови ДО збереження поточної репліки — інакше вона задвоїться
    // (потрапить і в history, і в messages як поточний user-turn).
    // Ліміт 20 останніх: вистачає щоб тримати нитку, не рознесе вхідні токени.
    //
    // Сама серіалізація — у chat-history.ts: це МЕЖА між продуктом і моделлю,
    // і вона мусить бути перевіряльна на рядку, без мережі (tests/history-provenance).
    const allMessages = preMessages;
    const history = buildChatHistory(allMessages.slice(-20));
    const truncated = allMessages.length > 20;

    await repo.saveMessage({
      id: randomUUID(), session_id: session.id, role: 'user',
      text: text ?? '', card: null, applied: 0, created_at: new Date().toISOString(),
    });

    // Назва сесії — з першої репліки. Без неї історія розмов була стовпчиком
    // однакових рядків «дата · час · N повідомлень»; кілька сесій за один день
    // розрізнити було нічим.
    if (!session.title) {
      const title = deriveSessionTitle(text ?? '');
      if (title) await repo.setSessionTitle(session.id, title);
    }

    // Останні 5 приготувань з рейтингом і verdict — щоб модель памʼятала,
    // що зайшло, а що ні. undone-runs не показуємо (то помилки, не історія).
    const rawRuns = await repo.listCookRuns(user_id, 8);
    const recentCookRuns = rawRuns
      .filter((r) => !r.undone_at)
      .slice(0, 5)
      .map((r) => ({
        title: r.recipe.title,
        rating: r.rating,
        verdict: r.verdict,
        finished_at: r.finished_at ?? r.started_at,
      }));

    // Висновки, які людина сама зробила про свою кухню: «фует знімати, щойно
    // краї хрусткі». Закріплені згори.
    // 8b: беремо на один більше за ліміт. Зайвий у промпт не йде — він лише
    // доводить, що показано не все. Точної кількості решти не знаємо й не
    // вигадуємо: чесне «є й інші» краще за вигадане число.
    const NOTES_CAP = 20;
    const notesRaw = await repo.listNotes(user_id, NOTES_CAP + 1);
    const notesTruncated = notesRaw.length > NOTES_CAP;
    const notes = notesRaw.slice(0, NOTES_CAP);
    // Їдці дому: страва готується на всіх, хто за столом.
    const eaters = await repo.listEaters(ctx.household_id);
    // Останні згенеровані рецепти — щоб модель бачила, що вже пропонувала,
    // і трималась названого складу замість нового підходу на кожен тап.
    const RECIPES_CAP = 5;
    const recipesRaw = await repo.listRecentRecipes(user_id, RECIPES_CAP + 1);
    const recipesTruncated = recipesRaw.length > RECIPES_CAP;
    const recentRecipes = recipesRaw.slice(0, RECIPES_CAP);

    // M13: [МЕРЕЖІ] у промпті — тільки коли інтеграція взагалі сконфігурована
    // на сервері (retailCart переданий). Статус читаємо напряму з repo:
    // chat.ts не знає про шифрування/провайдера, тільки «активна чи ні».
    let retailConnected: boolean | undefined;
    if (opts.retailCart) {
      const conn = await repo.getRetailConnection(user_id, 'silpo');
      retailConnected = !!conn && conn.status === 'active' && new Date(conn.expires_at).getTime() > Date.now();
    }
    const retailKarpaty = opts.retailCart ? !!opts.retailKarpaty : undefined;

    // №4: ситуація рахується сервером із повідомлень сесії — той самий факт,
    // який досі жив усередині гілки видалення й нікому не казався.
    // Плани — щоб модель могла на них послатись і правити їх по id. Тільки
    // свої: календар не спільний, і асистент доданого члена сімʼї не має
    // переказувати чужі плани так, ніби це спільна памʼять дому.
    const events = await repo.listOwnEvents(household_id, user_id);
    const modes = detectModes(preMessages, recentCookRuns, new Date(), events);
    const openCart = modes.find((m) => m.kind === 'cart_open');

    // Аудит раунд 3, крок 5: [ОСТАННІ ДІЇ] — картки дому, закриті ПОЗА цією
    // сесією за останні 48 год. exclude_session_id: історія ЦІЄЇ розмови вже
    // несе, що модель сама застосувала/скасувала — дублювати нема сенсу.
    const RECENT_ACTIONS_WINDOW_H = 48;
    const recentActions = await repo.listRecentResolved(household_id, {
      since: new Date(Date.now() - RECENT_ACTIONS_WINDOW_H * 3600_000),
      limit: 5,
      exclude_session_id: session.id,
    });

    const started = Date.now();
    // QA5-05: коли історія обрізана, модель читала порожнечу як відсутність факту —
    // «у тебе немає покупок на початку», хоча вони були за межею вікна. Кажемо прямо.
    if (truncated) {
      history.unshift({
        role: 'user',
        content: `[раніше в цій розмові було ще ${allMessages.length - 20} реплік — ти їх не бачиш]`,
      });
    }

    // UX9-02: модель упала (402 кредити, 5xx провайдера, мережа) — раніше це
    // ставало сирим 500, а клієнт ковтав його мовчки: людина писала в мертвий
    // продукт і не знала. 502 з кодом — клієнт показує «не надіслалось · повторити».
    let call: Awaited<ReturnType<typeof callChat>>;
    try {
      call = await callChat({
        user_id, session_id: session.id, text: text ?? '', pantry, stage, recentCookRuns,
        history, profile, profileText, profileNotes, shopping, notes, eaters, recentRecipes, products, retailConnected, retailKarpaty,
        // №4: ситуація рахується сервером із повідомлень сесії — той самий
        // факт, який досі жив усередині гілки видалення й нікому не казався.
        modes,
        events,
        notesTruncated, recipesTruncated,
        recentActions,
      });
    } catch (err) {
      req.log.error({ err, user_id }, 'chat-model-call-failed');
      return reply.code(502).send({ error: 'model_unavailable' });
    }
    await recordUsage(repo, ctx, 'chat', call.meta, call.usage, started);

    // Крок 6е: example-guard у model.ts уже перепитав модель — тут лише
    // фіксуємо частоту, як і решта логів навколо call.meta.
    if (call.meta.example_copy) {
      req.log.warn({ user_id, model: call.meta.model }, 'example-copy');
    }

    // Пул-4 №4а: службові [HH:MM] з історії не протікають у відповідь.
    if (call.reply) call.reply = stripHistoryStamps(call.reply);

    // Раунд 4, крок 4 (a): промт уже віддає картку поля {field, mode, text}.
    // З вимкненим прапором перекладаємо її в ops-картку v1 ДО applyMode і
    // збереження — щоб PROFILE_V2 лишався відкатом на проді, а не поламкою.
    if (!opts.profileV2 && isProfileFieldCard(call.card)) {
      call.card = legacyOpsFromFieldCard(call.card);
      if (!call.card.ops.length) call.card = null;
    }

    // Пул-2 №5: те саме для чату — сирий JSON у стрічку не протікає ніколи.
    if (!call.card && looksLikeModelDebris(call.reply ?? '')) {
      req.log.warn({ user_id, raw: (call.reply ?? '').slice(0, 300) }, 'chat-reply-debris');
      call.reply = INTAKE_TOO_BIG_REPLY;
    }

    // Знахідка A аудиту: правило про час дієслова жило тут другою копією і
    // описувало рантайм, якого вже немає — Пул-8 №2 і M13 01.09 зробили
    // intake_diff і shopping автозастосовними, а копія лишилась переписувати
    // правду на брехню. Виправлення й лічильник переїхали в src/tense.ts і
    // читають applyMode() з домену замість того, щоб перелічувати типи руками.
    if (call.reply) call.reply = fixTense(call.reply, call.card);
    if (tenseViolation(call.reply ?? '', call.card)) {
      req.log.warn(
        { card_type: call.card!.type, reply: call.reply },
        'tense-violation',
      );
    }

    // Гвардія: юзер явно попросив рецепт/ідею, а модель не вернула картку.
    // Логуємо як промах промпту — воно ловиться в token_usage-логах, потім
    // потрапляє в eval-фікстуру, а не мовчить у проді. Не блокуємо відповідь
    // самій — не хочемо ретраяти й палити токени, поки не буде eval-циклу.
    const wantsRecipe = /(рецепт|приготувати|вечер|що готувати|давай зробимо|давай приготу)/i.test(text ?? '');
    if (wantsRecipe && !call.card) {
      req.log.warn(
        { user_id, text: (text ?? '').slice(0, 100), model: call.meta.model },
        'proposal-card-missed: user asked for recipe, model returned no card',
      );
    }

    // QA5-01: чи не проліз алерген у пропозицію. Збіг за підрядком дає хибні
    // спрацювання, тому це лог, а не блок — але без нього ніхто не дізнається,
    // як часто це стається у проді.
    // QA7-06: алергії домашніх — у той самий детектор, з імʼям.
    const houseAllergies = [
      ...(profile?.allergies ?? []).map((a) => ({ label: a, who: 'owner' })),
      ...eaters.flatMap((e) => e.allergies.map((a) => ({ label: a, who: e.name }))),
    ].filter((a) => a.label);
    if (houseAllergies.length) {
      const hay = ((call.reply ?? '') + JSON.stringify(call.card ?? {})).toLowerCase();
      const hit = houseAllergies.filter((a) => hay.includes(a.label.toLowerCase()));
      if (hit.length) {
        req.log.warn({ hit, user_id, model: call.meta.model }, 'response-contains-allergen');
      }
    }

    // QA9-02: правка рецепта. Модель показала пальцем (назва + інструкція) —
    // сервер регенерує рецепт із базовим payload і кидає НОВИЙ recipe_link-хід
    // у стрічку. Старе повідомлення не редагується: правка — це відповідь,
    // не втручання в минуле. Картка recipe_edit до клієнта не доходить.
    // Пул-5 №6: людина погодилась готувати конкретну страву — не показуємо
    // їй службову картку, а одразу генеруємо рецепт і віддаємо recipe_link
    // тим самим ходом. «давай» після пропозиції = рецепт, не нове коло торгу.
    // M13: «замов через сільпо» — модель лише маркує намір (cart_go), сервер
    // сам виконує РІВНО той код, що кнопка «Зібрати кошик» (attemptBuildCart,
    // спільний з retail.ts), і підміняє картку на справжній cart. Три чесні
    // виходи без картки: не сконфігуровано на сервері / мережа не підключена
    // / список порожній — людині кажемо людською мовою, не мовчимо і не
    // вигадуємо картку, якої нема чим наповнити.
    if (call.card?.type === 'cart_go') {
      const saveTurn = async (text: string, card: Card | null) => {
        const id = randomUUID();
        await repo.saveMessage({
          id, session_id: session.id, role: 'assistant',
          text, card, applied: 0, created_at: new Date().toISOString(),
        });
        return card ? id : null;
      };
      // Відкритий кошик + названі позиції = РОЗШИРЕННЯ. Без items («збери
      // кошик», «замов список») — перезбирання, як раніше: людина просить
      // саме зібрати заново.
      if (openCart?.ref && call.card.items?.length && opts.retailCartExtend) {
        const ext = await opts.retailCartExtend(user_id, openCart.ref, call.card.items);
        if (ext.ok && ext.card) {
          const reply = call.reply || `Додав. У кошику ${ext.card.found} позицій на ${ext.card.total} ₴.`;
          await repo.saveMessage({
            id: randomUUID(), session_id: session.id, role: 'assistant',
            text: reply, card: null, applied: 0, created_at: new Date().toISOString(),
          });
          return { reply, card: ext.card, card_id: openCart.ref, usage: call.usage, meta: call.meta };
        }
        // Не вийшло — падаємо у звичайне збирання нижче, а не мовчимо.
      }
      if (!opts.retailCart) {
        const msg = 'Замовлення через мережу тут ще не підключене.';
        await saveTurn(msg, null);
        return { reply: msg, card: null, card_id: null, usage: call.usage, meta: call.meta };
      }
      const attempt = await opts.retailCart(user_id, household_id, call.card.items);
      if (!attempt.ok) {
        const msg = attempt.error === 'not_connected'
          ? 'Спершу підключи Сільпо: Профіль → Мережі → Підключити.'
          : attempt.error === 'empty_list'
          ? 'Список покупок порожній — нема що замовляти.'
          : 'Сільпо зараз не відповідає — спробуй за хвилину.';
        await saveTurn(msg, null);
        return { reply: msg, card: null, card_id: null, usage: call.usage, meta: call.meta };
      }
      const card = attempt.card!;
      let cartReply = call.reply || `Кошик у Сільпо: знайшов ${card.found} з ${card.of}`;
      // 01.09 комент #3: explicit items — це ЧАСТИНА списку (людина показала
      // пальцем на конкретне). Решта [СПИСОК ПОКУПОК] лишається поза
      // замовленням, і людина може забути, що вона там є — нагадуємо тим
      // самим ходом, а не мовчки.
      if (call.card.items?.length) {
        const ordered = new Set(call.card.items.map((s) => s.trim().toLowerCase()));
        const rest = (await repo.listShoppingItems(household_id))
          .filter((i) => !i.checked && !ordered.has(i.label.trim().toLowerCase()));
        if (rest.length) {
          cartReply = `${cartReply} У списку ще є ${rest.map((i) => i.label).join(', ')} — додати їх теж?`;
        }
      }
      const card_id = await saveTurn(cartReply, card);
      return { reply: cartReply, card, card_id, usage: call.usage, meta: call.meta };
    }

    // 01.09: «які ще опції в сільпо є по X» — питання про наявність, не
    // замовлення. Модель маркує намір (query), сервер шукає живцем
    // (attemptSearch — read-only, жоден addToCart) і сам формує репліку з
    // реальних даних. Картки нема навмисно: це відповідь-репліка, не дія.
    if (call.card?.type === 'retail_search_go') {
      // M13-ROLE-VOICE п.2: `source` ставиться ТІЛЬКИ на справжню видачу
      // мережі. Чесні відмови («Сільпо не відповідає», «спершу підключи») —
      // не асортимент, і підписувати їх асортиментом означало б брехати
      // моделі в інший бік.
      const saveTurn = async (text: string, source?: MessageRow['source']) => {
        await repo.saveMessage({
          id: randomUUID(), session_id: session.id, role: 'assistant',
          text, card: null, applied: 0, created_at: new Date().toISOString(), source,
        });
      };
      if (!opts.retailSearch) {
        const msg = 'Пошук у мережі тут ще не підключений.';
        await saveTurn(msg);
        return { reply: msg, card: null, card_id: null, usage: call.usage, meta: call.meta };
      }
      const attempt = await opts.retailSearch(user_id, call.card.query);
      if (!attempt.ok) {
        const msg = attempt.error === 'not_connected'
          ? 'Спершу підключи Сільпо: Профіль → Мережі → Підключити.'
          : 'Сільпо зараз не відповідає — спробуй за хвилину.';
        await saveTurn(msg);
        return { reply: msg, card: null, card_id: null, usage: call.usage, meta: call.meta };
      }
      // Кілька джерел (04.09): кожне — своїм абзацом, у тому ж форматі. Джерело
      // без підключення чи без відповіді — одним чесним рядком, не мовчки.
      if (attempt.sources && attempt.sources.length > 1) {
        const REPLY_CAP = 6;
        const q = call.card.query;
        const parts = attempt.sources.map((s) => {
          if (s.error === 'not_connected') return `Сільпо не підключено — Профіль → Мережі → Підключити.`;
          if (s.error) return `${s.label} зараз не відповідає.`;
          if (!s.products.length) return `У ${s.label === 'Сільпо' ? 'Сільпо' : 'Стейках Карпат'} нічого по «${q}».`;
          const shown = s.products.slice(0, REPLY_CAP);
          const rest = s.total - shown.length;
          return `${s.label === 'Сільпо' ? 'У Сільпо є' : 'У Стейках Карпат є'}:\n`
            + shown.map((p) => `— ${p.name} · ${Math.round(p.price)}₴`).join('\n')
            + (rest > 0 ? `\n— і ще ${rest}` : '')
            + (s.id === 'karpaty' ? '\nЗамовлення на karpatysteaks.com, доставка Новою Поштою.' : '');
        });
        const msg = parts.join('\n\n');
        await saveTurn(msg, 'retail_search');
        return { reply: msg, card: null, card_id: null, usage: call.usage, meta: call.meta };
      }
      const products = attempt.products ?? [];
      const total = attempt.total ?? products.length;
      // 01.09: суцільне речення через кому на 15 позицій читалось як сирий
      // дамп бекенда. Компактний список (перенос рядка), капнутий значно
      // нижче внутрішнього SEARCH_CAP, з чесним «і ще N» — рахує ВСЕ, що не
      // показано, не тільки те, що відсіклось до цього на пошуку.
      const REPLY_CAP = 6;
      const shown = products.slice(0, REPLY_CAP);
      const restCount = total - shown.length;
      const msg = shown.length
        ? `У Сільпо є:\n${shown.map((p) => `— ${p.name} · ${Math.round(p.price)}₴`).join('\n')}`
          + (restCount > 0 ? `\n— і ще ${restCount}` : '')
        : `У Сільпо не знайшов нічого по «${call.card.query}».`;
      await saveTurn(msg, 'retail_search');
      return { reply: msg, card: null, card_id: null, usage: call.usage, meta: call.meta };
    }

    if (call.card?.type === 'cook_go') {
      const wantedTitle = call.card.title.trim();
      // Дедуп той самий, що в POST /v1/recipes/generate: та сама назва в межах
      // доби → той самий рецепт без виклику моделі.
      const dayAgo = Date.now() - 24 * 3600_000;
      const recent = await repo.listRecentRecipes(user_id, 40);
      const wanted = wantedTitle.toLowerCase();
      const same = recent.find((r) =>
        (r.title.trim().toLowerCase() === wanted
          || r.requested_title?.trim().toLowerCase() === wanted)
        && new Date(r.created_at).getTime() > dayAgo);
      let goRecipe: Recipe | null = null;
      let goId: string | null = null;
      // Ручний тест 04.09: нотатка після готування («менше вершків, лимон»)
      // не скасовувала денний кеш — модель обіцяла оновлений рецепт, сервер
      // віддавав старий. Нотатка новіша за рецепт → генеруємо заново.
      const staleNotes = profileNotes
        ? profileNotes.map((n) => ({ created_at: n.created_at, recipe_title: null }))
        : notes;
      if (same?.payload && !recipeStaleByNotes(same, staleNotes)) {
        goRecipe = same.payload as Recipe;
        goId = same.id;
      } else {
        const genStarted = Date.now();
        let gen: Awaited<ReturnType<typeof callRecipe>>;
        try {
          gen = await callRecipe({
            title: wantedTitle,
            pantry, profile, notes, products, profileText, profileNotes,
            conversation: history.slice(-6).map((h) => `${h.role === 'user' ? 'людина' : 'кухар'}: ${h.content}`).join('\n') || undefined,
          });
        } catch (err) {
          req.log.error({ err, user_id }, 'cook-go-model-call-failed');
          return reply.code(502).send({ error: 'model_unavailable' });
        }
        await recordUsage(repo, ctx, 'recipe_gen', gen.meta, gen.usage, genStarted);
        if (gen.recipe) {
          const resolved = resolveRecipeLabels(gen.recipe, pantry);
          goId = randomUUID();
          await repo.saveRecipe({
            id: goId, owner_id: user_id, origin: 'generated',
            title: resolved.t, requested_title: wantedTitle,
            descr: resolved.d ?? null, character: resolved.ch ?? null, risk: resolved.rk ?? null,
            base_servings: resolved.sv ?? 2, time_total: resolved.tm ?? null,
            nutrition: resolved.nu ?? null, payload: resolved,
            created_at: new Date().toISOString(), saved_at: null,
          });
          goRecipe = resolved;
        } else {
          // Модель відповіла прозою (неоднозначно) — чесна репліка замість картки.
          const clean = gen.raw.replace(/\*\*/g, '').replace(/`/g, '').replace(/\n{2,}/g, ' ').trim().slice(0, 400);
          const proseReply = clean || `Не зміг скласти «${wantedTitle}» — уточни, що саме готуємо.`;
          await repo.saveMessage({
            id: randomUUID(), session_id: session.id, role: 'assistant',
            text: proseReply, card: null, applied: 0, created_at: new Date().toISOString(),
          });
          return { reply: proseReply, card: null, card_id: null, usage: call.usage, meta: call.meta };
        }
      }
      const goCard: Card = { type: 'recipe_link', recipe_id: goId!, title: goRecipe!.t, recipe: goRecipe! };
      const goReply = call.reply || 'Тримай рецепт.';
      await repo.saveMessage({
        id: randomUUID(), session_id: session.id, role: 'assistant',
        text: goReply, card: goCard, applied: 0, created_at: new Date().toISOString(),
      });
      return { reply: goReply, card: goCard, card_id: null, usage: call.usage, meta: call.meta };
    }

    if (call.card?.type === 'recipe_edit') {
      const wanted = call.card.title.trim().toLowerCase();
      const recent = await repo.listRecentRecipes(user_id, 40);
      const base = recent.find((r) =>
        r.title.trim().toLowerCase() === wanted
        || r.requested_title?.trim().toLowerCase() === wanted);

      if (!base || !base.payload) {
        // Чесна відмова замість «замінив»: рецепта з такою назвою поруч нема.
        const reply = `Не бачу поруч рецепта «${call.card.title}» — назви його точніше, і я оновлю.`;
        await repo.saveMessage({
          id: randomUUID(), session_id: session.id, role: 'assistant',
          text: reply, card: null, applied: 0, created_at: new Date().toISOString(),
        });
        return { reply, card: null, card_id: null, usage: call.usage, meta: call.meta };
      }

      const genStarted = Date.now();
      // UX9-03: у контекст правки базовий рецепт іде з АЛІАСАМИ p1..pN (тим
      // самим мапом, що й [КОМОРА] всередині callRecipe — порядок партій
      // однаковий, обидва будуються з цього ж pantry). Модель ніколи не
      // бачить uuid і не може їх переплутати.
      const editAlias = buildAliasMap(pantry);
      const aliasedBase = aliasRecipeIds(base.payload as Recipe, editAlias.toAlias);
      let gen: Awaited<ReturnType<typeof callRecipe>>;
      try {
        gen = await callRecipe({
          title: base.title,
          context:
            'Це ПРАВКА наявного рецепта, не нова страва. Базовий рецепт (JSON):\n'
            + JSON.stringify(aliasedBase)
            + `\n\nВнеси зміну: ${call.card.instruction}\n`
            + 'ЗАЛІЗНІ ПРАВИЛА ПРАВКИ:\n'
            + '1. Вказівники "p" існуючих інгредієнтів КОПІЮЙ ДОСЛІВНО з базового рецепта. Не перепризначай їх.\n'
            + '2. Міняй ТІЛЬКИ те, що названо в правці. Решта складу, кількостей і кроків — без змін.\n'
            + '3. Якщо правка про порції («на чотирьох») — постав нове sv і перерахуй УСІ v пропорційно від базових; nu лишається на порцію.\n'
            + '4. Якщо заміна стосується інгредієнта — зміни й кроки, де він згаданий.\n'
            + '5. Сумніваєшся щодо вказівника — дай "n" з назвою без "p".',
          pantry,
          profile,
          notes,
          products,
          profileText, profileNotes,
          conversation: history.slice(-6).map((h) => `${h.role === 'user' ? 'людина' : 'кухар'}: ${h.content}`).join('\n') || undefined,
        });
      } catch (err) {
        req.log.error({ err, user_id }, 'recipe-edit-model-call-failed');
        return reply.code(502).send({ error: 'model_unavailable' });
      }
      await recordUsage(repo, ctx, 'recipe_gen', gen.meta, gen.usage, genStarted);

      if (!gen.recipe) {
        // Модель відповіла прозою (неоднозначна правка) — віддаємо як репліку.
        const clean = gen.raw.replace(/\*\*/g, '').replace(/`/g, '').replace(/\n{2,}/g, ' ').trim().slice(0, 400);
        const reply = clean || `Не зміг оновити «${base.title}» — сформулюй правку інакше.`;
        await repo.saveMessage({
          id: randomUUID(), session_id: session.id, role: 'assistant',
          text: reply, card: null, applied: 0, created_at: new Date().toISOString(),
        });
        return { reply, card: null, card_id: null, usage: call.usage, meta: call.meta };
      }

      // Захист «база перемагає»: інгредієнт, чий p ІСНУЄ в базовому рецепті,
      // не може мовчки змінити назву — n форсується з бази. Модель, що
      // переплутала вказівник, тепер бодай не перепідпише збережений продукт.
      const baseNByP = new Map(
        ((base.payload as Recipe).ing ?? [])
          .filter((i) => i.p && i.n)
          .map((i) => [i.p!, i.n!]),
      );
      const guarded: Recipe = {
        ...gen.recipe,
        ing: gen.recipe.ing.map((i) => (i.p && baseNByP.has(i.p) ? { ...i, n: baseNByP.get(i.p)! } : i)),
      };
      const updated: Recipe = resolveRecipeLabels(guarded, pantry);
      const draft_id = randomUUID();
      await repo.saveRecipe({
        id: draft_id,
        owner_id: user_id,
        origin: 'generated',
        title: updated.t,
        // Спадкоємність дедупу: наступний тап «Рецепт» на цю назву має
        // повернути САМЕ оновлену версію, а не базову.
        requested_title: base.requested_title ?? base.title,
        descr: updated.d ?? null,
        character: updated.ch ?? null,
        risk: updated.rk ?? null,
        base_servings: updated.sv ?? 2,
        time_total: updated.tm ?? null,
        nutrition: updated.nu ?? null,
        payload: updated,
        created_at: new Date().toISOString(),
        saved_at: null,
      });

      const linkCard: Card = { type: 'recipe_link', recipe_id: draft_id, title: updated.t, recipe: updated };
      await repo.saveMessage({
        id: randomUUID(), session_id: session.id, role: 'assistant',
        text: call.reply ?? null, card: linkCard, applied: 0, created_at: new Date().toISOString(),
      });
      return { reply: call.reply, card: linkCard, card_id: null, usage: call.usage, meta: call.meta };
    }

    // Вето каталогу ДО збереження: картка має відповідати тому, що справді
    // поїде в комору. Якщо відсікти після — і pending, і повідомлення
    // казали б про позиції, яких у коморі не буде.
    vetoNonfood(call.card);
    composeIntakeLabels(call.card);
    // Аудит 04.09: тверда межа алергену — механікою, не лише міткою в рядку.
    // Еval після 1.2 зловив арахісову пасту в rescues на спільний сніданок.
    const allergenVeto = vetoAllergens(call, profile, eaters);
    if (allergenVeto.removed.length) {
      req.log.warn({ user_id, removed: allergenVeto.removed, emptied: allergenVeto.emptied }, 'allergen-veto');
    }
    // Крок 6з: voice v3.1 просить не згадувати алерген зі своєї ініціативи —
    // модель цього не тримає (qa5-allergen-proactive, KNOWN-FAILURES §10).
    // Ріжемо речення з reply, якщо людина сама цей алерген не називала.
    const allergenReplyClean = stripAllergenMentionsFromReply(call, profile, eaters, text ?? '');
    if (allergenReplyClean.stripped.length) {
      req.log.warn({ user_id, stripped: allergenReplyClean.stripped }, 'allergen-veto-reply');
    }
    // 01.09 комент #4: «прибери X з замовлення» після того, як кошик уже
    // зібрано — сам список ми виправили (shopping-remove нижче), але наша
    // інтеграція вміє лише addToCart, не видалення з живого кошика Сільпо.
    // Чесний наступний крок — запропонувати зібрати кошик заново (новим
    // cart_go), а не мовчати чи прикидатись, що кошик у Сільпо теж оновився.
    // «Коли» від моделі стає датою тут, до збереження картки: у стрічці має
    // стояти те саме, що ляже в базу. Операція з нерозпізнаним часом не
    // виживає — подія з вигаданою датою гірша за відсутню, бо виглядає як
    // факт; хай краще модель перепитає.
    if (call.card?.type === 'event') {
      const ops = (call.card.ops ?? []).map((op) => {
        // Id у блоці [ТВОЇ ПЛАНИ] короткий — вісім символів, щоб не платити
        // повними uuid у кожному виклику. Отже розгортати його має сервер:
        // без цього getHouseholdEvent('7f3a91c4') не знаходить нічого,
        // операція тихо не застосовується, а Кухня каже «змінив». Eval
        // показав саме це: модель повернула правильний короткий id.
        let id = op.id;
        if (id && id.length < 36) {
          const hits = events.filter((e) => e.id.startsWith(id!));
          // Два збіги — не вгадуємо: краще не зробити нічого, ніж змінити не те.
          id = hits.length === 1 ? hits[0]!.id : undefined;
        }
        // Правка/закриття несе назву події, яку чіпає: слід у стрічці має
        // сказати «ЗМІНЕНО · Олена в гостях», а не «подія». Модель назви не
        // повертає — і не мусить: id вона взяла з [ТВОЇ ПЛАНИ], назва там же.
        const target = id ? events.find((e) => e.id === id) : undefined;
        const withId = id
          ? { ...op, id, ...(op.op !== 'add' && target && !op.title ? { title: target.title } : {}) }
          : { ...op, id: undefined };
        if (op.op !== 'add' && !op.when) {
          // «На тиждень» без нової дати: тривалість міняється від дати самої
          // події. Без цього `days` у правці був тихим no-op — applyEventOp
          // править rule лише коли rule є.
          if (op.op === 'edit' && op.days && target && target.rule.t === 'once') {
            return { ...withId, rule: { ...target.rule, days: op.days } };
          }
          return withId;
        }
        const rule = resolveWhen(op.when, new Date(), op.days);
        return rule ? { ...withId, rule } : null;
      }).filter((op): op is NonNullable<typeof op> => op !== null);
      call.card = ops.length ? { ...call.card, ops } : null;
    }

    // Pending-картка створюється ЛИШЕ тут — після резолву дат подій і після
    // того, як картка могла стати null. Раніше вона писалась вище, ДО резолву:
    // applyCard читає картку з репо, не з call.card, і бачив ops без rule —
    // applyEventOp тихо повертав false, applied лишався 0, а відповідь уже
    // казала «Записав». У повідомлення при цьому йшла резолвлена копія, тож у
    // історії правило було видно, а в календарі — порожньо. Одна картка,
    // одне джерело: те, що ляже в повідомлення, те й застосовується.
    const card_id = call.card ? randomUUID() : null;
    if (call.card && card_id) {
      await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
    }

    let replyText = call.reply;
    if (call.card?.type === 'shopping' && call.card.items?.some((i) => i.op === 'remove')) {
      const hadCart = (await repo.listMessages(session.id)).some((m) => (m.card as Card | null)?.type === 'cart');
      if (hadCart) replyText = `${replyText ?? ''} Зібрати кошик заново?`.trim();
    }
    await repo.saveMessage({
      id: card_id ?? randomUUID(), session_id: session.id, role: 'assistant',
      text: replyText ?? null, card: call.card, applied: 0, created_at: new Date().toISOString(),
    });
    // Пул-8 №2: intake_diff застосовується ОДРАЗУ — підтвердження «Застосувати»
    // навантажувало кожен побутовий хід. Запобіжник переїхав у undo: картка в
    // стрічці лишається звітом зі «Скасувати».
    // M13 01.09: shopping — та сама підстава. card-rules.md дозволяє
    // shopping-картку ЛИШЕ на прямий запит людини про покупки («додай»,
    // «прибери») — модель ніколи не пропонує список сама, на відміну від
    // proposal/profile. Раніше картка чекала «У список»/«Ні», і виявився
    // живий баг: reply писав «Прибрав X» (доконаний вид), а список фізично
    // не змінювався, поки хтось не тисне кнопку — модель брехала про
    // зроблене. Profile/recipe_edit лишаються з підтвердженням: там і
    // пропозиція моделі трапляється, і ціна помилки вища (профіль стійкий).
    let auto_applied = false;
    let undo_token: string | undefined;
    // Тип більше не перелічується руками: рішення «одразу чи з підтвердженням»
    // живе в applyMode() (packages/domain/card-modes.ts), і саме цей гейт —
    // той, хто його виконує. Доки він мав власну копію списку, картка могла
    // отримати режим у мапі й не отримати його в рантаймі.
    if (call.card && card_id && applyModeFor(call.card) === 'auto') {
      const r = await applyCard(repo, card_id, [], user_id, { profileV2: opts.profileV2 });
      auto_applied = true;
      undo_token = r.undo_token;
      // Картка події стає артефактом лише тоді, коли знає, ЩО створила: id
      // народжується в applyEventOp і без цього кроку зникав. Дописуємо його
      // в ops і в збережене повідомлення — і відповідь, і історія несуть
      // одну й ту саму картку.
      if (call.card.type === 'event' && r.event_ids) {
        const ids = r.event_ids;
        const ops = call.card.ops.map((op, i) => (ids[i] ? { ...op, id: ids[i] } : op));
        call.card = { ...call.card, ops };
        await repo.updateMessageCard(card_id, call.card);
      }
      // Тут раніше стояв patchReceiptRows: після правки («то не хліб
      // салтівський, то батон») він переписував рядок у збереженій картці,
      // щоб артефакт не показував стару назву. Механізм пішов разом із
      // другою копією — картка тепер дивиться на живу позицію, і правка
      // видно в ній без жодної синхронізації.
    }
    return {
      reply: replyText, card: call.card, card_id,
      auto_applied, undo_token,
      usage: call.usage, meta: call.meta,
    };
  });
}
