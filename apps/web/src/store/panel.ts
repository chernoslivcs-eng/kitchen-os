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
}

export const RAIL_IN_FLOW = '(min-width: 1200px)';
export const RAIL_MIN = 280;
export const RAIL_MAX = 560;
export const RAIL_DEFAULT = 320;

interface PanelStore extends PanelPublication {
  active: string | null;
  /** Шторка на <1200 відкрита. */
  open: boolean;
  /** Панель у потоці згорнута до смуги 52px (персистентно). */
  hidden: boolean;
  width: number;
  dragging: boolean;
  /** Зʼявився новий артефакт, поки панель згорнута. */
  fresh: boolean;

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
}

function readHidden(): boolean {
  try { return localStorage.getItem('kos-rail-hidden') === '1'; } catch { return false; }
}
function readWidth(): number {
  try {
    const v = Number(localStorage.getItem('kos-rail-width'));
    return Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX ? v : RAIL_DEFAULT;
  } catch { return RAIL_DEFAULT; }
}
const inFlow = () => typeof window !== 'undefined' && window.matchMedia(RAIL_IN_FLOW).matches;

export const usePanelStore = create<PanelStore>((set, get) => ({
  artifacts: [],
  render: () => null,
  extra: undefined,
  pendingDot: false,
  ghostTab: null,
  active: null,
  open: false,
  hidden: readHidden(),
  width: readWidth(),
  dragging: false,
  fresh: false,

  publish: (p) => set({ artifacts: p.artifacts, render: p.render, extra: p.extra, pendingDot: !!p.pendingDot, ghostTab: p.ghostTab ?? null }),
  // Сторінка пішла — панель порожніє. Активний ключ лишається: повернення на
  // ту саму сторінку відкриє ту саму вкладку.
  clear: () => set({ artifacts: [], render: () => null, extra: undefined, pendingDot: false, ghostTab: null, open: false }),
  setActive: (key) => set({ active: key }),
  openArtifact: (key) => {
    set({ active: key });
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
}));
