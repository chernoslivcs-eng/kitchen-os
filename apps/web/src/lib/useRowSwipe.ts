// 12.09 (ANSWERS §8): на тачі ✕ у рядку комори постійно не показується —
// свайп рядка вліво відкриває «Списати». Один відкритий рядок за раз; тап по
// тілу відкритого рядка закриває його замість того, щоб відкрити картку.
// Реагує лише на touch (pointerType): миша й так має ховер.
import { useCallback, useRef, useState } from 'react';

export const SWIPE_OPEN_PX = 48;

export interface RowSwipe {
  openId: string | null;
  /** Пропси на тіло рядка з ідентифікатором. */
  handlers: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
  /** Чи тап по тілу треба проковтнути (рядок був відкритий — закрили). */
  swallowTap: (id: string) => boolean;
  close: () => void;
}

export function useRowSwipe(): RowSwipe {
  const [openId, setOpenId] = useState<string | null>(null);
  const start = useRef<{ id: string; x: number; y: number; horizontal: boolean | null } | null>(null);
  const justClosed = useRef<string | null>(null);

  const onPointerDown = useCallback((id: string, e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    start.current = { id, x: e.clientX, y: e.clientY, horizontal: null };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current; if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.horizontal == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.horizontal = Math.abs(dx) > Math.abs(dy);
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = start.current; start.current = null; if (!s) return;
    const dx = e.clientX - s.x;
    if (s.horizontal && dx <= -SWIPE_OPEN_PX) { setOpenId(s.id); return; }
    if (s.horizontal && dx >= SWIPE_OPEN_PX) { setOpenId((o) => (o === s.id ? null : o)); return; }
  }, []);
  const onPointerCancel = useCallback(() => { start.current = null; }, []);

  const handlers = useCallback((id: string) => ({
    onPointerDown: (e: React.PointerEvent) => onPointerDown(id, e),
    onPointerMove, onPointerUp, onPointerCancel,
  }), [onPointerDown, onPointerMove, onPointerUp, onPointerCancel]);

  const swallowTap = useCallback((id: string) => {
    if (openId === id) { setOpenId(null); justClosed.current = id; return true; }
    if (openId) { setOpenId(null); }
    return false;
  }, [openId]);

  return { openId, handlers, swallowTap, close: () => setOpenId(null) };
}
