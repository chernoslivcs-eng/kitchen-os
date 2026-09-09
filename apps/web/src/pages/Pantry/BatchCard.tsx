// Крок Ф2: картка позиції комори в правій панелі артефактів (замість модалки).
// Збереження без кнопки: blur/enter на полі → PATCH, як на сторінці профілю.
// Знизу — «Прибрати з комори» через слот панелі, як у решти артефактів.

import { useContext, useEffect, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, type HouseholdProduct, type PantryBatch } from '../../api';
import { PanelFootSlot } from '../Feed/panel-slots';
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';
import { FreshIcon } from './FreshIcon';
import { ZONE_LABEL, ZONE_OPTIONS, UNIT_OPTIONS, freshness, shortDate } from './filter';
import styles from './Pantry.module.css';

const ORIGIN_KIND = { receipt: 'чек', manual: 'додано рукою', chat: 'з розмови' } as const;

/**
 * «свіже до 8 вер · ще 2 дні» / «≈ще 5 днів» / «не псується».
 *
 * Б3: три стани замість двох. Досі «без терміну» означало одночасно «не
 * псується» і «ми не знаємо», і так виглядали 245 із 246 позицій. Після Б1/Б2
 * незнання зникло: строк є в кожної позиції, яка може псуватись, а порожній
 * означає рішення каталогу — «не псується».
 *
 * Точна дата лишається тільки там, де її ввела людина (або поставило
 * відкриття пачки). Розрахований строк іде з «≈» — той самий поділ, що
 * «~строк≈» проти точного «!Nдн» у промпті: видавати розрахунок за точну дату
 * означало б обіцяти те, чого система не знає.
 */
export function freshLine(b: Pick<PantryBatch, 'expires_at' | 'days'>): string {
  if (b.days == null) return 'не псується';
  const left = b.days > 0
    ? `ще ${b.days} ${plural(b.days, ['день', 'дні', 'днів'])}`
    : b.days === 0 ? 'сьогодні' : 'термін вийшов';
  if (!b.expires_at) return `≈${left}`;
  return `свіже до ${shortDate(b.expires_at)} · ${left}`;
}

/** «чек Сільпо · 3 вер», «чек · 3 вер», «додано рукою · 1 вер», «з розмови». */
export function originLine(b: Pick<PantryBatch, 'origin'>): string {
  const o = b.origin;
  if (!o) return '';
  if (o.kind === 'chat') return ORIGIN_KIND.chat;
  const head = o.kind === 'receipt' ? (o.shop ? `чек ${o.shop}` : 'чек') : ORIGIN_KIND.manual;
  return `${head} · ${shortDate(o.at)}`;
}

/** На 100 г і на позицію (× кількість / 100 для г/мл, через вагу штуки з каталогу для шт). */
export function nutritionLines(b: Pick<PantryBatch, 'kcal' | 'prot' | 'fat' | 'carb' | 'est' | 'value' | 'unit' | 'unit_weight'>): { per100: string; perItem: string | null } | null {
  if (b.kcal == null || b.prot == null || b.fat == null || b.carb == null) return null;
  const a = b.est ? '≈' : '';
  const line = (k: number) => `${a}${Math.round(b.kcal! * k)} ккал · Б ${Math.round(b.prot! * k)} · Ж ${Math.round(b.fat! * k)} · В ${Math.round(b.carb! * k)}`;
  let grams: number | null = null;
  if (b.value != null && (b.unit === 'g' || b.unit === 'ml')) grams = b.value;
  else if (b.value != null && b.unit === 'pcs' && b.unit_weight) grams = b.value * b.unit_weight;
  return { per100: line(1), perItem: grams != null ? line(grams / 100) : null };
}

const toDateInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export function BatchCard({ batch, product, onChanged, onRemove }: {
  batch: PantryBatch; product: HouseholdProduct | null;
  onChanged: () => Promise<void>; onRemove: () => Promise<void>;
}) {
  const footSlot = useContext(PanelFootSlot);
  const [label, setLabel] = useState(batch.label);
  const [value, setValue] = useState(batch.value != null ? String(batch.value) : '');
  const [expires, setExpires] = useState(toDateInput(batch.expires_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Живі дані з рядка: після PATCH сторінка перечитує список, картка бере нове.
  useEffect(() => { setLabel(batch.label); setValue(batch.value != null ? String(batch.value) : ''); setExpires(toDateInput(batch.expires_at)); }, [batch.label, batch.value, batch.expires_at]);

  async function commit(patch: Parameters<typeof api.batches.update>[1]) {
    setBusy(true); setError(null);
    try { await api.batches.update(batch.id, patch); await onChanged(); }
    catch { setError('Не збереглось. Спробуй ще раз.'); }
    finally { setBusy(false); }
  }
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); };
  const commitLabel = () => { const t = label.trim(); if (!t) { setLabel(batch.label); return; } if (t !== batch.label) void commit({ label: t }); };
  const commitValue = () => {
    const v = value.trim() === '' ? null : Number(value.trim());
    if (v != null && (!Number.isFinite(v) || v < 0)) { setValue(batch.value != null ? String(batch.value) : ''); return; }
    if (v !== batch.value) void commit({ value: v });
  };
  const commitExpires = (d: string) => {
    setExpires(d);
    const next = d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null;
    if (next !== batch.expires_at) void commit({ expires_at: next });
  };

  const nutri = nutritionLines(batch);
  const fresh = freshness(batch.days);
  const foot = (
    <button type="button" className={styles['card-remove']} disabled={busy}
      onClick={() => { if (confirm('Прибрати з комори? Вважатимемо, що закінчилось. В історії лишиться.')) void onRemove(); }}>
      Прибрати з комори
    </button>
  );

  return (
    <div className={styles.card} data-testid="batch-card">
      <input className={styles['card-title']} value={label} aria-label="Назва" disabled={busy}
        onChange={(e) => setLabel(e.target.value)} onBlur={commitLabel} onKeyDown={onEnter} />
      <div className={styles['card-sub']}>{[batch.cat, ZONE_LABEL[batch.zone]].filter(Boolean).join(' · ')}</div>
      {product && (
        <div className={styles['card-hint']}>
          {product.product}{product.brand ? ` · ${product.brand}` : ''}{product.variant ? ` · ${product.variant}` : ''} — деталі й позначки правляться в чаті
        </div>
      )}

      <div className={styles['card-row']}>
        <label className={styles['card-field']}>
          <span className={styles['card-label']}>Кількість</span>
          <input className={styles['card-input']} inputMode="decimal" value={value} aria-label="Кількість" disabled={busy}
            onChange={(e) => setValue(e.target.value)} onBlur={commitValue} onKeyDown={onEnter} />
        </label>
        <label className={styles['card-field']}>
          <span className={styles['card-label']}>Одиниця</span>
          <select className={styles['card-input']} value={batch.unit ?? ''} aria-label="Одиниця" disabled={busy}
            onChange={(e) => void commit({ unit: (e.target.value || null) as PantryBatch['unit'] })}>
            {UNIT_OPTIONS.map((o) => <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>)}
          </select>
        </label>
        <label className={styles['card-field']}>
          <span className={styles['card-label']}>Зона</span>
          <select className={styles['card-input']} value={batch.zone} aria-label="Зона" disabled={busy}
            onChange={(e) => void commit({ zone: e.target.value as PantryBatch['zone'] })}>
            {ZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div className={styles['card-block']}>
        <span className={styles['card-label']}>Свіжість</span>
        <div className={styles['card-line']} data-testid="fresh-line">
          <FreshIcon fresh={fresh} />
          <span>{freshLine(batch)}</span>
        </div>
        <div className={styles['card-row']}>
          <input type="date" className={styles['card-input']} value={expires} aria-label="Свіже до" disabled={busy}
            onChange={(e) => commitExpires(e.target.value)} />
          {batch.expires_at && <button type="button" className={styles['link-btn']} disabled={busy} onClick={() => commitExpires('')}>без терміну</button>}
        </div>
      </div>

      {batch.origin && (
        <div className={styles['card-block']}>
          <span className={styles['card-label']}>Звідки</span>
          <div className={styles['card-line']} data-testid="origin-line">{originLine(batch)}</div>
        </div>
      )}

      {nutri && (
        <div className={styles['card-block']}>
          <span className={styles['card-label']}>На 100 г</span>
          <div className={styles['card-line']} data-testid="per-100">{nutri.per100}</div>
          {nutri.perItem && (
            <>
              <span className={styles['card-label']}>На позицію{batch.value != null && batch.unit ? ` · ${formatQty(batch.value, batch.unit)}` : ''}</span>
              <div className={styles['card-line']} data-testid="per-item">{nutri.perItem}</div>
            </>
          )}
        </div>
      )}

      {batch.no && (
        <div className={styles['card-block']}>
          <span className={styles['card-label']}>Профіль</span>
          <div className={`${styles['card-line']} ${styles['tone-plum']}`} data-testid="profile-line">{batch.no}</div>
        </div>
      )}

      <div className={styles['card-block']}>
        {batch.state === 'opened' && batch.opened_at
          ? <div className={styles['card-line']} data-testid="opened-line">відкрито {shortDate(batch.opened_at)}</div>
          : null}
        <button type="button" className={styles['card-action']} disabled={busy}
          onClick={() => void commit({ state: batch.state === 'opened' ? 'sealed' : 'opened' })}>
          {batch.state === 'opened' ? 'Позначити запакованою' : 'Позначити відкритою'}
        </button>
      </div>

      {error && <div className={styles['card-error']} role="status">{error}</div>}
      {footSlot ? createPortal(foot, footSlot) : foot}
    </div>
  );
}
