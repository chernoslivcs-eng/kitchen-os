// M13 «Мережі», зріз 1: підключення Сільпо (OAuth 2.1 + PKCE, токен тільки
// серверно і тільки шифротекстом) + «чеки → комора» на явне підтвердження.
//
//   GET  /v1/retail                      → стан підключень для блоку «Мережі»
//   GET  /v1/retail/silpo/connect        → 302 на authorize Сільпо (PKCE у куках)
//   GET  /v1/retail/silpo/callback       → code → токени → шифр → upsert → редирект
//   POST /v1/retail/silpo/disconnect     → мʼяке (status), тост «Повернути ↩»
//   POST /v1/retail/silpo/reconnect      → undo тосту, без нового OAuth
//   POST /v1/retail/silpo/sync-receipts  → останній чек → intake-картка на підтвердження
//
// Обмін коду і фабрика провайдера інʼєктуються (патерн GoogleAuthOpts.exchange):
// тести тримають справжню криптографію PKCE/AES, але не ходять у мережу.

import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo, Card, CartCard, CartCardRow, RetailConnectionRow } from '@kitchen/domain';
import { createPending } from '@kitchen/domain';
import { resolveLabelToKey, categoriesCompatible } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter, type RateLimitCfg } from '../rate-limit.js';
import { makeTokenCipher } from '../retail/crypto.js';
import { SilpoProvider, RetailAuthError, type RetailFoundRow, type RetailProduct } from '../retail/silpo-provider.js';
import { receiptLinesToIntake } from '../retail/receipt-intake.js';
import { callAltFilter } from '../model.js';

export interface SilpoTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface RetailOpts {
  silpo?: {
    clientId: string;
    tokenSecret: string;
    exchange?: (code: string, redirectUri: string, verifier: string) => Promise<SilpoTokens>;
    // Обмін refresh_token на нову пару токенів (grant_type=refresh_token).
    // 401 (RetailAuthError) від провайдера НЕ означає одразу «увійди знову» —
    // access-токен живе 30 днів і мусить оновлюватись тихо, поки живий
    // refresh_token. Людина бачить «Увійти знову» тільки коли й це не рятує.
    refresh?: (refreshToken: string) => Promise<SilpoTokens>;
    makeProvider?: (accessToken: string) => Pick<SilpoProvider, 'receipts' | 'findBatch' | 'addToCart'>;
    // Дев-шорткат: готовий access-токен (напр. із розвідувального OAuth) —
    // connect підключає без походу в Сільпо. In-memory бекенд губить
    // підключення на кожен рестарт, і без цього кожна ітерація коду коштувала
    // людського кліку згоди. У production ігнорується.
    devAccessToken?: string;
    // П.6 pre-deploy принцип: мутуючі роути без ліміту — script, не людина.
    // build-cart/sync-receipts/cart-swap роблять 1-4 виклики до MCP мережі
    // кожен — дешевше не пускати скрипт, ніж потім розбиратись із рахунком
    // за наш серверний токен. 20/хв — людина не впирається.
    rateLimit?: RateLimitCfg;
  };
}

const AUTHORIZE_URL = 'https://mcp.silpo.ua/authorize';
const TOKEN_URL = 'https://mcp.silpo.ua/token';
const STATE_COOKIE = 'kos_retail_state';
const VERIFIER_COOKIE = 'kos_retail_verifier';

const b64url = (b: Buffer) => b.toString('base64url');

// 01.09 картка v2: сума по картці — price × quantity завжди, незалежно
// від типу товару (вагове: quantity=кг, кількісне/обсягове: quantity=шт).
// Раніше в двох місцях (cart-swap, cart-add-alt) невагове множилось на 1
// замість quantity — непомітно, поки степер не робив quantity ≠ 1.
function cartTotal(rows: CartCardRow[]): number {
  return Math.round(rows.reduce((s, r) => s + (r.product ? r.product.price * r.product.quantity : 0), 0));
}

// 01.09 картка v2: обсяг упаковки з назви товару Сільпо («0,33 л», «1 л»,
// «500 мл») — Сільпо не віддає це структурним полем (RetailProduct), тільки
// в назві. null — формат не впізнаний (штучний товар без обсягу в назві,
// чи незнайомий запис). Без коми/крапки як роздільника — «0,33» і «0.33»
// обидва трапляються в живих назвах.
function parsePackageMl(name: string): number | null {
  // \b тут не працює — кирилиця не \w у JS-regex без /u, тож межа слова
  // після «л»/«мл» ніколи не спрацьовує. Негативний lookahead замість:
  // не дозволяємо ще одну літеру одразу після (щоб не зловити «лохиновий»).
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*(л|мл)(?![а-яіїєґ'ʼa-z])/i);
  if (!m) return null;
  const num = parseFloat(m[1]!.replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(m[2]!.toLowerCase() === 'л' ? num * 1000 : num);
}

function apiBase(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

// Прод-обмін: той самий form-POST, що зняла розвідка (SILPO-MCP-RECON.md).
function makeRealExchange(clientId: string) {
  return async (code: string, redirectUri: string, verifier: string): Promise<SilpoTokens> => {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    const data = (await res.json()) as SilpoTokens & { error?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(`silpo token exchange failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  };
}

// Прод-рефреш: grant_type=refresh_token — той самий /token endpoint.
function makeRealRefresh(clientId: string) {
  return async (refreshToken: string): Promise<SilpoTokens> => {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    const data = (await res.json()) as SilpoTokens & { error?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(`silpo token refresh failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  };
}

// M13: «людина попросила словами» (card_go:cart_go з чату) виконує РІВНО той
// самий код, що кнопка «Зібрати кошик» — attemptBuildCart не знає, хто її
// покликав. card відсутній лише коли ok:false; error пояснює чому, людською
// мовою це перекладає вже викликач (Fastify-роут або chat.ts).
export interface RetailCartAttempt {
  ok: boolean;
  card?: CartCard;
  error?: 'not_connected' | 'empty_list' | 'retail_auth';
}

// 01.09: «що є в наявності по X» — read-only пошук, не замовлення. products
// уже пройшли гібридний фільтр категорій і обрізані до 15; total — скільки
// РЕАЛЬНО релевантних знайшлось (до обрізання), щоб reply міг чесно сказати
// «і ще N», а не мовчки показати перші 15 як повний список.
export interface RetailSearchAttempt {
  ok: boolean;
  products?: { name: string; price: number }[];
  total?: number;
  error?: 'not_connected' | 'retail_auth';
}

export interface RetailHandle {
  attemptBuildCart(user_id: string, household_id: string, explicitItems?: string[]): Promise<RetailCartAttempt>;
  attemptSearch(user_id: string, query: string): Promise<RetailSearchAttempt>;
}

export function retailRoutes(app: FastifyInstance, repo: Repo, opts?: RetailOpts): RetailHandle | undefined {
  const silpo = opts?.silpo;

  app.get('/v1/retail', { preHandler: authenticated(repo) }, async (req) => {
    const { user_id } = requireUser(req);
    if (!silpo) return { silpo: { status: 'unavailable' } };
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn) return { silpo: { status: 'none' } };
    const expired = new Date(conn.expires_at).getTime() < Date.now();
    return {
      silpo: {
        status: conn.status === 'disconnected' ? 'disconnected' : expired ? 'expired' : 'active',
        connected_at: conn.connected_at,
        expires_at: conn.expires_at,
        last_receipt_at: conn.last_receipt_at,
      },
    };
  });

  if (!silpo) return undefined;
  const cipher = makeTokenCipher(silpo.tokenSecret);
  const exchange = silpo.exchange ?? makeRealExchange(silpo.clientId);
  const refreshTokens = silpo.refresh ?? makeRealRefresh(silpo.clientId);
  const makeProvider = silpo.makeProvider
    ?? ((accessToken: string) => new SilpoProvider({ accessToken }));
  const redirectUri = () => `${apiBase()}/v1/retail/silpo/callback`;

  // Один retail-виклик з тихим оновленням протухлого токена. RetailAuthError
  // від провайдера НЕ означає одразу «Увійти знову» — access-токен живе 30
  // днів, тож спершу пробуємо refresh_token (якщо він є) РІВНО раз; якщо і
  // це кидає RetailAuthError — людина справді має зайти заново.
  async function withRetailAuth<T>(
    conn: RetailConnectionRow,
    fn: (provider: ReturnType<typeof makeProvider>) => Promise<T>,
  ): Promise<T> {
    try {
      return await fn(makeProvider(cipher.dec(conn.access_token_enc)));
    } catch (e) {
      if (!(e instanceof RetailAuthError) || !conn.refresh_token_enc) throw e;
      let tokens: SilpoTokens;
      try {
        tokens = await refreshTokens(cipher.dec(conn.refresh_token_enc));
      } catch {
        // Мережа відкликала refresh_token — не наша справа розбиратись, чому.
        throw new RetailAuthError();
      }
      const now = new Date();
      const updated = {
        ...conn,
        access_token_enc: cipher.enc(tokens.access_token),
        refresh_token_enc: tokens.refresh_token ? cipher.enc(tokens.refresh_token) : conn.refresh_token_enc,
        expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
        updated_at: now.toISOString(),
      };
      await repo.upsertRetailConnection(updated);
      return await fn(makeProvider(cipher.dec(updated.access_token_enc)));
    }
  }
  const secure = process.env.NODE_ENV === 'production';
  const oauthCookie = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: 600 };
  const NEXT_COOKIE = 'kos_retail_next';

  const limiter = makeRateLimiter(silpo.rateLimit ?? { max: 20, windowMs: 60_000 });
  const limitCheck = async (req: FastifyRequest, reply: FastifyReply) => {
    const { user_id } = requireUser(req);
    if (!limiter.check(user_id)) {
      reply.code(429).send({ error: 'too many requests' });
      return reply;
    }
  };

  // Куди повернути людину після OAuth-круга. Той самий ?next=/… патерн, що
  // magic-link auth (services/api/src/routes/auth.ts): валідний лише
  // абсолютний шлях у межах нашого домену — інакше open-redirect.
  const safeNext = (raw: string | undefined): string | null =>
    raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const withRetailParam = (path: string, value: 'connected' | 'declined') =>
    `${path}${path.includes('?') ? '&' : '?'}retail=${value}`;

  app.get<{ Querystring: { next?: string } }>(
    '/v1/retail/silpo/connect',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const next = safeNext(req.query.next);
      if (silpo.devAccessToken && process.env.NODE_ENV !== 'production') {
        const { user_id } = requireUser(req);
        const prev = await repo.getRetailConnection(user_id, 'silpo');
        const now = new Date();
        await repo.upsertRetailConnection({
          id: randomUUID(), user_id, provider: 'silpo',
          access_token_enc: cipher.enc(silpo.devAccessToken), refresh_token_enc: null,
          expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
          status: 'active', connected_at: now.toISOString(), updated_at: now.toISOString(),
          last_receipt_at: prev?.last_receipt_at ?? null,
        });
        return reply.redirect(withRetailParam(next ?? '/profile', 'connected'));
      }
      const state = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(48));
      const challenge = b64url(createHash('sha256').update(verifier).digest());
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: silpo.clientId,
        redirect_uri: redirectUri(),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();
      reply.setCookie(STATE_COOKIE, state, oauthCookie);
      reply.setCookie(VERIFIER_COOKIE, verifier, oauthCookie);
      if (next) reply.setCookie(NEXT_COOKIE, next, oauthCookie);
      return reply.redirect(url.toString());
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/v1/retail/silpo/callback',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const cookies = req.cookies as Record<string, string | undefined>;
      const next = safeNext(cookies[NEXT_COOKIE]);
      reply.clearCookie(STATE_COOKIE, { path: '/' });
      reply.clearCookie(VERIFIER_COOKIE, { path: '/' });
      reply.clearCookie(NEXT_COOKIE, { path: '/' });
      if (req.query.error) return reply.redirect(withRetailParam(next ?? '/profile', 'declined'));
      const { code, state } = req.query;
      const verifier = cookies[VERIFIER_COOKIE];
      if (!code || !state || !verifier || state !== cookies[STATE_COOKIE]) {
        return reply.code(403).send({ error: 'oauth_state_mismatch' });
      }
      const tokens = await exchange(code, redirectUri(), verifier);
      const now = new Date();
      // Повторний OAuth (протух токен) не скидає водяний знак синку —
      // інакше старі чеки поїхали б у комору вдруге.
      const prev = await repo.getRetailConnection(user_id, 'silpo');
      await repo.upsertRetailConnection({
        last_receipt_at: prev?.last_receipt_at ?? null,
        id: randomUUID(),
        user_id,
        provider: 'silpo',
        access_token_enc: cipher.enc(tokens.access_token),
        refresh_token_enc: tokens.refresh_token ? cipher.enc(tokens.refresh_token) : null,
        expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
        status: 'active',
        connected_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
      return reply.redirect(withRetailParam(next ?? '/profile', 'connected'));
    },
  );

  app.post('/v1/retail/silpo/disconnect', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn) return reply.code(404).send({ error: 'not_connected' });
    await repo.upsertRetailConnection({ ...conn, status: 'disconnected', updated_at: new Date().toISOString() });
    return { status: 'disconnected' };
  });

  app.post('/v1/retail/silpo/reconnect', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn) return reply.code(404).send({ error: 'not_connected' });
    await repo.upsertRetailConnection({ ...conn, status: 'active', updated_at: new Date().toISOString() });
    return { status: 'active' };
  });

  app.post('/v1/retail/silpo/sync-receipts', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn || conn.status !== 'active') return reply.code(409).send({ error: 'not_connected' });

    let receipts;
    try {
      receipts = await withRetailAuth(conn, (p) => p.receipts());
    } catch (e) {
      // Протухлий токен, і refresh не врятував — бурштиновий стан
      // «Увійти знову», не 500.
      if (e instanceof RetailAuthError) return reply.code(401).send({ error: 'retail_auth' });
      throw e;
    }

    // Водяний знак: беремо тільки новіші за last_receipt_at. Перший синк —
    // лише найсвіжіший чек (не тягнемо історію в комору заднім числом).
    const watermark = conn.last_receipt_at ? new Date(conn.last_receipt_at).getTime() : null;
    const fresh = watermark === null
      ? receipts.slice(0, 1)
      : receipts.filter((rc) => new Date(rc.at).getTime() > watermark);
    if (!fresh.length) return { up_to_date: true, cards: [] };

    const session = await repo.getOrCreateSessionForDay(user_id, new Date().toISOString().slice(0, 10));
    const cards = [];
    // Старіші першими — у стрічці чеки лягають хронологічно.
    for (const receipt of [...fresh].reverse()) {
      const { ops, nonfood, unmatched } = receiptLinesToIntake(receipt.lines);
      const card: Card = {
        type: 'intake_diff', ops,
        source: {
          kind: 'retail_receipt', provider: 'silpo',
          shop: receipt.shop, at: receipt.at, total: receipt.total,
          nonfood, unmatched,
        },
      };
      // 01.09: чек — НЕ auto-apply, на відміну від чек-фото в чаті (пул-8
      // №2) чи ручного intake. Людина тут нічого не казала — сервер сам
      // прочитав чек мережі; auto-apply ховав би від неї, ЩО саме поїхало
      // в комору. Картка лишається на явне підтвердження зі стрикаутом
      // позицій (той самий чекбоксовий UI, що в будь-якій intake_diff).
      const card_id = randomUUID();
      await createPending(repo, { message_id: card_id, household_id, user_id, card });
      const text = ops.length
        ? `Чек Сільпо · ${receipt.shop}. Додати до комори ці покупки?`
        : `Чек Сільпо · ${receipt.shop}`;
      await repo.saveMessage({
        id: card_id, session_id: session.id, role: 'assistant',
        text, card, applied: 0, created_at: new Date().toISOString(),
      });
      cards.push({
        card, card_id, text,
        auto_applied: false, undo_token: undefined,
        receipt: { shop: receipt.shop, city: receipt.city, at: receipt.at, total: receipt.total },
        nonfood, unmatched,
      });
    }
    const newest = fresh.reduce((m, rc) => Math.max(m, new Date(rc.at).getTime()), 0);
    await repo.upsertRetailConnection({
      ...conn, last_receipt_at: new Date(newest).toISOString(), updated_at: new Date().toISOString(),
    });
    return { up_to_date: false, cards };
  });

  // «Список → кошик» (канвас М3/М6). Двофазний пошук: спершу сирі лейбли,
  // для промахів — канонічне імʼя з каталогу (їхній пошук буквальний, наш
  // резолвер знає, що «стейк з лосося» — це лосось). Знайдене ОДРАЗУ лягає
  // в кошик акаунта Сільпо — «Оформити ↗» на картці веде в уже зібраний
  // кошик; чекаут цілком їхній.
  //
  // Витягнуто з роуту в перевикористовувану функцію (RetailHandle) — той
  // самий код виконує і кнопка «Зібрати кошик», і card_go:cart_go з чату
  // (chat.ts): жодних дублікатів логіки пошуку/addToCart, тільки різне
  // «що сказати людині» у викликача.
  // 01.09 рівень 1: скільки інших варіантів по одному пошуку показувати —
  // Сільпо може повернути десятки, картка лишається компактною.
  const ALT_CAP = 10;

  async function attemptBuildCart(
    user_id: string, household_id: string, explicitItems?: string[],
  ): Promise<RetailCartAttempt> {
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn || conn.status !== 'active') return { ok: false, error: 'not_connected' };

    // 01.09: cart_go.items — модель вказала конкретні позиції з розмови, яких
    // може ще не бути в персистованому списку («замов лосось і рис»). Це
    // вільний текст, як shopping.items — id тут нема чим наповнити, позицій
    // ще нема в базі.
    const items: { id: string | null; label: string; value: number | null; unit: string | null }[] =
      explicitItems?.length
        ? explicitItems.map((label) => ({ id: null, label, value: null, unit: null }))
        : (await repo.listShoppingItems(household_id)).filter((i) => !i.checked);
    if (!items.length) return { ok: false, error: 'empty_list' };

    // Кількість у кошик: вагове — кг із наших грамів (мінімум 0.1). Обсягове
    // («літр чи більше» на пляшку 0,33л) — кількість пляшок, щоб сумарний
    // обсяг покрив заявлений (округлення ВГОРУ — частину пляшки не купиш).
    // 01.09: раніше обсягове мовчки падало в гілку «штучне» (1 шт) — живий
    // репро «хочу літр, а додається 0.33».
    const qtyFor = (p: { weighted: boolean; step: number; name: string }, it: { unit: string | null; value: number | null }) => {
      if (p.weighted && it.unit === 'g' && it.value) {
        return Math.max(0.1, Math.round((it.value / 1000) * 100) / 100);
      }
      if (!p.weighted && it.unit === 'ml' && it.value) {
        const packageMl = parsePackageMl(p.name);
        if (packageMl) return Math.max(1, Math.ceil(it.value / packageMl));
      }
      return Math.max(1, p.step || 1);
    };

    // Пошук (3 фази) і addToCart — В ОДНОМУ withRetailAuth-виклику: якщо
    // токен протух, refresh стається до першого мережевого запиту в
    // переважній більшості випадків (findBatch іде першим), і весь блок
    // повторюється з новим токеном без подвійного addToCart. Побічний ефект
    // (запис у кошик) лишається останнім кроком навмисно.
    let rows: CartCardRow[];
    try {
      rows = await withRetailAuth(conn, async (provider) => {
        const phase1 = await provider.findBatch(items.map((i) => i.label));
        const found = new Map(phase1.map((r) => [r.query, r]));

        // Фаза 2 — тільки промахи, тільки якщо каталог дає ІНШЕ імʼя.
        const retry = new Map<string, string>(); // canonical → original label
        for (const it of items) {
          if (found.get(it.label)?.product) continue;
          const key = resolveLabelToKey(it.label);
          const canonical = key ? BY_KEY.get(key)?.name : null;
          if (canonical && canonical.toLowerCase() !== it.label.toLowerCase()) retry.set(canonical, it.label);
        }
        if (retry.size) {
          const phase2 = await provider.findBatch([...retry.keys()]);
          for (const r of phase2) {
            const original = retry.get(r.query);
            if (original && r.product) found.set(original, r);
          }
        }
        // Фаза 3 — досі промахи: головне слово канонічного імені («Рис
        // арборіо» → «рис»). Результат — ПРОПОЗИЦІЯ заміни, не покупка: «не
        // вгадувати» — в кошик вона їде тільки тапом «замінити» (cart-swap).
        const alt = new Map<string, string>(); // head → original label
        for (const it of items) {
          if (found.get(it.label)?.product) continue;
          const key = resolveLabelToKey(it.label);
          const head = (key ? BY_KEY.get(key)?.name : null)?.split(/\s+/)[0]?.toLowerCase();
          if (head && head !== it.label.toLowerCase()) alt.set(head, it.label);
        }
        const altFound = new Map<string, RetailFoundRow>();
        if (alt.size) {
          const phase3 = await provider.findBatch([...alt.keys()]);
          for (const r of phase3) {
            const original = alt.get(r.query);
            if (original && r.product) altFound.set(original, r);
          }
        }

        // Крок 1: зібрати сирі рядки й кандидатів (ще не відфільтрованих).
        const rawRows: Array<{
          it: (typeof items)[number]; hit: RetailProduct | null; quantity: number;
          rawAlts: RetailProduct[];
        }> = [];
        const toAdd: Array<{ productId: string; companyId: string; branchId: string; quantity: number }> = [];
        for (const it of items) {
          const foundRow = found.get(it.label);
          const hit = foundRow?.product ?? null;
          let quantity = 0;
          if (hit) {
            quantity = qtyFor(hit, it);
            toAdd.push({ productId: hit.id, companyId: hit.companyId, branchId: hit.branchId, quantity });
          }
          const altRow = hit ? null : altFound.get(it.label);
          // 01.09 рівень 1: candidates — усі знайдені варіанти того самого
          // пошуку (findBatch і так їх повертає, product — просто перший).
          // Хіт виключає себе зі списку (нижче він інформаційний, не тап);
          // проміс лишає ВСІ candidates як кнопки заміни, включно з тим, що
          // раніше був єдиним altHit — нічого ще не додано в кошик мережі.
          const candidateSource = hit ? foundRow?.candidates : altRow?.candidates;
          const rawAlts = (candidateSource ?? []).filter((c) => c.id !== hit?.id).slice(0, ALT_CAP);
          rawRows.push({ it, hit, quantity, rawAlts });
        }

        // Крок 2: фільтр за категоріями каталогу — живий репро 01.09: пошук
        // «Original Bitter Lemon» (безалкогольний тонік) повернув алкогольні
        // бітери й косметику як «схожі» (наївний повнотекстовий пошук мережі
        // не бачить категорій). Каталог знає — фільтруємо БЕЗКОШТОВНО, без
        // ЛЛМ, там, де впізнав обидві назви.
        type Verdict = 'keep' | 'reject' | 'unknown';
        const verdicts: Verdict[][] = rawRows.map(({ it, rawAlts }) => {
          const sourceKey = resolveLabelToKey(it.label);
          const sourceCategories = sourceKey ? BY_KEY.get(sourceKey)?.categories ?? [] : [];
          return rawAlts.map((c) => {
            const candKey = resolveLabelToKey(c.name);
            if (!candKey) return 'unknown' as const;
            const candCategories = BY_KEY.get(candKey)?.categories ?? [];
            return categoriesCompatible(sourceCategories, candCategories) ? 'keep' as const : 'reject' as const;
          });
        });

        // Крок 3: те, чого каталог не впізнав узагалі — одним пакетним
        // викликом ЛЛМ на всю картку (не на кожен рядок окремо).
        const unknownRefs: { rowIdx: number; altIdx: number }[] = [];
        const pairs: { source: string; candidate: string }[] = [];
        verdicts.forEach((rowVerdicts, rowIdx) => {
          rowVerdicts.forEach((v, altIdx) => {
            if (v === 'unknown') {
              unknownRefs.push({ rowIdx, altIdx });
              pairs.push({ source: rawRows[rowIdx]!.it.label, candidate: rawRows[rowIdx]!.rawAlts[altIdx]!.name });
            }
          });
        });
        const llmKeep = unknownRefs.length ? (await callAltFilter(pairs)).keep : [];
        const llmMap = new Map<string, boolean>();
        unknownRefs.forEach((ref, i) => llmMap.set(`${ref.rowIdx}:${ref.altIdx}`, llmKeep[i] ?? true));

        // Крок 4: зібрати фінальні рядки з відфільтрованими alternatives.
        const outRows: CartCardRow[] = rawRows.map(({ it, hit, quantity, rawAlts }, rowIdx) => {
          const alternatives = rawAlts
            .filter((_, altIdx) => {
              const v = verdicts[rowIdx]![altIdx]!;
              if (v !== 'unknown') return v === 'keep';
              return llmMap.get(`${rowIdx}:${altIdx}`) ?? true;
            })
            .map((c) => ({
              product_id: c.id, company_id: c.companyId, branch_id: c.branchId,
              name: c.name, price: c.price, weighted: c.weighted, quantity: qtyFor(c, it),
            }));
          return {
            label: it.label, item_id: it.id, v: it.value, u: it.unit,
            product: hit ? {
              product_id: hit.id, company_id: hit.companyId, branch_id: hit.branchId,
              name: hit.name, price: hit.price, weighted: hit.weighted, quantity,
              package_ml: hit.weighted ? null : parsePackageMl(hit.name),
            } : null,
            alternatives,
          };
        });
        if (toAdd.length) await provider.addToCart(toAdd);
        return outRows;
      });
    } catch (e) {
      if (e instanceof RetailAuthError) return { ok: false, error: 'retail_auth' };
      throw e;
    }

    const foundRows = rows.filter((r) => r.product);
    const card: CartCard = {
      type: 'cart', provider: 'silpo', list_label: null,
      rows,
      total: cartTotal(rows),
      found: foundRows.length, of: rows.length,
      // Не /cart: мережа прибрала цю сторінку (404 «Отакої»), кошик у них
      // живе попапом на будь-якій сторінці — ведемо на головну.
      cart_url: 'https://silpo.ua',
    };
    return { ok: true, card };
  }

  app.post('/v1/retail/silpo/build-cart', { preHandler: [authenticated(repo), limitCheck] }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const attempt = await attemptBuildCart(user_id, household_id);
    if (!attempt.ok) {
      return reply.code(attempt.error === 'retail_auth' ? 401 : 409).send({ error: attempt.error });
    }
    const card = attempt.card!;
    const card_id = randomUUID();
    const session = await repo.getOrCreateSessionForDay(user_id, new Date().toISOString().slice(0, 10));
    await repo.saveMessage({
      id: card_id, session_id: session.id, role: 'assistant',
      text: `Кошик у Сільпо: знайшов ${card.found} з ${card.of}`, card, applied: 0,
      created_at: new Date().toISOString(),
    });
    return { card, card_id };
  });

  // Тап «замінити» на бурштиновому рядку: альтернатива їде в кошик мережі,
  // картка правиться в БД — заміна переживає перезавантаження.
  app.post<{ Body: { card_id?: string; row_index?: number; alt_index?: number } }>(
    '/v1/retail/silpo/cart-swap',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const conn = await repo.getRetailConnection(user_id, 'silpo');
      if (!conn || conn.status !== 'active') return reply.code(409).send({ error: 'not_connected' });
      const { card_id, row_index, alt_index } = req.body ?? {};
      if (!card_id || row_index == null || alt_index == null) {
        return reply.code(400).send({ error: 'card_id, row_index and alt_index required' });
      }
      const msg = await repo.getMessage(card_id);
      const card = msg?.card;
      if (!card || card.type !== 'cart') return reply.code(404).send({ error: 'cart_not_found' });
      const row = card.rows[row_index];
      // 01.09: тап-заміна дозволена і на хіт-рядку (людина явно попросила
      // «переключити позицію, яку запропонував ЛЛМ»). Наша інтеграція вміє
      // лише addToCart, без видалення — стара позиція технічно може лишитись
      // у живому кошику Сільпо; попередження про це — відповідальність UI.
      const a = row?.alternatives?.[alt_index];
      if (!a) return reply.code(409).send({ error: 'no_alternative' });

      try {
        await withRetailAuth(conn, (provider) => provider.addToCart([
          { productId: a.product_id, companyId: a.company_id, branchId: a.branch_id, quantity: a.quantity },
        ]));
      } catch (e) {
        if (e instanceof RetailAuthError) return reply.code(401).send({ error: 'retail_auth' });
        throw e;
      }
      row.product = {
        product_id: a.product_id, company_id: a.company_id, branch_id: a.branch_id,
        name: a.name, price: a.price, weighted: a.weighted, quantity: a.quantity,
        package_ml: a.weighted ? null : parsePackageMl(a.name),
      };
      // Решта кандидатів того самого пошуку лишається — тепер уже
      // інформаційно (рядок став хітом), той самий перелік «ще є».
      row.alternatives = (row.alternatives ?? []).filter((_, i) => i !== alt_index);
      card.found = card.rows.filter((r) => r.product).length;
      card.total = cartTotal(card.rows);
      await repo.updateMessageCard(card_id, card);
      return { card, card_id };
    },
  );

  // 01.09 картка v2: степер кількості на рядку кошика (до «Оформити»).
  // quantity округлюється за типом товару — вагове: крок 0.1, мінімум 0.1;
  // кількісне/обсягове: ціле, мінімум 1. Той самий productId у addToCart
  // ОНОВЛЮЄ кількість у живому кошику Сільпо (add_or_update), не дублює.
  app.post<{ Body: { card_id?: string; row_index?: number; quantity?: number } }>(
    '/v1/retail/silpo/cart-update-qty',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const conn = await repo.getRetailConnection(user_id, 'silpo');
      if (!conn || conn.status !== 'active') return reply.code(409).send({ error: 'not_connected' });
      const { card_id, row_index, quantity } = req.body ?? {};
      if (!card_id || row_index == null || quantity == null) {
        return reply.code(400).send({ error: 'card_id, row_index and quantity required' });
      }
      const msg = await repo.getMessage(card_id);
      const card = msg?.card;
      if (!card || card.type !== 'cart') return reply.code(404).send({ error: 'cart_not_found' });
      const row = card.rows[row_index];
      if (!row?.product) return reply.code(409).send({ error: 'no_product' });

      const step = row.product.weighted ? 0.1 : 1;
      const min = row.product.weighted ? 0.1 : 1;
      const rounded = Math.max(min, Math.round(quantity / step) * step);
      const newQuantity = row.product.weighted ? Math.round(rounded * 100) / 100 : Math.round(rounded);

      try {
        await withRetailAuth(conn, (provider) => provider.addToCart([
          { productId: row.product!.product_id, companyId: row.product!.company_id, branchId: row.product!.branch_id, quantity: newQuantity },
        ]));
      } catch (e) {
        if (e instanceof RetailAuthError) return reply.code(401).send({ error: 'retail_auth' });
        throw e;
      }
      row.product.quantity = newQuantity;
      card.total = cartTotal(card.rows);
      await repo.updateMessageCard(card_id, card);
      return { card, card_id };
    },
  );

  // 01.09: «замовляю літр швепса, і раптом бачу банановий швепс серед
  // альтернатив — хочу замовити ще й його». НЕ заміна: оригінальний рядок
  // не чіпається, альтернатива їде окремим НОВИМ рядком (і в кошик мережі).
  app.post<{ Body: { card_id?: string; row_index?: number; alt_index?: number } }>(
    '/v1/retail/silpo/cart-add-alt',
    { preHandler: [authenticated(repo), limitCheck] },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const conn = await repo.getRetailConnection(user_id, 'silpo');
      if (!conn || conn.status !== 'active') return reply.code(409).send({ error: 'not_connected' });
      const { card_id, row_index, alt_index } = req.body ?? {};
      if (!card_id || row_index == null || alt_index == null) {
        return reply.code(400).send({ error: 'card_id, row_index and alt_index required' });
      }
      const msg = await repo.getMessage(card_id);
      const card = msg?.card;
      if (!card || card.type !== 'cart') return reply.code(404).send({ error: 'cart_not_found' });
      const row = card.rows[row_index];
      const a = row?.alternatives?.[alt_index];
      if (!a) return reply.code(409).send({ error: 'no_alternative' });

      try {
        await withRetailAuth(conn, (provider) => provider.addToCart([
          { productId: a.product_id, companyId: a.company_id, branchId: a.branch_id, quantity: a.quantity },
        ]));
      } catch (e) {
        if (e instanceof RetailAuthError) return reply.code(401).send({ error: 'retail_auth' });
        throw e;
      }
      row.alternatives = (row.alternatives ?? []).filter((_, i) => i !== alt_index);
      card.rows.push({
        label: a.name, item_id: null, v: null, u: null,
        product: {
          product_id: a.product_id, company_id: a.company_id, branch_id: a.branch_id,
          name: a.name, price: a.price, weighted: a.weighted, quantity: a.quantity,
          package_ml: a.weighted ? null : parsePackageMl(a.name),
        },
        alternatives: [],
      });
      card.found = card.rows.filter((r) => r.product).length;
      card.total = cartTotal(card.rows);
      await repo.updateMessageCard(card_id, card);
      return { card, card_id };
    },
  );

  // 01.09: «що є в наявності по X» — питання, не замовлення. Read-only:
  // жоден addToCart тут не викликається, нічого не летить у кошик мережі
  // й не пишеться в список покупок. Той самий гібридний фільтр категорій,
  // що альтернативи кошика (crossreference не випадковий — та сама
  // причина: наївний повнотекстовий пошук Сільпо плутає категорії).
  async function attemptSearch(user_id: string, query: string): Promise<RetailSearchAttempt> {
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn || conn.status !== 'active') return { ok: false, error: 'not_connected' };

    let candidates: RetailProduct[];
    try {
      candidates = await withRetailAuth(conn, async (provider) => {
        const [row] = await provider.findBatch([query]);
        return row?.candidates ?? [];
      });
    } catch (e) {
      if (e instanceof RetailAuthError) return { ok: false, error: 'retail_auth' };
      throw e;
    }

    const sourceKey = resolveLabelToKey(query);
    const sourceCategories = sourceKey ? BY_KEY.get(sourceKey)?.categories ?? [] : [];
    const verdicts: ('keep' | 'reject' | 'unknown')[] = candidates.map((c) => {
      const candKey = resolveLabelToKey(c.name);
      if (!candKey) return 'unknown';
      const candCategories = BY_KEY.get(candKey)?.categories ?? [];
      return categoriesCompatible(sourceCategories, candCategories) ? 'keep' : 'reject';
    });
    const unknownIdx = verdicts.reduce<number[]>((acc, v, i) => (v === 'unknown' ? [...acc, i] : acc), []);
    const pairs = unknownIdx.map((i) => ({ source: query, candidate: candidates[i]!.name }));
    const llmKeep = pairs.length ? (await callAltFilter(pairs)).keep : [];
    const keepSet = new Set<number>();
    verdicts.forEach((v, i) => { if (v === 'keep') keepSet.add(i); });
    unknownIdx.forEach((i, j) => { if (llmKeep[j] ?? true) keepSet.add(i); });
    const kept = candidates.filter((_, i) => keepSet.has(i));

    const SEARCH_CAP = 15;
    return {
      ok: true,
      products: kept.slice(0, SEARCH_CAP).map((c) => ({ name: c.name, price: c.price })),
      total: kept.length,
    };
  }

  return { attemptBuildCart, attemptSearch };
}
