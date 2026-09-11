// Права панель артефактів — стан у сторі, бо сама панель живе в каркасі
// (App.tsx → Shell) один раз, а публікують у неї СТОРІНКИ: Стрічка — свої
// картки (кошик, чек, рецепт, подія), Календар — подію на ≥1200. Доки панель
// жила всередині Feed.tsx, на Календарі її фізично не існувало, і подія на
// широкому екрані відкривалась шторкою всупереч канвасу («≥1280 · подія як
// артефакт у правій панелі»).
//
// Панель не знає, ЩО малювати: сторінка віддає їй список вкладок і функцію
// render(key) — тіло артефакта з усіма замиканнями сторінки (apply/undo,
// cookOpen, navigate…). Це навмисно: інакше довелося б тягнути півстрічки в
// каркас.

import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { ArtifactKey } from '../pages/Feed/artifacts';

export interface PanelArtifact {
  key: string;
  kind: ArtifactKey;
  label: string;
  meta: string;
}

export interface PanelPublication {
  artifacts: PanelArtifact[];
  render: (key: string) => ReactNode;
  /** Блок під артефактом (Стрічка: «очікують рішення»). */
  extra?: ReactNode;
  /** Бурштинова крапка на згорнутій смузі (є що вирішити). */
  pendingDot?: boolean;
  /** Приглушена вкладка-вхід (Стрічка: список покупок, поки він не відкритий). */
  ghostTab?: { glyphKind: ArtifactKey; count: number; onClick: () => void } | null;
  /**
   * Пул-9 №6: ключі артефактів, що прийшли ХОДОМ У ЦІЙ СЕСІЇ ВКЛАДКИ, а не
   * з історії при завантаженні. Тільки такий артефакт панель виводить
   * наперед; на F5 вона не має відкриватись самовільно, тому «новий у
   * списку» саме по собі — недостатня ознака (історія теж приходить одним
   * стрибком порожньо → повно).
   */
  freshKeys?: string[];
}

export const RAIL_IN_FLOW = '(min-width: 1200px)';
// HANDOFF «Артефакти»: ліва кромка тягнеться 300–720.
export const RAIL_MIN = 300;
export const RAIL_MAX = 720;
export const RAIL_DEFAULT = 320;
/** Пул-9 №6: вікно, у якому ручний вибір людини сильніший за новий артефакт. */
export const MANUAL_PICK_GRACE_MS = 10_000;

interface PanelStore extends PanelPublication {
  active: string | null;
  /** Шторка на <1200 відкрита. */
  open: boolean;
  /** Панель у потоці згорнута до смуги 52px (персистентно). */
  hidden: boolean;
  /** Ширина картки, потягнута рукою; null — типова за екраном (ArtifactPanel). */
  width: number | null;
  dragging: boolean;
  /** Зʼявився новий артефакт, поки панель згорнута. */
  fresh: boolean;
  /**
   * Пул-9 №6: коли людина востаннє перемикала артефакт РУКАМИ (мс). Десять
   * секунд після цього новий артефакт не перебиває вибір: інакше рецепт,
   * що прийшов із чату, вирвав би з-під рук список покупок.
   */
  lastManualPick: number;

  publish: (p: PanelPublication) => void;
  clear: () => void;
  setActive: (key: string) => void;
  /** Відкрити артефакт: у потоці — розгорнути панель, інакше — шторку. */
  openArtifact: (key: string) => void;
  collapse: () => void;
  expand: () => void;
  setOpen: (v: boolean) => void;
  setWidth: (px: number, persist?: boolean) => void;
  setDragging: (v: boolean) => void;
  setFresh: (v: boolean) => void;
  /** Пул-9 №6: вивести артефакт наперед — крім випадку «людина щойно обрала руками». */
  surfaceArtifact: (key: string) => void;
}

function readHidden(): boolean {
  try { return localStorage.getItem('kos-rail-hidden') === '1'; } catch { return false; }
}
/** Ширина, яку людина потягла сама; null — ще не тягнула, панель бере типову за екраном (340 → 420). */
function readWidth(): number | null {
  try {
    const raw = localStorage.getItem('kos-rail-width');
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX ? v : null;
  } catch { return null; }
}
const inFlow = () => typeof window !== 'undefined' && window.matchMedia(RAIL_IN_FLOW).matches;

export const usePanelStore = create<PanelStore>((set, get) => ({
  artifacts: [],
  render: () => null,
  extra: undefined,
  pendingDot: false,
  ghostTab: null,
  freshKeys: [],
  active: null,
  lastManualPick: 0,
  open: false,
  hidden: readHidden(),
  width: readWidth(),
  dragging: false,
  fresh: false,

  publish: (p) => set({
    artifacts: p.artifacts, render: p.render, extra: p.extra,
    pendingDot: !!p.pendingDot, ghostTab: p.ghostTab ?? null,
    freshKeys: p.freshKeys ?? [],
  }),
  // Сторінка пішла — панель порожніє. Активний ключ лишається: повернення на
  // ту саму сторінку відкриє ту саму вкладку.
  clear: () => set({ artifacts: [], render: () => null, extra: undefined, pendingDot: false, ghostTab: null, freshKeys: [], open: false }),
  // setActive/openArtifact — це завжди рука людини (вкладка в шапці панелі,
  // слід у стрічці, рядок міні-списку). Звідси й відлік «не перебивати».
  setActive: (key) => set({ active: key, lastManualPick: Date.now() }),
  openArtifact: (key) => {
    set({ active: key, lastManualPick: Date.now() });
    if (inFlow()) get().expand(); else set({ open: true });
    requestAnimationFrame(() => {
      document.getElementById(`rail-${key}`)?.scrollIntoView({ block: 'nearest' });
    });
  },
  collapse: () => {
    if (inFlow()) {
      set({ hidden: true });
      try { localStorage.setItem('kos-rail-hidden', '1'); } catch { /* ок */ }
    } else set({ open: false });
  },
  expand: () => {
    set({ hidden: false, fresh: false });
    try { localStorage.setItem('kos-rail-hidden', '0'); } catch { /* ок */ }
  },
  setOpen: (open) => set({ open }),
  setWidth: (px, persist = true) => {
    set({ width: px });
    if (persist) { try { localStorage.setItem('kos-rail-width', String(px)); } catch { /* ок */ } }
  },
  setDragging: (dragging) => set({ dragging }),
  setFresh: (fresh) => set({ fresh }),
  // Пул-9 №6: артефакт прийшов ходом — панель показує його. Раніше вона лише
  // ставила крапку, коли була згорнута, а `shownArtifact` лишався першим у
  // списку: новий рецепт із чату відкривався тільки руками.
  surfaceArtifact: (key) => {
    if (Date.now() - get().lastManualPick < MANUAL_PICK_GRACE_MS) {
      // Людина щойно обрала руками — не вириваємо. Лишається крапка.
      if (get().hidden) set({ fresh: true });
      return;
    }
    set({ active: key });
    if (get().hidden) get().expand();
  },
}));
