// Журнал (окремий таб). Список того, що готували — з групуванням по дню,
// з міткою «скасовано» на undone-run-ах і хоткеєм повернутись у сам рецепт.
//
// Бриф §11: спогади саме тут — не в стрічці, не в профілі. Стрічка про сьогодні,
// цей таб — про «що ми вже їли». Але без соцмережевого блиску: тихий список.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type CookRunWithRecipe } from '../../api';
import { TabBar } from '../../components/TabBar/TabBar';
import styles from './CookLog.module.css';

const WEEKDAYS = ['НД', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const MONTHS = ['СІЧ', 'ЛЮТ', 'БЕР', 'КВІ', 'ТРА', 'ЧЕР', 'ЛИП', 'СЕР', 'ВЕР', 'ЖОВ', 'ЛИС', 'ГРУ'];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(d, today)) return 'СЬОГОДНІ';
  if (same(d, yesterday)) return 'ВЧОРА';
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function CookLogPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<CookRunWithRecipe[]>([]);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, s] = await Promise.all([
          api.cookRuns.list().catch(() => ({ runs: [] as CookRunWithRecipe[] })),
          api.shopping.list().catch(() => ({ count: 0 })),
        ]);
        setRuns(r.runs);
        setShoppingCount(s.count);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Групуємо по дню; кожна група стає окремою секцією.
  const groups = new Map<string, CookRunWithRecipe[]>();
  for (const r of runs) {
    const day = (r.finished_at ?? r.started_at).slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(r);
  }

  const empty = !loading && runs.length === 0;

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.title}>Журнал</div>
        <div className={styles.meta}>{runs.length} {runs.length === 1 ? 'ГОТУВАННЯ' : 'ГОТУВАНЬ'}</div>
      </div>

      <div className={styles.body}>
        {empty && (
          <div className={styles.empty}>
            <h3>Ще нічого не готували</h3>
            <p>Приготуй перше блюдо — з&apos;явиться тут. Спогад про вечір, а не рецензія.</p>
          </div>
        )}

        {[...groups.entries()].map(([day, list]) => {
          const isoInDay = list[0]?.finished_at ?? list[0]?.started_at ?? day;
          return (
            <div key={day}>
              <div className={styles.day}>{dayLabel(isoInDay)}</div>
              {list.map((r) => {
                const partial = r.changes?.batches.filter((c) => c.op === 'subtract').length ?? 0;
                const deplete = r.changes?.batches.filter((c) => c.op === 'deplete').length ?? 0;
                const undone = !!r.undone_at;
                return (
                  <button
                    key={r.id}
                    className={styles.card}
                    onClick={() => navigate('/recipe', { state: { recipe: r.recipe.payload } })}
                  >
                    {r.photo_url && !undone ? (
                      <img
                        src={r.photo_url}
                        alt=""
                        style={{
                          width: 46, height: 46, borderRadius: 'var(--r)',
                          objectFit: 'cover', flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div className={`${styles.icon} ${undone ? styles.undone : ''}`}>
                        {undone ? '↩' : '✓'}
                      </div>
                    )}
                    <div className={styles.info}>
                      <div className={`${styles.dish} ${undone ? styles.undone : ''}`}>{r.recipe.title}</div>
                      <div className={styles.sub}>
                        {timeLabel(r.finished_at ?? r.started_at)}
                        {r.recipe.time_total && <> · {r.recipe.time_total}хв</>}
                        {!undone && (deplete + partial > 0) && (
                          <> · <span className={styles.stat}>{deplete + partial} з комори</span></>
                        )}
                        {undone && <> · <span className={styles.stat + ' ' + styles.warn}>СКАСОВАНО</span></>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <TabBar shoppingCount={shoppingCount} />
    </div>
  );
}
