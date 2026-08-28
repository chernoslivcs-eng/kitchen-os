import type { HTMLAttributes, ReactNode } from 'react';
import styles from './MonoLabel.module.css';

type Tone = 'default' | 'pending' | 'applied' | 'anti' | 'danger' | 'muted';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
}

export function MonoLabel({ tone = 'default', className, children, ...rest }: Props) {
  const cls = [styles.label, tone !== 'default' ? styles[tone] : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <span className={cls} {...rest}>{children}</span>;
}
