// Крок А2: GET /v1/admin/households — з чого починається адмінка.
//
// Пілот роздано, і кожна людина, яка зайшла за лінком, дістає ВЛАСНИЙ дім
// (`createUserWithHousehold`). Тобто дані пілотних людей пишуться в базу з
// першої хвилини, а власник досі бачив тільки свій дім і більше нічого.
//
// Дім БЕЗ жодної активності присутній у списку нарівні з рештою — і це не
// повнота заради повноти. Людина, яка відкрила продукт за лінком і не
// написала жодного слова, — найцінніший рядок тут: на пілоті таких буде
// більшість, і саме вони кажуть те, чого не скаже жодна розмова.
//
// Доступ — той самий requireAdmin: 404, а не 403. Чужий не мусить знати, що
// адмінка існує, і тим паче — скільки в продукті домів.

import type { FastifyInstance } from 'fastify';
import type { Repo } from '@kitchen/domain';
import { authenticated, requireUser } from '../middleware/session.js';
import { requireAdmin } from '../middleware/admin.js';

/**
 * Технічний дім — той, чия пошта власника закінчується на `@example.com`.
 *
 * Це не здогадка по підрядку: RFC 2606 резервує `example.com` саме для
 * прикладів і документації, і пошта на ньому не може належати живій людині за
 * визначенням. Тому підстава відсіювати такий дім не «схоже на тест», а «ця
 * адреса не існує й існувати не може».
 *
 * У проді таких дев'ять із шістнадцяти: сміття QA-прогонів кінця серпня
 * (`qa6-*`, `qa7-*`, `qa8-*`, `design-audit*`, `e2e-smoke`). Вони мовчазні, а
 * список сортується за останнім ходом — тож вони осідали б унизу рівно поруч
 * із мовчазними ЖИВИМИ людьми, а це найцінніший рядок у списку. Саме там його
 * найлегше не помітити.
 *
 * Нічого не видаляємо: прапорцем їх видно, і історія лишається цілою.
 */
const TECHNICAL_DOMAIN = '@example.com';

const isTechnical = (email: string | null): boolean =>
  !!email && email.toLowerCase().trim().endsWith(TECHNICAL_DOMAIN);

export interface AdminHouseholdItem {
  id: string;
  name: string;
  people: number;
  last_turn_at: string | null;
  turns: number;
  last_seen_at: string | null;
  /** Чи це дім того, хто питає. Від нього залежить, чи екран «у гостях». */
  mine: boolean;
  owner_name: string | null;
  /**
   * Пошта власника дому. Свідомий виняток із «PII в адмінку не носимо»:
   * власник цих людей особисто кликав і має розрізняти їх у списку. Далі за
   * список ця пара не йде.
   */
  owner_email: string | null;
  /** Пошта власника на зарезервованому домені — жива людина такої не має. */
  technical: boolean;
}

export function adminHouseholdsRoutes(app: FastifyInstance, repo: Repo) {
  app.get<{ Querystring: { technical?: string } }>(
    '/v1/admin/households',
    { preHandler: [authenticated(repo), requireAdmin(repo)] },
    async (req) => {
      const me = requireUser(req);
      // Один запит на весь список — агрегати рахує SQL. Циклу по домах тут
      // немає й бути не може: на вісімдесяти домах він з'їв би і сторінку, і
      // базу, якою в ту саму мить користуються живі люди.
      const rows = await repo.listAdminHouseholds();

      const all: AdminHouseholdItem[] = rows.map((h) => ({
        id: h.id,
        name: h.name,
        people: h.people,
        last_turn_at: h.last_turn_at,
        turns: h.turns,
        last_seen_at: h.last_seen_at,
        mine: h.id === me.household_id,
        owner_name: h.owner_name,
        owner_email: h.owner_email,
        technical: isTechnical(h.owner_email),
      }));

      // Фільтр стоїть ТУТ, а не в SQL, з двох причин: політика «що вважати
      // технічним» — рішення продукту, а не форма запиту; і щоб порахувати
      // приховані, їх усе одно треба спершу дістати. На шістнадцяти (і на
      // вісімдесяти) домах різниця в ціні нульова.
      const show = req.query.technical === '1';
      const hidden = all.filter((h) => h.technical && !h.mine).length;
      const households = show ? all : all.filter((h) => !h.technical || h.mine);

      return {
        households,
        my_household_id: me.household_id,
        /** Скільки домів сховано зараз. Підпис показує це число з перемикачем. */
        hidden_technical: show ? 0 : hidden,
        /** Скільки їх узагалі — щоб перемикач знав, чи є що показувати. */
        technical_total: all.filter((h) => h.technical && !h.mine).length,
      };
    },
  );
}
