// Список покупок (06 з брифу): чекбокс + назва + кількість + причина + видалити.
// Клік на checkbox — оптимістично перекреслюємо і летимо POST.
// Клік на × — видаляємо запис без confirm; помилку показуємо тост-ом.

import { useEffect, useState } from 'react';
import { track } from '../../lib/track';
import { useNavigate } from 'react-router-dom';
import { api, type ShoppingItem } from '../../api';
import { Icon } from '../../components/Icon/Icon';
import { formatQty } from '../../lib/units';
import { Toast } from '../../components/ErrorState/Toast';
import { LIST_FAILED } from '../../components/ErrorState/copy';
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

  // Крок Е1: не вдалось принести ≠ список порожній.
  const [loadFailed, setLoadFailed] = useState(false);
  const load = async () => {
    try {
      setItems((await api.shopping.list()).items);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); track('shopping_opened'); }, []);

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
      {loadFailed && (
        <Toast
          tone="danger"
          text={LIST_FAILED.text}
          action={{ label: LIST_FAILED.cta, run: () => void load() }}
        />
      )}
      {/* Prototype (Список): «N купити · M вже є» біля заголовка, розпірка,
          дії — кнопки 40 на card+тінь праворуч. Бандл не малює ні «Додати
          додому», ні непідключеного Сільпо — обидва тим самим родом кнопки. */}
      <AppHeader title="Список" onMenu={() => openNav(true)} fill action={<>
          {items.length > 0 && (
            <span className={styles.meta} data-meta>{unchecked} купити · {checkedCount} вже є</span>
          )}
          <span className={styles['head-gap']} />
          {checkedCount > 0 && (
            <button type="button" className={styles['head-btn']} onClick={unpackChecked} disabled={unpacking} data-unpack>
              <Icon name="sys.pantry" size={16} inherit decorative />
              <span className={styles.long}>Додати додому · {checkedCount}</span>
              <span className={styles.short}>Додому · {checkedCount}</span>
            </button>
          )}
          {retailReady && unchecked > 0 && (
            <button type="button" className={styles['head-btn']} onClick={() => void buildCart()} disabled={building} data-cart>
              <Icon name="sys.cart" size={16} inherit decorative />
              <span className={styles.long}>{building ? 'Шукаю все це в Сільпо…' : 'Зібрати кошик у Сільпо'}</span>
              <span className={styles.short}>{building ? 'Шукаю…' : 'Кошик'}</span>
            </button>
          )}
          {/* M13: авторизація — не на вході в застосунок, а в момент наміру
              оформити кошик. ?next повертає сюди ж після OAuth-круга. */}
          {!retailReady && unchecked > 0 && (retailStatus === 'none' || retailStatus === 'expired' || retailStatus === 'disconnected') && (
            <a className={`${styles['head-btn']} ${styles['head-btn-soft']}`} href={`/v1/retail/silpo/connect?next=${encodeURIComponent('/list')}`} data-connect>
              <Icon name="sys.cart" size={16} inherit decorative />
              <span className={styles.long}>{retailStatus === 'none' ? 'Підключити Сільпо' : 'Увійти в Сільпо'}</span>
              <span className={styles.short}>Сільпо</span>
            </a>
          )}
      </>} />

      <div className={styles.body}>
        {loading && <SkeletonRows rows={4} />}
        {!loading && items.length === 0 && (
          <div className={styles.empty}>
            <h3>Купувати поки нічого</h3>
            <p>Якщо для страви чогось бракує, після твого «так» воно опиниться тут. Без самодіяльності.</p>
          </div>
        )}

        {/* Картка списку (Prototype): r14, 4 20, рядки 56 з волосиною,
            чекбокс 22 r6, назва 15/500, під нею 12 dim «кількість · причина»
            або «вже є вдома · кількість». Весь рядок — тогл (UX-9: у магазині
            тапають по назві); ✕ — окрема мішень, бандл його не малює. */}
        {(items.length > 0 || !loading) && (
        <div className={styles.card}>
          {items.map((it) => {
            const qty = it.value != null && it.unit ? formatQty(it.value, it.unit) : null;
            const sub = it.checked
              ? ['вже є вдома', qty].filter(Boolean).join(' · ')
              : [qty, it.reason].filter(Boolean).join(' · ');
            return (
              <div
                key={it.id}
                className={`${styles.row} ${it.checked ? styles['row-done'] : ''} ${freshIds.has(it.id) ? styles['row-fresh'] : ''} ${leavingIds.has(it.id) ? styles['row-leave'] : ''}`}
              >
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => toggle(it)}
                  aria-pressed={it.checked}
                  aria-label={it.checked ? `${it.label} — зняти галочку` : `${it.label} — позначити куплене`}
                >
                  <span className={`${styles.check} ${it.checked ? styles.checked : ''}`} aria-hidden>
                    {it.checked ? <Icon name="sys.done" size={12} inherit decorative /> : null}
                  </span>
                  <span className={styles.text}>
                    <span className={styles.label}>{it.label}</span>
                    {sub && <span className={styles.sub}>{sub}</span>}
                  </span>
                </button>
                <button type="button" className={styles.delete} onClick={() => remove(it)} aria-label={`Прибрати «${it.label}» зі списку`} title="Прибрати зі списку">
                  <Icon name="sys.close" size={12} inherit />
                </button>
              </div>
            );
          })}

          {/* UX9-12: «стою біля полиці, згадав про молоко» — дописати руками,
              без чотирьох екранів і моделі. Рядок «+ Додати…» з Prototype і є
              поле: Enter або кнопка, що зʼявляється з текстом. */}
          <form onSubmit={addManual} className={styles.add}>
            <Icon name="sys.add" size={16} inherit decorative />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Додати…"
              aria-label="Додати в список"
            />
            {newLabel.trim() && (
              <button type="submit" className={styles['add-go']} disabled={adding}>Додати</button>
            )}
          </form>
        </div>
        )}
      </div>

    </div>
  );
}
