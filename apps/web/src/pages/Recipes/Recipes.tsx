// Екран 07 «Рецепти» — бібліотека. Був у прототипі (RecipesView), у прод не
// доїхав: рецепт існував тільки як побічний ефект cook-run, і не приготувавши —
// зникав назавжди. QA-6 намацав це відчуттям «двічі отримав різото й обидва
// рази втратив».
//
// Форма — Screens D5 (v3): сегмент «Збережені · N / Журнал», «Записати свій»,
// фільтри пігулками з лічильниками, картка — знак страви, назва + слово стану
// в роді, рядок часу · калорій · «готував», під ним «бракує: …» і
// «використає: …». Стан рахує сервер проти поточної комори, тому список
// змінюється сам, коли щось купуєш: рецепт переїжджає з «далеко» в «можу
// зараз» без жодної дії. «Знайти рецепт» (кадр «Рецепти · 1440») — пошук
// по назві в уже принесеному списку: даних за ним рівно стільки, скільки на
// екрані, тож обіцянка чесна.
//
// 11.09: форма переведена на кадри Screens «Рецепти · 1440 / 390» (v3 бандл):
// картки на card+тінь у сітці 2×, шапка на картках, чипи без рамки.

import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { useNavigate } from 'react-router-dom';
import { api, type SavedRecipe } from '../../api';
import { plural } from '../../lib/plural';
import { formatDuration } from '@kitchen/domain/duration';
import styles from './Recipes.module.css';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { RecipesHead, SearchRow } from './RecipesHead';
import { FILTERS, filterCounts, matches, rank, statusWord, type Filter } from './library';
import { Toast } from '../../components/ErrorState/Toast';
import { RECIPES_FAILED } from '../../components/ErrorState/copy';

export function RecipesPage() {
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // На 390 поле пошуку ховається за круглим знаком у шапці (кадр «Рецепти · 390»).
  const [searchOpen, setSearchOpen] = useState(false);
  // Етап 5 (п.1): не принести ≠ порожньо. Раніше catch підставляв [] і екран
  // казав «Тут поки жодного рецепта» — Errors: «порожній екран каже „у тебе
  // нічого нема", і це брехня». Тепер — тост із повтором, список як був.
  const [loadFailed, setLoadFailed] = useState(false);

  async function refresh() {
    try {
      const r = await api.savedRecipes.list();
      setRecipes(r.recipes);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const needle = query.trim().toLocaleLowerCase('uk');
  const shown = recipes.filter((r) => matches(r, filter) && (!needle || r.title.toLocaleLowerCase('uk').includes(needle)));
  const sorted = [...shown].sort((a, b) => rank(a) - rank(b));
  const counts = filterCounts(recipes);

  // Моушн-кіт §03: прибраний рецепт згортається 250ms exit, а не щезає.
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  async function unsave(r: SavedRecipe) {
    // QA9-08: приготовані рядки теж можна прибрати — журнал не постраждає.
    const q = r.cooked_count > 0
      ? `Прибрати «${r.title}» з рецептів? Записи в журналі готувань лишаться.`
      : `Прибрати «${r.title}» з рецептів?`;
    if (!confirm(q)) return;
    setLeavingIds((prev) => new Set(prev).add(r.id));
    try {
      await Promise.all([api.savedRecipes.unsave(r.id), new Promise<void>((res) => window.setTimeout(res, 250))]);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLeavingIds((prev) => { const n = new Set(prev); n.delete(r.id); return n; });
    }
  }

  return (
    <div className={styles.screen}>
      {loadFailed && (
        <Toast tone="danger" text={RECIPES_FAILED.text} action={{ label: RECIPES_FAILED.cta, run: () => void refresh() }} />
      )}
      <RecipesHead tab="saved" savedCount={recipes.length} query={query} onQuery={setQuery} searchOpen={searchOpen} onSearchOpen={setSearchOpen} />

      <div className={styles.body}>
        {loading && <SkeletonRows rows={4} />}
        {/* №43: порожньо — та сама форма, що й контент: пунктирна картка на
            місці першої картки сітки (ліворуч), заголовок 16/600 + текст
            muted. Один патерн із Журналом. */}
        {!loading && !loadFailed && recipes.length === 0 && (
          <div className={styles.empty} data-empty>
            <h3>Тут поки жодного рецепта</h3>
            {/* UX9-20: кнопка в стрічці зветься «У рецепти» — підказка вчила
                неіснуючій назві. */}
            <p>
              Збережи рецепт — він почекає тут. Коли все потрібне зʼявиться вдома,
              сам нагадає про себе.
            </p>
          </div>
        )}

        {searchOpen && <SearchRow tab="saved" query={query} onQuery={setQuery} />}
        {recipes.length > 0 && (
          <div className={styles.filters}>
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={active}
                  className={`${styles.filter} ${active ? styles['filter-on'] : ''}`} data-filter={f.id}>
                  {f.id === 'ready' && <span className={`${styles['filter-dot']} ${styles.sage}`} aria-hidden />}
                  {f.id === 'near' && <span className={`${styles['filter-dot']} ${styles.amber}`} aria-hidden />}
                  {f.id === 'cooked' && <Icon name="sys.done" size={12} inherit decorative />}
                  {f.label}
                  <span className={styles['filter-n']} data-count>{counts[f.id]}</span>
                </button>
              );
            })}
            <span className={styles['filters-hint']}>спершу те, що можна зараз</span>
          </div>
        )}

        {!loading && recipes.length > 0 && sorted.length === 0 && (
          <div className={`${styles.empty} ${styles['empty-filter']}`}>
            <p>Тут нічого. Або фільтр суворий, або холодильник має інші плани.</p>
          </div>
        )}

        {/* Сітка 2× з 768 (кадр 1440: 652+12+652), одна колона на 390. */}
        <div className={styles.grid}>
        {sorted.map((r) => {
          const st = statusWord(r);
          return (
            <div key={r.id} className={`${styles.slot} ${leavingIds.has(r.id) ? styles['card-leave'] : ''}`}>
              <button
                className={`${styles.card} ${st.tone === 'far' ? styles['card-far'] : ''}`}
                data-status={r.status}
                /* Правка №10: рецепт — хід розмови. Тап відкриває сесію з
                   рецептом у чаті (близнюк реюзається на бекенді), не екран. */
                onClick={async () => {
                  try {
                    const { session } = await api.session.fresh(r.id);
                    navigate('/app', { state: { sessionId: session.id, at: Date.now() } });
                  } catch {
                    navigate(`/recipe/${r.id}`, { state: { recipe: r.payload } });
                  }
                }}
              >
                <span className={styles.icon}><Icon name="cook.type" size={20} inherit decorative /></span>
                <div className={styles.info}>
                  <span className={styles.dish}>{r.title}</span>

                  <div className={styles.sub}>
                    <span className={`${styles.status} ${styles[`status-${st.tone}`]}`}>
                      <span className={styles['status-dot']} aria-hidden />{st.text}
                    </span>
                    {r.time_total && <span className={styles.stat}><Icon name="cook.time" size={12} inherit decorative />{formatDuration(r.time_total)}</span>}
                    {r.payload.nu?.kcal && <span className={styles.stat}>≈ {r.payload.nu.kcal} ккал</span>}
                    {r.cooked_count > 0 && (
                      <span className={styles.stat}><Icon name="cook.done" size={12} inherit decorative />{r.cooked_count} {plural(r.cooked_count, ['раз', 'рази', 'разів'])}</span>
                    )}
                  </div>

                  {/* Найкорисніший рядок екрана: що саме докупити. */}
                  {r.missing.length > 0 && (
                    <div className={`${styles.line} ${styles['line-missing']}`}>
                      <Icon name="cook.missing" size={12} inherit decorative />бракує: {r.missing.join(', ')}
                    </div>
                  )}
                  {/* Чому саме зараз — те, що рецепт рятує з комори. */}
                  {r.rescues.length > 0 && (
                    <div className={`${styles.line} ${styles['line-rescues']}`}>
                      <Icon name="live.burning" size={12} inherit decorative />використає: {r.rescues.join(', ')}
                    </div>
                  )}
                </div>
              </button>

              {/* QA9-08: ✕ на КОЖНОМУ рядку — «готував, не зберіг» раніше
                  висів у бібліотеці назавжди без жодного способу прибрати. */}
              <button type="button" className={styles.remove}
                onClick={(e) => { e.stopPropagation(); void unsave(r); }}
                aria-label={`Прибрати «${r.title}» з рецептів`}
                title="Прибрати з рецептів"
              ><Icon name="sys.close" size={12} inherit /></button>
            </div>
          );
        })}
        </div>
      </div>

    </div>
  );
}
