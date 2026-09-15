// Власник 15.09: ручна форма «Додати» в коморі — через той самий суворий
// резолвер, що чат і чек (exact | anchored; generic/words — ні, невпевнений →
// null, без вгадування, як після посилення 08.09). Підказка для форми і
// зона/строк для партії — з довідника за ключем.
import { resolveLabelToKey } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import { shelfSealedDays } from './shelf-life.js';
import { ZONE_SHELF_DAYS } from './pantry-view.js';
import type { Zone } from './types.js';

export interface PantryAddHint {
  key: string;
  name: string;
  /** Найконкретніша категорія довідника. */
  cat: string;
  zone: Zone;
  /** Днів строку в цій зоні — з довідника або таблиці зон; null — не псується. */
  days: number | null;
}

export function pantryAddHint(label: string): PantryAddHint | null {
  const key = resolveLabelToKey(label.trim());
  const item = key ? BY_KEY.get(key) : undefined;
  if (!key || !item) return null;
  const zone = item.zone_default;
  const fromCatalog = shelfSealedDays(key, zone);
  const days = fromCatalog === null ? null : (fromCatalog ?? ZONE_SHELF_DAYS[zone] ?? null);
  return { key, name: item.name, cat: item.categories[0] ?? '', zone, days };
}
