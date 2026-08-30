// Журнал (окремий таб). Список того, що готували — з групуванням по дню,
// з міткою «скасовано» на undone-run-ах і хоткеєм повернутись у сам рецепт.
//
// Бриф §11: спогади саме тут — не в стрічці, не в профілі. Стрічка про сьогодні,
// цей таб — про «що ми вже їли». Але без соцмережевого блиску: тихий список.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type CookRunWithRecipe } from '../../api';
import { plural } from '../../lib/plural';
import styles from './CookLog.module.css';
import { TabBar } from '../../components/TabBar/TabBar';

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
  const [query, setQuery] = useState('');

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

  // Фільтр по назві рецепта — коли журнал переростає екран.
  const q = query.trim().toLowerCase();
  const filteredRuns = q
    ? runs.filter((r) => r.recipe.title.toLowerCase().includes(q))
    : runs;

  // Групуємо по дню; кожна група стає окремою секцією.
  const groups = new Map<string, CookRunWithRecipe[]>();
  for (const r of filteredRuns) {
    const day = (r.finished_at ?? r.started_at).slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(r);
  }

  const empty = !loading && runs.length === 0;

  // Лічильник у шапці — тільки активні готування; після undo кількість спадає
  // разом із weekly chip. undone-runs лишаються у списку із міткою «СКАСОВАНО».
  // QA8-13: лічильник рахував без скасованих, а список показував їх —
  // «0 ГОТУВАНЬ» над непорожнім списком. Рахуємо те, що видно.
  const activeCount = runs.length;

  // За тиждень: скільки готувань (не скасованих), середній рейтинг, скільки позицій
  // з комори реально пішло в їжу. Одна фраза, без графіків.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekRuns = runs.filter((r) => !r.undone_at && new Date(r.finished_at ?? r.started_at).getTime() >= weekAgo);
  const ratings = weekRuns.map((r) => r.rating).filter((x): x is number => x != null);
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;
  const pantryUsed = weekRuns.reduce(
    (n, r) => n + (r.changes?.batches.length ?? 0),
    0,
  );

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} aria-label="Назад" style={{ width: 38, height: 38, border: '1px solid var(--border-strong)', borderRadius: 10, background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 16 }}>←</button>
          <div className={styles.title}>Журнал</div>
        </div>
        <div className={styles.meta}>{activeCount} {plural(activeCount, ['ГОТУВАННЯ', 'ГОТУВАННЯ', 'ГОТУВАНЬ'])}</div>
      </div>

      <div className={styles.body}>
        {runs.length >= 8 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Знайти в журналі"
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              color: 'var(--fg)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              marginBottom: 4,
            }}
          />
        )}
        {empty && (
          <div className={styles.empty}>
            <h3>Ще нічого не готували</h3>
            <p>Приготуй першу страву — з&apos;явиться тут. Спогад про вечір, а не рецензія.</p>
          </div>
        )}
        {!empty && filteredRuns.length === 0 && query && (
          <div className={styles.empty} style={{ borderStyle: 'solid' }}>
            <p>Нічого не знайшлось за «{query}».</p>
          </div>
        )}

        {weekRuns.length > 0 && (
          <div style={{
            padding: '14px 16px',
            background: 'var(--bg-hover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            marginTop: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.06em',
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            lineHeight: 1.5,
          }}>
            <span style={{ color: 'var(--fg-dim)' }}>ЗА ТИЖДЕНЬ ·</span>{' '}
            <span style={{ color: 'var(--fg)' }}>{weekRuns.length} {plural(weekRuns.length, ['ГОТУВАННЯ', 'ГОТУВАННЯ', 'ГОТУВАНЬ'])}</span>
            {avgRating != null && <> · <span style={{ color: 'var(--accent)' }}>★{avgRating.toFixed(1)}</span></>}
            {pantryUsed > 0 && <> · <span style={{ color: 'var(--fg)' }}>{pantryUsed} З КОМОРИ</span></>}
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
                  <div key={r.id} style={{ position: 'relative' }}>
                    <button
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
                        {/* Папіркат UX-9: «ЗНОВУ ⟳» (absolute справа) наїжджав
                            на довгу назву — резервуємо їй місце. */}
                        <div className={`${styles.dish} ${undone ? styles.undone : ''}`} style={{ paddingRight: 86 }}>{r.recipe.title}</div>
                        <div className={styles.sub}>
                          {timeLabel(r.finished_at ?? r.started_at)}
                          {r.recipe.time_total && <> · {r.recipe.time_total}хв</>}
                          {r.rating != null && !undone && (
                            <> · <span className={styles.stat}>{'★'.repeat(r.rating)}<span style={{ opacity: 0.3 }}>{'★'.repeat(5 - r.rating)}</span></span></>
                          )}
                          {!undone && (deplete + partial > 0) && (
                            <> · <span className={styles.stat}>{deplete + partial} з комори</span></>
                          )}
                          {undone && <> · <span className={styles.stat + ' ' + styles.warn}>СКАСОВАНО</span></>}
                        </div>
                        {r.verdict && !undone && (
                          <div style={{
                            marginTop: 4,
                            fontFamily: 'var(--font-body)',
                            fontSize: 13,
                            color: 'var(--fg-muted)',
                            fontStyle: 'italic',
                          }}>
                            «{r.verdict}»
                          </div>
                        )}
                      </div>
                    </button>
                    {!undone && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          /* UX9-11: реюз рядка рецепта — «ЗНОВУ» не плодить дубль. */
                          navigate('/cook', { state: { recipe: r.recipe.payload, recipeId: r.recipe_id } });
                        }}
                        style={{
                          position: 'absolute',
                          top: 20, right: 0,
                          background: 'transparent',
                          border: '1px solid var(--border-strong)',
                          padding: '6px 12px',
                          borderRadius: 'var(--r-pill)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: 'var(--fg-muted)',
                          cursor: 'pointer',
                        }}
                        aria-label="Приготувати знову"
                      >
                        Знову ⟳
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Д03/Д06: на десктопі сайдбар є всюди, крім Cook Mode. */}
      <TabBar desktopOnly />
    </div>
  );
}
