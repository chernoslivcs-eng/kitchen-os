import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { InMemoryRepo, type Repo } from '@kitchen/domain';
import { makePool, migrate, PostgresRepo } from '@kitchen/db';
import { InMemoryStore, LocalFSStore, type AttachmentStore } from './attachment-store.js';
import { chatRoute } from './routes/chat.js';
import { cardsRoutes } from './routes/cards.js';
import { attachmentsRoutes } from './routes/attachments.js';

// Один сервіс на MVP: chat + cards + attachments в тому самому процесі, спільний Repo.
// Розділення на chat-service / pantry-service / intake-service — задача про деплой.

export function buildApp(
  repo: Repo = new InMemoryRepo(),
  store: AttachmentStore = new InMemoryStore(),
): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  // 20 MB per file — вища за реальні фото/PDF, нижча за DoS-ризик.
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  chatRoute(app, repo, store);
  cardsRoutes(app, repo);
  attachmentsRoutes(app, repo, store);

  app.get('/health', async () => ({ ok: true, prompt: process.env.PROMPT_VERSION ?? '(latest)' }));
  return app;
}

// Обрати сховище: PG_URL → PostgresRepo (з міграцією), інакше InMemoryRepo.
// ATTACHMENT_DIR (або дефолт ./storage/attachments) → LocalFSStore.
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
  return buildApp(repo, store);
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
