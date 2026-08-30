import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { callChat, callAttachmentParse, type AttachmentPayload } from '../model.js';
import { createPending, deriveSessionTitle, type Repo, type Card } from '@kitchen/domain';
import type { AttachmentStore } from '../attachment-store.js';
import { authenticated, requireUser } from '../middleware/session.js';
import { recordUsage } from '../usage.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';

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
function summarizeCard(c: Card): string {
  if (c.type === 'proposal') {
    return '[картка: пропозиції] ' + c.items.map((i) => i.title).join(' · ');
  }
  if (c.type === 'intake_diff') {
    return '[картка: комора] ' + c.ops.map((o) => `${o.op ?? 'add'} ${o.label}`).join(' · ');
  }
  if (c.type === 'shopping') {
    return '[картка: покупки] ' + c.items.map((i) => `${i.op ?? 'add'} ${i.label}`).join(' · ');
  }
  if (c.type === 'profile') {
    return '[картка: профіль] ' + c.ops.map((o) => `${o.op ?? 'add'} ${o.kind}: ${o.label}`).join(' · ');
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
      const call = await callAttachmentParse(payloads);
      await recordUsage(repo, ctx, 'attachment_parse', call.meta, call.usage, started);

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
      return {
        reply: call.reply, card: call.card, card_id,
        raw_kind: call.raw_kind, usage: call.usage, meta: call.meta,
      };
    }

    const pantry = await repo.listBatches(household_id);
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
    const allMessages = await repo.listMessages(session.id);
    const history = allMessages
      .slice(-20)
      .map((m) => {
        const parts: string[] = [];
        if (m.text) parts.push(m.text);
        if (m.card) {
          parts.push(summarizeCard(m.card) + (m.applied > 0 ? ' [ЗАСТОСОВАНО]' : ' [НЕ ЗАСТОСОВАНО]'));
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
    const notes = await repo.listNotes(user_id, 12);
    // Їдці дому: страва готується на всіх, хто за столом.
    const eaters = await repo.listEaters(ctx.household_id);

    const started = Date.now();
    // QA5-05: коли історія обрізана, модель читала порожнечу як відсутність факту —
    // «у тебе немає покупок на початку», хоча вони були за межею вікна. Кажемо прямо.
    if (truncated) {
      history.unshift({
        role: 'user',
        content: `[раніше в цій розмові було ще ${allMessages.length - 20} реплік — ти їх не бачиш]`,
      });
    }

    const call = await callChat({
      user_id, session_id: session.id, text: text ?? '', pantry, stage, recentCookRuns,
      history, profile, shopping, notes, eaters,
    });
    await recordUsage(repo, ctx, 'chat', call.meta, call.usage, started);

    // Копі-звіти QA-4…7: час дієслова коливається (1/6 → 10/11 → 9/14 → 7/13),
    // і QA-7 вперше побачив закономірність — правило тримається на картках про
    // людину (profile/member/note: 6/8) і розсипається на картках про речі
    // (intake_diff: 0/3). Правило переписували двічі; втретє не переписуємо —
    // рахуємо на реальних даних із розбивкою за типом, і через тиждень логів
    // буде видно, чи гіпотеза правильна і чи варто ставити пост-процесор.
    // Увага: \b тут не можна — у JS це межа [A-Za-z0-9_], кирилиця вся
    // «поза словом», і /\bзаписав\b/.test('записав') === false. Лічильник
    // із \b мовчав би вічно і читався б як «порушень нема».
    const TENSE_CLAIMS = new RegExp(
    "(?<![а-щьюяіїєґА-ЩЬЮЯІЇЄҐʼ'])(записав|записала|записую|прибрав|прибрала|прибираю|додав|додала|додаю|видалив|видалила|видаляю)(?![а-щьюяіїєґА-ЩЬЮЯІЇЄҐʼ'])",
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

    const card_id = call.card ? randomUUID() : null;
    if (call.card && card_id) {
      await createPending(repo, { message_id: card_id, household_id, user_id, card: call.card });
    }
    await repo.saveMessage({
      id: card_id ?? randomUUID(), session_id: session.id, role: 'assistant',
      text: call.reply ?? null, card: call.card, applied: 0, created_at: new Date().toISOString(),
    });
    return {
      reply: call.reply, card: call.card, card_id,
      usage: call.usage, meta: call.meta,
    };
  });
}
