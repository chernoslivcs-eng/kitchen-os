import { useEffect } from 'react';
import styles from './ActionState.module.css';
import { Icon } from '../Icon/Icon';
import { useIncidentStore } from '../../store/incident';
import { actionState, type ActionStateInput } from './state';

interface Props extends Pick<ActionStateInput, 'sending' | 'waited' | 'parsing' | 'nothingChanged' | 'cardConflict'> {
  onStop?: () => void;
  onRetry?: () => void;
  onRefresh?: () => void;
  /** Пул-9 №3: після LONG_WAIT — одна додаткова фраза, і більше жодної. */
  longWaitNote?: string | null;
}

/**
 * Рядок стану дії над композитором. Чотири стани з бандла (думаю · ліміт ·
 * мережа · нічого не змінилось) плюс конфлікт — лише для карток, де 409
 * існує (DEBT §34). Ліміт і мережа читаються з того самого стору, що й
 * смуги інцидентів; на стрічці цей рядок їх ЗАМІЩУЄ (смуги знають, що він
 * змонтований), на інших екранах смуги працюють як досі.
 */
export function ActionState({ sending, waited, parsing, nothingChanged, cardConflict, onStop, onRetry, onRefresh, longWaitNote }: Props) {
  const offline = useIncidentStore((s) => s.offline);
  const throttledUntil = useIncidentStore((s) => s.throttledUntil);
  const throttledKind = useIncidentStore((s) => s.throttledKind);
  const setRowMounted = useIncidentStore((s) => s.setActionRowMounted);
  useEffect(() => { setRowMounted(true); return () => setRowMounted(false); }, [setRowMounted]);

  const st = actionState({ sending, waited, parsing, offline, throttledUntil, throttledKind, nothingChanged, cardConflict });
  if (!st) return null;
  const act = st.action === 'stop' ? { label: 'Стоп', icon: 'sys.stop' as const, run: onStop }
    : st.action === 'retry' ? { label: 'Повторити', icon: 'sys.retry' as const, run: onRetry }
      : st.action === 'refresh' ? { label: 'Оновити', icon: 'sys.retry' as const, run: onRefresh }
        : null;
  return (
    <div data-action-state={st.kind} aria-live="polite">
      <div className={`${styles.row} ${styles[`tone-${st.tone}`]}`}>
        <span className={styles.icon}><Icon name={st.icon} size={16} inherit decorative /></span>
        {/* data-wait — контракт Пул-9 №3: годинник справжній, тест його читає. */}
        <span className={styles.text} {...(st.kind === 'thinking' ? { 'data-wait': true } : {})}>{st.text}</span>
        {act && act.run && (
          <button type="button" className={styles.action} onClick={act.run} data-action={st.action}>
            <Icon name={act.icon} size={12} inherit decorative />{act.label}
          </button>
        )}
      </div>
      {st.kind === 'thinking' && longWaitNote && <div className={styles.note} data-wait-long>{longWaitNote}</div>}
    </div>
  );
}
