// Журнал — вкладка Рецептів (Screens «Журнал · 1440»: «На проді Журнал —
// окремий маршрут без місця в навігації; він про „що ми вже їли“ — це рід
// Рецептів»). Та сама шапка, що в Рецептах: h1 · сегмент «Збережені · N /
// Журнал» · пошук «Знайти в журналі» (з 8 записів, як було).
//
// Бриф §11: спогади саме тут — не в стрічці, не в профілі. Без соцмережевого
// блиску: тихий список. Рядок готування — той самий, що в Cook Mode
// «маршрут»: коло-статус (галочка шавлією / фото 40 / undo при скасуванні),
// назва, рядок «час · тривалість · зірки · N з того, що було вдома», вердикт
// курсивом, «Знову» — контурна пігулка праворуч. Скасоване лишається на 50 %
// з перекресленою назвою і «скасовано — комора повернена».

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon/Icon';
import { api, type CookRunWithRecipe } from '../../api';
import { plural } from '../../lib/plural';
import { formatDuration } from '@kitchen/domain/duration';
import styles from './CookLog.module.css';
import rs from '../Recipes/Recipes.module.css';
import { useCookStore } from '../../store/cook';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';

const WEEKDAYS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (same(d, now)) return 'Сьогодні';
  if (same(d, yesterday)) return 'Вчора';
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Тривалість готування — від старту до кінця; поки не скінчилось — час рецепта. */
export function runMinutes(r: Pick<CookRunWithRecipe, 'started_at' | 'finished_at'> & { recipe: { time_total: number | null } }): number | null {
  if (r.finished_at) {
    const m = Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 60_000);
    if (m >= 1) return m;
  }
  return r.recipe.time_total;
}

/**
 * Оцінка — це ДАНІ, а не рядок символів: знаки Lucide, число в aria-label
 * (бандл: зірки бурштином, порожні на 30 %).
 */
function Rating({ value }: { value: number }) {
  return (
    <span className={styles.stars} role="img" aria-label={`${value} з 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="cook.rating" size={12} inherit decorative className={n <= value ? styles['star-on'] : styles['star-off']} />
      ))}
    </span>
  );
}

export function CookLogPage() {
  const navigate = useNavigate();
  const openNav = useNavStore((st) => st.setOpen);
  const cookOpen = useCookStore((s) => s.open);
  const [runs, setRuns] = useState<CookRunWithRecipe[]>([]);
  const [savedCount, setSavedCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [r, s] = await Promise.all([
          api.cookRuns.list().catch(() => ({ runs: [] as CookRunWithRecipe[] })),
          api.savedRecipes.list().catch(() => ({ recipes: [] })),
        ]);
        setRuns(r.runs);
        setSavedCount(s.recipes.length);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Пошук по назві — з 8 записів, як у коді (підпис кадра).
  const q = query.trim().toLowerCase();
  const searchable = runs.length >= 8;
  const filteredRuns = q ? runs.filter((r) => r.recipe.title.toLowerCase().includes(q)) : runs;

  const groups = new Map<string, CookRunWithRecipe[]>();
  for (const r of filteredRuns) {
    const day = (r.finished_at ?? r.started_at).slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(r);
  }

  const empty = !loading && runs.length === 0;

  // «За тиждень» — одне речення в картці, без графіків: N готувань ·
  // середня оцінка · N із дому.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekRuns = runs.filter((r) => !r.undone_at && new Date(r.finished_at ?? r.started_at).getTime() >= weekAgo);
  const ratings = weekRuns.map((r) => r.rating).filter((x): x is number => x != null);
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;
  const pantryUsed = weekRuns.reduce((n, r) => n + (r.changes?.batches.length ?? 0), 0);
  const weekTail = [
    avgRating != null ? `Середня оцінка ${avgRating.toFixed(1).replace('.', ',')}` : '',
    pantryUsed > 0 ? `${pantryUsed} ${plural(pantryUsed, ['позиція', 'позиції', 'позицій'])} із того, що було вдома` : '',
  ].filter(Boolean).join(' · ');

  const openRun = async (r: CookRunWithRecipe) => {
    // Правка №11: запис журналу веде в СЕСІЮ, де рецепт народився.
    try {
      let sid = r.session_id ?? null;
      if (!sid) sid = (await api.session.findByRecipe(r.recipe_id)).session_id;
      if (!sid) sid = (await api.session.fresh(r.recipe_id)).session.id;
      navigate('/app', { state: { sessionId: sid, at: Date.now() } });
    } catch {
      navigate('/recipe', { state: { recipe: r.recipe.payload } });
    }
  };

  return (
    <div className={styles.screen}>
      <AppHeader title="Рецепти" onMenu={() => openNav(true)} fill action={<>
          <div className={rs.segment} role="tablist">
            <button type="button" role="tab" aria-selected="false" className={rs.seg} onClick={() => navigate('/recipes')}>
              Збережені{savedCount > 0 && <span className={rs['seg-n']}>· {savedCount}</span>}
            </button>
            <span role="tab" aria-selected="true" className={`${rs.seg} ${rs['seg-on']}`}>Журнал</span>
          </div>
          <span className={rs['head-gap']} />
          {searchable && (
            <label className={rs.search} data-search>
              <Icon name="sys.search" size={16} inherit decorative />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Знайти в журналі" aria-label="Знайти в журналі" />
            </label>
          )}
          {searchable && (
            <button type="button" className={`${rs['head-icon']} ${rs['head-search']}`} aria-label="Знайти в журналі" aria-pressed={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}>
              <Icon name="sys.search" size={16} inherit decorative />
            </button>
          )}
          <button type="button" className={rs['head-icon']} aria-label="Збережені" title="Збережені" onClick={() => navigate('/recipes')}>
            <Icon name="sys.recipes" size={16} inherit decorative />
          </button>
      </>} />

      <div className={styles.body}>
        {searchable && searchOpen && (
          <label className={`${rs.search} ${rs['search-row']}`} data-search-row>
            <Icon name="sys.search" size={16} inherit decorative />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Знайти в журналі" aria-label="Знайти в журналі" autoFocus />
          </label>
        )}
        {loading && <SkeletonRows rows={4} />}
        {empty && (
          <div className={styles.empty}>
            <h3>Тут ще тихо</h3>
            <p>Перша приготовлена страва зʼявиться тут — не для оцінок, щоб потім згадати, що взагалі було смачно.</p>
          </div>
        )}
        {!empty && filteredRuns.length === 0 && query && (
          <div className={styles.empty}><p>За «{query}» нічого.</p></div>
        )}

        {weekRuns.length > 0 && (
          /* Картка «За тиждень» (Screens): знак у шавлієвому квадраті 36 r10,
             одне речення — жирна частина і muted хвіст. */
          <div className={styles.week} data-testid="week">
            <span className={styles['week-icon']}><Icon name="sys.calendar" size={16} inherit decorative /></span>
            <span className={styles['week-text']}>
              <b>За тиждень — {weekRuns.length} {plural(weekRuns.length, ['готування', 'готування', 'готувань'])}.</b>
              {weekTail && <span className={styles['week-tail']}> {weekTail}.</span>}
            </span>
          </div>
        )}

        {[...groups.entries()].map(([day, list]) => {
          const isoInDay = list[0]?.finished_at ?? list[0]?.started_at ?? day;
          return (
            <div key={day} className={styles.group} data-day={day}>
              <span className={styles.day}>{dayLabel(isoInDay)}</span>
              <div className={styles.card}>
                {list.map((r) => {
                  const used = r.changes?.batches.length ?? 0;
                  const undone = !!r.undone_at;
                  const minutes = runMinutes(r);
                  return (
                    <div key={r.id} className={`${styles.row} ${undone ? styles['row-undone'] : ''}`} data-run={r.id}>
                      <button type="button" className={styles['row-main']} onClick={() => void openRun(r)}>
                        {r.photo_url && !undone ? (
                          <img src={r.photo_url} alt="" className={styles.photo} />
                        ) : (
                          <span className={`${styles.mark} ${undone ? styles['mark-undone'] : styles['mark-done']}`}>
                            <Icon name={undone ? 'sys.undo' : 'sys.done'} size={16} inherit decorative />
                          </span>
                        )}
                        <span className={styles.info}>
                          <span className={`${styles.dish} ${undone ? styles['dish-undone'] : ''}`}>{r.recipe.title}</span>
                          <span className={styles.sub}>
                            <span>{timeLabel(r.finished_at ?? r.started_at)}</span>
                            {undone ? (
                              <><span>·</span><span>скасовано — комора повернена</span></>
                            ) : (
                              <>
                                {minutes != null && <><span>·</span><span>{formatDuration(minutes)}</span></>}
                                {r.rating != null && <><span>·</span><Rating value={r.rating} /></>}
                                {used > 0 && <><span>·</span><span>{used} з того, що було вдома</span></>}
                              </>
                            )}
                          </span>
                          {r.verdict && !undone && <span className={styles.verdict}>«{r.verdict}»</span>}
                        </span>
                      </button>
                      {!undone && (
                        <button
                          type="button"
                          className={styles.again}
                          onClick={() => cookOpen({ recipe: r.recipe.payload, recipeId: r.recipe_id })}
                          aria-label="Приготувати знову"
                        >
                          <Icon name="cook.done" size={12} inherit decorative /><span className={styles['again-text']}>Знову</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
