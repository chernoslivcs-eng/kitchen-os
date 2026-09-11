// Крок О1а: POST /v1/events/track — прийом подій поведінки.
//
// Окремий файл, а не в routes/events.ts: там календар дому, і спільне в них
// лише слово «події» в адресі. Плутати їх у коді дорожче, ніж мати ще один
// маленький роутер.
//
// user_id береться З СЕСІЇ, а не з тіла. Клієнт його не надсилає й надіслати
// не може: інакше будь-хто писав би події в чужу стрічку.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppEventRow, DeviceClass, Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { makeRateLimiter } from '../rate-limit.js';
import { tooMany } from '../too-many.js';

/** Стеля пачки. Більше двадцяти за раз означає, що щось у клієнті циклиться. */
export const MAX_BATCH = 20;

/**
 * Імена подій — закритий список. Не заради валідації заради валідації: без
 * нього перша ж помилка в клієнті засмітить стрічку дня іменами-опечатками, і
 * шукати в ній стане нічим.
 */
export const KNOWN_EVENTS = new Set([
  'pantry_opened', 'pantry_filter_changed', 'pantry_card_opened',
  'recipe_opened', 'cook_started', 'cook_step_reached', 'cook_finished', 'cook_abandoned',
  'shopping_opened', 'calendar_opened',
  'attachment_added',
  'chat_input_abandoned',
  'error_shown',
  // Крок А1: знайомство (Семен) і картка «Про тебе». Підкреслення — як у
  // решти подій; через дефіс пишуться інциденти, і це інший набір.
  'welcome_started', 'welcome_card_reached', 'welcome_finished', 'welcome_skipped',
  'onboarding_started', 'onboarding_panel_reached', 'onboarding_finished', 'onboarding_skipped',
]);

/**
 * Клас пристрою — закритий список, як і імена подій. Порахував його клієнт (там
 * же, де живуть межі розкладки), а тут ми тільки не пускаємо чуже слово в
 * стовпчик, за яким потім рахуватимуть. Ширина при цьому пишеться незалежно —
 * якщо клас колись розійдеться з межами, правдою лишиться вона.
 */
export const KNOWN_DEVICE_CLASSES = new Set<DeviceClass>(['mobile', 'tablet', 'desktop']);

/** Стеля родини браузера й ОС: сюди їде «Safari · iOS», а не сирий User-Agent. */
const UA_MAX = 40;

interface TrackBody {
  events?: { name?: string; props?: Record<string, unknown>; at?: string }[];
  /**
   * Пристрій — один на пачку, а не на подію. Може не приїхати зовсім: у людини
   * буває відкрита стара вкладка з клієнтом, який його ще не слав. Такий
   * конверт мусить записатись нормально, з порожнім пристроєм.
   */
  device?: { w?: unknown; class?: unknown; ua?: unknown };
}

/** Розбирає конверт у три поля рядка. Усе, що не впізнали, стає null. */
export function readDeviceEnvelope(d: TrackBody['device']): Pick<AppEventRow, 'viewport_w' | 'device_class' | 'ua_family'> {
  const w = typeof d?.w === 'number' && Number.isFinite(d.w) && d.w > 0 && d.w < 100_000
    ? Math.round(d.w) : null;
  const cls = typeof d?.class === 'string' && KNOWN_DEVICE_CLASSES.has(d.class as DeviceClass)
    ? d.class as DeviceClass : null;
  const ua = typeof d?.ua === 'string' && d.ua.trim() ? d.ua.trim().slice(0, UA_MAX) : null;
  return { viewport_w: w, device_class: cls, ua_family: ua };
}

export function trackRoutes(app: FastifyInstance, repo: Repo) {
  // Двісті подій на пʼять хвилин: клієнт шле раз на 10 с пачками, тож навіть
  // дуже активна людина не підходить до стелі близько.
  const limiter = makeRateLimiter({ max: 200, windowMs: 5 * 60_000 });

  app.post<{ Body: TrackBody }>('/v1/events/track', { preHandler: authenticated(repo) }, async (req, reply) => {
    const { user_id, household_id } = requireUser(req);
    if (!limiter.check(user_id)) return tooMany(reply, limiter, user_id, 'track');

    const incoming = req.body?.events;
    if (!Array.isArray(incoming) || !incoming.length) return { accepted: 0 };
    if (incoming.length > MAX_BATCH) return reply.code(400).send({ error: 'batch too large' });

    const now = Date.now();
    const device = readDeviceEnvelope(req.body?.device);
    const rows: AppEventRow[] = [];
    for (const e of incoming) {
      if (!e?.name || !KNOWN_EVENTS.has(e.name)) continue;   // невідоме тихо викидаємо
      // Час події — клієнтський (подія сталась до відправки), але в межах
      // розумного: годину в минуле і хвилину в майбутнє. Інакше збитий
      // годинник на машині людини розмазав би стрічку дня на роки.
      const at = e.at ? new Date(e.at).getTime() : now;
      const ok = Number.isFinite(at) && at > now - 3600_000 && at < now + 60_000;
      rows.push({
        id: randomUUID(),
        user_id,
        household_id,
        name: e.name,
        props: e.props && typeof e.props === 'object' ? e.props : {},
        ...device,
        created_at: new Date(ok ? at : now).toISOString(),
      });
    }
    if (rows.length) await repo.saveAppEvents(rows);
    // Втрата події — не помилка: клієнт повторів не робить, і знати йому про
    // відкинуті теж не треба.
    return { accepted: rows.length };
  });
}
