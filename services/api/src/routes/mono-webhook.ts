// Вебхук monobank (план mono, задача 3).
//
// Живе окремим модулем і окремим Fastify-плагіном не з любові до файлів, а
// тому що підпис ECDSA рахується над СИРИМ тілом. Глобальний JSON-парсер
// віддає вже розібраний обʼєкт; зібрати його назад у байти не можна — інший
// порядок ключів чи пробіли, і підпис не зійдеться. Плагін дає власний
// парсер у своєму обсязі (encapsulation), решта API читає JSON як раніше.
//
// Довіра тут береться лише з підпису: сесії немає, mono приходить з чужого IP.
import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { ingestProviderEvent } from '../billing/ingest.js';
import { monoPubKey, monoToEvent, monoVerify, type MonoInvoiceStatus } from '../billing/mono.js';
import { MONO_WEBHOOK_PATH } from '../billing/pick-provider.js';

export interface MonoWebhookOpts {
  /** Тести й стенд підсовують ключ; у проді — GET /api/merchant/pubkey. */
  pubKey?: () => Promise<string>;
}

export function monoWebhookRoute(app: FastifyInstance, repo: Repo, opts: MonoWebhookOpts = {}) {
  // Звичайний register (БЕЗ fastify-plugin): саме він створює окремий обсяг.
  // fastify-plugin зробив би протилежне — виніс парсер назовні, на весь API.
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post(MONO_WEBHOOK_PATH, async (req, reply) => {
      const token = process.env.MONO_TOKEN;
      // Немає токена — немає чим спитати відкритий ключ, тобто немає чим
      // перевірити підпис. Розбирати тіло наосліп не будемо.
      if (!token) return reply.code(503).send({ error: 'billing_not_configured' });

      const raw = req.body as Buffer;
      const sign = req.headers['x-sign'];
      let pem: string;
      try {
        pem = await (opts.pubKey ? opts.pubKey() : monoPubKey(token));
      } catch (err) {
        // Ключ не дістали — відповідаємо 503, і mono повторить. Пропустити
        // неперевірене тіло було б гірше, ніж втратити подію на кілька хвилин.
        req.log.error({ err: String(err) }, 'mono-pubkey-unavailable');
        return reply.code(503).send({ error: 'pubkey_unavailable' });
      }

      if (typeof sign !== 'string' || !monoVerify(pem, raw, sign)) {
        // Тіло не логуємо: у ньому маска картки й сума.
        req.log.warn({ ip: req.ip }, 'mono-webhook-bad-signature');
        return reply.code(403).send({ error: 'bad_signature' });
      }

      let body: MonoInvoiceStatus;
      try {
        body = JSON.parse(raw.toString('utf8')) as MonoInvoiceStatus;
      } catch {
        return reply.code(400).send({ error: 'bad_json' });
      }

      const ev = monoToEvent(body);
      // Проміжні статуси (created/processing/hold/reversed/expired) стану не
      // міняють. 200 — щоб mono не повторював те, що ми свідомо ігноруємо.
      if (!ev) return { ignored: true };

      const result = await ingestProviderEvent(repo, ev, new Date(), req.log);
      // Невідомий order теж 200: повторювати нема сенсу, а 404 змусив би mono
      // бити до трьох разів за кожною такою подією.
      return { ok: true, result };
    });
  });
}
