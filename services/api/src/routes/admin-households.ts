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
}

export function adminHouseholdsRoutes(app: FastifyInstance, repo: Repo) {
  app.get('/v1/admin/households', { preHandler: [authenticated(repo), requireAdmin(repo)] }, async (req) => {
    const me = requireUser(req);
    // Один запит на весь список — агрегати рахує SQL. Циклу по домах тут
    // немає й бути не може: на вісімдесяти домах він з'їв би і сторінку, і
    // базу, якою в ту саму мить користуються живі люди.
    const rows = await repo.listAdminHouseholds();
    const households: AdminHouseholdItem[] = rows.map((h) => ({
      id: h.id,
      name: h.name,
      people: h.people,
      last_turn_at: h.last_turn_at,
      turns: h.turns,
      last_seen_at: h.last_seen_at,
      mine: h.id === me.household_id,
      owner_name: h.owner_name,
      owner_email: h.owner_email,
    }));
    return { households, my_household_id: me.household_id };
  });
}
