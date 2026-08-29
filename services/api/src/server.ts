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

export interface BuildAppOpts {
  rateLimits?: {
    authRequest?: RateLimitCfg;
    invite?: RateLimitCfg;
    chat?: RateLimitCfg;
  };
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
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  authRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.authRequest });
  invitesRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.invite });
  meRoute(app, repo);
  pantryRoute(app, repo);
  shoppingRoutes(app, repo);
  profileRoutes(app, repo);
  recipesRoutes(app, repo);
  cookRunsRoutes(app, repo);
  sessionRoutes(app, repo);
  chatRoute(app, repo, store, { rateLimit: opts.rateLimits?.chat });
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
    return {
      ok: true,
      prompt: process.env.PROMPT_VERSION ?? '(latest)',
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
  return buildApp(repo, store, mailer);
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
