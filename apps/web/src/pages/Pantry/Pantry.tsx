// Комора (05 з брифу): партії дому, згруповані за зоною.
// Порядок зон — з брифу §01: свіже → холодильник → морозилка → комора → спеції → напої.
// Тап на партію → sheet із деталями, звідки можна відредагувати або прибрати.

import { useEffect, useRef, useState } from 'react';
import { track } from '../../lib/track';
import { ZONE_OPTIONS, UNIT_OPTIONS, ORIGIN_ICON, ORIGIN_LABEL, ZONE_ICON, applyFilter, toggleKind, toggleState, resetFilter, INITIAL, SORTS, type FilterState, type FilterView, type RowView, type SortKey, type KindKey, type StateKey } from './filter';
import { usePanelStore } from '../../store/panel';
import { api, type HouseholdProduct, type PantryBatch, type ShoppingList } from '../../api';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { Sheet } from '../../components/Sheet/Sheet';
import { BatchCard } from './BatchCard';
import { Icon } from '../../components/Icon/Icon';
import { FreshIcon } from './FreshIcon';
import { plural } from '../../lib/plural';
import { formatQty } from '../../lib/units';
import { Toast } from '../../components/ErrorState/Toast';
import { PANTRY_FAILED } from '../../components/ErrorState/copy';
import styles from './Pantry.module.css';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { useAuth } from '../../store/auth';


export function PantryPage() {
  const openNav = useNavStore((st) => st.setOpen);
  const navigate = useNavigate();
  const [batches, setBatches] = useState<PantryBatch[]>([]);
  const [products, setProducts] = useState<HouseholdProduct[]>([]);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PantryBatch | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<FilterState>(INITIAL);
  // Крок О1а: який зріз людина справді вмикає. Тільки назва зрізу — вмісту комори тут не буває.
  const trackFilter = (patch: Record<string, unknown>) => track('pantry_filter_changed', patch);
  const [lastReceiptAt, setLastReceiptAt] = useState<string | null>(null);
  // QA9-09: швидкий хрестик на рядку — списати одним тапом, із «Повернути».
  const [removed, setRemoved] = useState<PantryBatch | null>(null);
  const removedTimer = useRef<number | null>(null);

  // Моушн-кіт §03, як у Списку: рядок, що зникає, згортається 250ms exit;
  // новий — вʼїжджає base/enter. Комора довго жила без цього — списання
  // просто «щезало», а додане зʼявлялось без входу.
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
  const markLeaving = (id: string) => setLeavingIds((prev) => new Set(prev).add(id));
  const unmarkLeaving = (id: string) => setLeavingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });

  async function quickRemove(b: PantryBatch) {
    markLeaving(b.id);
    try {
      await Promise.all([api.batches.update(b.id, { state: 'depleted' }), wait(250)]);
      setRemoved(b);
      if (removedTimer.current != null) window.clearTimeout(removedTimer.current);
      removedTimer.current = window.setTimeout(() => setRemoved(null), 8000);
      await refresh();
    } catch { /* рядок лишиться — видно, що не вийшло */ }
    finally { unmarkLeaving(b.id); }
  }

  async function undoRemove() {
    if (!removed) return;
    const prev = removed;
    setRemoved(null);
    if (removedTimer.current != null) window.clearTimeout(removedTimer.current);
    try {
      // Повертаємо той стан, що був: sealed чи opened.
      await api.batches.update(prev.id, { state: prev.state === 'opened' ? 'opened' : 'sealed' });
      await refresh();
    } catch { /* тихо */ }
  }

  // Моушн-кіт §03: після apply/готування змінений рядок підсвічується тінтом
  // шавлії 700ms — порівнюємо value/state зі знімком перед перечитуванням.
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  // Крок Е1: не вдалось завантажити ≠ порожньо.
  const [loadFailed, setLoadFailed] = useState(false);
  const prevSnapshot = useRef<Map<string, string>>(new Map());
  const snapshotReady = useRef(false);
  async function refresh() {
    try {
      const [p, s] = await Promise.all([api.pantry(), api.shopping.list().catch(() => ({ count: 0 } as ShoppingList))]);
      const prev = prevSnapshot.current;
      // Перше завантаження — без входів: список просто зʼявляється. Далі кожна
      // партія, якої не було в знімку, вʼїжджає — і в порожню комору теж.
      if (snapshotReady.current) {
        const fresh = p.batches.filter((b) => !prev.has(b.id)).map((b) => b.id);
        if (fresh.length) {
          setFreshIds(new Set(fresh));
          window.setTimeout(() => setFreshIds(new Set()), 400);
        }
      }
      if (prev.size) {
        const changed = new Set<string>();
        for (const b of p.batches) {
          const sig = `${b.value}|${b.unit}|${b.state}|${b.zone}`;
          if (prev.has(b.id) && prev.get(b.id) !== sig) changed.add(b.id);
        }
        if (changed.size) {
          setFlashIds(changed);
          window.setTimeout(() => setFlashIds(new Set()), 800);
          // Пул-7 №4 (кіт): скрол до зміненого рядка, якщо він поза екраном.
          const firstId = [...changed][0]!;
          window.setTimeout(() => {
            const el = document.getElementById(`batch-${firstId}`);
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (r.top < 0 || r.bottom > window.innerHeight) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }, 50);
        }
      }
      prevSnapshot.current = new Map(p.batches.map((b) => [b.id, `${b.value}|${b.unit}|${b.state}|${b.zone}`]));
      snapshotReady.current = true;
      setBatches(p.batches);
      setProducts(p.products ?? []);
      setLastReceiptAt(p.last_receipt_at ?? null);
      setShoppingCount(s.count);
      setLoadFailed(false);
    } catch {
      // Крок Е1: раніше виняток летів далі, а екран лишався з порожнім
      // станом — тобто казав «у тебе нічого нема». Це різні речі, і в коморі
      // різниця найдорожча.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); track('pantry_opened'); }, []);

  // UX9-15: друге вікно показувало «КОМОРА 7» при 5 позиціях безкінечно.
  // Мінімум чесності: перечитуємо на поверненні фокуса/видимості.
  useEffect(() => {
    const refetch = () => { void refresh(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', refetch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Крок Ф2: картка позиції живе в правій панелі артефактів (тій самій, що
  // рецепт), не в модалці. Сторінка публікує в панель одну вкладку «batch:id»
  // і рендер картки; дані картки — з живого списку, щоб після PATCH вона
  // оновлювалась разом із рядком.
  const panel = usePanelStore();
  const editingLive = editing ? batches.find((b) => b.id === editing.id) ?? editing : null;
  useEffect(() => {
    if (!editingLive) { panel.clear(); return; }
    const key = `batch:${editingLive.id}`;
    panel.publish({
      artifacts: [{ key, kind: 'batch', label: editingLive.label, meta: '' }],
      render: () => (
        <BatchCard
          key={editingLive.id}
          batch={editingLive}
          product={products.find((pr) => pr.id === (editingLive.product_id ?? '')) ?? null}
          onChanged={refresh}
          onRemove={async (reason) => { markLeaving(editingLive.id); await wait(250); await api.batches.remove(editingLive.id, reason); setEditing(null); await refresh(); }}
        />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingLive, products]);
  useEffect(() => {
    if (editing) { track('pantry_card_opened'); panel.openArtifact(`batch:${editing.id}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);
  useEffect(() => () => panel.clear(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Раунд 5, крок Ф1: порядок / тільки / стан — логіка в filter.ts (спека
  // дизайну один в один), тут лише стан і рендер.
  const productsById = new Map(products.map((p) => [p.id, p]));
  const view = applyFilter(batches, filter, { productsById, receiptAt: lastReceiptAt });
  const q = filter.q.trim().toLowerCase();

  const renderRow = (r: RowView, flat: boolean) => {
    const b = r.it;
    return (
      /* QA9-09: рядок — контейнер: тап по тілу відкриває редагування,
         Хрестик праворуч списує одним дотиком (з «Повернути» внизу). */
      <div key={b.id} id={`batch-${b.id}`} data-batch={b.label} className={`${styles.row} ${flashIds.has(b.id) ? styles['row-flash'] : ''} ${freshIds.has(b.id) ? styles['row-fresh'] : ''} ${leavingIds.has(b.id) ? styles['row-leave'] : ''}`} style={{ borderBottom: '1px solid var(--line)' }}>
        <button className={styles['row-main']} onClick={() => setEditing(b)}>
          {/* Без каталожного ключа шкали немає (PLAN §2) — місце тримаємо,
              щоб назви не стрибали по рядках. */}
          {r.scale ? <FreshIcon fresh={r.fresh} /> : <span className={styles['mark-none']} aria-hidden />}
          {/* Назва двома ярусами: «наше імʼя» і паспортна нижче, тихо. */}
          <span className={`${styles.name} ${flat ? styles['name-flat'] : ''}`}>
            <span className={styles['name-text']} title={r.name}>{r.name}</span>
            {r.passport && <span className={styles.passport}>{r.passport}</span>}
            {flat && <span className={styles['meta-line']}><span className={styles['zone-tag']}>{r.zone}</span></span>}
          </span>
          {/* Слот безпеки. Обмеження людини — слива: контур на «не їм»,
              заливка зі знаком на «не можна» (tokens-v3 · Слоти рядка). */}
          {r.safety && (
            <span className={`${styles.safety} ${r.safety === 'не можна' ? styles['safety-hard'] : ''}`} data-safety={r.safety}>
              {r.safety === 'не можна' && <Icon name="cook.ban" size={12} inherit decorative />}
              {r.safety}
            </span>
          )}
          {/* Слот походження. Іконка 12 без тексту — підпис несе aria. */}
          {r.origin && (
            <span className={styles.origin} data-origin={r.origin} title={ORIGIN_LABEL[r.origin]}>
              <Icon name={ORIGIN_ICON[r.origin]} size={12} inherit />
            </span>
          )}
          {flat && <span className={`${styles.val} ${styles[`tone-${r.valTone}`]}`} data-val>{r.val}</span>}
          {/* Слот часу — четверте слово («−9 дн») сюди й приходить. */}
          <span className={`${styles.time} ${styles[`tone-${r.timeTone}`]}`} data-time>{r.time}</span>
          {r.qty && <span className={`${styles.qty} ${flat ? styles['qty-flat'] : ''}`}>{r.qty}</span>}
        </button>
        <button
          className={styles['row-x']}
          aria-label={`Списати «${b.label}»`}
          title="Закінчилось? Прибрати"
          onClick={() => void quickRemove(b)}
        ><Icon name="sys.close" size={16} inherit /></button>
      </div>
    );
  };

  return (
    <div className={styles.screen}>
      {loadFailed && (
        <Toast
          text={PANTRY_FAILED.text}
          action={{ label: PANTRY_FAILED.cta, run: () => void refresh() }}
        />
      )}
      <AppHeader title="Комора" onMenu={() => openNav(true)} action={<>
          <button
            onClick={() => setAdding(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--line2)',
              borderRadius: 'var(--r-pill)',
              padding: '5px 12px',
              color: 'var(--muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            + Додати
          </button>
          {/* QA6-12: під час пошуку лічильник показував загальну кількість —
              «9 ПОЗИЦІЙ» при одній видимій. Крок Ф1: те саме для фільтра — «12 З 61». */}
          <div className={styles.meta} data-testid="pantry-meta">{view.meta}</div>
      </>} />

      <div className={styles.body}>
        {batches.length > 0 && (
          <input
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
            placeholder="Знайти в коморі — продукт або категорію: «сир», «овочі»"
            aria-label="Знайти в коморі"
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              marginBottom: 4,
            }}
          />
        )}
        {batches.length > 0 && (
          <FilterRails
            view={view}
            state={filter}
            onSort={(k) => { trackFilter({ sort: k }); setFilter((f) => ({ ...f, sort: k })); }}
            onKind={(k) => { trackFilter({ kind: k }); setFilter((f) => toggleKind(f, k)); }}
            onState={(k) => { trackFilter({ state: k }); setFilter((f) => toggleState(f, k)); }}
            onReset={() => setFilter((f) => resetFilter(f))}
          />
        )}
        {loading && <SkeletonRows rows={5} />}
        {!loading && batches.length === 0 && (
          <div className={styles.empty}>
            <h3>Тут поки порожньо</h3>
            {/* DA-03: «порожні стани — коротко, з дією». Дія і є суть патерна. */}
            <p>Покажи полицю або напиши кілька продуктів. Не треба згадувати весь холодильник одразу.</p>
            <p style={{ marginTop: 12 }}>
              <Button onClick={() => navigate('/app')}>Додати, що є вдома</Button>
            </p>
          </div>
        )}
        {!loading && view.empty && (
          <div className={styles.empty} data-testid="filter-empty">
            <h3>{view.emptyTitle}</h3>
            <p>{view.emptyText} <button type="button" className={styles['link-btn']} onClick={() => setFilter((f) => resetFilter(f))}>Показати все</button></p>
          </div>
        )}
        {!loading && batches.length > 0 && !view.empty && view.shown.length === 0 && (
          <div className={styles.empty} data-testid="search-empty">
            <h3>Нічого не знайшли</h3>
            <p>За «{filter.q}» у коморі порожньо. <button type="button" className={styles['link-btn']} onClick={() => setFilter((f) => ({ ...resetFilter(f), q: '' }))}>Показати все</button></p>
          </div>
        )}

        {view.grouped && view.groups.map((g) => (
          <div key={g.zone} data-zone={g.zone}>
            {/* Хедер зони за каноном v3: чорнило, 44 px, знак 15, назва 14/600,
                лічильник 13/400 на opacity .6. Раніше лічильник фарбувався
                токеном РАМКИ (--border-strong) — 1.32:1, найгучніший провал
                контрасту в усій базі аудиту. */}
            <div className={styles['section-label']}>
              <Icon name={ZONE_ICON[g.zone] as 'zone.fresh'} size={16} inherit decorative />
              <span className={styles['section-name']}>{g.label}</span>
              <span className={styles['section-count']}>{g.count}</span>
            </div>
            {g.items.map((r) => renderRow(r, false))}
          </div>
        ))}

        {!view.grouped && !view.empty && view.list.length > 0 && (
          <div className={styles.flat} data-testid="flat-list">
            <div className={styles['flat-head']}>
              <span className={styles['flat-title']}>{view.flatLabel}</span>
              {/* Крок Ф2: заголовок шкали одним рядком над колонкою значення;
                  на вузькій ширині — скорочення. Колонка ваги без заголовка. */}
              <span className={styles['flat-unit']} data-testid="unit-label">
                <span className={styles['unit-long']}>{view.unitLabel}</span>
                <span className={styles['unit-short']}>{view.unitShort}</span>
              </span>
            </div>
            {view.list.map((r) => renderRow(r, true))}
          </div>
        )}
      </div>

      {removed && (
        <div className={styles['undo-bar']} role="status">
          <span style={{ flex: 1 }}>Списано «{removed.label}»</span>
          <button type="button" onClick={() => void undoRemove()}><Icon name="sys.undo" size={16} inherit decorative /> Повернути</button>
        </div>
      )}


      {adding && (
        <BatchAddSheet
          onClose={() => setAdding(false)}
          onCreated={async () => { await refresh(); setAdding(false); }}
        />
      )}

    </div>
  );
}

// Три рядки над списком: порядок (одна шкала), тільки (один рід), стан (до
// двох). На мобільному — рейки з горизонтальним скролом, підпис закріплений
// зліва; активне слово прокручується у видиму зону (reveal() з дизайну).
function FilterRails({ view, state, onSort, onKind, onState, onReset }: {
  view: FilterView; state: FilterState;
  onSort: (k: SortKey) => void; onKind: (k: KindKey) => void; onState: (k: StateKey) => void; onReset: () => void;
}) {
  const sortRef = useRef<HTMLDivElement>(null);
  const kindRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLDivElement>(null);
  const reveal = (rail: HTMLDivElement | null, k: string | undefined) => {
    if (!rail || !k) return;
    const el = rail.querySelector<HTMLElement>(`[data-k="${k}"]`);
    if (!el) return;
    const l = el.offsetLeft - rail.offsetLeft, r = l + el.offsetWidth;
    if (l < rail.scrollLeft + 12) rail.scrollLeft = l - 12;
    else if (r > rail.scrollLeft + rail.clientWidth - 22) rail.scrollLeft = r - rail.clientWidth + 22;
  };
  useEffect(() => {
    reveal(sortRef.current, state.sort);
    reveal(kindRef.current, view.kinds.find((k) => k.on)?.key);
    reveal(stateRef.current, [...view.states].reverse().find((k) => k.on)?.key);
  }, [state.sort, state.cuts, view.kinds, view.states]);
  return (
    <div className={styles.rails} data-testid="filter-rails">
      <div className={styles.rail}>
        <span className={styles['rail-label']}>порядок</span>
        <div className={`${styles['rail-words']} ${styles.hs}`} ref={sortRef} role="radiogroup" aria-label="Порядок">
          {SORTS.map((s) => (
            <button key={s.key} type="button" data-k={s.key} role="radio" aria-checked={s.key === state.sort}
              className={`${styles.word} ${styles['word-sort']} ${s.key === state.sort ? styles['word-on'] : ''}`} onClick={() => onSort(s.key)}>{s.label}</button>
          ))}
        </div>
        {view.dirty ? <button type="button" className={`${styles.reset} ${styles['reset-desktop']}`} onClick={onReset}>скинути</button> : <span />}
      </div>
      <div className={styles.rail}>
        <span className={styles['rail-label']}>тільки</span>
        <div className={`${styles['rail-words']} ${styles.hs}`} ref={kindRef} aria-label="Тільки">
          {view.kinds.map((k) => (
            <button key={k.key} type="button" data-k={k.key} aria-pressed={k.on}
              className={`${styles.word} ${styles.chip} ${k.on ? styles['chip-on'] : ''}`} onClick={() => onKind(k.key)}>{k.label}</button>
          ))}
        </div>
        <span />
      </div>
      <div className={styles.rail}>
        <span className={styles['rail-label']}>стан</span>
        <div className={`${styles['rail-words']} ${styles.hs}`} ref={stateRef} aria-label="Стан">
          {view.states.map((c) => (
            <button key={c.key} type="button" data-k={c.key} aria-pressed={c.on} aria-disabled={c.full} disabled={c.full}
              className={`${styles.word} ${styles.chip} ${c.on ? `${styles['chip-on']} ${styles[`tone-${c.tone}`]}` : ''} ${c.full ? styles['chip-full'] : ''}`}
              onClick={() => onState(c.key)}>{c.label}</button>
          ))}
        </div>
        <span />
      </div>
      {/* Мобільний (дизайн 1b): «скинути» під трьома рейками, праворуч. */}
      {view.dirty && <button type="button" className={`${styles.reset} ${styles['reset-mobile']}`} onClick={onReset}>скинути</button>}
    </div>
  );
}

function BatchAddSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState<string>('');
  const [unit, setUnit] = useState<PantryBatch['unit']>('g');
  const [zone, setZone] = useState<PantryBatch['zone']>('fridge');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const l = label.trim();
    if (!l) { setError('Треба хоча б назву'); return; }
    setSaving(true);
    setError(null);
    try {
      const v = value.trim() === '' ? null : Number(value.trim());
      if (v != null && isNaN(v)) { setError('Кількість — числом. Або залиш порожньою.'); return; }
      await api.batches.create({ label: l, value: v, unit, zone });
      await onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Додати позицію в комору">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <MonoLabel>Додати продукт</MonoLabel>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 20 }}
            aria-label="Закрити"
          ><Icon name="sys.close" size={16} inherit /></button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--dim)' }}>Назва</span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Наприклад, пармезан"
            error={error}
            autoFocus
          />
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 2 }}>
            <span style={{ fontSize: 13, color: 'var(--dim)' }}>Кількість</span>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="250" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 13, color: 'var(--dim)' }}>Одиниця</span>
            <select
              value={unit ?? ''}
              onChange={(e) => setUnit((e.target.value || null) as PantryBatch['unit'])}
              style={{
                padding: '11px 12px', background: 'var(--bg)',
                border: '1px solid var(--line)', borderRadius: 'var(--r)',
                color: 'var(--ink)', fontFamily: 'var(--font-body)', fontSize: 14,
              }}
            >
              {UNIT_OPTIONS.map((o) => <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--dim)' }}>Зона</span>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value as PantryBatch['zone'])}
            style={{
              padding: '11px 12px', background: 'var(--bg)',
              border: '1px solid var(--line)', borderRadius: 'var(--r)',
              color: 'var(--ink)', fontFamily: 'var(--font-body)', fontSize: 14,
            }}
          >
            {ZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Скасувати</Button>
          <div style={{ flex: 1 }} />
          <Button onClick={submit} loading={saving}>Додати</Button>
        </div>
    </Sheet>
  );
}
