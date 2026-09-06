// Крок О1: димовий тест символікації.
//
// Навіщо він постійний, а не разовий скрипт: сорсмепи ламаються тихо. Вони
// вивантажуються на кожній збірці, і будь-яка зміна в esbuild, у плагіні або в
// порядку кроків може одного дня перетворити стек у Sentry на
// `server.mjs:1:2841097` — а дізнаємось ми про це в той день, коли справді
// щось упаде і треба буде читати стек. Тому кнопка, яку можна натиснути після
// будь-якого деплою і за пʼятнадцять секунд побачити, чи читається стек.
//
// Виняток НЕ ловиться тут. Обробник не має ні try, ні catch: помилка йде
// нагору до onError-хука в server.ts — тим самим шляхом, яким піде справжня
// аварія. Ловити її тут означало б перевіряти не той шлях.
//
// Доступ — той самий requireAdmin, що на /admin/pulse: 404, а не 403.
//
// Три кадри вглиб — навмисно. Виняток, кинутий у самому обробнику, дав би стек
// з одного рядка, і символікацію на ньому не перевіриш: розшифровувати нічого.

import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { authenticated } from '../middleware/session.js';
import { requireAdmin } from '../middleware/admin.js';

/** Кадр 3: тут і ламається. Назва навмисно схожа на справжню роботу з коморою. */
function readShelfDepth(shelf: string): number {
  throw new Error(`димовий тест символікації: полиці «${shelf}» не існує`);
}

/** Кадр 2. */
function pickCentrepiece(shelves: string[]): string {
  const depth = readShelfDepth(shelves[0] ?? 'порожньо');
  return `${shelves[0]} (${depth})`;
}

/** Кадр 1 — його викликає обробник. */
function planNightMeal(): string {
  return pickCentrepiece(['холодильник', 'морозилка']);
}

export function boomRoutes(app: FastifyInstance, repo: Repo) {
  app.get<{ Querystring: { dry?: string } }>(
    '/v1/admin/boom',
    { preHandler: [authenticated(repo), requireAdmin(repo)] },
    async (req) => {
      // `?dry=1` — не вибухає, лише каже «тобі сюди можна». Це та сама
      // перевірка, якою фронтова сторінка вирішує, показати 404 чи впасти:
      // окремий ендпоінт заради цього був би зайвим шматком адмінки.
      if (req.query.dry) return { ok: true };
      return { never: planNightMeal() };
    },
  );
}
