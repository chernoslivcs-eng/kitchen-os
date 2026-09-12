// Оверлей перетягування — за Prototype v3.1 (FIXES-V3-2 №24a): один шар
// поверх стрічки, поки файл над вікном. Замість трьох станів Responsive
// D1–D3 (картка «Зараз прийму», чотири секунди, чіп над композитором).
// Курсор крізь нього не проходить (pointer-events: none) — ціль одна, куди
// б не кинув.

import { Icon } from '../Icon/Icon';
import styles from './DropOverlay.module.css';

export function DropOverlay() {
  return (
    <div className={styles.overlay} aria-hidden data-drop-overlay>
      <div className={styles.body}>
        {/* receipt 28 кадру — на шкалі словника 24 (IconSize). */}
        <Icon name="sys.receipt" size={24} inherit decorative />
        <span className={styles.title}>Кидай — розберу</span>
        <span className={styles.sub}>чек, фото полиці або текст</span>
      </div>
    </div>
  );
}
