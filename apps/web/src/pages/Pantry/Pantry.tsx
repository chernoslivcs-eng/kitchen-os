// Комора (05 з брифу): партії дому, згруповані за зоною.
// Порядок зон — з брифу §01: свіже → холодильник → морозилка → комора → спеції → напої.
// Тап на партію → sheet із деталями, звідки можна відредагувати або прибрати.

import { useEffect, useRef, useState } from 'react';
import { api, type PantryBatch, type ShoppingList } from '../../api';
import { TabBar } from '../../components/TabBar/TabBar';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { Sheet } from '../../components/Sheet/Sheet';
import { plural } from '../../lib/plural';
import { formatQty } from '../../lib/units';
import styles from './Pantry.module.css';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { Avatar } from '../../components/Avatar/Avatar';
import { useAuth } from '../../store/auth';

const ZONE_ORDER: PantryBatch['zone'][] = ['fresh', 'fridge', 'freezer', 'dry', 'spices', 'drinks'];
const ZONE_LABEL: Record<PantryBatch['zone'], string> = {
  fresh: 'Свіже',
  fridge: 'Холодильник',
  freezer: 'Морозилка',
  dry: 'Суха шафа',
  spices: 'Спеції',
  drinks: 'Напої',
};

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function PantryPage() {
  const meName = useAuth((st) => st.me?.user?.name ?? null);
  const navigate = useNavigate();
  const [batches, setBatches] = useState<PantryBatch[]>([]);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PantryBatch | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  // QA9-09: швидке «✕» на рядку — списати одним тапом, з ↩ Повернути.
  const [removed, setRemoved] = useState<PantryBatch | null>(null);
  const removedTimer = useRef<number | null>(null);

  async function quickRemove(b: PantryBatch) {
    try {
      await api.batches.update(b.id, { state: 'depleted' });
      setRemoved(b);
      if (removedTimer.current != null) window.clearTimeout(removedTimer.current);
      removedTimer.current = window.setTimeout(() => setRemoved(null), 8000);
      await refresh();
    } catch { /* рядок лишиться — видно, що не вийшло */ }
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

  async function refresh() {
    try {
      const [p, s] = await Promise.all([api.pantry(), api.shopping.list().catch(() => ({ count: 0 } as ShoppingList))]);
      setBatches(p.batches);
      setShoppingCount(s.count);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? batches.filter((b) => b.label.toLowerCase().includes(q))
    : batches;
  const byZone = new Map<PantryBatch['zone'], PantryBatch[]>();
  for (const b of filtered) {
    if (!byZone.has(b.zone)) byZone.set(b.zone, []);
    byZone.get(b.zone)!.push(b);
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.title}>Комора</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={meName} />
          <button
            onClick={() => setAdding(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              padding: '5px 12px',
              color: 'var(--fg-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            + Додати
          </button>
          {/* QA6-12: під час пошуку лічильник показував загальну кількість —
              «9 ПОЗИЦІЙ» при одній видимій. */}
          <div className={styles.meta}>
            {q
              ? `${filtered.length} З ${batches.length}`
              : `${batches.length} ${plural(batches.length, ['ПОЗИЦІЯ', 'ПОЗИЦІЇ', 'ПОЗИЦІЙ'])}`}
          </div>
        </div>
      </div>

      <div className={styles.body}>
        {batches.length >= 8 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Знайти в коморі"
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
        {loading && <SkeletonRows rows={5} />}
        {!loading && batches.length === 0 && (
          <div className={styles.empty}>
            <h3>Комора порожня</h3>
            {/* DA-03: «порожні стани — коротко, з дією». Дія і є суть патерна. */}
            <p>Сфотографуй полицю або перелічи 5–10 позицій — решту доберемо.</p>
            <p style={{ marginTop: 12 }}>
              <Button onClick={() => navigate('/app')}>Показати кухню</Button>
            </p>
          </div>
        )}
        {!loading && batches.length > 0 && filtered.length === 0 && (
          <div className={styles.empty} style={{ borderStyle: 'solid' }}>
            <p>Нічого не знайшлось за «{query}». Спробуй інше слово.</p>
          </div>
        )}

        {ZONE_ORDER.map((zone) => {
          const items = byZone.get(zone);
          if (!items?.length) return null;
          return (
            <div key={zone}>
              <div className={styles['section-label']}>{ZONE_LABEL[zone]}</div>
              {items.map((b) => {
                const days = daysLeft(b.expires_at);
                const urgent = b.state === 'opened' && days != null && days <= 5;
                return (
                  /* QA9-09: рядок — контейнер: тап по тілу відкриває редагування,
                     ✕ праворуч списує одним дотиком (з ↩ Повернути внизу). */
                  <div key={b.id} className={styles.row} style={{ borderBottom: '1px solid var(--border)' }}>
                    <button
                      className={styles['row-main']}
                      onClick={() => setEditing(b)}
                    >
                      <span className={`${styles.mark} ${b.state === 'opened' ? styles.opened : ''}`}>
                        {b.state === 'opened' ? '◔' : '●'}
                      </span>
                      <span className={styles.name}>
                        {b.label}
                        {urgent && days != null && (
                          <span className={styles.hint}>ВІДКРИТО · ≈{days} {days === 1 ? 'ДЕНЬ' : 'ДНІ'}</span>
                        )}
                      </span>
                      {b.value != null && b.unit && (
                        <span className={styles.qty}>{formatQty(b.value, b.unit)}</span>
                      )}
                    </button>
                    <button
                      className={styles['row-x']}
                      aria-label={`Списати «${b.label}»`}
                      title="Закінчилось — списати"
                      onClick={() => void quickRemove(b)}
                    >✕</button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {removed && (
        <div className={styles['undo-bar']} role="status">
          <span style={{ flex: 1 }}>Списано «{removed.label}»</span>
          <button type="button" onClick={() => void undoRemove()}>↩ Повернути</button>
        </div>
      )}

      {editing && (
        <BatchEditSheet
          batch={editing}
          onClose={() => setEditing(null)}
          onChanged={async () => { await refresh(); setEditing(null); }}
        />
      )}

      {adding && (
        <BatchAddSheet
          onClose={() => setAdding(false)}
          onCreated={async () => { await refresh(); setAdding(false); }}
        />
      )}

      <TabBar shoppingCount={shoppingCount} />
    </div>
  );
}

const ZONE_OPTIONS: { value: PantryBatch['zone']; label: string }[] = [
  { value: 'fresh', label: 'Свіже' },
  { value: 'fridge', label: 'Холодильник' },
  { value: 'freezer', label: 'Морозилка' },
  { value: 'dry', label: 'Суха шафа' },
  { value: 'spices', label: 'Спеції' },
  { value: 'drinks', label: 'Напої' },
];
const UNIT_OPTIONS: { value: PantryBatch['unit']; label: string }[] = [
  { value: null, label: '—' },
  { value: 'g', label: 'г' },
  { value: 'ml', label: 'мл' },
  { value: 'pcs', label: 'шт' },
  { value: 'pack', label: 'пач' },
];

function BatchEditSheet({ batch, onClose, onChanged }: { batch: PantryBatch; onClose: () => void; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState(batch.label);
  const [value, setValue] = useState<string>(batch.value != null ? String(batch.value) : '');
  const [unit, setUnit] = useState<PantryBatch['unit']>(batch.unit);
  const [zone, setZone] = useState<PantryBatch['zone']>(batch.zone);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const v = value.trim() === '' ? null : Number(value.trim());
      await api.batches.update(batch.id, {
        label: label.trim(),
        value: v,
        unit,
        zone,
      });
      await onChanged();
    } catch (err) {
      alert(`Не вдалося зберегти: ${(err as Error).message}`);
    } finally { setSaving(false); }
  }

  async function toggleOpened() {
    setSaving(true);
    try {
      // FIX-04: перемикач «Відкрито» шле ще й поточні поля форми, інакше тап
      // тихо викидає все, що юзер щойно наредагував, і закриває шит.
      const v = value.trim() === '' ? null : Number(value.trim());
      await api.batches.update(batch.id, {
        label: label.trim(),
        value: v,
        unit,
        zone,
        state: batch.state === 'sealed' ? 'opened' : 'sealed',
      });
      await onChanged();
    } catch (err) {
      alert(`Не вдалося зберегти: ${(err as Error).message}`);
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!confirm('Прибрати з комори? Це те саме, що «зʼїли» — в історії лишиться.')) return;
    setSaving(true);
    try {
      await api.batches.remove(batch.id);
      await onChanged();
    } catch (err) {
      alert(`Не вдалося прибрати: ${(err as Error).message}`);
    } finally { setSaving(false); }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Редагувати позицію">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <MonoLabel>ПОЗИЦІЯ</MonoLabel>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 20 }}
            aria-label="Закрити"
          >✕</button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Назва</span>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Кількість</span>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Одиниця</span>
            <select
              value={unit ?? ''}
              onChange={(e) => setUnit((e.target.value || null) as PantryBatch['unit'])}
              style={{
                padding: '11px 12px', background: 'var(--bg-input)',
                border: '1px solid var(--border)', borderRadius: 'var(--r)',
                color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 14,
              }}
            >
              {UNIT_OPTIONS.map((o) => <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Зона</span>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value as PantryBatch['zone'])}
            style={{
              padding: '11px 12px', background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 'var(--r)',
              color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 14,
            }}
          >
            {ZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <Button variant="secondary" onClick={toggleOpened} disabled={saving}>
            {batch.state === 'sealed' ? '◔ Відкрито' : '● Запаковано'}
          </Button>
          <div style={{ flex: 1 }} />
          <Button onClick={save} loading={saving}>Зберегти</Button>
        </div>

        <button
          onClick={remove}
          disabled={saving}
          style={{
            marginTop: 4,
            background: 'transparent', border: 0,
            color: 'var(--danger)', fontFamily: 'var(--font-mono)',
            fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '10px 0', cursor: 'pointer',
          }}
        >
          Прибрати з комори
        </button>
    </Sheet>
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
    if (!l) { setError('Назва потрібна'); return; }
    setSaving(true);
    setError(null);
    try {
      const v = value.trim() === '' ? null : Number(value.trim());
      if (v != null && isNaN(v)) { setError('Кількість — число або порожнє'); return; }
      await api.batches.create({ label: l, value: v, unit, zone });
      await onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Додати позицію в комору">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <MonoLabel>ДОДАТИ ПОЗИЦІЮ</MonoLabel>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 20 }}
            aria-label="Закрити"
          >✕</button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Назва</span>
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Кількість</span>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="250" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Одиниця</span>
            <select
              value={unit ?? ''}
              onChange={(e) => setUnit((e.target.value || null) as PantryBatch['unit'])}
              style={{
                padding: '11px 12px', background: 'var(--bg-input)',
                border: '1px solid var(--border)', borderRadius: 'var(--r)',
                color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 14,
              }}
            >
              {UNIT_OPTIONS.map((o) => <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase' }}>Зона</span>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value as PantryBatch['zone'])}
            style={{
              padding: '11px 12px', background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 'var(--r)',
              color: 'var(--fg)', fontFamily: 'var(--font-body)', fontSize: 14,
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
