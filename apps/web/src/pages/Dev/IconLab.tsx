// Лабораторія знаків (лише DEV, /dev/icons) — для запису руху
// scripts/icon-motion-record.mjs --lab: 16 знаків Icon Motion v2 у двох
// носіях, як у застосунку: кнопка рейки 38/r10 зі знаком 18 (одна активна —
// чорнилом, щоб видно --frame під дверцятами) і кнопка-плитка 44/r12 зі
// знаком 20 на card. У продовому бандлі маршруту нема.
import { Icon } from '../../components/Icon/Icon';
import { MOTION, V2_DURATION, isV2 } from '../../components/Icon/motion';
import type { IconName } from '../../components/Icon/icons';

const KEYS = (Object.keys(MOTION) as (keyof typeof MOTION)[]).filter((k) => isV2(MOTION[k] as never)) as IconName[];

export function IconLab() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: 'var(--bg)', minHeight: '100vh', color: 'var(--ink)' }} data-icon-lab>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Icon Motion v2 · 16 знаків · рейка 18 · плитка 20</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', background: 'var(--card)', padding: 8, borderRadius: 12, width: 'max-content' }} data-lab-rail>
        {KEYS.map((k, i) => (
          <button key={k} type="button" data-lab={`rail:${MOTION[k as keyof typeof MOTION]}`} aria-current={i === 1 ? 'page' : undefined} title={k}
            style={{ width: 38, height: 38, borderRadius: 10, border: 0, background: i === 1 ? 'var(--ink)' : 'transparent', color: i === 1 ? 'var(--bg)' : 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden' }}>
            <Icon name={k} size={18} inherit decorative />
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 120px)', gap: 8 }} data-lab-tiles>
        {KEYS.map((k) => (
          <button key={k} type="button" data-lab={`tile:${MOTION[k as keyof typeof MOTION]}`} title={`${k} · ${V2_DURATION[MOTION[k as keyof typeof MOTION] as keyof typeof V2_DURATION]} мс`}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 14, border: 0, background: 'var(--card)', color: 'var(--ink)', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg)', color: 'var(--muted)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}><Icon name={k} size={20} inherit decorative /></span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{MOTION[k as keyof typeof MOTION]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
