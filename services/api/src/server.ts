import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { InMemoryRepo, type Repo } from '@kitchen/domain';
import { makePool, migrate, PostgresRepo } from '@kitchen/db';
import { InMemoryStore, LocalFSStore, type AttachmentStore } from './attachment-store.js';
import { ConsoleMailer, pickMailer, type Mailer } from './mailer.js';
import { chatRoute } from './routes/chat.js';
import { cardsRoutes } from './routes/cards.js';
import { attachmentsRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { invitesRoutes } from './routes/invites.js';
import { meRoute } from './routes/me.js';
import { pantryRoute } from './routes/pantry.js';

import type { RateLimitCfg } from './rate-limit.js';

export interface BuildAppOpts {
  rateLimits?: {
    authRequest?: RateLimitCfg;
    invite?: RateLimitCfg;
  };
}

export function buildApp(
  repo: Repo = new InMemoryRepo(),
  store: AttachmentStore = new InMemoryStore(),
  mailer: Mailer = new ConsoleMailer(),
  opts: BuildAppOpts = {},
): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  authRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.authRequest });
  invitesRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.invite });
  meRoute(app, repo);
  pantryRoute(app, repo);
  chatRoute(app, repo, store);
  cardsRoutes(app, repo);
  attachmentsRoutes(app, repo, store);

  app.get('/health', async () => ({ ok: true, prompt: process.env.PROMPT_VERSION ?? '(latest)' }));
  return app;
}

// Обрати сховище: PG_URL → PostgresRepo (з міграцією), інакше InMemoryRepo.
export async function buildAppWithBackend(): Promise<FastifyInstance> {
  const url = process.env.PG_URL;
  let repo: Repo;
  if (url) {
    const pool = makePool(url);
    const migRes = await migrate(pool);
    if (migRes.applied.length) console.log('migrations applied:', migRes.applied.join(', '));
    repo = new PostgresRepo(pool);
  } else {
    repo = new InMemoryRepo();
  }
  const store: AttachmentStore = new LocalFSStore();
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
