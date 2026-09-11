// Крок Е1: одна відповідь на 429 для всіх роутів.
//
// Смуга «забагато за раз» малює смужку, що стікає до нуля, і час для неї
// береться звідси, а не з константи в клієнті. Заголовок стандартний
// (`Retry-After`, у секундах) — щоб і чужий клієнт зрозумів.
import type { FastifyReply } from 'fastify';
import type { RateLimiter } from './rate-limit.js';

/**
 * Етап 3 (рішення 11.09): ЯКИЙ ліміт. Десять роутів віддавали одне тіло, і
 * клієнт бачив 429 із секундами, але не бачив чого: смуга не могла сказати
 * «10 рецептів за раз», лише «дай хвилину наздогнати». Поле необовʼязкове —
 * старі виклики без нього і старі клієнти без розбору поля не ламаються;
 * загальна смуга лишається запасною.
 */
export type LimitKind =
  | 'chat' | 'recipe_gen' | 'recipe_public' | 'shopping' | 'events'
  | 'retail' | 'auth' | 'invite' | 'track' | 'admin';

export function tooMany(reply: FastifyReply, limiter: RateLimiter, key: string, kind?: LimitKind) {
  reply.header('Retry-After', String(limiter.retryAfter(key)));
  return reply.code(429).send(kind ? { error: 'too many requests', kind } : { error: 'too many requests' });
}
