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
import type { Repo, Card } from '@kitchen/domain';
import { createPending, applyCard } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeTokenCipher } from '../retail/crypto.js';
import { SilpoProvider, RetailAuthError } from '../retail/silpo-provider.js';
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
    makeProvider?: (accessToken: string) => Pick<SilpoProvider, 'receipts'>;
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
      if (req.query.error) return reply.redirect('/app/profile?retail=declined');
      const { code, state } = req.query;
      const verifier = cookies[VERIFIER_COOKIE];
      if (!code || !state || !verifier || state !== cookies[STATE_COOKIE]) {
        return reply.code(403).send({ error: 'oauth_state_mismatch' });
      }
      const tokens = await exchange(code, redirectUri(), verifier);
      const now = new Date();
      await repo.upsertRetailConnection({
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
      return reply.redirect('/app/profile?retail=connected');
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
    const receipt = receipts[0];
    if (!receipt) return { receipt: null, card: null, ops: [], nonfood: [], unmatched: [] };

    const { ops, nonfood, unmatched } = receiptLinesToIntake(receipt.lines);
    const meta = { shop: receipt.shop, city: receipt.city, at: receipt.at, total: receipt.total };
    if (!ops.length) return { receipt: meta, card: null, nonfood, unmatched };

    // Той самий шлях, що чек-фото в чаті (пул-8 №2): картка в сесію дня,
    // застосування одразу, undo — страховка.
    const card: Card = { type: 'intake_diff', ops };
    const card_id = randomUUID();
    const session = await repo.getOrCreateSessionForDay(user_id, new Date().toISOString().slice(0, 10));
    await createPending(repo, { message_id: card_id, household_id, user_id, card });
    await repo.saveMessage({
      id: card_id, session_id: session.id, role: 'assistant',
      text: `Чек Сільпо · ${receipt.shop}`, card, applied: 0, created_at: new Date().toISOString(),
    });
    const applied = await applyCard(repo, card_id, [], user_id);
    return {
      receipt: meta, card, card_id,
      auto_applied: true, undo_token: applied.undo_token,
      nonfood, unmatched,
    };
  });
}
