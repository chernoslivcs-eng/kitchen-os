// FIXES-V3-2 №35: один механізм закриття шторки змахом — для всіх шторок
// (Sheet, шторка артефакта, «Дім зараз», шторка кроків Cook). Обробники
// вішаються ЛИШЕ на грабер і шапку: скрол усередині шторки не перехоплюється.
// Поріг — 80 px або швидкість > 0.5 px/мс з ходом > 20 px.
//
// fix/sheet-drag-jump (13.09): під час жесту міняється лише translateY —
// анімація входу знімається першим дотиком (інакше keyframe перекриває
// inline-transform і шторка стрибає, коли анімація добігає), transition
// вимкнена, will-change лише на час жесту; після відпускання — повернення
// або вихід за --dur-fast з поточної точки (раніше шторка стрибала в 0 і
// лише тоді їхала вниз keyframe-анімацією виходу).
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

export const SHEET_CLOSE_PX = 80;
const SHEET_CLOSE_VELOCITY = 0.5; // px/мс
const SHEET_MIN_TRAVEL = 20;
/** Стільки триває повернення/вихід (= --dur-fast); onClose — після нього. */
export const SHEET_SETTLE_MS = 160;

type Phase = 'idle' | 'dragging' | 'settling' | 'leaving';

export interface SheetDrag {
  /** Зсув панелі вниз під час жесту, px. */
  dragY: number;
  dragging: boolean;
  /** Шторка вже поїхала вниз за порогом — той, хто її малює, не має грати свій вихід. */
  leaving: boolean;
  /** На грабер і шапку. */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  /** На панель: зсув за пальцем без переходу; повернення й вихід — за --dur-fast. */
  panelStyle: CSSProperties | undefined;
}

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useSheetDrag(onClose: () => void, enabled = true): SheetDrag {
  const [dragY, setDragY] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const start = useRef<{ y: number; t: number } | null>(null);
  const timer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const end = (e: ReactPointerEvent<HTMLElement>, cancel = false) => {
    const st = start.current;
    if (!st) return;
    start.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
    const dy = Math.max(0, e.clientY - st.y);
    const v = dy / Math.max(1, Date.now() - st.t);
    const instant = reduced();
    if (!cancel && (dy >= SHEET_CLOSE_PX || (v > SHEET_CLOSE_VELOCITY && dy > SHEET_MIN_TRAVEL))) {
      setPhase('leaving');
      if (instant) { onCloseRef.current(); return; }
      timer.current = window.setTimeout(() => { timer.current = null; onCloseRef.current(); }, SHEET_SETTLE_MS);
      return;
    }
    setDragY(0);
    if (dy === 0 || instant) { setPhase('idle'); return; }
    setPhase('settling');
    timer.current = window.setTimeout(() => { timer.current = null; setPhase('idle'); }, SHEET_SETTLE_MS + 20);
  };

  const ease = 'var(--ease-standard, ease)';
  const dur = `var(--dur-fast, ${SHEET_SETTLE_MS}ms)`;
  const gesture: CSSProperties = { animation: 'none', willChange: 'transform' };
  const panelStyle: CSSProperties | undefined =
    phase === 'dragging' ? { ...gesture, transform: `translateY(${dragY}px)`, transition: 'none' }
    : phase === 'settling' ? { ...gesture, transform: 'translateY(0px)', transition: `transform ${dur} ${ease}` }
    : phase === 'leaving' ? { ...gesture, transform: 'translateY(110%)', transition: `transform ${dur} var(--ease-exit, ease)` }
    : undefined;

  return {
    dragY,
    dragging: phase === 'dragging',
    leaving: phase === 'leaving',
    handleProps: {
      onPointerDown: (e) => {
        if (!enabled || phase === 'leaving' || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
        start.current = { y: e.clientY, t: Date.now() };
        setDragY(0);
        setPhase('dragging');
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
      },
      onPointerMove: (e) => { if (start.current) setDragY(Math.max(0, e.clientY - start.current.y)); },
      onPointerUp: (e) => end(e),
      onPointerCancel: (e) => end(e, true),
      style: { touchAction: 'none', cursor: enabled ? 'grab' : undefined },
    },
    panelStyle,
  };
}
