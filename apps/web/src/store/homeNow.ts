// «Дім зараз» — один стан дому на шапку чату, чіп «Дім ●●● N», панель і
// (раніше) блок «ЗАРАЗ» у сайдбарі. Джерела: комора (партії з днями) і
// GET /v1/now (приводи й записи дому). Кеш 60 с, версія комори скидає.
//
// Роди станів (Screens «Чат · збірка», Responsive G3): danger — прострочено
// (days < 0, лише з каталожним ключем), plum — суворий період (піст), sage —
// триває готування. Чіп — по одному на рід і лише коли стан є; сезони й свої
// події чіпів не мають — вони тихі рядки панелі.
import { useEffect, useState } from 'react';
import { api, type NowItem, type PantryBatch } from '../api';
import { isSoon, hasScale, freshness } from '@kitchen/domain/shelf-thresholds';
import { usePantryStore } from './pantry';
import { loadPantryFacts, type PantryFacts } from './pantryFacts';
import { toneOfNow } from '../lib/period';

export interface BurningRow { id: string; label: string; days: number; tone: 'danger' | 'amber' }

export interface HomeNow {
  facts: PantryFacts | null;
  /** Прострочені (days < 0) — лічильник чіпа «Прострочено N». */
  overdue: number;
  /** До трьох рядків «Горить»: за днями, прострочене першим. */
  burning: BurningRow[];
  /** Усі активні приводи/записи (не лише три): суворе першим, далі за кінцем. */
  now: NowItem[];
  /** Суворий період для чіпа «Піст · до …» — перший зі strict. */
  strict: NowItem | null;
  /** Список покупок для тихого рядка «Список · N» (G3): скільки і перші назви. */
  shopping: { count: number; labels: string[] } | null;
}

let pantryCache: { rows: BurningRow[]; overdue: number; at: number; version: number } | null = null;
let nowCache: { value: NowItem[]; at: number } | null = null;
let shopCache: { value: { count: number; labels: string[] }; at: number; version: number } | null = null;

function burningOf(batches: PantryBatch[]): { rows: BurningRow[]; overdue: number } {
  const scaled = batches.filter((b) => hasScale(b.catalog_key) && b.days != null && isSoon(b.days));
  const overdue = scaled.filter((b) => freshness(b.days) === 'overdue').length;
  const rows = [...scaled]
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, 3)
    .map((b) => ({ id: b.id, label: b.label, days: b.days!, tone: (b.days! <= 0 ? 'danger' : 'amber') as 'danger' | 'amber' }));
  return { rows, overdue };
}

export function sortNow(items: NowItem[]): NowItem[] {
  return [...items].sort((a, b) => Number(b.strict) - Number(a.strict) || a.to.localeCompare(b.to));
}

export function useHomeNow(dep?: unknown): HomeNow {
  const version = usePantryStore((s) => s.version);
  const [facts, setFacts] = useState<PantryFacts | null>(null);
  const [pantry, setPantry] = useState<{ rows: BurningRow[]; overdue: number }>(pantryCache ?? { rows: [], overdue: 0 });
  const [now, setNow] = useState<NowItem[]>(nowCache?.value ?? []);
  const [shopping, setShopping] = useState<{ count: number; labels: string[] } | null>(shopCache?.value ?? null);
  useEffect(() => {
    let alive = true;
    if (shopCache && shopCache.version === version && Date.now() - shopCache.at < 60_000) {
      setShopping(shopCache.value);
    } else {
      api.shopping.list().then(({ items }) => {
        const open = items.filter((it) => !it.checked);
        const v = { count: open.length, labels: open.slice(0, 2).map((it) => it.label) };
        shopCache = { value: v, at: Date.now(), version };
        if (alive) setShopping(v);
      }).catch(() => {});
    }
    loadPantryFacts(version).then((f) => { if (alive) setFacts(f); }).catch(() => {});
    if (pantryCache && pantryCache.version === version && Date.now() - pantryCache.at < 60_000) {
      setPantry(pantryCache);
    } else {
      api.pantry().then(({ batches }) => {
        const v = burningOf(batches);
        pantryCache = { ...v, at: Date.now(), version };
        if (alive) setPantry(v);
      }).catch(() => {});
    }
    if (nowCache && Date.now() - nowCache.at < 60_000) {
      setNow(nowCache.value);
    } else {
      api.events.now().then(({ now: items }) => {
        const v = sortNow(items);
        nowCache = { value: v, at: Date.now() };
        if (alive) setNow(v);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [version, dep]);
  return { facts, overdue: pantry.overdue, burning: pantry.rows, now, strict: now.find((e) => toneOfNow(e) === 'restrict') ?? null, shopping };
}
