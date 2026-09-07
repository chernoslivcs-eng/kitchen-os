// Крок О1а: один хелпер на всі серверні інциденти.
//
// Двадцять девʼять викликів req.log.warn/error писали в логи Vercel, які живуть
// пʼять хвилин. Гірше за строк — те, що вони були однорідні: «модель не
// відповіла» і «продукт міг збрехати людині» лежали в одній купі.
//
// Тому два роди, і це рішення по кожному рядку, а не механіка:
//
//   broke — зламалось. Виклик моделі впав, база не відповіла, лист не пішов.
//           Продукт НЕ відпрацював. Це те, за чим прийде сповіщення.
//
//   guard — спрацював запобіжник. Сервер відпрацював правильно: відкинув
//           малформлену картку, помітив алерген у відповіді, не знайшов ціль
//           операції. Але продукт МІГ збрехати людині — вона попросила, дістала
//           відповідь, а картки не було. Цей рід важливіший за перший: перший
//           видно по 502 в очі, другий не видно нікому.
//
// Куди пише — у три місця одразу, і кожне має свою причину:
//   лог Vercel — видно ЗАРАЗ, поки дивишся деплой (живе пʼять хвилин);
//   app_event  — стрічка дня на /admin/pulse, поруч із поведінкою людини:
//                саме там видно, що вона робила перед тим, як зламалось;
//   Sentry     — стек, угруповання однакових і сповіщення на пошту.
// Жодне з трьох не замінює двох інших, і жодне не має права впасти.

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { captureIncident } from './sentry.js';

export type IncidentKind = 'broke' | 'guard';

export interface IncidentCtx {
  user_id?: string | null;
  household_id?: string | null;
  session_id?: string | null;
  /** Усе інше — структурне: id картки, назва моделі, промахи операцій. */
  [k: string]: unknown;
}

export interface IncidentSink {
  repo: Repo;
  log: FastifyBaseLogger;
}

/**
 * Записати інцидент. Ніколи не кидає: інцидент — це вже погана новина, і
 * впасти на її записі означало б перетворити guard на broke.
 *
 * Повертає короткий код події Sentry (вісім знаків) або null, якщо Sentry
 * вимкнений. Код їде людині — щоб вона могла назвати аварію, а не описувати.
 */
export function incident(sink: IncidentSink, kind: IncidentKind, name: string, ctx: IncidentCtx = {}): string | null {
  const { user_id = null, household_id = null, session_id = null, ...rest } = ctx;
  // Лог лишається: у проді він єдиний, хто бачить подію одразу, до того як її
  // прочитають на /admin/pulse.
  const line = { kind, user_id, household_id, session_id, ...rest };
  if (kind === 'broke') sink.log.error(line, name);
  else sink.log.warn(line, name);

  const eventId = captureIncident(kind, name, ctx);
  // Вісім знаків: достатньо, щоб знайти подію пошуком, і достатньо коротко,
  // щоб людина продиктувала його голосом. Той самий формат, що в ErrorBoundary.
  const code = eventId ? eventId.slice(0, 8) : null;

  // user_id обовʼязковий у схемі: подія без людини нікому не потрібна — за нею
  // неможливо ні зіставити з розмовою, ні спитати «що в неї сталось».
  if (!user_id) return code;
  void sink.repo
    .saveAppEvents([{
      id: randomUUID(),
      user_id,
      household_id,
      name: `incident:${name}`,
      props: { kind, ...(session_id ? { session_id } : {}), ...rest },
      // Крок А1: інцидент — серверний, пристрою в нього немає. Ці три
      // порожні тут не втрата даних, а факт: подію писав сервер, не вкладка.
      viewport_w: null,
      device_class: null,
      ua_family: null,
      created_at: new Date().toISOString(),
    }])
    .catch((err) => sink.log.error({ err, name }, 'incident-save-failed'));
  return code;
}
