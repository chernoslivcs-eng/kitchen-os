// Простий rate-limiter у памʼяті. Один процес — одна карта. Для MVP достатньо.
// Для кластерного деплою треба спільна база (Redis) — тоді підмінити реалізацію
// за тим самим інтерфейсом і жодного роуту не чіпати.
//
// Свідомо НЕ плагін @fastify/rate-limit: у v10 хук глобальний, а `authenticated`
// у нас — теж preHandler, і рейт-лімітер плагіна тоді читає req.user до того,
// як його виставили. Тут ми ставимо лімітер ЯК другий preHandler у route.config,
// а порядок керуємо в самому route.

export interface RateLimitCfg {
  max: number;
  windowMs: number;
}

export interface RateLimiter {
  check(key: string): boolean;   // true = дозволено; false = 429
  reset(): void;                 // для тестів
}

export function makeRateLimiter(cfg: RateLimitCfg): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt < now) {
        buckets.set(key, { count: 1, resetAt: now + cfg.windowMs });
        return true;
      }
      if (bucket.count >= cfg.max) return false;
      bucket.count++;
      return true;
    },
    reset() { buckets.clear(); },
  };
}
