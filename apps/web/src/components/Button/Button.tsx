import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'positive' | 'secondary';
type Size = 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  disabled,
  children,
  className,
  ...rest
}: Props) {
  const cls = [
    styles.btn,
    styles[variant],
    size === 'lg' ? styles.large : '',
    block ? styles.block : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
