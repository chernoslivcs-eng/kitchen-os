// Логотип — розірване кільце (◌ pending) + вузол (● applied).
// Це те саме, що в брифі: «система пропонує, людина замикає».
// Розмір і колір керуються ззовні через props/tokens.
//
// 12.09 (ANSWERS E13): екран помилки (Errors E1) не малює власне кільце —
// це той самий знак з іншим розривом: `gap` ширший (90° проти 45°), розрив
// стоїть угорі праворуч, а вузол бере колір роду (`core`). Один компонент,
// два параметри; крапка й штрих масштабуються з розміром (viewBox 48:
// штрих 3 → 4 px при 64, вузол r6 → 16 px).

import type { CSSProperties, Ref } from 'react';

interface Props {
  size?: number;
  variant?: 'default' | 'wordmark';
  className?: string;
  style?: CSSProperties;
  /** Крок Д1: зона перетягування анімує вузол окремо від кільця (він дихає). */
  coreRef?: Ref<SVGCircleElement>;
  /** Розрив кільця в градусах; логотип — 45, екран помилки — 90. */
  gap?: number;
  /** Де розрив починається (градуси за годинниковою від 3-ї години); логотип −103 (≈ 12-та), помилка −90. */
  gapStart?: number;
  /** Колір вузла — рід (var(--sage) за замовчуванням; на екрані помилки — danger/amber/sage/dim). */
  core?: string;
}

const R = 19;
const CIRC = 2 * Math.PI * R;

export function Logo({ size = 44, variant = 'default', className, style, coreRef, gap = 45, gapStart = -103, core = 'var(--sage)' }: Props) {
  const gapLen = (CIRC * gap) / 360;
  const mark = (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" data-ring-gap={gap}>
      <circle
        cx="24" cy="24" r={R}
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(CIRC - gapLen).toFixed(1)} ${gapLen.toFixed(1)}`}
        transform={`rotate(${gapStart + gap} 24 24)`}
      />
      <circle ref={coreRef} cx="24" cy="24" r="6" fill={core} style={{ transformOrigin: '24px 24px' }} />
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
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
        }}
      >
        Kitchen
        <span style={{ color: 'var(--sage)' }}> OS</span>
      </span>
    </span>
  );
}
