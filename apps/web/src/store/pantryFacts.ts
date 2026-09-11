// Факти комори для оболонки й шапки чату: скільки позицій і скільки «горить».
// Один кеш на всіх (60 с), бо їх читають і рейка (крапка на «Коморі»), і
// шапка чату («Горить N», Prototype); версія комори з usePantryStore скидає
// кеш після записів. До 6b-5 кеш жив у TabBar.tsx приватно.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { isSoon, hasScale } from '@kitchen/domain/shelf-thresholds';
import { usePantryStore } from './pantry';

export interface PantryFacts { count: number; soon: number }

let cache: { value: PantryFacts; at: number; version: number } | null = null;
let inflight: Promise<PantryFacts> | null = null;

export function loadPantryFacts(version: number): Promise<PantryFacts> {
  if (cache && cache.version === version && Date.now() - cache.at < 60_000) return Promise.resolve(cache.value);
  if (!inflight) {
    inflight = api.pantry()
      .then(({ count, batches }) => {
        const soon = batches.filter((b) => isSoon(b.days) && hasScale(b.catalog_key)).length;
        cache = { value: { count, soon }, at: Date.now(), version };
        return cache.value;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Факти комори; `dep` — будь-що, зміна чого має перечитати (шлях). */
export function usePantryFacts(dep?: unknown): PantryFacts | null {
  const version = usePantryStore((s) => s.version);
  const [facts, setFacts] = useState<PantryFacts | null>(cache?.value ?? null);
  useEffect(() => {
    let alive = true;
    loadPantryFacts(version).then((f) => { if (alive) setFacts(f); }).catch(() => {/* тихо */});
    return () => { alive = false; };
  }, [version, dep]);
  return facts;
}
