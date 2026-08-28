// Хелпер для тестів: пройти magic-link потік і повернути cookie-заголовок
// плюс user_id/household_id, які тепер приховані за сесією.

import type { FastifyInstance } from 'fastify';
import { ConsoleMailer } from '../src/mailer.js';

export interface Signed {
  cookie: string;      // готовий рядок для Cookie header
  user_id: string;
  household_id: string;
}

export async function signIn(app: FastifyInstance, mailer: ConsoleMailer, email: string): Promise<Signed> {
  await app.inject({
    method: 'POST',
    url: '/v1/auth/request',
    payload: { email },
  });
  const last = mailer.last();
  if (!last) throw new Error('mailer did not receive a magic link');
  const url = new URL(last.link);
  const verify = await app.inject({
    method: 'GET',
    url: `${url.pathname}${url.search}`,
  });
  if (verify.statusCode !== 200) throw new Error(`verify failed: ${verify.statusCode} ${verify.body}`);
  const setCookie = verify.headers['set-cookie'];
  const cookieRaw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  const cookie = cookieRaw.split(';')[0]!;
  const body = verify.json() as { user_id: string; household_id: string };
  return { cookie, user_id: body.user_id, household_id: body.household_id };
}
