// Власник 15.09, BETA-PLAN-0915: таблиця «Бета» — рядок на людину, сім справ
// лічильниками; сортування за останнім візитом (сервер). Щільність адмінська,
// як у Пульсі; токени продукту, обидві теми.
import { useEffect, useState } from 'react';
import { api, type AdminBetaRow } from '../../api';
import styles from './Pulse.module.css';
import own from './Beta.module.css';

const SOURCE_WORD: Record<AdminBetaRow['source'], string> = { telegram: 'Telegram', email: 'пошта', google: 'Google' };
const CHANNEL_WORD = { telegram: 'Telegram', web: 'веб' } as const;

function day(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

export function BetaPage() {
  const [data, setData] = useState<{ rows: AdminBetaRow[]; thresholds: { pantry: number; profile: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.admin.beta().then((d) => { if (alive) setData(d); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  const mark = (ok: boolean, n?: number) => (
    <span className={ok ? own.ok : own.no}>{ok ? '✓' : '—'}{n != null && n > 0 ? <span className={styles.dim}> {n}</span> : null}</span>
  );
  return (
    <div className={styles.page} data-admin-beta>
      <div className={styles.head}>
        <h1 className={styles.title}>Бета</h1>
        <span className={styles.dim}>сім справ · рядок на людину · без адмінських домів</span>
      </div>
      {error && <div className={styles.empty}>{error}</div>}
      {data && data.rows.length === 0 && <div className={styles.empty}>Тестерів ще нема — ніхто не натиснув Start.</div>}
      {data && data.rows.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table} data-beta-table>
            <thead>
              <tr>
                <th>Людина</th><th>Start</th><th>Комора ≥{data.thresholds.pantry}</th><th>Профіль ≥{data.thresholds.profile}</th>
                <th>«Що на вечерю»</th><th>Приготував</th><th>Відгук</th><th>Подія</th><th>Запросив</th><th>Сільпо</th><th>Останній візит</th><th>Днів/7</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.user_id} data-beta-row data-user={r.user_id}>
                  <td>
                    <div>{r.name}</div>
                    <div className={styles.dim}>{r.email ?? (r.telegram_user_id != null ? `tg · ${r.telegram_user_id}` : '')}</div>
                  </td>
                  <td className={styles.mono} data-col="start">{day(r.started_at)}<div className={styles.dim}>{SOURCE_WORD[r.source]}</div></td>
                  <td className={styles.mono} data-col="pantry" data-ok={String(r.pantry_ok)}>{mark(r.pantry_ok, r.pantry)}</td>
                  <td className={styles.mono} data-col="profile" data-ok={String(r.profile_ok)}>{mark(r.profile_ok, r.profile_filled)}</td>
                  <td className={styles.mono} data-col="dinner">{mark(r.dinner_asks > 0, r.dinner_asks)}</td>
                  <td className={styles.mono} data-col="cooks">{mark(r.cooks > 0, r.cooks)}</td>
                  <td className={styles.mono} data-col="feedback">{mark(r.feedback > 0, r.feedback)}</td>
                  <td className={styles.mono} data-col="periods">{mark(r.periods > 0, r.periods)}</td>
                  <td className={styles.mono} data-col="invites">{mark(r.invites > 0, r.invites)}</td>
                  <td className={styles.mono} data-col="silpo">{mark(r.silpo)}</td>
                  <td className={styles.mono} data-col="last">{day(r.last_seen_at)}{r.last_channel && <div className={styles.dim}>{CHANNEL_WORD[r.last_channel]}</div>}</td>
                  <td className={styles.mono} data-col="days">{r.active_days_7}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
