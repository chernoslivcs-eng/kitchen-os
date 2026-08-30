// Профіль (11 з брифу): алергії, побажання, обмеження, техніка, висновки з
// готування, склад дому, logout.
//
// Основний шлях наповнення лишається розмовним — питання ставиться в момент,
// коли відповідь одразу потрібна (бриф §07). Але правити руками теж можна:
// поки екран був доступний лише для читання, помилка моделі в полі «алергії»
// коштувала ще однієї розмови й надії, що цього разу вона зрозуміє. Найдорожча
// помилка сиділа в найдорожчому полі й не мала кнопки.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProfileData, type Me, type InviteInfo, type NoteInfo, type EaterInfo } from '../../api';
import { TagInput } from '../../components/TagInput/TagInput';
import { EQUIP_EXTRA, DIET_PRESETS, cycleEquip, equipGlyph, type EquipState } from '../../lib/presets';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { useAuth } from '../../store/auth';
import styles from './Profile.module.css';
import { TabBar } from '../../components/TabBar/TabBar';

export function ProfilePage() {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [eaters, setEaters] = useState<EaterInfo[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Одна точка правки на всі три блоки. Відповідь сервера — джерело істини:
  // локально нічого не домальовуємо, щоб на екрані не з'явилось те, чого
  // в базі немає.
  async function patch(op: 'add' | 'remove', kind: 'allergy' | 'wish' | 'anti' | 'equip', label: string) {
    setProfileError(null);
    try {
      const { profile: next } = await api.profilePatch([{ op, kind, label }]);
      setProfile(next);
    } catch (err) {
      setProfileError((err as Error).message);
    }
  }

  async function patchEquip(label: string, has: boolean) {
    setProfileError(null);
    try {
      const { profile: next } = await api.profilePatch([{ op: 'add', kind: 'equip', label, has }]);
      setProfile(next);
    } catch (err) {
      setProfileError((err as Error).message);
    }
  }

  async function dropEater(id: string) {
    try {
      await api.deleteEater(id);
      setEaters((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setProfileError((err as Error).message);
    }
  }

  async function dropNote(id: string) {
    try {
      await api.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setProfileError((err as Error).message);
    }
  }

  useEffect(() => {
    (async () => {
      const [p, m, s] = await Promise.all([
        api.profile().catch(() => ({ profile: null as ProfileData | null, notes: [] as NoteInfo[], eaters: [] as EaterInfo[] })),
        api.me().catch(() => null),
        api.shopping.list().catch(() => ({ count: 0 })),
      ]);
      setProfile(p.profile);
      setNotes(p.notes ?? []);
      setEaters(p.eaters ?? []);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Бриф-2 5а: Профіль відкривається з аватара, тому в шапці «←». */}
          <button
            onClick={() => navigate(-1)}
            aria-label="Назад"
            style={{
              width: 38, height: 38, border: '1px solid var(--border-strong)',
              borderRadius: 10, background: 'transparent', color: 'var(--fg-muted)',
              cursor: 'pointer', fontSize: 16,
            }}
          >←</button>
          <div className={styles.title}>Профіль</div>
        </div>
        {me && <div className={styles.who}>{me.user.email}</div>}
      </div>

      <div className={styles.body}>
        <div className={styles.section}>
          <div className={styles['section-label']}>Алергії</div>
          <div className={styles.hint}>
            Конкретними назвами. «Молюски» не помітять «мідії» — тому виписуємо всі назви, під якими продукт зустрічається.
          </div>
          <TagInput
            values={profile?.allergies ?? []}
            tone="allergy"
            prefix="⚠"
            placeholder="арахіс, арахісова паста…"
            onAdd={(l) => patch('add', 'allergy', l)}
            onRemove={(l) => patch('remove', 'allergy', l)}
          />
        </div>

        <div className={styles.section}>
          <div className={styles['section-label']}>Побажання</div>
          <div className={styles.hint}>
            Куди тягне. Наприклад: більше риби, менше цукру, українська кухня на свята.
          </div>
          <TagInput
            values={profile?.wishes ?? []}
            tone="wish"
            placeholder="більше риби, постуємо…"
            onAdd={(l) => patch('add', 'wish', l)}
            onRemove={(l) => patch('remove', 'wish', l)}
          />
          {/* DIET_PRESETS із прототипу — там вони лишились заготовкою.
              Тап — і побажання записане, без набирання «низький FODMAP»
              пальцем на телефоні. Уже записані пресети зі списку зникають. */}
          <div style={{
            marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-dim)',
          }}>
            Часті дієти — одним тапом
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {DIET_PRESETS
              .filter((d) => !(profile?.wishes ?? []).some((w) => w.toLowerCase() === d.toLowerCase()))
              .map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => void patch('add', 'wish', d)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px dashed var(--border-strong)',
                    background: 'transparent',
                    color: 'var(--fg-dim)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  + {d}
                </button>
              ))}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles['section-label']}>Чого не їм</div>
          <div className={styles.hint}>
            Від чого відштовхуватись. Сила читається з формулювання: «не їм свинину» — принципово; «не люблю кінзу» — смак.
          </div>
          <TagInput
            values={profile?.antipatterns ?? []}
            tone="anti"
            placeholder="не їм свинину, не люблю кінзу…"
            onAdd={(l) => patch('add', 'anti', l)}
            onRemove={(l) => patch('remove', 'anti', l)}
          />
        </div>

        {/* Пікер техніки з прототипу (EQUIP_EXTRA): весь список одразу, тап
            крутить цикл ○ невідомо → ● є → ✕ немає → ○. До цього техніка
            зʼявлялась тут лише після того, як людина сама згадала її в чаті
            (QA6-09) — тобто список був порожній рівно тоді, коли він
            найпотрібніший. */}
        <div className={styles.section}>
          <div className={styles['section-label']}>Техніка</div>
          <div className={styles.hint}>
            Базове — пательня, каструля, ніж — вважається наявним. ● є · ✕ немає · ○ невідомо.
          </div>
          <div className={styles.chips}>
            {[...EQUIP_EXTRA, ...Object.keys(profile?.equipment ?? {}).filter((k) => !(EQUIP_EXTRA as readonly string[]).includes(k))].map((name) => {
              const state = (profile?.equipment ?? {})[name] as EquipState;
              const next = cycleEquip(state);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    if (next.op === 'remove') void patch('remove', 'equip', name);
                    else void patchEquip(name, next.has);
                  }}
                  className={styles.chip}
                  style={{
                    cursor: 'pointer',
                    // Канон Бриф-2 5а: ● є = шавлія; ✕ немає = закреслений і
                    // пригашений (45%), НЕ слива — слива тільки для АНТИ;
                    // ○ невідомо = пунктир.
                    ...(state === 'has'
                      ? { background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }
                      : state === 'lacks'
                        ? { background: 'transparent', border: '1px solid var(--border)', color: 'var(--fg-dim)', opacity: 0.45, textDecoration: 'line-through' }
                        : { background: 'transparent', border: '1px dashed var(--border-strong)', color: 'var(--fg-dim)' }),
                  }}
                  title={state === 'has' ? 'Є → позначити «немає»' : state === 'lacks' ? 'Немає → прибрати запис' : 'Невідомо → позначити «є»'}
                >
                  {equipGlyph(state)} {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Їдці дому без акаунтів: «зі мною живе Оксана, вона веганка».
            Записуються розмовою (kind: member); тут — видно й можна прибрати. */}
        <div className={styles.section}>
          <div className={styles['section-label']}>Домашні</div>
          <div className={styles.hint}>
            Хто ще їсть у домі. Страви враховують їхні обмеження нарівні з твоїми.
          </div>
          {eaters.length === 0 && (
            <span className={styles['empty-chip']}>
              поки нікого — скажи в чаті «зі мною живе Оксана, вона веганка»
            </span>
          )}
          {eaters.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {eaters.map((e) => {
                const limits = [
                  ...e.allergies.map((a) => `⚠ ${a}`),
                  ...e.antipatterns,
                  ...e.wishes,
                ].join(' · ');
                return (
                  <div
                    key={e.id}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 10,
                      padding: '10px 0', borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg)' }}>
                        {e.name}
                      </div>
                      {limits && (
                        <div style={{
                          marginTop: 3, fontFamily: 'var(--font-mono)', fontSize: 11,
                          letterSpacing: '0.04em', color: e.allergies.length ? 'var(--danger)' : 'var(--fg-dim)',
                        }}>
                          {limits}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void dropEater(e.id)}
                      aria-label={`Прибрати «${e.name}»`}
                      title="Прибрати"
                      style={{
                        border: 0, background: 'transparent', color: 'var(--fg-dim)',
                        fontFamily: 'var(--font-mono)', fontSize: 13, cursor: 'pointer', padding: '2px 4px',
                      }}
                    >×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Висновки з готування. Єдине в профілі, що написала не система про
            людину, а людина про свою кухню — тому окремим блоком. */}
        {notes.length > 0 && (
          <div className={styles.section}>
            <div className={styles['section-label']}>Висновки з готування</div>
            <div className={styles.hint}>
              Те, що ти зрозумів про свою кухню. Памʼятається назавжди і враховується в кожному рецепті. ★ — закріплене, згадується завжди.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {notes.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 10,
                    padding: '10px 0', borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg)' }}>
                      {n.pinned && <span style={{ color: 'var(--amber)', marginRight: 6 }}>★</span>}
                      {n.text}
                    </div>
                    {n.recipe_title && (
                      <div style={{
                        marginTop: 3, fontFamily: 'var(--font-mono)', fontSize: 11,
                        letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase',
                      }}>
                        {n.recipe_title}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void dropNote(n.id)}
                    aria-label={`Прибрати висновок «${n.text}»`}
                    title="Прибрати"
                    style={{
                      border: 0, background: 'transparent', color: 'var(--fg-dim)',
                      fontFamily: 'var(--font-mono)', fontSize: 13, cursor: 'pointer', padding: '2px 4px',
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {profileError && (
          <div className={styles.section}>
            <div style={{ color: 'var(--danger)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
              Не вдалося зберегти: {profileError}
            </div>
          </div>
        )}

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

      {/* Д03/Д06: на десктопі сайдбар є всюди, крім Cook Mode. */}
      <TabBar desktopOnly />
    </div>
  );
}
