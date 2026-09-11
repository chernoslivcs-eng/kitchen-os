// «Що впливає на кухню протягом року» — вхід у підписки з календаря
// (Components · «Календар · що впливає на кухню: традиція · сезони · свої
// події», PLAN §7). Одна картка на все: п'ять традицій чіпами, рядки обраної
// з перемикачами, сезони з каталогу, вхід у свою подію.
//
// Відмінність від серії з чату (PeriodSeries, A1): там галочки й одна кнопка
// «Записати в календар», бо картка ще має застосуватись. Тут перемикач пише
// одразу — PUT одним рядком; «увімкнути набір» / «вимкнути набір» — PUT усіма
// рядками традиції. Знятий рядок лишається на місці як «заглушено · повернути»:
// повернути — той самий перемикач.
//
// Контракт підписок (services/api routes/events.ts): рядок традиції за
// замовчуванням вимкнений, сезон — увімкнений; збіг із дефолтом сервер
// прибирає сам. Тому «традиція увімкнена» = хоч один її рядок enabled.

import { useEffect, useState } from 'react';
import { api, type OccasionItem, type OccasionSet, type SubscriptionRow, type Tradition } from '../../api';
import { Icon } from '../Icon/Icon';
import { shortDate, todayIso, TRADITION_LABEL, TRADITION_SETS } from '../../lib/period';
import type { PeriodChange } from './PeriodArtifact';
import styles from './PeriodArtifact.module.css';
import sub from './PeriodSubscriptions.module.css';

export interface SubscriptionsProps {
  /** Звідки відкрили: рядок «свята» — традиція, «приховані» — сезони. */
  initialSet?: OccasionSet;
  onDone?: (change: PeriodChange) => void;
  onAddOwn?: () => void;
  onClose?: () => void;
}

export const SUBSCRIPTIONS_COPY = {
  title: 'Що впливає на кухню протягом року',
  text: 'Дві підписки: традиція дає свята й пости (обмеження), каталог дає сезони (що зараз найкраще). Обидві потрапляють у «Дім зараз» і в пропозиції — вимкнув набір, і воно зникає звідусіль.',
  traditions: 'Свята й пости · традиція',
  seasons: 'Сезонні продукти · каталог · мʼяко',
  own: 'Своя подія з датами — гості, дієта на період, відпустка',
  add: 'додати',
  setOn: 'увімкнути набір',
  setOff: 'вимкнути набір',
  muted: 'заглушено · повернути',
  strict: 'суворо',
  err: 'Не вийшло записати. Спробуй ще раз',
} as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const [viewed, setViewed] = useState<Tradition>(initialSet && initialSet !== 'seasons' ? initialSet : 'orthodox');
  const [subs, setSubs] = useState<SubscriptionRow[] | null>(null);
  const [rows, setRows] = useState<OccasionItem[] | null>(null);
  const [seasons, setSeasons] = useState<OccasionItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.occasions.subscriptions()
      .then(({ subscriptions }) => {
        if (!alive) return;
        setSubs(subscriptions);
        // Відкрили «свята» без набору — показуємо першу увімкнену традицію.
        if (!initialSet || initialSet === 'seasons') {
          const on = TRADITION_SETS.find((t) => subscriptions.some((r) => r.enabled && r.tradition === t));
          if (on) setViewed(on);
        }
      })
      .catch(() => { if (alive) setSubs([]); });
    readSet('seasons').then((items) => { if (alive) setSeasons(items); }).catch(() => { if (alive) setErr('Не вдалось прочитати довідник'); });
    return () => { alive = false; };
  }, [initialSet]);

  useEffect(() => {
    let alive = true;
    setRows(null);
    readSet(viewed).then((items) => { if (alive) setRows(items); }).catch(() => { if (alive) setErr('Не вдалось прочитати довідник'); });
    return () => { alive = false; };
  }, [viewed]);

  const traditionOn = (t: Tradition): boolean =>
    t === viewed && rows ? rows.some((r) => r.enabled) : !!subs?.some((r) => r.enabled && r.tradition === t);

  async function write(list: { occasion_id: string; enabled: boolean }[], key: string) {
    setBusy(key); setErr(null);
    try {
      await api.occasions.setSubscriptions(list);
      const patch = new Map(list.map((l) => [l.occasion_id, l.enabled]));
      const apply = (items: OccasionItem[] | null) => items && items.map((i) => (patch.has(i.occasion_id) ? { ...i, enabled: patch.get(i.occasion_id)! } : i));
      setRows(apply);
      setSeasons(apply);
      setSubs((prev) => {
        const rest = (prev ?? []).filter((r) => !patch.has(r.occasion_id));
        const now = new Date().toISOString();
        const src = [...(rows ?? []), ...(seasons ?? [])];
        return [...rest, ...list.map((l) => {
          const it = src.find((i) => i.occasion_id === l.occasion_id);
          return { occasion_id: l.occasion_id, enabled: l.enabled, updated_at: now, title: it?.title ?? l.occasion_id, type: it?.type ?? null, tradition: it?.tradition ?? null };
        })];
      });
      onDone?.('subscribe');
    } catch {
      setErr(SUBSCRIPTIONS_COPY.err);
    } finally { setBusy(null); }
  }

  const toggle = (i: OccasionItem) => write([{ occasion_id: i.occasion_id, enabled: !i.enabled }], i.occasion_id);
  const setAll = (enabled: boolean) => rows && write(rows.map((r) => ({ occasion_id: r.occasion_id, enabled })), `set:${viewed}`);
  const viewedOn = traditionOn(viewed);

  const renderRow = (i: OccasionItem, withDot: boolean, setOn = true) => (
    <div key={i.occasion_id} className={`${sub.row} ${i.enabled ? '' : sub['row-off']}`} data-occasion={i.occasion_id} data-enabled={i.enabled ? '' : undefined}>
      {withDot && <span className={`${sub.dot} ${i.enabled ? '' : sub['dot-off']}`} aria-hidden />}
      <span className={sub['row-body']}>
        <span className={sub['row-name']}>{i.title}</span>
        <span className={`${sub['row-sub']} ${i.enabled && i.strict ? sub['row-strict'] : ''}`}>{rowSub(i, setOn)}</span>
      </span>
      <button type="button" role="switch" aria-checked={i.enabled} aria-label={i.title}
        className={`${sub.switch} ${i.enabled ? sub['switch-on'] : ''}`}
        disabled={busy !== null} onClick={() => void toggle(i)}>
        <span className={sub.knob} />
      </button>
    </div>
  );

  return (
    <div className={styles.body} data-testid="period-subscriptions">
      <h2 className={styles.title}>{SUBSCRIPTIONS_COPY.title}</h2>
      <p className={styles.text}>{SUBSCRIPTIONS_COPY.text}</p>

      <div className={sub.section}>
        <div className={sub['section-head']}>
          <span className={sub.label}>{SUBSCRIPTIONS_COPY.traditions}</span>
          {rows && (
            <button type="button" className={sub['set-link']} disabled={busy !== null} onClick={() => void setAll(!viewedOn)} data-set-toggle={viewedOn ? 'off' : 'on'}>
              {viewedOn ? SUBSCRIPTIONS_COPY.setOff : SUBSCRIPTIONS_COPY.setOn}
            </button>
          )}
        </div>
        <div className={sub.chips} role="tablist">
          {TRADITION_SETS.map((t) => {
            const on = traditionOn(t);
            return (
              <button key={t} type="button" role="tab" aria-selected={t === viewed} data-on={on ? '' : undefined}
                className={`${sub.chip} ${on ? sub['chip-on'] : ''} ${t === viewed ? sub['chip-viewed'] : ''}`}
                onClick={() => setViewed(t)}>
                {on && <Icon name="sys.done" size={12} inherit decorative />}
                {cap(TRADITION_LABEL[t])}
              </button>
            );
          })}
        </div>
        {!rows && !err && <div className={styles.loading}>ЧИТАЮ ДОВІДНИК…</div>}
        {rows && <div className={sub.list} data-list="tradition">{rows.map((i) => renderRow(i, false, viewedOn))}</div>}
      </div>

      <div className={sub.section}>
        <div className={sub['section-head']}><span className={sub.label}>{SUBSCRIPTIONS_COPY.seasons}</span></div>
        {seasons && <div className={sub.list} data-list="seasons">{seasons.map((i) => renderRow(i, true))}</div>}
      </div>

      <button type="button" className={sub.own} onClick={() => { onClose?.(); onAddOwn?.(); }}>
        <Icon name="sys.add" size={16} inherit decorative />
        <span className={sub['own-text']}>{SUBSCRIPTIONS_COPY.own}</span>
        <span className={sub['own-go']}>{SUBSCRIPTIONS_COPY.add}</span>
      </button>

      {err && <div className={styles.err}>{err}</div>}
    </div>
  );
}
