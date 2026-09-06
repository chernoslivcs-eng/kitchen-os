import './env.js';                      // MUST BE FIRST — заселяє process.env перед усім
import { initSentry, flushSentry } from './sentry.js';
initSentry();                          // одразу за env: DSN уже в process.env
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { InMemoryRepo, type Repo } from '@kitchen/domain';
import { makePool, migrate, PostgresRepo, seedOccasions } from '@kitchen/db';
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
import { eventsRoutes } from './routes/events.js';
import { trackRoutes } from './routes/track.js';
import { incident } from './incident.js';
import { pulseRoutes } from './routes/pulse.js';
import { adminOccasionsRoutes } from './routes/admin-occasions.js';
import { profileRoutes, eaterRoutes } from './routes/profile.js';
import { cookRunsRoutes } from './routes/cook-runs.js';
import { sessionRoutes } from './routes/session.js';
import { onboardingRoutes } from './routes/onboarding.js';

import type { RateLimitCfg } from './rate-limit.js';
import { googleAuthRoutes, type GoogleAuthOpts } from './routes/auth-google.js';
import { retailRoutes, type RetailOpts } from './routes/retail.js';

export interface BuildAppOpts {
  /** Тести: власний логер Fastify (рівень + потік). */
  logger?: FastifyServerOptions['logger'];
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
    // П2a: тест може дати свій логер (потік) — щоб перевірити warn-маркери
    // маршруту (period-card-dropped) там, де їх побачить прод.
    logger: opts.logger ?? (process.env.NODE_ENV === 'test' ? false
      : process.env.NODE_ENV === 'production' ? { level: 'warn' }
      : true),
  });
  // П.6 pre-deploy: базові security-заголовки на кожній відповіді API.
  // CSP для статики живе у vercel.json (headers) — тут лише API-шар.
  app.addHook('onSend', (_req, reply, payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    done(null, payload);
  });
  // Крок О1: усе, що впало в обробнику й не було спіймано на місці. Без цього
  // хука Sentry бачив би лише те, що ми передбачили назвати інцидентом, — а
  // найдорожчі падіння якраз ті, яких ніхто не передбачив.
  //
  // Тільки 5xx: 400 від валідації схеми теж проходить сюди, але це не аварія,
  // а відмова, і сипати нею в Sentry означало б втопити справжні падіння.
  app.addHook('onError', (req, reply, err, done) => {
    if ((err.statusCode ?? reply.statusCode ?? 500) < 500) return done();
    incident({ repo, log: req.log }, 'broke', 'unhandled-route-error', {
      user_id: req.user?.user_id ?? null,
      household_id: req.user?.household_id ?? null,
      route: `${req.method} ${req.routeOptions?.url ?? req.url}`,
      err,
    });
    done();
  });
  // Лямбда засинає одразу після відповіді — без цього подія не встигає піти.
  // Нічого не робить, якщо за запит нічого не сталось.
  app.addHook('onResponse', async () => { await flushSentry(); });

  app.register(cookie);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  authRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.authRequest });
  googleAuthRoutes(app, repo, opts.google);
  const retail = retailRoutes(app, repo, opts.retail);
  invitesRoutes(app, repo, mailer, { rateLimit: opts.rateLimits?.invite });
  meRoute(app, repo);
  pantryRoute(app, repo);
  shoppingRoutes(app, repo, { rateLimit: opts.rateLimits?.shopping });
  eventsRoutes(app, repo, { rateLimit: opts.rateLimits?.shopping });
  // Крок О1а: прийом подій поведінки й сторінка власника.
  trackRoutes(app, repo);
  pulseRoutes(app, repo);
  adminOccasionsRoutes(app, repo, { rateLimit: opts.rateLimits?.shopping });
  profileRoutes(app, repo);
  eaterRoutes(app, repo);
  recipesRoutes(app, repo);
  cookRunsRoutes(app, repo);
  sessionRoutes(app, repo);
  onboardingRoutes(app, repo);
  chatRoute(app, repo, store, {
    rateLimit: opts.rateLimits?.chat,
    retailCart: retail?.attemptBuildCart,
    retailSearch: retail?.attemptSearch,
    retailKarpaty: retail?.karpatyEnabled,
    retailCartExtend: retail?.attemptExtendCart,
  });
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
      // Довідник подій живе в таблиці, а його джерело — код: на Vercel сід іде
      // кроком білду (vercel.json), локально — тут, щоб календар не був порожнім.
      await seedOccasions(pool);
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
      },
      // Стейки Карпат — відкритий каталог без ключів; KARPATY_ENABLED=0 вимикає.
      karpaty: { enabled: process.env.KARPATY_ENABLED !== '0' } }
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
