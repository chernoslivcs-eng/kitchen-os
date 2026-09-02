import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

// V7 «один закон»: чотири рівні дії, одна геометрія.
//   primary   — чорнильна: незворотна дія або вихід із продукту. Одна на артефакт.
//   positive  — шавлієва заливка: головний перехід усередині продукту.
//   soft      — шавлієва тонована: важлива, але не єдина дія екрана.
//   text      — текстова: відкат і другорядне. НІКОЛИ не рамка: рамка = тонована.
type Variant = 'primary' | 'positive' | 'secondary' | 'soft' | 'text';
// strip — розмір смуги в низу панелі: 44px / radius 12 / 14px. Окремий, а не
// заміна md: 46px живуть по всьому застосунку, і V7 говорить про низ панелі,
// а не про кожну кнопку продукту.
type Size = 'md' | 'lg' | 'strip';

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
    size === 'strip' ? styles.strip : '',
    block ? styles.block : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {/* DA-08: кіт дає loading-стану власне копі — дія в процесі, не її назва. */}
      {loading ? 'Застосовую…' : children}
    </button>
  );
}
