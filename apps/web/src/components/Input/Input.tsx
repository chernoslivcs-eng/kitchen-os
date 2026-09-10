import type { InputHTMLAttributes } from 'react';
import styles from './Input.module.css';
import { Icon } from '../Icon/Icon';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  error?: string | null;
}

export function Input({ error, className, ...rest }: Props) {
  return (
    <div className={`${styles.wrap} ${error ? styles.error : ''}`}>
      <input className={`${styles.input} ${className ?? ''}`} aria-invalid={!!error} {...rest} />
      {error && <span className={styles.errmsg}><Icon name="sys.close" size={12} inherit decorative /> {error}</span>}
    </div>
  );
}
