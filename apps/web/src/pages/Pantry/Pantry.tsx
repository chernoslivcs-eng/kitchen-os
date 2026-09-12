// Комора (05 з брифу): партії дому, згруповані за зоною.
// Порядок зон — з брифу §01: свіже → холодильник → морозилка → комора → спеції → напої.
// Тап на партію → sheet із деталями, звідки можна відредагувати або прибрати.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { track } from '../../lib/track';
import { ZONE_OPTIONS, UNIT_OPTIONS, ORIGIN_ICON, ZONE_ICON, ZONE_ORDER, ZONE_LABEL, applyFilter, toggleKind, toggleState, resetFilter, shortDate, INITIAL, SORTS, type FilterState, type FilterView, type RowView, type SortKey, type KindKey, type StateKey } from './filter';
import { usePanelStore } from '../../store/panel';
import { api, DEPLETED_REASON_LABEL, type DepletedReason, type HouseholdProduct, type PantryBatch, type ShoppingList } from '../../api';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { Sheet } from '../../components/Sheet/Sheet';
import { BatchCard } from './BatchCard';
import { Icon } from '../../components/Icon/Icon';
import { FreshIcon } from './FreshIcon';
import { plural } from '../../lib/plural';
import { useFlipRows } from '../../lib/useFlipRows';
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
  // 6b-5: «Ще N прострочених — у коморі, за свіжістю» з панелі «Дім зараз»
  // приходить із `state.sort` — комора відкривається вже в тому порядку.
  const location = useLocation();
  const [filter, setFilter] = useState<FilterState>(() => {
    const sort = (location.state as { sort?: FilterState['sort'] } | null)?.sort;
    return sort ? { ...INITIAL, sort } : INITIAL;
  });
  // Рейки фільтра — за кнопкою «Фільтр» (Screens); брудний фільтр — крапка на кнопці.
  const [filterOpen, setFilterOpen] = useState(() => !!(location.state as { sort?: string } | null)?.sort);
  const [searchOpen, setSearchOpen] = useState(false);
  // Крок 1 (things-v3, Screens «Комора · збірка»): чіп зони звужує екран до
  // однієї зони; «Усе» повертає всі. Це не зріз фільтра — рейки його не знають.
  const [zoneFocus, setZoneFocus] = useState<PantryBatch['zone'] | null>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const cols = useZoneColumns(colsRef);
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

  // №36: списання через ✕ — оптимістично. Відгук на тап одразу: рядок
  // згортається (exit 250 токеном, лише висота й opacity), плашка
  // «Списано · Повернути» стає ще до відповіді сервера; після виходу рядок
  // ховається локально, поки refresh не підтвердить. Відмова сервера —
  // рядок повертається, тост danger із «Повторити». Раніше рух і плашка
  // чекали на PATCH — тап «не реагував».
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [removeFailed, setRemoveFailed] = useState<PantryBatch | null>(null);
  async function quickRemove(b: PantryBatch) {
    setRemoveFailed(null);
    markLeaving(b.id);
    setRemoved(b);
    setRemovedReason(null);
    if (removedTimer.current != null) window.clearTimeout(removedTimer.current);
    removedTimer.current = window.setTimeout(() => setRemoved(null), 8000);
    const hide = window.setTimeout(() => {
      setHiddenIds((prev) => new Set(prev).add(b.id));
      unmarkLeaving(b.id);
    }, 250);
    try {
      await api.batches.update(b.id, { state: 'depleted' });
      await refresh();
    } catch {
      window.clearTimeout(hide);
      unmarkLeaving(b.id);
      setRemoved((r) => (r?.id === b.id ? null : r));
      setRemoveFailed(b);
    } finally {
      setHiddenIds((prev) => { if (!prev.has(b.id)) return prev; const n = new Set(prev); n.delete(b.id); return n; });
    }
  }

  // 2c: причина, яку людина назвала в плашці після ✕. Скидається разом із
  // плашкою; «Повернути» знімає її і на сервері (роут: state → sealed ⇒
  // depleted_reason → null).
  const [removedReason, setRemovedReason] = useState<DepletedReason | null>(null);
  async function tellReason(b: PantryBatch, reason: DepletedReason) {
    setRemovedReason(reason);
    try { await api.batches.update(b.id, { reason }); } catch { setRemovedReason(null); }
  }

  async function undoRemove() {
    if (!removed) return;
    const prev = removed;
    setRemoved(null);
    setRemovedReason(null);
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
      // Крок 2 things-v3: кікер шапки панелі — зона (Components / G6 «🍃 Свіже»
      // + ✕); назва позиції — заголовком у самій картці.
      artifacts: [{ key, kind: 'batch', label: ZONE_LABEL[editingLive.zone], meta: '' }],
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
  const view = applyFilter(hiddenIds.size ? batches.filter((b) => !hiddenIds.has(b.id)) : batches, filter, { productsById, receiptAt: lastReceiptAt });
  const q = filter.q.trim().toLowerCase();
  // Крок 1 (Screens «Комора · збірка»): чіпи зон рахують усю комору, не зріз —
  // «Холодильник 31» лишається 31 і під фільтром; звужує лише чіп.
  const zoneCounts = new Map<PantryBatch['zone'], number>();
  for (const b of batches) zoneCounts.set(b.zone, (zoneCounts.get(b.zone) ?? 0) + 1);
  const zoneChips = ZONE_ORDER.filter((z) => zoneCounts.has(z));
  const groups = view.groups.filter((g) => !zoneFocus || g.zone === zoneFocus);
  const list = view.list.filter((r) => !zoneFocus || r.it.zone === zoneFocus);
  // Банер «N розрахунків скінчились» (Screens): партії, чий строк за каталогом
  // минув — у рядку це «−N дн» тоном danger. Підрядок — три найтерміновіші
  // (прострочені й ті, що добігають), решта «нижче за свіжістю».
  const allRows = view.grouped ? view.groups.flatMap((g) => g.items) : view.list;
  // 12.09 (ANSWERS B7): порядок у зоні — за строком; після правки рядок їде на
  // нове місце рухом 240 (--dur-base), а не стрибає. Ключ — id партії.
  useFlipRows(allRows.map((r) => r.it.id), (id) => `batch-${id}`);
  const ended = allRows.filter((r) => r.timeTone === 'danger');
  const urgent = allRows.filter((r) => r.scale && r.it.days != null && (r.timeTone === 'danger' || r.timeTone === 'amber'))
    .sort((a, b) => (a.it.days ?? 0) - (b.it.days ?? 0));
  const overdue = batches.filter((b) => b.days != null && b.days < 0 && b.catalog_key).length;
  // Емфаза за правилом ⚠1 (Screens: «на 18 видимих рядках 600 + колір мають
  // три: стейк, помідори, фует») — три найтерміновіші, решта звичайним 500.
  const hot = new Set(urgent.slice(0, 3).map((r) => r.it.id));
  // Шапка (Screens): «113 · 10 прострочено · чек 7 вер»; звужений список —
  // «12 з 61», як і було (крок Ф2). Хвіст на 390 ховається — кадр «мобайл»
  // дає лише число.
  const metaTail = [
    overdue > 0 ? `${overdue} прострочено` : '',
    lastReceiptAt ? `чек ${shortDate(lastReceiptAt)}` : '',
  ].filter(Boolean);

  const renderRow = (r: RowView, flat: boolean) => {
    const b = r.it;
    return (
      /* QA9-09: рядок — контейнер: тап по тілу відкриває редагування,
         Хрестик праворуч списує одним дотиком (з «Повернути» внизу). */
      <div key={b.id} id={`batch-${b.id}`} data-batch={b.label} className={`${styles.row} ${flat ? '' : styles['row-grouped']} ${hot.has(b.id) ? styles['row-hot'] : ''} ${flashIds.has(b.id) ? styles['row-flash'] : ''} ${freshIds.has(b.id) ? styles['row-fresh'] : ''} ${leavingIds.has(b.id) ? styles['row-leave'] : ''} ${editing?.id === b.id ? styles['row-open'] : ''}`} data-open={editing?.id === b.id || undefined}>
        <button className={styles['row-main']} onClick={() => setEditing(b)}>
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
            <span className={styles.origin} data-origin={r.origin} title={r.originTitle} aria-label={r.originTitle}>
              <Icon name={ORIGIN_ICON[r.origin]} size={12} inherit />
            </span>
          )}
          {/* Слот часу — крапка 6 несе колір стану, слово — зміст (Components
              «ROW ANATOMY»). Четверте слово («−9 дн») сюди й приходить. Без
              каталожного ключа шкали немає (PLAN §2) — місце тримаємо. */}
          <span className={`${styles.time} ${styles[`tone-${r.timeTone}`]}`} data-time>
            {r.scale ? <FreshIcon fresh={r.fresh} /> : <span className={styles['mark-none']} aria-hidden />}
            {r.time}
          </span>
          {r.qty && <span className={`${styles.qty} ${flat ? styles['qty-flat'] : ''}`}>{r.qty}</span>}
          {/* №5 (рішення власника): число порядку («≈24 г», «120 ккал») —
              останнім стовпчиком, після кількості; підпис шкали стоїть над
              ним по тому ж краю. Назва — першою, як у порядку «за місцем». */}
          {flat && <span className={`${styles.val} ${styles[`tone-${r.valTone}`]}`} data-val>{r.val}</span>}
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
          tone="danger"
          text={PANTRY_FAILED.text}
          action={{ label: PANTRY_FAILED.cta, run: () => void refresh() }}
        />
      )}
      {removeFailed && !loadFailed && (
        <Toast
          tone="danger"
          text={`Не вдалось списати «${removeFailed.label}»`}
          action={{ label: 'Повторити', run: () => { const b = removeFailed; setRemoveFailed(null); void quickRemove(b); } }}
          onDismiss={() => setRemoveFailed(null)}
        />
      )}
      {/* Шапка за Screens «Комора · збірка» / «мобайл» (з wip/6b-2, окремим
          комітом): h1 · лічильник 13 dim · розпірка · пошук 260×36 на card
          (на 390 — знаком 40, розкриває поле над рейками) · «Фільтр» 38 на
          card (ховає рейки порядок/тільки/стан) · «Додати» 36 чорнилом (на
          390 — коло 42). Розкладка зон, банер, ритм календаря — лишаються на
          гілці за чергою. */}
      <AppHeader title="Комора" onMenu={() => openNav(true)} fill action={<>
          {/* QA6-12: під час пошуку лічильник показував загальну кількість —
              «9 ПОЗИЦІЙ» при одній видимій. Крок Ф1: те саме для фільтра — «12 З 61». */}
          <div className={styles.meta} data-testid="pantry-meta">{view.meta}{filter.cuts.length === 0 && !q && metaTail.map((t) => <span key={t} className={styles['meta-tail']}> · {t}</span>)}</div>
          <span className={styles['head-gap']} />
          {batches.length > 0 && (
            <label className={styles.search} data-search>
              <Icon name="sys.search" size={16} inherit decorative />
              <input
                type="search"
                value={filter.q}
                onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                placeholder="Продукт або категорія"
                aria-label="Знайти в коморі"
                className={styles['search-input']}
              />
            </label>
          )}
          {batches.length > 0 && (
            <button type="button" className={`${styles['head-icon']} ${styles['head-search']}`} onClick={() => setSearchOpen((v) => !v)}
              aria-label="Знайти в коморі" aria-pressed={searchOpen} data-search-toggle>
              <Icon name="sys.search" size={16} inherit decorative />
            </button>
          )}
          {batches.length > 0 && (
            <button type="button" className={`${styles['head-icon']} ${styles['head-filter']} ${filterOpen || view.dirty ? styles['head-icon-on'] : ''}`}
              onClick={() => setFilterOpen((v) => !v)} aria-label="Фільтр" title="Фільтр" aria-expanded={filterOpen} data-filter-toggle>
              <Icon name="sys.filter" size={16} inherit decorative />
              {view.dirty && <span className={styles['head-badge']} aria-hidden />}
            </button>
          )}
          <button type="button" className={styles['head-add']} onClick={() => setAdding(true)} data-add>
            <Icon name="sys.add" size={16} inherit decorative /><span className={styles['head-add-text']}>Додати</span>
          </button>
      </>} />

      <div className={styles.body}>
        {batches.length > 0 && searchOpen && (
          <label className={`${styles.search} ${styles['search-row']}`} data-search-row>
            <Icon name="sys.search" size={16} inherit decorative />
            <input type="search" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="Продукт або категорія" aria-label="Знайти в коморі" className={styles['search-input']} autoFocus />
          </label>
        )}
        {batches.length > 0 && (
          /* Ряд чіпів (Screens «Комора · збірка» / «мобайл»): «Усе» чорнилом,
             зони на card зі знаком 14 і лічильником dim; праворуч — слово
             порядку зі знаком «↕» (відкриває рейки). На 390 другий чіп —
             «Фільтр» колом 34, як у кадрі; слово порядку ховається. */
          <div className={styles.chips} data-zone-chips>
            <button type="button" className={`${styles['zone-chip']} ${zoneFocus === null ? styles['zone-chip-on'] : ''}`}
              aria-pressed={zoneFocus === null} onClick={() => setZoneFocus(null)}>Усе</button>
            <button type="button" className={`${styles['zone-chip']} ${styles['chip-filter']} ${filterOpen || view.dirty ? styles['zone-chip-on'] : ''}`}
              onClick={() => setFilterOpen((v) => !v)} aria-label="Фільтр" title="Фільтр" aria-expanded={filterOpen} data-filter-chip>
              <Icon name="sys.filter" size={16} inherit decorative />
            </button>
            {zoneChips.map((z) => (
              <button key={z} type="button" className={`${styles['zone-chip']} ${zoneFocus === z ? styles['zone-chip-on'] : ''}`}
                aria-pressed={zoneFocus === z} onClick={() => setZoneFocus((cur) => (cur === z ? null : z))} data-zone-chip={z}>
                <Icon name={ZONE_ICON[z] as 'zone.fresh'} size={16} inherit decorative />{ZONE_LABEL[z]}<span className={styles['zone-chip-n']}>{zoneCounts.get(z)}</span>
              </button>
            ))}
            <button type="button" className={styles['chips-sort']} onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen} data-sort-word>
              <Icon name="sys.sort" size={16} inherit decorative />{view.sort.label}
            </button>
          </div>
        )}
        {batches.length > 0 && filterOpen && (
          <FilterRails
            view={view}
            state={filter}
            onSort={(k) => { trackFilter({ sort: k }); setFilter((f) => ({ ...f, sort: k })); }}
            onKind={(k) => { trackFilter({ kind: k }); setFilter((f) => toggleKind(f, k)); }}
            onState={(k) => { trackFilter({ state: k }); setFilter((f) => toggleState(f, k)); }}
            onReset={() => setFilter((f) => resetFilter(f))}
          />
        )}
        {!loading && ended.length > 0 && !view.dirty && !q && (
          /* Банер (Screens «Комора · збірка»): знак flame у бурштиновому
             квадраті 38 · заголовок 15/600 · підрядок 12 muted · «Приготувати
             з цього» чорнилом 36 (у чат) · «Перевірити N» контуром (порядок
             «за свіжістю» з розкритими рейками — прострочене зверху, і на
             кожному «ще годиться / зіпсувалось»). На 390 — компактно: одна
             дія-знак, «Перевірити» — тап по тексту. */
          <div className={styles.banner} data-ended-banner>
            <span className={styles['banner-icon']}><Icon name="live.burning" size={20} inherit decorative /></span>
            <button type="button" className={styles['banner-text']} onClick={() => { setFilter((f) => ({ ...f, sort: 'fresh' })); setFilterOpen(true); }} data-banner-check-tap>
              <span className={styles['banner-title']}>{ended.length} {plural(ended.length, ['розрахунок скінчився', 'розрахунки скінчились', 'розрахунків скінчились'])}</span>
              <span className={styles['banner-sub']}>
                {urgent.slice(0, 3).map((r) => `${r.name} ${r.time}`).join(', ')}
                {urgent.length > 3 ? ' — решта нижче за свіжістю' : ''}
              </span>
            </button>
            <button type="button" className={styles['banner-main']} onClick={() => navigate('/app', { state: { composePrefix: 'Приготуй щось із того, що горить: ' } })} aria-label="Приготувати з цього" data-banner-cook>
              <Icon name="cook.go" size={16} inherit decorative /><span className={styles['banner-main-text']}>Приготувати з цього</span>
            </button>
            <button type="button" className={styles['banner-ghost']} onClick={() => { setFilter((f) => ({ ...f, sort: 'fresh' })); setFilterOpen(true); }} data-banner-check>
              Перевірити {ended.length}
            </button>
          </div>
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

        {view.grouped && groups.length > 0 && (
          /* Зони — колонки з чергуванням (Screens «Комора · збірка»: Свіже ·
             Морозилка ліворуч, Холодильник · Суха шафа праворуч; R0 на 1920 —
             три). Колонок стільки, скільки дає ширина САМОГО екрана комори,
             не вікна (власник, 11.09): 1 · 2 від 1000 · 3 від 1500. */
          <div className={styles['zone-cols']} ref={colsRef} data-zone-cols={cols}>
            {Array.from({ length: cols }, (_, ci) => (
              <div key={ci} className={styles['zone-col']}>
                {groups.filter((_, gi) => gi % cols === ci).map((g) => (
                  <div key={g.zone} data-zone={g.zone} className={styles['zone-card']}>
                    {/* Хедер зони як у бандлі: заливка чорнилом, текст bg, 44 px, знак 16,
                        назва 14/600, лічильник 12 на opacity .7 (бандл .6 — у темній це
                        4.4:1, тому .7: 8.1 / 6.1). Зона — картка на полотні bg. */}
                    <div className={styles['section-label']}>
                      <Icon name={ZONE_ICON[g.zone] as 'zone.fresh'} size={16} inherit decorative />
                      <span className={styles['section-name']}>{g.label}</span>
                      <span className={styles['section-count']}>{g.count}</span>
                    </div>
                    {g.items.map((r) => renderRow(r, false))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!view.grouped && !view.empty && list.length > 0 && (
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
            {list.map((r) => renderRow(r, true))}
          </div>
        )}
      </div>

      {removed && (
        <div className={styles['undo-bar']} role="status">
          <span className={styles['undo-label']}>Списано «{removed.label}»</span>
          {/* 2c, ⚠3: з хрестика причина НЕобовʼязкова — партія вже списана,
              трійка приходить сюди й іде ОКРЕМИМ запитом на вже depleted
              партію (роут це приймає з 2c, шар 1). Не натиснули — нічого не
              сталось, метрика лишається порожньою, а не вигаданою. */}
          {!removedReason && (
            <span className={styles['undo-reasons']} role="group" aria-label="Чому списали">
              {(Object.keys(DEPLETED_REASON_LABEL) as DepletedReason[]).map((r) => (
                <button key={r} type="button" data-reason={r} className={styles['undo-reason']}
                  onClick={() => void tellReason(removed, r)}>{DEPLETED_REASON_LABEL[r]}</button>
              ))}
            </span>
          )}
          {removedReason && <span className={styles['undo-told']}>{DEPLETED_REASON_LABEL[removedReason]}</span>}
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

// Скільки колонок зон уміщує екран комори. Розкладка бандла — колонки з
// чергуванням зон (не сітка рядками: картки різної висоти не тримають один
// одного), тому кількість колонок потрібна в розмітці, а не лише в CSS.
// Пороги — за ANSWERS §2 / HANDOFF (12.09): за шириною КОНТЕЙНЕРА, не вікна —
// одна до 1280, дві від 1280, три від 1500 (1920, R0). 1440 без панелі
// (контейнер ≈ 1324) — дві; з відкритою панеллю артефакта (≈ 980) — одна:
// три слоти рядка (безпека · походження · час) у вужчій колонці не влазять.
export const ZONE_COLS_TWO = 1280;
export const ZONE_COLS_THREE = 1500;
export const zoneColumns = (w: number): number => (w >= ZONE_COLS_THREE ? 3 : w >= ZONE_COLS_TWO ? 2 : 1);

function useZoneColumns(ref: { current: HTMLElement | null }): number {
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      setCols(zoneColumns(el.getBoundingClientRect().width));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return cols;
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
    <Sheet onClose={onClose} ariaLabel="Додати позицію в комору" kind="batch">
        {/* «Закрити» тепер у шапці шторки (одна колода з панеллю) — свій ✕ зайвий. */}
        <MonoLabel>Додати продукт</MonoLabel>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Назва</span>
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
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Кількість</span>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="250" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Одиниця</span>
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
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Зона</span>
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
