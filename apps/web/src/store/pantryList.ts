// Мобільний аудит 0912 · A (№48): на старті /app комору читали пʼять разів
// по 20 kB (стрічка двічі, факти для рейки, «Дім зараз», картки). Один кеш на
// 60 с з версією з usePantryStore (bump після записів скидає), як у
// pantryFacts; поки запит летить — усі беруть той самий проміс. `fresh` —
// для екрана комори і оновлення після подій: не читати з кешу, але й не
// дублювати запит, що вже в дорозі.
import { api, type PantryList } from '../api';
import { usePantryStore } from './pantry';

let cache: { value: PantryList; at: number; version: number } | null = null;
let inflight: Promise<PantryList> | null = null;
const TTL = 60_000;

export function loadPantry(opts?: { fresh?: boolean }): Promise<PantryList> {
  const version = usePantryStore.getState().version;
  if (!opts?.fresh && cache && cache.version === version && Date.now() - cache.at < TTL) return Promise.resolve(cache.value);
  if (!inflight) {
    inflight = api.pantry()
      .then((value) => { cache = { value, at: Date.now(), version: usePantryStore.getState().version }; return value; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Тільки для тестів: забути кеш між кейсами. */
export function __resetPantryList() { cache = null; inflight = null; }
