// Список покупок (06 з брифу): чекбокс + назва + кількість + причина + видалити.
// Клік на checkbox — оптимістично перекреслюємо і летимо POST.
// Клік на × — видаляємо запис без confirm; помилку показуємо тост-ом.

import { useEffect, useState } from 'react';
import { api, type ShoppingItem } from '../../api';
import { TabBar } from '../../components/TabBar/TabBar';
import styles from './Shopping.module.css';

export function ShoppingPage() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setItems((await api.shopping.list()).items); }
      finally { setLoading(false); }
    })();
  }, []);

  async function toggle(it: ShoppingItem) {
    const nextChecked = !it.checked;
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, checked: nextChecked } : x));
    try { await api.shopping.toggle(it.id, nextChecked); }
    catch {
      // Відкат при помилці — стан такий, як був до кліку.
      setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, checked: it.checked } : x));
    }
  }

  async function remove(it: ShoppingItem) {
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    try { await api.shopping.remove(it.id); } catch {
      // Повертаємо; але порядок може загубитись — простіше перечитати список.
      const fresh = await api.shopping.list();
      setItems(fresh.items);
    }
  }

  const unchecked = items.filter((x) => !x.checked).length;

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.title}>Список</div>
        <div className={styles.meta}>{unchecked} / {items.length}</div>
      </div>

      <div className={styles.body}>
        {!loading && items.length === 0 && (
          <div className={styles.empty}>
            <h3>Список порожній</h3>
            <p>Скажи асистенту «додай молоко в список» — з'явиться тут. Або з картки пропозиції «+ у список».</p>
          </div>
        )}

        {items.map((it) => (
          <div key={it.id} className={styles.row}>
            <button
              className={`${styles.check} ${it.checked ? styles.checked : ''}`}
              onClick={() => toggle(it)}
              aria-label={it.checked ? 'Зняти галочку' : 'Позначити куплене'}
            >
              {it.checked ? '✓' : ''}
            </button>
            <span className={`${styles.label} ${it.checked ? styles.done : ''}`}>
              {it.label}
              {it.reason && <span className={styles.reason}>{it.reason}</span>}
            </span>
            {it.value != null && it.unit && (
              <span className={styles.qty}>{it.value}{it.unit}</span>
            )}
            <button className={styles.delete} onClick={() => remove(it)} aria-label="Видалити">×</button>
          </div>
        ))}
      </div>

      <TabBar shoppingCount={unchecked} />
    </div>
  );
}
