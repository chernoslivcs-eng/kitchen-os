// M13 «Мережі», зріз 1: підключення Сільпо (OAuth 2.1 + PKCE, токен тільки
// серверно і тільки шифротекстом) + «чеки → комора» через канон auto-apply.
//
//   GET  /v1/retail                      → стан підключень для блоку «Мережі»
//   GET  /v1/retail/silpo/connect        → 302 на authorize Сільпо (PKCE у куках)
//   GET  /v1/retail/silpo/callback       → code → токени → шифр → upsert → редирект
//   POST /v1/retail/silpo/disconnect     → мʼяке (status), тост «Повернути ↩»
//   POST /v1/retail/silpo/reconnect      → undo тосту, без нового OAuth
//   POST /v1/retail/silpo/sync-receipts  → останній чек → intake-картка → комора
//
// Обмін коду і фабрика провайдера інʼєктуються (патерн GoogleAuthOpts.exchange):
// тести тримають справжню криптографію PKCE/AES, але не ходять у мережу.

import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Repo, Card, CartCardRow } from '@kitchen/domain';
import { createPending, applyCard } from '@kitchen/domain';
import { resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeTokenCipher } from '../retail/crypto.js';
import { SilpoProvider, RetailAuthError, type RetailFoundRow } from '../retail/silpo-provider.js';
import { receiptLinesToIntake } from '../retail/receipt-intake.js';

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
    makeProvider?: (accessToken: string) => Pick<SilpoProvider, 'receipts' | 'findBatch' | 'addToCart'>;
    // Дев-шорткат: готовий access-токен (напр. із розвідувального OAuth) —
    // connect підключає без походу в Сільпо. In-memory бекенд губить
    // підключення на кожен рестарт, і без цього кожна ітерація коду коштувала
    // людського кліку згоди. У production ігнорується.
    devAccessToken?: string;
  };
}

const AUTHORIZE_URL = 'https://mcp.silpo.ua/authorize';
const TOKEN_URL = 'https://mcp.silpo.ua/token';
const STATE_COOKIE = 'kos_retail_state';
const VERIFIER_COOKIE = 'kos_retail_verifier';

const b64url = (b: Buffer) => b.toString('base64url');

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

export function retailRoutes(app: FastifyInstance, repo: Repo, opts?: RetailOpts) {
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

  if (!silpo) return;
  const cipher = makeTokenCipher(silpo.tokenSecret);
  const exchange = silpo.exchange ?? makeRealExchange(silpo.clientId);
  const makeProvider = silpo.makeProvider
    ?? ((accessToken: string) => new SilpoProvider({ accessToken }));
  const redirectUri = () => `${apiBase()}/v1/retail/silpo/callback`;
  const secure = process.env.NODE_ENV === 'production';
  const oauthCookie = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: 600 };

  app.get('/v1/retail/silpo/connect', { preHandler: authenticated(repo) }, async (_req, reply) => {
    if (silpo.devAccessToken && process.env.NODE_ENV !== 'production') {
      const { user_id } = requireUser(_req);
      const prev = await repo.getRetailConnection(user_id, 'silpo');
      const now = new Date();
      await repo.upsertRetailConnection({
        id: randomUUID(), user_id, provider: 'silpo',
        access_token_enc: cipher.enc(silpo.devAccessToken), refresh_token_enc: null,
        expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
        status: 'active', connected_at: now.toISOString(), updated_at: now.toISOString(),
        last_receipt_at: prev?.last_receipt_at ?? null,
      });
      return reply.redirect('/profile?retail=connected');
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
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/v1/retail/silpo/callback',
    { preHandler: authenticated(repo) },
    async (req, reply) => {
      const { user_id } = requireUser(req);
      const cookies = req.cookies as Record<string, string | undefined>;
      reply.clearCookie(STATE_COOKIE, { path: '/' });
      reply.clearCookie(VERIFIER_COOKIE, { path: '/' });
      if (req.query.error) return reply.redirect('/profile?retail=declined');
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
      return reply.redirect('/profile?retail=connected');
    },
  );

  app.post('/v1/retail/silpo/disconnect', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn) return reply.code(404).send({ error: 'not_connected' });
    await repo.upsertRetailConnection({ ...conn, status: 'disconnected', updated_at: new Date().toISOString() });
    return { status: 'disconnected' };
  });

  app.post('/v1/retail/silpo/reconnect', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id } = requireUser(req);
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn) return reply.code(404).send({ error: 'not_connected' });
    await repo.upsertRetailConnection({ ...conn, status: 'active', updated_at: new Date().toISOString() });
    return { status: 'active' };
  });

  app.post('/v1/retail/silpo/sync-receipts', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn || conn.status !== 'active') return reply.code(409).send({ error: 'not_connected' });

    let receipts;
    try {
      receipts = await makeProvider(cipher.dec(conn.access_token_enc)).receipts();
    } catch (e) {
      // Протухлий токен — бурштиновий стан «Увійти знову», не 500.
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
      // Той самий шлях, що чек-фото в чаті (пул-8 №2): картка в сесію дня,
      // застосування одразу, undo — страховка. Чек без жодного op'а теж
      // лишається в стрічці — «не для комори»/«додати руками» видно людині.
      const card_id = randomUUID();
      await createPending(repo, { message_id: card_id, household_id, user_id, card });
      await repo.saveMessage({
        id: card_id, session_id: session.id, role: 'assistant',
        text: `Чек Сільпо · ${receipt.shop}`, card, applied: 0, created_at: new Date().toISOString(),
      });
      const applied = ops.length ? await applyCard(repo, card_id, [], user_id) : null;
      cards.push({
        card, card_id,
        auto_applied: Boolean(applied), undo_token: applied?.undo_token,
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
  app.post('/v1/retail/silpo/build-cart', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    const conn = await repo.getRetailConnection(user_id, 'silpo');
    if (!conn || conn.status !== 'active') return reply.code(409).send({ error: 'not_connected' });

    const items = (await repo.listShoppingItems(household_id)).filter((i) => !i.checked);
    if (!items.length) return reply.code(409).send({ error: 'empty_list' });

    const provider = makeProvider(cipher.dec(conn.access_token_enc));
    let found: Map<string, RetailFoundRow>;
    try {
      const phase1 = await provider.findBatch(items.map((i) => i.label));
      found = new Map(phase1.map((r) => [r.query, r]));

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
    } catch (e) {
      if (e instanceof RetailAuthError) return reply.code(401).send({ error: 'retail_auth' });
      throw e;
    }

    // Кількість у кошик: вагове — кг із наших грамів (мінімум 0.1), штучне — 1.
    const rows: CartCardRow[] = [];
    const toAdd: Array<{ productId: string; companyId: string; branchId: string; quantity: number }> = [];
    for (const it of items) {
      const hit = found.get(it.label)?.product ?? null;
      let quantity = 0;
      if (hit) {
        quantity = hit.weighted && it.unit === 'g' && it.value
          ? Math.max(0.1, Math.round((it.value / 1000) * 100) / 100)
          : Math.max(1, hit.step || 1);
        toAdd.push({ productId: hit.id, companyId: hit.companyId, branchId: hit.branchId, quantity });
      }
      rows.push({
        label: it.label, item_id: it.id, v: it.value, u: it.unit,
        product: hit ? { name: hit.name, price: hit.price, weighted: hit.weighted, quantity } : null,
      });
    }
    if (toAdd.length) {
      try { await provider.addToCart(toAdd); } catch (e) {
        if (e instanceof RetailAuthError) return reply.code(401).send({ error: 'retail_auth' });
        throw e;
      }
    }

    const foundRows = rows.filter((r) => r.product);
    const card: Card = {
      type: 'cart', provider: 'silpo', list_label: null,
      rows,
      total: Math.round(foundRows.reduce((s, r) => s + (r.product!.price * (r.product!.weighted ? r.product!.quantity : r.product!.quantity)), 0)),
      found: foundRows.length, of: rows.length,
      cart_url: 'https://silpo.ua/cart',
    };
    const card_id = randomUUID();
    const session = await repo.getOrCreateSessionForDay(user_id, new Date().toISOString().slice(0, 10));
    await repo.saveMessage({
      id: card_id, session_id: session.id, role: 'assistant',
      text: `Кошик у Сільпо: знайшов ${card.found} з ${card.of}`, card, applied: 0,
      created_at: new Date().toISOString(),
    });
    return { card, card_id };
  });
}
