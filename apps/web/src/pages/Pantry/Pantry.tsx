// Комора (05 з брифу): партії дому, згруповані за зоною.
// Порядок зон — з брифу §01: свіже → холодильник → морозилка → комора → спеції → напої.

import { useEffect, useState } from 'react';
import { api, type PantryBatch, type ShoppingList } from '../../api';
import { TabBar } from '../../components/TabBar/TabBar';
import styles from './Pantry.module.css';

const ZONE_ORDER: PantryBatch['zone'][] = ['fresh', 'fridge', 'freezer', 'dry', 'spices', 'drinks'];
const ZONE_LABEL: Record<PantryBatch['zone'], string> = {
  fresh: 'Свіже',
  fridge: 'Холодильник',
  freezer: 'Морозилка',
  dry: 'Комора',
  spices: 'Спеції',
  drinks: 'Напої',
};

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function PantryPage() {
  const [batches, setBatches] = useState<PantryBatch[]>([]);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [p, s] = await Promise.all([api.pantry(), api.shopping.list().catch(() => ({ count: 0 } as ShoppingList))]);
        setBatches(p.batches);
        setShoppingCount(s.count);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const byZone = new Map<PantryBatch['zone'], PantryBatch[]>();
  for (const b of batches) {
    if (!byZone.has(b.zone)) byZone.set(b.zone, []);
    byZone.get(b.zone)!.push(b);
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.title}>Комора</div>
        <div className={styles.meta}>{batches.length} ПОЗИЦІЙ</div>
      </div>

      <div className={styles.body}>
        {!loading && batches.length === 0 && (
          <div className={styles.empty}>
            <h3>Комора порожня</h3>
            <p>Розкажи асистенту, що купив — воно з'явиться тут. Наприклад: «купив моцарелу 250 г».</p>
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
                  <div key={b.id} className={styles.row}>
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
                      <span className={styles.qty}>{b.value}{b.unit}</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <TabBar shoppingCount={shoppingCount} />
    </div>
  );
}
