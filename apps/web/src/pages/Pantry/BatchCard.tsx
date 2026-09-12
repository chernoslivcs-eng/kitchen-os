// Картка позиції комори в правій панелі артефактів (замість модалки).
// Збереження без кнопки: blur/enter на полі → PATCH, як на сторінці профілю.
//
// Крок 2 things-v3 — вигляд за Components «ITEM CARD + WRITE-OFF» і
// Responsive G6 («плавуча 380 на десктопі · шторка на 390 · три осі рядка
// стають трьома блоками: безпека · час · походження»), поведінка — Prototype
// (aside картки: паспорт · Кількість ± · стан ціле/відкрито · строк · безпека
// · поживність). Контракт той самий: label / value / unit / zone / state /
// expires_at, причина списання — з картки обовʼязкова (⚠3).

import { useContext, useEffect, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, DEPLETED_REASON_LABEL, type DepletedReason, type HouseholdProduct, type PantryBatch } from '../../api';
import { PanelFootSlot } from '../Feed/panel-slots';
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';
import { Icon } from '../../components/Icon/Icon';
import { ZONE_OPTIONS, UNIT_OPTIONS, freshness, shortDate } from './filter';
import styles from './Pantry.module.css';

const ORIGIN_KIND = { receipt: 'чек', manual: 'додано рукою', chat: 'з розмови', inference: 'домислено' } as const;

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
  if (o.kind === 'inference') return o.confidence != null ? `${ORIGIN_KIND.inference} · ${Math.round(o.confidence * 100)} %` : ORIGIN_KIND.inference;
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

/**
 * Блок «Строк» (Components / G6 / Prototype): заголовок називає, що саме
 * скінчилось, підрядок — як порахувано. Тон — danger на простроченому,
 * бурштин ≤ 3 дні, інакше тихо.
 */
export function termBlock(b: Pick<PantryBatch, 'days' | 'expires_at' | 'expires_source' | 'catalog_key' | 'added_at'>): { title: string; sub: string; tone: 'danger' | 'amber' | 'quiet' } {
  const manual = b.expires_source === 'manual' && !!b.expires_at;
  const sub = manual
    ? `з пачки, поставив ти · до ${shortDate(b.expires_at)}`
    : !b.catalog_key ? 'без категорії · строк не рахую'
    : b.days == null ? 'рішення каталогу · строк не рахую'
    : `≈ рахую від додавання ${shortDate(b.added_at)} · дати на пачці не знаю`;
  if (b.days == null) return { title: !b.catalog_key ? 'Без категорії' : 'Не псується', sub, tone: 'quiet' };
  if (b.days < 0) {
    const n = Math.abs(b.days);
    return { title: `${manual ? 'Строк' : 'Розрахунок'} скінчився ${n} ${plural(n, ['день', 'дні', 'днів'])} тому`, sub, tone: 'danger' };
  }
  if (b.days === 0) return { title: `${manual ? 'Строк' : 'Розрахунок'} скінчився — сьогодні`, sub, tone: 'danger' };
  if (b.days <= 3) return { title: `Ще ${b.days} дн — краще не відкладати`, sub, tone: 'amber' };
  return { title: manual ? `Ще ${b.days} дн` : `Ще ≈ ${b.days} дн`, sub, tone: 'quiet' };
}

const toDateInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
/** Крок ± для кількості: штуки й пачки по одній, грами й мілілітри по 50. */
const stepOf = (unit: PantryBatch['unit']) => (unit === 'pcs' || unit === 'pack' ? 1 : 50);

export function BatchCard({ batch, product, onChanged, onRemove }: {
  batch: PantryBatch; product: HouseholdProduct | null;
  onChanged: () => Promise<void>;
  /** 2c, ⚠3: з картки причина ОБОВʼЯЗКОВА — без неї списати не можна. */
  onRemove: (reason: DepletedReason) => Promise<void>;
}) {
  const footSlot = useContext(PanelFootSlot);
  // 2c: «Списати» розкриває трійку причин; ні «Прибрати» без причини, ні
  // confirm() більше немає. Це головна діра продукту за PLAN §3: метрика
  // «зіпсувалось» не мала чисельника, бо жодна кнопка причину не передавала.
  const [askReason, setAskReason] = useState(false);
  const [label, setLabel] = useState(batch.label);
  const [value, setValue] = useState(batch.value != null ? String(batch.value) : '');
  const [expires, setExpires] = useState(toDateInput(batch.expires_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // «Ще годиться» (Prototype `stillOk`): відповідь без контракту — гасить
  // плашку до закриття картки, нічого не пише. Не відповів — нічого не сталось.
  const [stillOk, setStillOk] = useState(false);
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
  const nudge = (dir: -1 | 1) => {
    const cur = batch.value ?? 0;
    const next = Math.max(0, cur + dir * stepOf(batch.unit));
    setValue(String(next));
    if (next !== batch.value) void commit({ value: next });
  };
  const commitExpires = (d: string) => {
    setExpires(d);
    const next = d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null;
    if (next !== batch.expires_at) void commit({ expires_at: next });
  };

  const nutri = nutritionLines(batch);
  const fresh = freshness(batch.days);
  const term = termBlock(batch);
  const expired = term.tone === 'danger' && !stillOk;
  const tone = stillOk ? 'quiet' : term.tone;
  const opened = batch.state === 'opened';
  const passport = product ? [product.brand, product.variant].filter(Boolean).join(' · ') : '';
  const unitLabel = UNIT_OPTIONS.find((o) => o.value === batch.unit)?.label ?? '—';

  const foot = askReason ? (
    <div className={styles['card-reasons']} role="group" aria-label="Чому списуємо">
      {(Object.keys(DEPLETED_REASON_LABEL) as DepletedReason[]).map((r) => (
        <button key={r} type="button" className={`${styles['card-reason']} ${r === 'spoiled' ? styles['card-reason-danger'] : ''}`}
          disabled={busy} data-reason={r} onClick={() => void onRemove(r)}>
          {DEPLETED_REASON_LABEL[r]}
        </button>
      ))}
      <button type="button" className={styles['card-reason-cancel']} onClick={() => setAskReason(false)}>Не списувати</button>
    </div>
  ) : (
    /* Підвал (Components / G6): «Зміни зберігаються самі» 13 muted · «Списати»
       контуром danger 38. Без «Зберегти» (⚠2). */
    <div className={styles['card-foot']}>
      <span className={styles['card-foot-note']}>Зміни зберігаються самі</span>
      <button type="button" className={styles['card-remove']} disabled={busy} onClick={() => setAskReason(true)}>Списати</button>
    </div>
  );

  return (
    <div className={styles.card} data-testid="batch-card">
      {/* Паспорт (Components): заголовок = перше з трійки (назва партії, правиться
          на місці), бренд · тип — підзаголовок; третій рядок — походження:
          «чек Сільпо · 7 вер» (G6 «з чека: … · Сільпо 7 вер»; сирого рядка чека
          й ціни в даних нема). На 390 — без цього рядка (G6). */}
      <div className={styles['card-head']}>
        <input className={styles['card-title']} value={label} aria-label="Назва" enterKeyHint="done" disabled={busy}
          onChange={(e) => setLabel(e.target.value)} onBlur={commitLabel} onKeyDown={onEnter} />
        {passport && <span className={styles['card-passport']}>{passport}</span>}
        {batch.origin && <span className={styles['card-origin']} data-testid="origin-line">{originLine(batch)}</span>}
      </div>

      {/* Кількість ± (Prototype) · Стан ціле / відкрито (Components, G6). */}
      <div className={styles['card-row']}>
        <div className={styles['card-field']}>
          <span className={styles['card-label']}>Кількість</span>
          <div className={styles['card-qty']}>
            <input className={styles['card-qty-input']} inputMode="decimal" enterKeyHint="done" value={value} aria-label="Кількість" disabled={busy}
              onChange={(e) => setValue(e.target.value)} onBlur={commitValue} onKeyDown={onEnter} />
            <label className={styles['card-unit']}>
              <span>{unitLabel}</span><Icon name="sys.open" size={12} inherit decorative />
              <select className={styles['card-unit-select']} value={batch.unit ?? ''} aria-label="Одиниця" disabled={busy}
                onChange={(e) => void commit({ unit: (e.target.value || null) as PantryBatch['unit'] })}>
                {UNIT_OPTIONS.map((o) => <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>)}
              </select>
            </label>
            <button type="button" className={styles['card-nudge']} disabled={busy} onClick={() => nudge(-1)} aria-label="Менше" data-nudge="-"><Icon name="sys.less" size={12} inherit decorative /></button>
            <button type="button" className={styles['card-nudge']} disabled={busy} onClick={() => nudge(1)} aria-label="Більше" data-nudge="+"><Icon name="sys.add" size={12} inherit decorative /></button>
          </div>
        </div>
        <div className={`${styles['card-field']} ${styles['card-field-state']}`}>
          <span className={styles['card-label']}>Стан</span>
          <div className={styles['card-seg']} role="radiogroup" aria-label="Стан">
            <button type="button" role="radio" aria-checked={!opened} className={`${styles['card-seg-btn']} ${!opened ? styles['card-seg-on'] : ''}`}
              disabled={busy} onClick={() => { if (opened) void commit({ state: 'sealed' }); }}>ціле</button>
            <button type="button" role="radio" aria-checked={opened} className={`${styles['card-seg-btn']} ${opened ? styles['card-seg-on'] : ''}`}
              disabled={busy} onClick={() => { if (!opened) void commit({ state: 'opened' }); }}>відкрито</button>
          </div>
        </div>
      </div>

      {/* Строк — вісь часу блоком: плашка (danger / бурштин / тихо), дві
          відповіді на простроченому (необовʼязково), дата з пачки. «Був у
          морозилці» (G6) — контракту немає, не робиться (DEBT). */}
      <div className={styles['card-field']}>
        <span className={styles['card-label']}>Строк</span>
        <div className={`${styles['card-term']} ${styles[`card-term-${tone}`]}`} data-testid="fresh-line" data-tone={tone} data-fresh={fresh}>
          <span className={styles['card-term-icon']}>
            {tone === 'danger' ? <Icon name="live.overdue" size={16} inherit decorative /> : <Icon name="cook.time" size={16} inherit decorative />}
          </span>
          <span className={styles['card-term-text']}>
            <span className={styles['card-term-title']}>{stillOk ? 'Ще годиться — сказав ти' : term.title}</span>
            <span className={styles['card-term-sub']}>{term.sub}</span>
          </span>
        </div>
        {expired && (
          <>
            <div className={styles['card-answers']}>
              <button type="button" className={styles['card-answer']} onClick={() => setStillOk(true)} data-still-ok>
                <Icon name="sys.done" size={16} inherit decorative className={styles['tone-sage']} />Ще годиться
              </button>
              <button type="button" className={`${styles['card-answer']} ${styles['card-answer-danger']}`} disabled={busy} onClick={() => void onRemove('spoiled')} data-spoiled>
                Зіпсувалось
              </button>
            </div>
            <span className={styles['card-hint']}>Необовʼязково — не відповів, нічого не сталось.</span>
          </>
        )}
        <label className={styles['card-date']}>
          <Icon name="sys.calendar" size={16} inherit decorative />
          <span className={styles['card-date-text']}>{batch.expires_source === 'manual' && batch.expires_at ? `Дата з пачки · ${shortDate(batch.expires_at)}` : 'Дата з пачки — постав, і розрахунок стане точним'}</span>
          <input type="date" className={styles['card-date-input']} value={expires} aria-label="Свіже до" disabled={busy}
            onChange={(e) => commitExpires(e.target.value)} />
          {batch.expires_at && batch.expires_source === 'manual'
            ? <button type="button" className={styles['link-btn']} disabled={busy} onClick={(e) => { e.preventDefault(); commitExpires(''); }}>прибрати</button>
            : <span className={styles['card-date-hint']}>дд.мм</span>}
        </label>
      </div>

      {/* Безпека — вісь обмеження блоком: чіп plum зі знаком ban. Охоплення
          («категорія „мʼясо“ · Оля») у даних нема (Р13 → DEBT §24). */}
      {batch.no && (
        <div className={styles['card-field']}>
          <span className={styles['card-label']}>Безпека</span>
          <span className={styles['card-safety']} data-testid="profile-line"><Icon name="cook.ban" size={12} inherit decorative />{batch.no}</span>
        </div>
      )}

      {/* Місце — чого бандл не має: партію можна перекласти в іншу зону. */}
      <div className={styles['card-field']}>
        <span className={styles['card-label']}>Місце</span>
        <select className={styles['card-select']} value={batch.zone} aria-label="Зона" disabled={busy}
          onChange={(e) => void commit({ zone: e.target.value as PantryBatch['zone'] })}>
          {ZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {nutri && (
        <div className={styles['card-rows']}>
          <div className={styles['card-line']}><span className={styles['card-line-k']}>На 100 г</span><span className={styles['card-line-v']} data-testid="per-100">{nutri.per100}</span></div>
          {nutri.perItem && (
            <div className={styles['card-line']}><span className={styles['card-line-k']}>На позицію{batch.value != null && batch.unit ? ` · ${formatQty(batch.value, batch.unit)}` : ''}</span><span className={styles['card-line-v']} data-testid="per-item">{nutri.perItem}</span></div>
          )}
        </div>
      )}

      {opened && batch.opened_at && <span className={styles['card-hint']} data-testid="opened-line">відкрито {shortDate(batch.opened_at)}</span>}
      {error && <div className={styles['card-error']} role="status">{error}</div>}
      {footSlot ? createPortal(foot, footSlot) : foot}
    </div>
  );
}
