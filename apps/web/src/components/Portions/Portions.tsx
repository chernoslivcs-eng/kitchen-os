// Порційник (Screens «Рецепт»): пілюля на bg «− 2 порції +». Був лише на
// /recipe/:id; з 14.09 (рішення власника) живе і в панелі рецепта в чаті —
// один компонент, вигляд і межі 1..12 спільні.
import { Icon } from '../Icon/Icon';
import { plural } from '../../lib/plural';
import styles from './Portions.module.css';

export const PORTIONS_MIN = 1;
export const PORTIONS_MAX = 12;

export function Portions({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <span className={styles.portions} role="group" aria-label="Порції" data-portions>
      <button type="button" aria-label="Менше порцій" disabled={value <= PORTIONS_MIN} onClick={() => onChange(Math.max(PORTIONS_MIN, value - 1))}><Icon name="sys.less" size={12} inherit decorative /></button>
      {/* <768 (власник 14.09): лише число — слово ховає CSS, aria-label групи каже, що це порції. */}
      <span className={styles.n}>{value}<span className={styles.word}> {plural(value, ['порція', 'порції', 'порцій'])}</span></span>
      <button type="button" aria-label="Більше порцій" disabled={value >= PORTIONS_MAX} onClick={() => onChange(Math.min(PORTIONS_MAX, value + 1))}><Icon name="sys.add" size={12} inherit decorative /></button>
    </span>
  );
}
