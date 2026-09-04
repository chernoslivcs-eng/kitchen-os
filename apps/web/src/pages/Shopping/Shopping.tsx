// Список покупок (06 з брифу): чекбокс + назва + кількість + причина + видалити.
// Клік на checkbox — оптимістично перекреслюємо і летимо POST.
// Клік на × — видаляємо запис без confirm; помилку показуємо тост-ом.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ShoppingItem } from '../../api';
import { plural } from '../../lib/plural';
import { formatQty } from '../../lib/units';
import styles from './Shopping.module.css';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { useAuth } from '../../store/auth';

export function ShoppingPage() {
  const openNav = useNavStore((st) => st.setOpen);
  const navigate = useNavigate();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  // M13 (канвас М6): кнопка «Зібрати кошик» зʼявляється лише коли мережа
  // підключена і в списку є хоч одна незакрита позиція. Не панічна CTA —
  // шавлієва вторинна над таббаром. Для непідключеного/протухлого —
  // мʼякший вхід (лінк на connect), не саму дію: авторизація живе в момент
  // наміру оформити кошик, не на вході в застосунок.
  const [retailStatus, setRetailStatus] = useState<'loading' | 'unavailable' | 'none' | 'active' | 'expired' | 'disconnected'>('loading');
  const retailReady = retailStatus === 'active';
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    void api.retail.status()
      .then((r) => setRetailStatus(r.silpo.status))
      .catch(() => setRetailStatus('unavailable'));
  }, []);
  async function buildCart() {
    if (building) return;
    setBuilding(true);
    try {
      await api.retail.buildCart();
      // Картка з цінами приходить у стрічку — ведемо людину до неї.
      navigate('/app');
    } catch {
      setBuilding(false);
    }
  }

  useEffect(() => {
    (async () => {
      try { setItems((await api.shopping.list()).items); }
      finally { setLoading(false); }
    })();
  }, []);

  // UX9-15: два вікна на одному акаунті не бачили одне одного — застарілий
  // екран нічим не позначався. Мінімум: перечитуємо на поверненні фокуса.
  useEffect(() => {
    const refetch = () => { void api.shopping.list().then((l) => setItems(l.items)).catch(() => {}); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', refetch);
    };
  }, []);

  // UX9-12: «стою біля полиці, згадав про молоко» — дописати руками, без
  // чотирьох екранів і моделі. POST /v1/shopping існує з QA-8.
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  async function addManual(e: { preventDefault(): void }) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label || adding) return;
    setAdding(true);
    try {
      await api.shopping.add(label);
      setNewLabel('');
      const fresh = (await api.shopping.list()).items;
      // Моушн-кіт §03: новий рядок в'їжджає (height 0→auto + fade), сусіди
      // з'їжджають. Позначаємо тільки прибулі id — F5 не анімує весь список.
      const known = new Set(items.map((x) => x.id));
      setFreshIds(new Set(fresh.filter((x) => !known.has(x.id)).map((x) => x.id)));
      setItems(fresh);
    } catch { /* рядок лишиться в полі — видно, що не додалось */ }
    finally { setAdding(false); }
  }

  async function toggle(it: ShoppingItem) {
    const nextChecked = !it.checked;
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, checked: nextChecked } : x));
    try { await api.shopping.toggle(it.id, nextChecked); }
    catch {
      // Відкат при помилці — стан такий, як був до кліку.
      setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, checked: it.checked } : x));
    }
  }

  // Моушн-кіт §03: видалення — колапс 250ms exit, потім рядок зникає з DOM.
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  async function remove(it: ShoppingItem) {
    setLeavingIds((prev) => new Set(prev).add(it.id));
    setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      setLeavingIds((prev) => { const n = new Set(prev); n.delete(it.id); return n; });
    }, 250);
    try { await api.shopping.remove(it.id); } catch {
      // Повертаємо; але порядок може загубитись — простіше перечитати список.
      const fresh = await api.shopping.list();
      setItems(fresh.items);
    }
  }

  const [unpacking, setUnpacking] = useState(false);
  async function unpackChecked() {
    if (!confirm('Додати куплене в комору?')) return;
    setUnpacking(true);
    // Моушн-кіт §03: гуртове перенесення виходить тим самим згортанням,
    // що й поштучне «прибрати» — інакше пів списку щезало одним кадром.
    const going = items.filter((x) => x.checked).map((x) => x.id);
    setLeavingIds((prev) => new Set([...prev, ...going]));
    try {
      await Promise.all([api.shopping.unpack(), new Promise<void>((r) => window.setTimeout(r, 250))]);
      const fresh = await api.shopping.list();
      setItems(fresh.items);
    } finally {
      setUnpacking(false);
      setLeavingIds((prev) => { const n = new Set(prev); for (const id of going) n.delete(id); return n; });
    }
  }

  const unchecked = items.filter((x) => !x.checked).length;
  const checkedCount = items.filter((x) => x.checked).length;

  return (
    <div className={styles.screen}>
      <AppHeader title="Список" onMenu={() => openNav(true)} action={<>
          {checkedCount > 0 && (
            <button
              onClick={unpackChecked}
              disabled={unpacking}
              style={{
                background: 'var(--accent-bg)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--r-pill)',
                padding: '5px 12px',
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: unpacking ? 'wait' : 'pointer',
              }}
            >
              → В КОМОРУ ({checkedCount})
            </button>
          )}
          <div className={styles.meta}>{unchecked} / {items.length}</div>
      </>} />

      <div className={styles.body}>
        <form onSubmit={addManual} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="+ Додати в список…"
            style={{
              flex: 1, padding: '10px 14px',
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              borderRadius: 'var(--r)', color: 'var(--fg)',
              fontFamily: 'var(--font-body)', fontSize: 14,
            }}
          />
          {newLabel.trim() && (
            <button
              type="submit"
              disabled={adding}
              style={{
                padding: '0 16px', border: 0, borderRadius: 'var(--r)',
                background: 'var(--accent)', color: 'var(--accent-fg-on)',
                fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                cursor: adding ? 'wait' : 'pointer',
              }}
            >Додати</button>
          )}
        </form>
        {loading && <SkeletonRows rows={4} />}
        {!loading && items.length === 0 && (
          <div className={styles.empty}>
            <h3>Купувати поки нічого</h3>
            <p>Якщо для страви чогось бракує, після твого «так» воно опиниться тут. Без самодіяльності.</p>
          </div>
        )}

        {items.map((it) => (
          <div
            key={it.id}
            className={`${styles.row} ${freshIds.has(it.id) ? styles['row-fresh'] : ''} ${leavingIds.has(it.id) ? styles['row-leave'] : ''}`}
          >
            <button
              className={`${styles.check} ${it.checked ? styles.checked : ''}`}
              onClick={() => toggle(it)}
              aria-label={it.checked ? 'Зняти галочку' : 'Позначити куплене'}
            >
              <span className={styles['check-box']}>{it.checked ? '✓' : ''}</span>
            </button>
            {/* Папіркат UX-9: у магазині тапають по НАЗВІ, не по кружечку 24px.
                Весь рядок-тіло — тогл; ✕ лишається окремою мішенню праворуч. */}
            <span
              className={`${styles.label} ${it.checked ? styles.done : ''}`}
              onClick={() => toggle(it)}
              style={{ cursor: 'pointer' }}
            >
              {it.label}
              {it.reason && <span className={styles.reason}>{it.reason}</span>}
            </span>
            {it.value != null && it.unit && (
              <span className={styles.qty}>{formatQty(it.value, it.unit)}</span>
            )}
            <button className={styles.delete} onClick={() => remove(it)} aria-label="Видалити">×</button>
          </div>
        ))}

        {retailReady && unchecked > 0 && (
          <button
            onClick={() => void buildCart()}
            disabled={building}
            style={{
              width: '100%', height: 48, marginTop: 14,
              border: '1px solid var(--accent-border)', borderRadius: 12,
              background: 'var(--accent-bg)', color: 'var(--accent)',
              fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600,
              cursor: building ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 16px', opacity: building ? 0.6 : 1,
            }}
          >
            <span>{building ? 'Шукаю все це в Сільпо…' : 'Зібрати кошик у Сільпо'}</span>
            <span style={{ fontWeight: 400 }}>{unchecked} {plural(unchecked, ['позиція', 'позиції', 'позицій'])} →</span>
          </button>
        )}

        {/* M13: авторизація — не на вході в застосунок, а в момент наміру
            оформити кошик (питання користувача про доцільність). ?next
            повертає сюди ж після OAuth-круга, а не на /profile. */}
        {!retailReady && unchecked > 0 && (retailStatus === 'none' || retailStatus === 'expired' || retailStatus === 'disconnected') && (
          <a
            href={`/v1/retail/silpo/connect?next=${encodeURIComponent('/list')}`}
            style={{
              width: '100%', height: 44, marginTop: 14, boxSizing: 'border-box',
              border: '1px solid var(--border-strong)', borderRadius: 12,
              background: 'transparent', color: 'var(--fg-muted)', textDecoration: 'none',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {retailStatus === 'none' ? 'Підключити Сільпо й не шукати все вручну' : 'Увійти в Сільпо, щоб зібрати кошик'} →
          </a>
        )}
      </div>

    </div>
  );
}
