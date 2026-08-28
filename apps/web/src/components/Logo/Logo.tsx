// Логотип — розірване кільце (◌ pending) + вузол (● applied).
// Це те саме, що в брифі: «система пропонує, людина замикає».
// Розмір і колір керуються ззовні через props/tokens.

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  variant?: 'default' | 'wordmark';
  className?: string;
  style?: CSSProperties;
}

export function Logo({ size = 44, variant = 'default', className, style }: Props) {
  const mark = (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle
        cx="24" cy="24" r="19"
        stroke="var(--fg)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="104 15"
        transform="rotate(-58 24 24)"
      />
      <circle cx="24" cy="24" r="6" fill="var(--accent)" />
    </svg>
  );
  if (variant === 'default') return <span className={className} style={style}>{mark}</span>;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        ...style,
      }}
    >
      {mark}
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: size * 0.55,
          letterSpacing: 'var(--tracking-tight)',
          color: 'var(--fg)',
          whiteSpace: 'nowrap',
        }}
      >
        Kitchen
        <span style={{ color: 'var(--accent)' }}> OS</span>
      </span>
    </span>
  );
}
