// FIXES-V3-2 №35: один механізм закриття шторки змахом — для всіх шторок
// (Sheet, шторка артефакта, «Дім зараз», шторка кроків Cook). Обробники
// вішаються ЛИШЕ на грабер і шапку: скрол усередині шторки не перехоплюється.
// Поріг — 80 px або швидкість > 0.5 px/мс з ходом > 20 px; не дотягнув —
// шторка пружинить назад (transition панелі). Тап по скриму закриває той,
// хто малює скрим.
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

export const SHEET_CLOSE_PX = 80;
const SHEET_CLOSE_VELOCITY = 0.5; // px/мс
const SHEET_MIN_TRAVEL = 20;

export interface SheetDrag {
  /** Зсув панелі вниз під час жесту, px. */
  dragY: number;
  dragging: boolean;
  /** На грабер і шапку. */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  /** На панель: зсув за пальцем без переходу, повернення — з переходом. */
  panelStyle: CSSProperties | undefined;
}

export function useSheetDrag(onClose: () => void, enabled = true): SheetDrag {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);

  const end = (e: ReactPointerEvent<HTMLElement>, cancel = false) => {
    const st = start.current;
    if (!st) return;
    start.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
    const dy = Math.max(0, e.clientY - st.y);
    const v = dy / Math.max(1, Date.now() - st.t);
    setDragging(false);
    if (!cancel && (dy >= SHEET_CLOSE_PX || (v > SHEET_CLOSE_VELOCITY && dy > SHEET_MIN_TRAVEL))) { onClose(); return; }
    setDragY(0);
  };

  return {
    dragY,
    dragging,
    handleProps: {
      onPointerDown: (e) => {
        if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
        start.current = { y: e.clientY, t: Date.now() };
        setDragging(true);
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
      },
      onPointerMove: (e) => { if (start.current) setDragY(Math.max(0, e.clientY - start.current.y)); },
      onPointerUp: (e) => end(e),
      onPointerCancel: (e) => end(e, true),
      style: { touchAction: 'none', cursor: enabled ? 'grab' : undefined },
    },
    panelStyle: dragY > 0
      ? { transform: `translateY(${dragY}px)`, transition: dragging ? 'none' : undefined }
      : undefined,
  };
}
