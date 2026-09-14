// KOS-TEST-REPORT п. 4: на iPhone затемнення без шторки і мертві тапи.
// Бекдропи (шухляда TabBar, скрім артефакта, Sheet) — plain div з React
// onClick. Safari iOS не піднімає click для делегованого слухача на
// «неклікабельному» елементі (без cursor: pointer) — тап у скрім ковтається,
// закрити нема чим. Тут одне правило на всі три: cursor: pointer + закриття
// по pointerup (дотик) і по click (миша/клавіатура), але рівно раз на дотик:
// після pointerup наступний click того самого дотику пропускаємо.
import { useRef, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';

const SAME_TAP_MS = 700;

export interface BackdropCloseProps {
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  style: CSSProperties;
}

export function useBackdropClose(onClose: () => void): BackdropCloseProps {
  const lastUp = useRef(0);
  return {
    onPointerUp: (e) => {
      if (e.target !== e.currentTarget || !e.isPrimary || e.button !== 0) return;
      lastUp.current = Date.now();
      onClose();
    },
    onClick: (e) => {
      if (e.target !== e.currentTarget) return;
      if (Date.now() - lastUp.current < SAME_TAP_MS) return;
      onClose();
    },
    style: { cursor: 'pointer' },
  };
}
