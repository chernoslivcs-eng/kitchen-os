// Екран 07 «Рецепти» — бібліотека. Був у прототипі (RecipesView), у прод не
// доїхав: рецепт існував тільки як побічний ефект cook-run, і не приготувавши —
// зникав назавжди. QA-6 намацав це відчуттям «двічі отримав різото й обидва
// рази втратив».
//
// Фільтри — з прототипу: «Можу зараз» (ready) / «Майже» (near) / «Готував».
// Стан рахує сервер проти поточної комори, тому список змінюється сам, коли
// щось купуєш: рецепт переїжджає з «далеко» в «можу зараз» без жодної дії.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SavedRecipe } from '../../api';
import { plural } from '../../lib/plural';
import styles from './Recipes.module.css';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { useAuth } from '../../store/auth';

type Filter = 'all' | 'ready' | 'near' | 'cooked';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Усі' },
  { id: 'ready', label: 'Можу приготувати зараз' },
  { id: 'near', label: 'Майже' },
  { id: 'cooked', label: 'Готував' },
];

function statusChip(r: SavedRecipe): { text: string; color: string; bg: string; border: string } {
  if (r.status === 'ready') {
    return { text: 'МОЖУ ЗАРАЗ', color: 'var(--accent)', bg: 'var(--accent-bg)', border: 'var(--accent)' };
  }
  if (r.status === 'near') {
    return { text: `−${r.missing.length}`, color: 'var(--amber)', bg: 'var(--amber-bg)', border: 'var(--amber-border)' };
  }
  return { text: `${r.have} З ${r.total}`, color: 'var(--fg-dim)', bg: 'transparent', border: 'var(--border-strong)' };
}

export function RecipesPage() {
  const openNav = useNavStore((st) => st.setOpen);
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [shoppingCount, setShoppingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  async function refresh() {
    try {
      const [r, s] = await Promise.all([
        api.savedRecipes.list().catch(() => ({ recipes: [] as SavedRecipe[] })),
        api.shopping.list().catch(() => ({ count: 0 })),
      ]);
      setRecipes(r.recipes);
      setShoppingCount(s.count);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const shown = recipes.filter((r) => {
    if (filter === 'ready') return r.status === 'ready';
    if (filter === 'near') return r.status === 'near';
    if (filter === 'cooked') return r.cooked_count > 0;
    return true;
  });

  // Порядок як у прототипі: спершу те, що можна робити зараз.
  const rank = (r: SavedRecipe) => (r.status === 'ready' ? 0 : r.status === 'near' ? 1 : 2);
  const sorted = [...shown].sort((a, b) => rank(a) - rank(b));

  const readyCount = recipes.filter((r) => r.status === 'ready').length;

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
      <AppHeader title="Рецепти" onMenu={() => openNav(true)} action={<>
          {/* DA2-22, Р-2 варіант 2: точка входу там, де її шукають, а канал
              лишається один — чат. Префікс «Запиши мій рецепт:» заодно дає
              моделі явний сигнал на recipe-картку (DA2-23). */}
          <button
            onClick={() => navigate('/app', { state: { composePrefix: 'Запиши мій рецепт: ' } })}
            style={{
              background: 'transparent', border: 0, padding: '5px 4px',
              color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11,
              letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            + Імпорт
          </button>
          <button
            onClick={() => navigate('/cooklog')}
            style={{
              background: 'transparent', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)', padding: '5px 10px', color: 'var(--fg-muted)',
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
              textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            ✎ Журнал
          </button>
          <div className={styles.meta}>
            {readyCount > 0
              ? `${readyCount} МОЖУ ЗАРАЗ`
              : `${recipes.length} ${plural(recipes.length, ['РЕЦЕПТ', 'РЕЦЕПТИ', 'РЕЦЕПТІВ'])}`}
          </div>
      </>} />

      <div className={styles.body}>
        {loading && <SkeletonRows rows={4} />}
        {!loading && recipes.length === 0 && (
          <div className={styles.empty}>
            <h3>Тут поки жодного рецепта</h3>
            {/* UX9-20: кнопка в стрічці зветься «У рецепти» — підказка вчила
                неіснуючій назві. */}
            <p>
              Збережи рецепт — він почекає тут. Коли все потрібне зʼявиться вдома,
              сам нагадає про себе.
            </p>
          </div>
        )}

        {recipes.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  style={{
                    // Канон Бриф-2 5б: активний фільтр — інверсна пігулка,
                    // шавлія лишається для семантики (МОЖУ ЗАРАЗ), не для стану.
                    height: 32,
                    padding: '0 13px',
                    borderRadius: 'var(--r-pill)',
                    border: `1px solid ${active ? 'var(--btn-primary-bg)' : 'var(--border-strong)'}`,
                    background: active ? 'var(--btn-primary-bg)' : 'transparent',
                    color: active ? 'var(--btn-primary-fg)' : 'var(--fg-muted)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

        {!loading && recipes.length > 0 && sorted.length === 0 && (
          <div className={styles.empty} style={{ borderStyle: 'solid' }}>
            <p>Тут нічого. Або фільтр суворий, або холодильник має інші плани.</p>
          </div>
        )}

        {/* Пул-6 №5: ≥768 — 2 колонки тими самими рядками, row-wise. */}
        <div className={styles.grid}>
        {sorted.map((r) => {
          const chip = statusChip(r);
          return (
            <div key={r.id} style={{ position: 'relative' }} className={leavingIds.has(r.id) ? styles['card-leave'] : ''}>
              <button
                className={styles.card}
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
                <div className={styles.info}>
                  <div className={styles.dish}>{r.title}</div>

                  <div className={styles.sub} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--r-pill)',
                      border: `1px solid ${chip.border}`,
                      background: chip.bg,
                      color: chip.color,
                      fontSize: 10,
                    }}>
                      {chip.text}
                    </span>
                    {r.time_total && <span>{r.time_total}ХВ</span>}
                    {r.cooked_count > 0 && (
                      <span>ГОТУВАВ {r.cooked_count} {plural(r.cooked_count, ['РАЗ', 'РАЗИ', 'РАЗІВ'])}</span>
                    )}
                  </div>

                  {r.descr && (
                    <div style={{
                      marginTop: 5,
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      color: 'var(--fg-muted)',
                      lineHeight: 1.45,
                    }}>
                      {r.descr}
                    </div>
                  )}

                  {/* Найкорисніший рядок екрана: що саме докупити. */}
                  {r.missing.length > 0 && (
                    <div style={{
                      marginTop: 5,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      color: 'var(--amber)',
                    }}>
                      БРАКУЄ: {r.missing.join(', ')}
                    </div>
                  )}

                  {/* Чому саме зараз — те, що рецепт рятує з комори. */}
                  {r.rescues.length > 0 && (
                    <div style={{
                      marginTop: 3,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      letterSpacing: '0.04em',
                      color: 'var(--accent)',
                    }}>
                      РЯТУЄ: {r.rescues.join(', ')}
                    </div>
                  )}
                </div>
              </button>

              {/* QA9-08: ✕ на КОЖНОМУ рядку — «готував, не зберіг» раніше
                  висів у бібліотеці назавжди без жодного способу прибрати. */}
              <button
                onClick={(e) => { e.stopPropagation(); void unsave(r); }}
                style={{
                  position: 'absolute',
                  top: 8, right: 0,
                  width: 44, height: 44,
                  background: 'transparent',
                  border: 0,
                  borderRadius: 'var(--r)',
                  color: 'var(--fg-dim)',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
                aria-label={`Прибрати «${r.title}» з рецептів`}
                title="Прибрати з рецептів"
              >✕</button>
            </div>
          );
        })}
        </div>
      </div>

    </div>
  );
}
