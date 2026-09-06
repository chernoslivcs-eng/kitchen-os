// Крок Е1: одна відповідь на 429 для всіх роутів.
//
// Смуга «забагато за раз» малює смужку, що стікає до нуля, і час для неї
// береться звідси, а не з константи в клієнті. Заголовок стандартний
// (`Retry-After`, у секундах) — щоб і чужий клієнт зрозумів.
import type { FastifyReply } from 'fastify';
import type { RateLimiter } from './rate-limit.js';

export function tooMany(reply: FastifyReply, limiter: RateLimiter, key: string) {
  reply.header('Retry-After', String(limiter.retryAfter(key)));
  return reply.code(429).send({ error: 'too many requests' });
}
