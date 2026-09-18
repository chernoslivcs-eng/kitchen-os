// «Каталог подій» — вхід у підписки з календаря (spec 2026-09-18, Календар
// v3, К7): ДВА рівні, не чіпи+рядки на одному екрані. Перший рівень —
// пакети (пʼять традицій + сезони), кожен «підписуєшся й отримуєш весь
// набір одразу»; другий — вміст пакета, рядки з перемикачами на кожному.
// Періоди раціону (сушка, набір ваги…) у каталозі більше нема — це власні
// події, людина створює їх через «Своя подія» (onAddOwn), поза пакетами.
//
// Дані й контракт не змінились від попередньої версії (PLAN §7): перемикач
// пише одразу — PUT одним рядком; «Твій»/«Увімкнути» на пакеті — PUT усіма
// рядками. Знятий рядок лишається на місці як «заглушено · повернути».

import { useEffect, useState } from 'react';
import { api, type OccasionItem, type OccasionSet, type SubscriptionRow } from '../../api';
import { Icon } from '../Icon/Icon';
import { shortDate, todayIso, TRADITION_LABEL, TRADITION_SETS } from '../../lib/period';
import type { PeriodChange } from './PeriodArtifact';
import styles from './PeriodArtifact.module.css';
import sub from './PeriodSubscriptions.module.css';

export interface SubscriptionsProps {
  /** Звідки відкрили: конкретний пакет — одразу його вміст; нема — список пакетів. */
  initialSet?: OccasionSet;
  onDone?: (change: PeriodChange) => void;
  onAddOwn?: () => void;
  onClose?: () => void;
}

/** Шість пакетів каталогу: пʼять традицій + сезони (К7). */
const OCCASION_SETS: OccasionSet[] = [...TRADITION_SETS, 'seasons'];

export const SUBSCRIPTIONS_COPY = {
  title: 'Каталог подій',
  text: 'Підпишись на пакет — і отримаєш весь набір одразу. Усередині можна вимкнути зайве, за замовчуванням усе увімкнено.',
  own: 'Своя подія',
  ownMeta: 'гості · вечеря · рамка дня · постачання · свій період',
  add: 'Додати',
  mine: 'Твій',
  events: (n: number) => `${n} ${plural(n, ['подія', 'події', 'подій'])}`,
  seasons: (n: number) => `${n} ${plural(n, ['вікно', 'вікна', 'вікон'])}`,
  someOff: (n: number) => `${n} вимкнено`,
  setOn: 'увімкнути набір',
  setOff: 'вимкнути набір',
  offPackage: 'Вимкнути пакет',
  offPackageMeta: (n: number) => `усі ${n} ${plural(n, ['подія', 'події', 'подій'])} зникнуть`,
  muted: 'заглушено · повернути',
  strict: 'суворо',
  err: 'Не вийшло записати. Спробуй ще раз',
} as const;

function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const packageName = (set: OccasionSet) => (set === 'seasons' ? 'Сезонні продукти' : `${cap(TRADITION_LABEL[set])} свята`);

/**
 * Довідник віддає вікна одного року. Рядок, що цього року вже минув,
 * показуємо наступним вікном — Рамадан зсувається на 11 днів щороку, і
 * торішні дати ввели б в оману. Порядок — за найближчим вікном.
 */
export function nextWindows(thisYear: OccasionItem[], nextYear: OccasionItem[], today = todayIso()): OccasionItem[] {
  const merged = thisYear.map((r) => {
    if (!r.to || r.to >= today) return r;
    const n = nextYear.find((x) => x.occasion_id === r.occasion_id);
    return n?.from ? { ...r, from: n.from, to: n.to, approx: n.approx } : r;
  });
  return merged.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
}

const YEAR = new Date().getFullYear();
async function readSet(set: OccasionSet): Promise<OccasionItem[]> {
  const [a, b] = await Promise.all([api.occasions.set(set, YEAR), api.occasions.set(set, YEAR + 1)]);
  return nextWindows(a.items, b.items);
}

/**
 * Підрядок рядка: дати · що робить. Знятий у живому наборі — «заглушено ·
 * повернути»; рядок традиції, яку ще не вмикали, — не заглушений, а просто
 * не підключений: показує дати, як довідник.
 */
export function rowSub(
  i: Pick<OccasionItem, 'from' | 'to' | 'approx' | 'enabled' | 'strict' | 'what' | 'type'>,
  setOn = true, today = todayIso(),
): string {
  if (!i.enabled && setOn) return SUBSCRIPTIONS_COPY.muted;
  const ap = i.approx ? '≈ ' : '';
  let when = '';
  if (i.from && i.to) {
    // Сезон — кінцем, поки триває («≈ до 30 вер»), інакше початком («з 1 квіт»:
    // сезони річні, минулий прийде знову); свято — проміжком або днем.
    if (i.type === 'season') when = i.from <= today && today <= i.to ? `${ap}до ${shortDate(i.to)}` : `${ap}з ${shortDate(i.from)}`;
    else when = i.to !== i.from ? `${ap}${shortDate(i.from)} – ${shortDate(i.to)}` : `${ap}${shortDate(i.from)}`;
  }
  const does = i.strict ? SUBSCRIPTIONS_COPY.strict : i.type === 'season' ? '' : i.what;
  return [when, does].filter(Boolean).join(' · ');
}

export function PeriodSubscriptions({ initialSet, onDone, onAddOwn, onClose }: SubscriptionsProps) {
  // Рівень 1 (пакети) — нема обраного набору; рівень 2 (вміст) — набір є.
  const [viewed, setViewed] = useState<OccasionSet | null>(initialSet ?? null);
  const [subs, setSubs] = useState<SubscriptionRow[] | null>(null);
  const [rows, setRows] = useState<OccasionItem[] | null>(null);
  // Рівень 1: не лише лічильник — повний список (без злиття років), щоб
  // «Твій»/«Увімкнути» на пакеті могло писати PUT усіма occasion_id одразу,
  // не заходячи у вміст.
  const [packageItems, setPackageItems] = useState<Partial<Record<OccasionSet, OccasionItem[]>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.occasions.subscriptions().then(({ subscriptions }) => { if (alive) setSubs(subscriptions); }).catch(() => { if (alive) setSubs([]); });
    return () => { alive = false; };
  }, []);

  // Рівень 1: лічильники й склад усіх шести пакетів — на фронті з
  // GET /v1/occasions?set= (аудит, п. 2.5: сервер їх не рахує).
  useEffect(() => {
    if (viewed !== null) return;
    let alive = true;
    Promise.all(OCCASION_SETS.map((s) => api.occasions.set(s, YEAR).then((r) => [s, r.items] as const)))
      .then((pairs) => { if (alive) setPackageItems(Object.fromEntries(pairs)); })
      .catch(() => { if (alive) setErr('Не вдалось прочитати довідник'); });
    return () => { alive = false; };
  }, [viewed]);

  // Рівень 2: вміст обраного пакета.
  useEffect(() => {
    if (viewed === null) return;
    let alive = true;
    setRows(null);
    readSet(viewed).then((items) => { if (alive) setRows(items); }).catch(() => { if (alive) setErr('Не вдалось прочитати довідник'); });
    return () => { alive = false; };
  }, [viewed]);

  /** Пакет «увімкнено» — традиція за підпискою; сезони за задумом завжди «Твій» (дефолт-он). */
  const packageOn = (set: OccasionSet): boolean =>
    set === 'seasons' ? true : (set === viewed && rows ? rows.some((r) => r.enabled) : !!subs?.some((r) => r.enabled && r.tradition === set));
  const offCount = (set: OccasionSet): number =>
    (subs ?? []).filter((r) => !r.enabled && (set === 'seasons' ? r.type === 'season' : r.tradition === set)).length;

  async function write(list: { occasion_id: string; enabled: boolean }[], key: string, source: OccasionItem[]) {
    setBusy(key); setErr(null);
    try {
      await api.occasions.setSubscriptions(list);
      const patch = new Map(list.map((l) => [l.occasion_id, l.enabled]));
      const apply = (items: OccasionItem[]) => items.map((i) => (patch.has(i.occasion_id) ? { ...i, enabled: patch.get(i.occasion_id)! } : i));
      setRows((items) => items && apply(items));
      setPackageItems((bySet) => Object.fromEntries(Object.entries(bySet).map(([s, items]) => [s, items && apply(items)])));
      setSubs((prev) => {
        const rest = (prev ?? []).filter((r) => !patch.has(r.occasion_id));
        const now = new Date().toISOString();
        return [...rest, ...list.map((l) => {
          const it = source.find((i) => i.occasion_id === l.occasion_id);
          return { occasion_id: l.occasion_id, enabled: l.enabled, updated_at: now, title: it?.title ?? l.occasion_id, type: it?.type ?? null, tradition: it?.tradition ?? null };
        })];
      });
      onDone?.('subscribe');
    } catch {
      setErr(SUBSCRIPTIONS_COPY.err);
    } finally { setBusy(null); }
  }

  const toggle = (i: OccasionItem) => write([{ occasion_id: i.occasion_id, enabled: !i.enabled }], i.occasion_id, rows ?? []);
  const setAll = (enabled: boolean) => rows && viewed && write(rows.map((r) => ({ occasion_id: r.occasion_id, enabled })), `set:${viewed}`, rows);
  const togglePackage = (set: OccasionSet) => {
    const items = packageItems[set];
    if (!items) return;
    void write(items.map((r) => ({ occasion_id: r.occasion_id, enabled: !packageOn(set) })), `set:${set}`, items);
  };
  const openPackage = (set: OccasionSet) => { setErr(null); setViewed(set); };
  const backToPackages = () => { setErr(null); setViewed(null); setRows(null); };

  // ── Рівень 1: список пакетів ────────────────────────────────────────────
  if (viewed === null) {
    return (
      <div className={styles.body} data-testid="period-subscriptions" data-catalog-level="packages">
        <h2 className={sub.head}>{SUBSCRIPTIONS_COPY.title}</h2>
        <p className={sub['head-text']}>{SUBSCRIPTIONS_COPY.text}</p>
        <div className={sub.list} data-list="packages">
          {OCCASION_SETS.map((set) => {
            const items = packageItems[set];
            const n = items?.length;
            const on = packageOn(set);
            const off = offCount(set);
            return (
              <div key={set} className={sub.pkg} data-package={set}>
                <button type="button" className={sub['pkg-body']} onClick={() => openPackage(set)}>
                  <Icon name={set === 'seasons' ? 'live.season' : 'live.tradition'} size={16} inherit decorative />
                  <span className={sub['row-body']}>
                    <span className={sub['row-name']}>{packageName(set)}</span>
                    <span className={sub['row-sub']}>
                      {n === undefined ? '…' : set === 'seasons' ? SUBSCRIPTIONS_COPY.seasons(n) : SUBSCRIPTIONS_COPY.events(n)}
                      {off > 0 ? ` · ${SUBSCRIPTIONS_COPY.someOff(off)}` : ''}
                    </span>
                  </span>
                  <Icon name="sys.next" size={16} inherit decorative />
                </button>
                {set !== 'seasons' && (
                  <button type="button" className={`${sub['pkg-btn']} ${on ? sub['pkg-btn-on'] : ''}`} data-tap
                    disabled={busy !== null || n === undefined} data-package-toggle={set}
                    onClick={() => togglePackage(set)}>
                    {on ? SUBSCRIPTIONS_COPY.mine : 'Увімкнути'}
                  </button>
                )}
                {set === 'seasons' && <span className={`${sub['pkg-btn']} ${sub['pkg-btn-on']}`}>{SUBSCRIPTIONS_COPY.mine}</span>}
              </div>
            );
          })}
        </div>
        <button type="button" className={sub.own} onClick={() => { onClose?.(); onAddOwn?.(); }}>
          <Icon name="sys.add" size={16} inherit decorative />
          <span className={sub['own-text']}>
            <span className={sub['row-name']}>{SUBSCRIPTIONS_COPY.own}</span>
            <span className={sub['row-sub']}>{SUBSCRIPTIONS_COPY.ownMeta}</span>
          </span>
          <span className={sub['own-go']}>{SUBSCRIPTIONS_COPY.add}</span>
        </button>
        {err && <div className={styles.err}>{err}</div>}
      </div>
    );
  }

  // ── Рівень 2: вміст пакета ───────────────────────────────────────────────
  const viewedOn = packageOn(viewed);
  const total = rows?.length ?? 0;
  return (
    <div className={styles.body} data-testid="period-subscriptions" data-catalog-level="items">
      <div className={sub['items-head']}>
        <button type="button" className={sub.back} data-tap onClick={backToPackages} aria-label="Назад до пакетів">
          <Icon name="sys.prev" size={18} inherit decorative />
        </button>
        <span className={sub['row-body']}>
          <span className={sub.head}>{packageName(viewed)}</span>
          <span className={sub['row-sub']}>{rows ? `${SUBSCRIPTIONS_COPY.events(total)} · ${viewedOn ? 'твій пакет' : 'не підключено'}` : '…'}</span>
        </span>
      </div>

      {!rows && !err && <div className={styles.loading}>Читаю довідник…</div>}
      {rows && (
        <>
          <div className={sub['section-head']}>
            <span className={sub.label} />
            <button type="button" className={sub['set-link']} data-tap disabled={busy !== null} onClick={() => void setAll(!viewedOn)} data-set-toggle={viewedOn ? 'off' : 'on'}>
              {viewedOn ? SUBSCRIPTIONS_COPY.setOff : SUBSCRIPTIONS_COPY.setOn}
            </button>
          </div>
          <div className={sub.list} data-list={viewed}>
            {rows.map((i) => (
              <div key={i.occasion_id} className={`${sub.row} ${i.enabled ? '' : sub['row-off']}`} data-occasion={i.occasion_id} data-enabled={i.enabled ? '' : undefined}>
                <span className={sub['row-body']}>
                  <span className={sub['row-name']}>{i.title}</span>
                  <span className={`${sub['row-sub']} ${i.enabled && i.strict ? sub['row-strict'] : ''}`}>{rowSub(i, viewedOn)}</span>
                </span>
                <button type="button" role="switch" aria-checked={i.enabled} aria-label={i.title}
                  className={`${sub.switch} ${i.enabled ? sub['switch-on'] : ''}`} data-tap
                  disabled={busy !== null} onClick={() => void toggle(i)}>
                  <span className={sub.knob} />
                </button>
              </div>
            ))}
          </div>
          {viewedOn && (
            <button type="button" className={sub['off-pkg']} data-tap disabled={busy !== null} onClick={() => void setAll(false)}>
              <span>{SUBSCRIPTIONS_COPY.offPackage}</span>
              <span className={sub['off-pkg-meta']}>{SUBSCRIPTIONS_COPY.offPackageMeta(total)}</span>
            </button>
          )}
        </>
      )}
      {err && <div className={styles.err}>{err}</div>}
    </div>
  );
}
