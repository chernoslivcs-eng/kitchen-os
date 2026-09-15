// Власник 15.09: ручна форма «Додати» в коморі — рівно той самий рівень, що
// чат-шлях apply (не суворіший): ключ — resolveLabelToKey (anchored, як в
// ensureProduct), зона — resolveLabelToZone (generic, як `zone` партії в
// apply). Тому «кефір» тут, як і в чаті: ключа нема (у довіднику лише
// варіанти), а зона — холодильник.
import { resolveLabelToKey, resolveLabelToZone } from '@kitchen/catalog';
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

/** Зона за чат-рівнем (generic) — навіть коли ключа нема. */
export function pantryAddZone(label: string): Zone | null {
  return resolveLabelToZone(label.trim()) ?? null;
}

export function pantryAddHint(label: string): PantryAddHint | null {
  const key = resolveLabelToKey(label.trim());
  const item = key ? BY_KEY.get(key) : undefined;
  if (!key || !item) return null;
  const zone = pantryAddZone(label) ?? item.zone_default;
  const fromCatalog = shelfSealedDays(key, zone);
  const days = fromCatalog === null ? null : (fromCatalog ?? ZONE_SHELF_DAYS[zone] ?? null);
  return { key, name: item.name, cat: item.categories[0] ?? '', zone, days };
}
