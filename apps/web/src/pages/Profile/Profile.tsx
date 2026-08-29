// Профіль (11 з брифу): три блоки з чипами (алергії/побажання/анти),
// плюс список членів дому, плюс logout.
//
// MVP-межа: тут тільки перегляд + чипи, редагування — через чат
// ("Оля не їсть лактозу", "запам'ятай алергію арахіс"). Це саме те,
// про що бриф §07: «прогресивне розкриття — питання ставиться в момент,
// коли відповідь на нього одразу потрібна».

import { useEffect, useState } from 'react';
import { api, type ProfileData, type Me } from '../../api';
import { Button } from '../../components/Button/Button';
import { TabBar } from '../../components/TabBar/TabBar';
import { useAuth } from '../../store/auth';
import styles from './Profile.module.css';

export function ProfilePage() {
  const logout = useAuth((s) => s.logout);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [shoppingCount, setShoppingCount] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const [p, m, s] = await Promise.all([
        api.profile().catch(() => ({ profile: null as ProfileData | null })),
        api.me().catch(() => null),
        api.shopping.list().catch(() => ({ count: 0 })),
      ]);
      setProfile(p.profile);
      setMe(m);
      setShoppingCount(s.count);
    })();
  }, []);

  const initials = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.title}>Профіль</div>
        {me && <div className={styles.who}>{me.user.email}</div>}
      </div>

      <div className={styles.body}>
        <div className={styles.section}>
          <div className={styles['section-label']}>Алергії</div>
          <div className={styles.hint}>
            Конкретними назвами. «Молюски» не помітять «мідії» — тому виписуємо всі назви, під якими продукт зустрічається.
          </div>
          <div className={styles.chips}>
            {(profile?.allergies ?? []).length === 0 && (
              <span className={styles['empty-chip']}>ще жодної</span>
            )}
            {profile?.allergies.map((a, i) => (
              <span key={i} className={`${styles.chip} ${styles['chip-allergy']}`}>⚠ {a}</span>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles['section-label']}>Побажання</div>
          <div className={styles.hint}>
            Куди тягнути. Вільні фрази: традиції, дієта, свята, наміри, смаки.
          </div>
          <div className={styles.chips}>
            {(profile?.wishes ?? []).length === 0 && (
              <span className={styles['empty-chip']}>ще жодного</span>
            )}
            {profile?.wishes.map((w, i) => (
              <span key={i} className={`${styles.chip} ${styles['chip-wish']}`}>{w}</span>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles['section-label']}>Антипатерни</div>
          <div className={styles.hint}>
            Від чого відштовхуватись. Сила читається з формулювання: «не їм свинину» — принципово; «не люблю кінзу» — смак.
          </div>
          <div className={styles.chips}>
            {(profile?.antipatterns ?? []).length === 0 && (
              <span className={styles['empty-chip']}>ще жодного</span>
            )}
            {profile?.antipatterns.map((a, i) => (
              <span key={i} className={`${styles.chip} ${styles['chip-anti']}`}>{a}</span>
            ))}
          </div>
        </div>

        {me && me.household.members.length > 0 && (
          <div className={styles.section}>
            <div className={styles['section-label']}>Дім · {me.household.name}</div>
            <div className={styles.members}>
              {me.household.members.map((mem) => (
                <div key={mem.user_id} className={styles.member}>
                  <div className={styles.avatar}>{initials(mem.name)}</div>
                  <span className={styles.name}>{mem.name}</span>
                  <span className={styles.role}>{mem.role.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.logout}>
          <Button variant="secondary" onClick={() => logout()}>Вийти</Button>
        </div>
      </div>

      <TabBar shoppingCount={shoppingCount} />
    </div>
  );
}
