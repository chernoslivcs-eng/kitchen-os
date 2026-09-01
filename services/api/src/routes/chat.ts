import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { callChat, callAttachmentParse, callRecipe, type AttachmentPayload } from '../model.js';
import { createPending, applyCard, deriveSessionTitle, resolveRecipeLabels, buildAliasMap, aliasRecipeIds, maskHistoryQuantities, type Repo, type Card, type Recipe } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';
import {
  isYes, isNo, extractRating, buildWriteoffOps, latestRunInSession,
  WRITEOFF_PROMPT, WRITEOFF_CARD_REPLY, WRITEOFF_DECLINED_REPLY, WRITEOFF_EMPTY_REPLY,
  FEEDBACK_MARKERS, FEEDBACK_PROMPT,
} from '../post-cook.js';
import { looksLikeModelDebris, stripHistoryStamps, INTAKE_TOO_BIG_REPLY } from '../reply-guard.js';
import type { RetailCartAttempt, RetailSearchAttempt } from './retail.js';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// QA5-03: в історію йшов тільки m.text. Уся суть картки — назви страв, позиції комори —
// лишалась за бортом, а при `proposal` reply це часто один рядок («Три варіанти:»).
// Наслідок: модель не пам'ятала, що сама запропонувала, і вигадувала третій варіант.
// Гірше — картка без прози зберігалась із text:'' і випадала з історії цілком, лишаючи
// юзерську репліку без відповіді; наступного разу модель її «переграла» і згенерувала
// повторний intake. Це найімовірніша причина дублів у коморі.
// Захист від малформленої картки моделі: живий репро 01.09 — модель
// повернула {"type":"shopping","ops":[...]} замість items (плутанина з
// intake_diff/profile, де саме ops), картка збереглась як є (model.ts не
// валідує форму), і НАСТУПНИЙ /v1/chat падав 500 тут же, при читанні
// історії. TS думає *.items/*.ops завжди масив — жива відповідь моделі
// цю гарантію не тримає, тому `?? []` на кожному полі, не тільки тут:
// одна погана картка більше не мусить блокувати всю розмову назавжди.
function summarizeCard(c: Card): string {
  if (c.type === 'proposal') {
    return '[картка: пропозиції] ' + (c.items ?? []).map((i) => i.title).join(' · ');
  }
  if (c.type === 'intake_diff') {
    return '[картка: комора] ' + (c.ops ?? []).map((o) => `${o.op ?? 'add'} ${o.label}`).join(' · ');
  }
  if (c.type === 'shopping') {
    return '[картка: покупки] ' + (c.items ?? []).map((i) => `${i.op ?? 'add'} ${i.label}`).join(' · ');
  }
  if (c.type === 'profile') {
    return '[картка: профіль] ' + (c.ops ?? []).map((o) => `${o.op ?? 'add'} ${o.kind}: ${o.label}`).join(' · ');
  }
  // QA9-02: recipe_link в історії був безликим «[картка]» — модель не бачила,
  // що рецепт лежить у стрічці, і на «поміняв?» відповідала навмання.
  if (c.type === 'recipe_link') {
    const ing = (c.recipe?.ing ?? [])
      .map((i) => i.n)
      .filter((n): n is string => !!n)
      .join(', ');
    return `[рецепт у стрічці: «${c.title}»${ing ? ` — ${ing}` : ''}]`;
  }
  if (c.type === 'recipe_edit') {
    return `[картка: правка рецепта «${c.title}»]`;
  }
  return '[картка]';
}

// POST /v1/chat
//   { text?, attachments?: [{id}] } → { reply, card, card_id, usage, meta }
//
// Побічних ефектів на комору НЕ застосовує. Картка йде як пропозиція,
// клієнт натискає apply. Обидва повідомлення (user + assistant) пишуться
// в message/session — щоб чат переживав F5 і перезапуск сервера.

export interface ChatRouteOpts {
  rateLimit?: RateLimitCfg;
  // M13: «асистент повинен мати руки» — та сама дія, що кнопка «Зібрати
  // кошик», доступна словами. Інʼєкція з retailRoutes() (server.ts) —
  // chat.ts не знає нічого про Сільпо, цифри/крипту/withRetryAuth, тільки
  // «спробуй, скажи як пройшло».
  retailCart?: (user_id: string, household_id: string, explicitItems?: string[]) => Promise<RetailCartAttempt>;
  // 01.09: «що є в наявності по X» — read-only пошук, той самий принцип
  // ін'єкції, що retailCart.
  retailSearch?: (user_id: string, query: string) => Promise<RetailSearchAttempt>;
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
    if (!session) session = await repo.getOrCreateSessionForDay(user_id, today());

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
        call = await callAttachmentParse(payloads);
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
        const r = await applyCard(repo, card_id, [], user_id);
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
        const applied = await applyCard(repo, card_id, [], user_id);
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
      const empty = !profile
        || (profile.allergies.length === 0 && profile.wishes.length === 0 && profile.antipatterns.length === 0);
      if (empty) stage = 2;
    }

    // Історія розмови ДО збереження поточної репліки — інакше вона задвоїться
    // (потрапить і в history, і в messages як поточний user-turn).
    // Ліміт 20 останніх: вистачає щоб тримати нитку, не рознесе вхідні токени.
    //
    // Картка йде в історію разом зі статусом: модель має розрізняти «я це
    // запропонувала» і «людина це застосувала». Без мітки вона вірила власному
    // «Запишу» й казала «так, вже в коморі», коли нічого не записано (QA5-02).
    const allMessages = preMessages;
    const history = allMessages
      .slice(-20)
      .map((m) => {
        const parts: string[] = [];
        // Час кожного ходу: без нього модель не могла впорядкувати події
        // розмови проти [ОСТАННІ ГОТУВАННЯ] («купив 500 г» — до готування чи
        // після?) і трактувала свіжу згадку числа як свіжий стан (UX9-04).
        const d = new Date(m.created_at);
        const stamp = `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`;
        // Пул-3, pantry-truth: кількості запасів у репліках історії маскуються —
        // єдине число про запас, яке бачить модель, живе в [КОМОРА].
        if (m.text) parts.push(`${stamp} ${maskHistoryQuantities(m.text)}`);
        if (m.card) {
          // recipe_link — не pending-дія, а доконаний факт: рецепт УЖЕ в
          // стрічці. Суфікс [НЕ ЗАСТОСОВАНО] тут читався моделлю як «система
          // ще не оновила рецепт» — і вона чесно відмовлялась від зробленого.
          // «Творча бухгалтерія» (eval pantry-truth): застосована intake-картка
          // в історії читалась як ЩЕ ОДИН запас поверх [КОМОРА] — модель
          // складала 500 з розмови й 100 з блока в «600 г». Кажемо прямо:
          // ефект цієї події ВЖЕ в блоці, рахувати її вдруге не можна.
          const status = m.card.type === 'recipe_link'
            ? ''
            : (m.applied > 0
              ? (m.card.type === 'intake_diff'
                ? ' [ЗАСТОСОВАНО — ефект уже врахований у поточному [КОМОРА], не додавай]'
                : ' [ЗАСТОСОВАНО]')
              : ' [НЕ ЗАСТОСОВАНО]');
          parts.push(summarizeCard(m.card) + status);
        }
        return { role: m.role, content: parts.join('\n') };
      })
      .filter((m) => m.content);
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
    const notes = await repo.listNotes(user_id, 20);
    // Їдці дому: страва готується на всіх, хто за столом.
    const eaters = await repo.listEaters(ctx.household_id);
    // Останні згенеровані рецепти — щоб модель бачила, що вже пропонувала,
    // і трималась названого складу замість нового підходу на кожен тап.
    const recentRecipes = await repo.listRecentRecipes(user_id, 5);

    // M13: [МЕРЕЖІ] у промпті — тільки коли інтеграція взагалі сконфігурована
    // на сервері (retailCart переданий). Статус читаємо напряму з repo:
    // chat.ts не знає про шифрування/провайдера, тільки «активна чи ні».
    let retailConnected: boolean | undefined;
    if (opts.retailCart) {
      const conn = await repo.getRetailConnection(user_id, 'silpo');
      retailConnected = !!conn && conn.status === 'active' && new Date(conn.expires_at).getTime() > Date.now();
    }

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
        history, profile, shopping, notes, eaters, recentRecipes, products, retailConnected,
      });
    } catch (err) {
      req.log.error({ err, user_id }, 'chat-model-call-failed');
      return reply.code(502).send({ error: 'model_unavailable' });
    }
    await recordUsage(repo, ctx, 'chat', call.meta, call.usage, started);

    // Пул-4 №4а: службові [HH:MM] з історії не протікають у відповідь.
    if (call.reply) call.reply = stripHistoryStamps(call.reply);

    // Пул-2 №5: те саме для чату — сирий JSON у стрічку не протікає ніколи.
    if (!call.card && looksLikeModelDebris(call.reply ?? '')) {
      req.log.warn({ user_id, raw: (call.reply ?? '').slice(0, 300) }, 'chat-reply-debris');
      call.reply = INTAKE_TOO_BIG_REPLY;
    }

    // Копі-звіти QA-4…7: час дієслова коливається (1/6 → 10/11 → 9/14 → 7/13),
    // і QA-7 вперше побачив закономірність — правило тримається на картках про
    // людину (profile/member/note: 6/8) і розсипається на картках про речі
    // (intake_diff: 0/3). Правило переписували двічі; втретє не переписуємо —
    // рахуємо на реальних даних із розбивкою за типом, і через тиждень логів
    // буде видно, чи гіпотеза правильна і чи варто ставити пост-процесор.
    // Увага: \b тут не можна — у JS це межа [A-Za-z0-9_], кирилиця вся
    // «поза словом», і /\bзаписав\b/.test('записав') === false. Лічильник
    // із \b мовчав би вічно і читався б як «порушень нема».
    // QA-7/8 дані: час дієслова тримається на картках про людину (8/10) і
    // не працює на картках про речі НІКОЛИ (0/5). Промпт переписували двічі —
    // втретє не переписуємо: детермінований пост-процесор саме для
    // intake_diff/recipe. Тільки закритий словник, тільки з картка-pending.
    const TENSE_FIX: [RegExp, string][] = [
      [/(?<![а-щьюяіїєґ])[Зз]аписую(?![а-щьюяіїєґ])/g, 'Запишу'],
      [/(?<![а-щьюяіїєґ])[Зз]аписав(?![а-щьюяіїєґ])/g, 'Запишу'],
      [/(?<![а-щьюяіїєґ])[Зз]аписала(?![а-щьюяіїєґ])/g, 'Запишу'],
      [/(?<![а-щьюяіїєґ])[Дд]одаю(?![а-щьюяіїєґ])/g, 'Додам'],
      [/(?<![а-щьюяіїєґ])[Дд]одав(?![а-щьюяіїєґ])/g, 'Додам'],
      [/(?<![а-щьюяіїєґ])[Пп]рибираю(?![а-щьюяіїєґ])/g, 'Приберу'],
      [/(?<![а-щьюяіїєґ])[Пп]рибрав(?![а-щьюяіїєґ])/g, 'Приберу'],
      [/(?<![а-щьюяіїєґ])[Зз]беріг(?![а-щьюяіїєґ])/g, 'Збережу'],
      [/(?<![а-щьюяіїєґ])[Зз]берігаю(?![а-щьюяіїєґ])/g, 'Збережу'],
    ];
    if (call.card && (call.card.type === 'intake_diff' || call.card.type === 'recipe') && call.reply) {
      for (const [re, to] of TENSE_FIX) call.reply = call.reply.replace(re, to);
    }

    const TENSE_CLAIMS = new RegExp(
    "(?<![а-щьюяіїєґА-ЩЬЮЯІЇЄҐʼ'])(записав|записала|записую|прибрав|прибрала|прибираю|додав|додала|додаю|видалив|видалила|видаляю|створив|створила|створюю|оновив|оновила|оновлюю|зберіг|зберегла|зберігаю|поклав|поклала|кладу|вніс|внесла|вношу|позначив|позначила|позначаю|виправив|виправила|виправляю|поставив|поставила|ставлю)(?![а-щьюяіїєґА-ЩЬЮЯІЇЄҐʼ'])",
    'i',
    );
    if (call.card && TENSE_CLAIMS.test(call.reply ?? '')) {
    req.log.warn({ card_type: call.card.type, reply: call.reply }, 'tense-violation');
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
      const saveTurn = async (text: string) => {
        await repo.saveMessage({
          id: randomUUID(), session_id: session.id, role: 'assistant',
          text, card: null, applied: 0, created_at: new Date().toISOString(),
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
      const products = attempt.products ?? [];
      const total = attempt.total ?? products.length;
      const msg = products.length
        ? `У Сільпо є: ${products.map((p) => `${p.name} · ${Math.round(p.price)}₴`).join(', ')}`
          + (total > products.length ? ` — і ще ${total - products.length}, показав перші ${products.length}` : '')
        : `У Сільпо не знайшов нічого по «${call.card.query}».`;
      await saveTurn(msg);
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
      if (same?.payload) {
        goRecipe = same.payload as Recipe;
        goId = same.id;
      } else {
        const genStarted = Date.now();
        let gen: Awaited<ReturnType<typeof callRecipe>>;
        try {
          gen = await callRecipe({
            title: wantedTitle,
            pantry, profile, notes, products,
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

    const card_id = call.card ? randomUUID() : null;
    if (call.card && card_id) {
      await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
    }
    // 01.09 комент #4: «прибери X з замовлення» після того, як кошик уже
    // зібрано — сам список ми виправили (shopping-remove нижче), але наша
    // інтеграція вміє лише addToCart, не видалення з живого кошика Сільпо.
    // Чесний наступний крок — запропонувати зібрати кошик заново (новим
    // cart_go), а не мовчати чи прикидатись, що кошик у Сільпо теж оновився.
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
    if ((call.card?.type === 'intake_diff' || call.card?.type === 'shopping') && card_id) {
      const r = await applyCard(repo, card_id, [], user_id);
      auto_applied = true;
      undo_token = r.undo_token;
    }
    return {
      reply: replyText, card: call.card, card_id,
      auto_applied, undo_token,
      usage: call.usage, meta: call.meta,
    };
  });
}
