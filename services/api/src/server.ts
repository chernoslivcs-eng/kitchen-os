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
import { settleTelemetry } from './telemetry.js';
import { pulseRoutes } from './routes/pulse.js';
import { adminHouseholdsRoutes } from './routes/admin-households.js';
import { moneyRoutes } from './routes/admin-money.js';
import { boomRoutes } from './routes/boom.js';
import { adminOccasionsRoutes } from './routes/admin-occasions.js';
import { profileRoutes } from './routes/profile.js';
import { cookRunsRoutes } from './routes/cook-runs.js';
import { sessionRoutes } from './routes/session.js';
import { onboardingRoutes } from './routes/onboarding.js';

import type { RateLimitCfg } from './rate-limit.js';
import { googleAuthRoutes, type GoogleAuthOpts } from './routes/auth-google.js';
import { retailRoutes, type RetailOpts } from './routes/retail.js';

/**
 * Стеля флашу в Sentry — скільки ми готові тримати готову відповідь заради
 * того, щоб подія долетіла.
 *
 * Секунда, а не типові для SDK дві. Рахунок такий: лямбда в iad1, приймач
 * Sentry в EU — обмін укладається в 100–150 мс, тож секунда це шестикратний
 * запас на поганий день. Далі чекати нема сенсу: подію ми вже й так втратили б
 * не через мережу, а через щось гірше, а людина в цей час дивиться в екран.
 *
 * Ціна платиться ТІЛЬКИ на запитах, де інцидент справді стався. Там, де це
 * аварія, людина й так отримує 5xx; там, де запобіжник, хід у чаті триває
 * секунди через виклик моделі, і секунда стелі — це верхня межа, якої в
 * житті майже не буває.
 */
const SENTRY_FLUSH_MS = 1000;

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

    // Крок О1: код інциденту — не лише заголовком, а й у тілі 5xx. Заголовок
    // бачить curl -i і клієнтський код; людина, яка відкрила адресу в
    // браузері, не бачить його ніяк, а саме вона й читає цей код уголос.
    //
    // Робимо це тут, а не через setErrorHandler: форму тіла помилки знає
    // fastify (у валідаційних там свої поля), і переписувати її означало б
    // узяти на себе те, що вже працює. Тут ми лише ДОДАЄМО поле в готовий
    // JSON, а якщо тіло не JSON — не чіпаємо взагалі.
    const code = reply.getHeader('x-incident-code');
    if (code && reply.statusCode >= 500 && typeof payload === 'string') {
      try {
        const body: unknown = JSON.parse(payload);
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          // content-length fastify перераховує сам після onSend — перевірено
          // на справжньому HTTP-сервері, не на inject. Ставити його руками
          // означало б тримати рядок, який неможливо зламати тестом.
          return done(null, JSON.stringify({ ...(body as Record<string, unknown>), incident: code }));
        }
      } catch {
        // Не JSON — лишаємо як є. Тіло помилки важливіше за наш код.
      }
    }
    done(null, payload);
  });
  // Крок О1: усе, що впало в обробнику й не було спіймано на місці. Без цього
  // хука Sentry бачив би лише те, що ми передбачили назвати інцидентом, — а
  // найдорожчі падіння якраз ті, яких ніхто не передбачив.
  //
  // Тільки 5xx: 400 від валідації схеми теж проходить сюди, але це не аварія,
  // а відмова, і сипати нею в Sentry означало б втопити справжні падіння.
  app.addHook('onError', (req, reply, err, done) => {
    // Статус беремо З ПОМИЛКИ, а не з відповіді: на момент цього хука fastify
    // ще не проставив 500 у reply, там лежить дефолтна 200. Перший захід
    // читав reply.statusCode як запасний варіант — і мовчки пропускав рівно те,
    // заради чого хук написано: необроблений виняток без власного statusCode.
    // Тепер запасний варіант — 500, а reply.statusCode бере участь, тільки
    // якщо він уже сам по собі аварійний.
    const status = err.statusCode ?? (reply.statusCode >= 500 ? reply.statusCode : 500);
    if (status < 500) return done();
    const code = incident({ repo, req }, 'broke', 'unhandled-route-error', {
      user_id: req.user?.user_id ?? null,
      household_id: req.user?.household_id ?? null,
      route: `${req.method} ${req.routeOptions?.url ?? req.url}`,
      err,
    });
    // Код події їде у відповіді. Тіло лишаємо як є — його форму знає fastify і
    // на неї спираються інші місця; заголовок нічого не ламає й доступний
    // однаково і людині з curl, і клієнту.
    if (code) reply.header('x-incident-code', code);
    done();
  });
  // Крок А1а: остання застава перед тим, як відповідь піде.
  //
  // Тут, а НЕ в `onResponse`: той хук спрацьовує вже після відправки, а
  // `vercel-handler.ts` повертається одразу після `emit('request')` — для
  // платформи функція скінчилась, і контейнер має право замерзнути тієї ж
  // миті. Усе, що лишилось у повітрі, просто не станеться, і тиша буде
  // єдиним симптомом. Саме так після А1 і зник серверний інцидент.
  //
  // Порядок навмисний: спершу наша база (це наші дані, і чекаємо їх без
  // стелі), потім Sentry (чуже, по мережі, зі стелею).
  //
  // На звичайному ході обидва рядки коштують нуль: масиву телеметрії на
  // запиті не існує, а flushSentry виходить одразу, коли за запит нічого не
  // сталось.
  app.addHook('onSend', async (req, _reply, payload) => {
    await settleTelemetry(req);
    await flushSentry(SENTRY_FLUSH_MS);
    return payload;
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
  eventsRoutes(app, repo, { rateLimit: opts.rateLimits?.shopping });
  // Крок О1а: прийом подій поведінки й сторінка власника.
  trackRoutes(app, repo);
  pulseRoutes(app, repo);
  // Крок А2: список домів — з нього починається адмінка.
  adminHouseholdsRoutes(app, repo);
  // Крок А4: гроші розрізами й прогноз.
  moneyRoutes(app, repo);
  boomRoutes(app, repo);
  adminOccasionsRoutes(app, repo, { rateLimit: opts.rateLimits?.shopping });
  profileRoutes(app, repo);
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
