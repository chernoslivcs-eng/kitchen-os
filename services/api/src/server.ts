import './env.js';                      // MUST BE FIRST — заселяє process.env перед усім
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { InMemoryRepo, type Repo } from '@kitchen/domain';
import { makePool, migrate, PostgresRepo } from '@kitchen/db';
import { InMemoryStore, LocalFSStore, VercelBlobStore, type AttachmentStore } from './attachment-store.js';
import { ConsoleMailer, pickMailer, type Mailer } from './mailer.js';
import { chatRoute } from './routes/chat.js';
import { cardsRoutes } from './routes/cards.js';
import { attachmentsRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { invitesRoutes } from './routes/invites.js';
import { meRoute } from './routes/me.js';
import { pantryRoute } from './routes/pantry.js';
import { recipesRoutes } from './routes/recipes.js';
import { shoppingRoutes } from './routes/shopping.js';
import { profileRoutes } from './routes/profile.js';
import { cookRunsRoutes } from './routes/cook-runs.js';
import { sessionRoutes } from './routes/session.js';

import type { RateLimitCfg } from './rate-limit.js';
import { googleAuthRoutes, type GoogleAuthOpts } from './routes/auth-google.js';
import { retailRoutes, type RetailOpts } from './routes/retail.js';

export interface BuildAppOpts {
  rateLimits?: {
    authRequest?: RateLimitCfg;
    invite?: RateLimitCfg;
    chat?: RateLimitCfg;
    shopping?: RateLimitCfg;
  };
  google?: GoogleAuthOpts;
  retail?: RetailOpts;
}

export function buildApp(
  repo: Repo = new InMemoryRepo(),
  store: AttachmentStore = new InMemoryStore(),
  mailer: Mailer = new ConsoleMailer(),
  opts: BuildAppOpts = {},
): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false
      : process.env.NODE_ENV === 'production' ? { level: 'warn' }
      : true,
  });
  // П.6 pre-deploy: базові security-заголовки на кожній відповіді API.
  // CSP для статики живе у vercel.json (headers) — тут лише API-шар.
  app.addHook('onSend', (_req, reply, payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    done(null, payload);
  });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  authRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.authRequest });
  googleAuthRoutes(app, repo, opts.google);
  const retail = retailRoutes(app, repo, opts.retail);
  invitesRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.invite });
  meRoute(app, repo);
  pantryRoute(app, repo);
  shoppingRoutes(app, repo, { rateLimit: opts.rateLimits?.shopping });
  profileRoutes(app, repo);
  recipesRoutes(app, repo);
  cookRunsRoutes(app, repo);
  sessionRoutes(app, repo);
  chatRoute(app, repo, store, { rateLimit: opts.rateLimits?.chat, retailCart: retail?.attemptBuildCart });
  cardsRoutes(app, repo);
  attachmentsRoutes(app, repo, store);

  // /health для uptime-probes. Легкий SELECT 1 для перевірки БД, метадані
  // про модель/сховище/пошту. Ніяких HEAD-запитів у OpenRouter — це витрачає
  // квоту й не додає інформації, яку не бачить чат.
  app.get('/health', async (req, reply) => {
    const provider = process.env.OPENROUTER_API_KEY ? 'openrouter'
      : process.env.ANTHROPIC_API_KEY ? 'anthropic'
      : 'stub';
    const attachmentMode = process.env.BLOB_READ_WRITE_TOKEN ? 'vercel_blob' : 'local_fs';
    const mailerMode = process.env.SMTP_HOST ? 'smtp' : 'console';
    let db: 'ok' | 'error' | 'skipped' = 'skipped';
    try {
      // Тільки якщо репо реально Postgres — інакше InMemory завжди «ok».
      const anyRepo = repo as unknown as { pool?: { query: (q: string) => Promise<unknown> } };
      if (anyRepo.pool && typeof anyRepo.pool.query === 'function') {
        await anyRepo.pool.query('SELECT 1');
        db = 'ok';
      } else {
        db = 'ok'; // InMemory не має що перевіряти
      }
    } catch {
      db = 'error';
    }
    if (db === 'error') return reply.code(503).send({ ok: false, db });
    // Пул-5 №3: промпти вантажимо РЕАЛЬНО. Інцидент versions/versions на
    // проді: чат лежав, а health друкував константу і брехав, що все ок.
    let promptVersion: string;
    try {
      const { loadPrompt } = await import('@kitchen/prompts');
      promptVersion = loadPrompt().version;
    } catch (e) {
      return reply.code(503).send({ ok: false, db, prompt_error: (e as Error).message });
    }
    return {
      ok: true,
      prompt: promptVersion,
      model_provider: provider,
      attachments: attachmentMode,
      mailer: mailerMode,
      db,
    };
    void req;
  });
  return app;
}

// Обрати attachment-сховище: BLOB_READ_WRITE_TOKEN → VercelBlobStore, інакше LocalFS.
// Тестовий шар (InMemoryStore) використовується лише в тестах через buildApp() напряму.
export function pickStore(): AttachmentStore {
  if (process.env.BLOB_READ_WRITE_TOKEN) return new VercelBlobStore();
  return new LocalFSStore();
}

// Обрати сховище: PG_URL → PostgresRepo (з міграцією), інакше InMemoryRepo.
export async function buildAppWithBackend(): Promise<FastifyInstance> {
  const url = process.env.PG_URL;
  let repo: Repo;
  if (url) {
    const pool = makePool(url);
    // На Vercel міграції ганяє крок білду (див. buildCommand у vercel.json):
    // теки migrations/ у бандлі функції немає, і паралельні cold start'и
    // влаштували б гонку у CREATE TABLE. Локально — як раніше, при кожному
    // старті.
    if (!process.env.VERCEL) {
      const migRes = await migrate(pool);
      if (migRes.applied.length) console.log('migrations applied:', migRes.applied.join(', '));
    }
    repo = new PostgresRepo(pool);
  } else {
    repo = new InMemoryRepo();
  }
  const store: AttachmentStore = pickStore();
  const mailer: Mailer = pickMailer();
  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
    : undefined;
  // M13: client_id — разова динамічна реєстрація на mcp.silpo.ua/register
  // (SILPO-MCP-RECON.md), секрет шифрування токенів — власний, довільний рядок.
  const retail = process.env.SILPO_CLIENT_ID && process.env.RETAIL_TOKEN_SECRET
    ? { silpo: {
        clientId: process.env.SILPO_CLIENT_ID,
        tokenSecret: process.env.RETAIL_TOKEN_SECRET,
        devAccessToken: process.env.SILPO_DEV_ACCESS_TOKEN,
      } }
    : undefined;
  return buildApp(repo, store, mailer, { google, retail });
}

// entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  buildAppWithBackend()
    .then((app) => {
      const port = Number(process.env.PORT ?? 3000);
      return app.listen({ port, host: '0.0.0.0' }).then(() => {
        console.log(`api listening on :${port} (backend: ${process.env.PG_URL ? 'postgres' : 'in-memory'})`);
      });
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
