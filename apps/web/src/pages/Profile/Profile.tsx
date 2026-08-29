// Профіль (11 з брифу): три блоки з чипами (алергії/побажання/анти),
// плюс список членів дому, плюс logout.
//
// MVP-межа: тут тільки перегляд + чипи, редагування — через чат
// ("Оля не їсть лактозу", "запам'ятай алергію арахіс"). Це саме те,
// про що бриф §07: «прогресивне розкриття — питання ставиться в момент,
// коли відповідь на нього одразу потрібна».

import { useEffect, useState, type FormEvent } from 'react';
import { api, type ProfileData, type Me, type InviteInfo } from '../../api';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { TabBar } from '../../components/TabBar/TabBar';
import { useAuth } from '../../store/auth';
import styles from './Profile.module.css';

export function ProfilePage() {
  const logout = useAuth((s) => s.logout);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

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
      if (m) {
        try {
          const inv = await api.households.listInvites(m.household.id);
          setInvites(inv.invites);
        } catch { /* no permission or transient error — не показуємо */ }
      }
    })();
  }, []);

  async function inviteSend(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteError('Схоже, це не email');
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      await api.households.invite(me.household.id, email);
      setInviteEmail('');
      const fresh = await api.households.listInvites(me.household.id);
      setInvites(fresh.invites);
    } catch (err) {
      setInviteError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function inviteRevoke(id: string) {
    try {
      await api.invites.revoke(id);
      if (me) {
        const fresh = await api.households.listInvites(me.household.id);
        setInvites(fresh.invites);
      }
    } catch { /* ignore for MVP */ }
  }

  function inviteStatus(inv: InviteInfo): { text: string; tone: 'pending' | 'muted' | 'danger' | 'applied' } {
    if (inv.consumed_at) return { text: 'ПРИЙНЯТО', tone: 'applied' };
    if (inv.revoked_at) return { text: 'СКАСОВАНО', tone: 'muted' };
    const expired = new Date(inv.expires_at).getTime() < Date.now();
    if (expired) return { text: 'ТЕРМІН СПЛИВ', tone: 'muted' };
    return { text: 'ЧЕКАЄ', tone: 'pending' };
  }

  const activeInvites = invites.filter((i) => !i.consumed_at && !i.revoked_at);

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
              {me.household.members.map((mem) => {
                const isMe = mem.user_id === me.user.id;
                const iAmOwner = me.household.role === 'owner';
                // Власник бачить «× видалити» на всіх, крім себе.
                // Учасник бачить «× вийти» тільки на собі.
                const canRemove = (iAmOwner && !isMe) || (isMe && me.household.role !== 'owner');
                return (
                  <div key={mem.user_id} className={styles.member}>
                    <div className={styles.avatar}>{initials(mem.name)}</div>
                    <span className={styles.name}>{mem.name}</span>
                    <span className={styles.role}>{mem.role.toUpperCase()}</span>
                    {iAmOwner && !isMe && mem.role === 'member' && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Передати роль власника ${mem.name}? Ти станеш звичайним учасником.`)) return;
                          try {
                            // Транзакційно: спочатку піднімаємо target, потім знижуємо себе.
                            // Якщо перше вдалось, а друге ні — просто дім із двома власниками,
                            // не критично.
                            await api.households.setRole(me.household.id, mem.user_id, 'owner');
                            await api.households.setRole(me.household.id, me.user.id, 'member');
                            const fresh = await api.me().catch(() => null);
                            if (fresh) setMe(fresh);
                          } catch (err) { alert((err as Error).message); }
                        }}
                        style={{
                          border: 0, background: 'transparent',
                          color: 'var(--fg-dim)', cursor: 'pointer',
                          fontSize: 12, fontFamily: 'var(--font-mono)',
                          marginLeft: 8, padding: '4px 6px',
                        }}
                        title="Передати роль власника"
                      >↑ РОЛЬ</button>
                    )}
                    {canRemove && (
                      <button
                        onClick={async () => {
                          const label = isMe ? 'Вийти з дому?' : `Виключити ${mem.name}?`;
                          if (!confirm(label)) return;
                          try {
                            await api.households.removeMember(me.household.id, mem.user_id);
                            if (isMe) {
                              await logout();
                            } else {
                              // Оновити список членів на екрані
                              const fresh = await api.me().catch(() => null);
                              if (fresh) setMe(fresh);
                            }
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                        style={{
                          border: 0, background: 'transparent',
                          color: 'var(--fg-dim)', cursor: 'pointer',
                          fontSize: 12, fontFamily: 'var(--font-mono)',
                          marginLeft: 8, padding: '4px 6px',
                        }}
                        title={isMe ? 'Вийти з дому' : 'Виключити з дому'}
                      >
                        × {isMe ? 'ВИЙТИ' : 'ВИКЛЮЧИТИ'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {me && (
          <div className={styles.section}>
            <div className={styles['section-label']}>Запросити в дім</div>
            <div className={styles.hint}>
              Гість отримає лінк на email — клік у нього автоматично залогінить і додасть у {me.household.name}. Пароля не треба.
            </div>
            <form onSubmit={inviteSend} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  error={inviteError}
                />
              </div>
              <Button type="submit" loading={inviting}>Надіслати</Button>
            </form>
            {activeInvites.length > 0 && (
              <div className={styles.members} style={{ marginTop: 12 }}>
                {activeInvites.map((inv) => {
                  const s = inviteStatus(inv);
                  return (
                    <div key={inv.id} className={styles.member}>
                      <div className={styles.avatar}>@</div>
                      <span className={styles.name}>{inv.email}</span>
                      <span className={styles.role} style={{
                        color: s.tone === 'pending' ? 'var(--amber)'
                          : s.tone === 'applied' ? 'var(--accent)'
                          : s.tone === 'danger' ? 'var(--danger)'
                          : 'var(--fg-dim)',
                      }}>{s.text}</span>
                      {s.tone === 'pending' && (
                        <button
                          onClick={() => inviteRevoke(inv.id)}
                          style={{
                            border: 0, background: 'transparent',
                            color: 'var(--fg-dim)', cursor: 'pointer',
                            fontSize: 12, fontFamily: 'var(--font-mono)',
                            marginLeft: 8, padding: '4px 6px',
                          }}
                          title="Скасувати запрошення"
                        >
                          × СКАСУВАТИ
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
