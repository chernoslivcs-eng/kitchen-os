// Профіль (11 з брифу): алергії, побажання, обмеження, техніка, висновки з
// готування, склад дому, logout.
//
// Основний шлях наповнення лишається розмовним — питання ставиться в момент,
// коли відповідь одразу потрібна (бриф §07). Але правити руками теж можна:
// поки екран був доступний лише для читання, помилка моделі в полі «алергії»
// коштувала ще однієї розмови й надії, що цього разу вона зрозуміє. Найдорожча
// помилка сиділа в найдорожчому полі й не мала кнопки.

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProfileData, type Me, type InviteInfo, type InviteCreated, type NoteInfo, type EaterInfo, type EventOccurrence, type YearStrip, type Tradition } from '../../api';

const TRADITION_CHIPS: [Tradition, string][] = [
  ['orthodox', 'православні'], ['catholic', 'католицькі'], ['islamic', 'ісламські'], ['jewish', 'юдейські'],
];
import { ribbonDate, endingSoon } from '../../lib/when';
import { TagInput } from '../../components/TagInput/TagInput';
import { EQUIP_EXTRA, DIET_PRESETS, cycleEquip, equipGlyph, type EquipState } from '../../lib/presets';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { useAuth } from '../../store/auth';
import styles from './Profile.module.css';
import { Sheet } from '../../components/Sheet/Sheet';

// Пул-7 №4: дієти — НЕ теги з поля, а ряд пресет-тоглів. Зберігаються як
// звичайні wishes (та сама логіка, нуль міграцій) — тут лише візуальний шар:
// обрані спливають наперед (FLIP), тап тоглить на місці, «ще N ▾» ховає хвіст.
// M13: пʼята зона профілю — «Мережі» (канон М1/М5 дизайн-канвасу).
// Стан — той самий ●/◌ бренд-глиф; протухла сесія — бурштин-рутина, не
// помилка; відключення мʼяке й одразу, з тостом «Повернути ↩» (патерн
// pool-8), без модалки. OAuth веде назовні — «Підключити» це навігація.
type RetailSilpoStatus = 'loading' | 'unavailable' | 'none' | 'active' | 'expired' | 'disconnected';

function fmtSync(iso: string | null | undefined): string {
  if (!iso) return 'підключено';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay
    ? `синхронізовано сьогодні ${hm}`
    : `синхронізовано ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function NetworksSection() {
  const [status, setStatus] = useState<RetailSilpoStatus>('loading');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  // Тост живе окремо від «чи показувати» — leaving тримає рядок у DOM на
  // час exit-анімації (той самий патерн, що row-fresh/row-leave у Списку).
  const [toast, setToast] = useState<'in' | 'leaving' | null>(null);
  const [busy, setBusy] = useState(false);
  // Кіт: будь-яка зміна стану має видимий перехід. Пропускаємо перший рендер
  // (initial fetch — не «зміна», а показ поточного стану) і рахуємо статус
  // fresh рівно один такт, доки CSS-анімація не встигне запуститись.
  const [rowFresh, setRowFresh] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    let alive = true;
    // Щойно з OAuth (?retail=connected): скинути тротл автосинку стрічки —
    // інакше візит у стрічку ДО підключення зʼїдає 10-хвилинне вікно,
    // і перший чек не приходить одразу після підключення.
    if (new URLSearchParams(window.location.search).get('retail') === 'connected') {
      sessionStorage.removeItem('kos_retail_sync_at');
    }
    void api.retail.status()
      .then((r) => { if (alive) { setStatus(r.silpo.status); setSyncedAt(r.silpo.last_receipt_at ?? null); } })
      .catch(() => { if (alive) setStatus('unavailable'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setRowFresh(true);
    const t = setTimeout(() => setRowFresh(false), 260);
    return () => clearTimeout(t);
  }, [status]);

  // Мережа не сконфігурована на сервері — зони просто немає, без пояснень.
  if (status === 'loading' || status === 'unavailable') return null;

  const glyph = (color: string) => (
    <span aria-hidden style={{
      color, fontSize: 15, width: 18, textAlign: 'center', flex: 'none',
    }}>{color === 'var(--accent)' ? '●' : '◌'}</span>
  );
  const mono: CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-dim)',
  };
  const linkBtn: CSSProperties = {
    border: 0, background: 'transparent', cursor: 'pointer', padding: '4px 6px',
    marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
    color: 'var(--accent)',
  };

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await api.retail.disconnect();
      setStatus('disconnected');
      setToast('in');
    } catch { /* рядок лишається як був */ } finally { setBusy(false); }
  }
  async function reconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await api.retail.reconnect();
      setStatus('active');
      // Тост виходить, не зникає стрибком: leaving тримає DOM на dur-base,
      // потім прибираємо зовсім.
      if (toast) {
        setToast('leaving');
        setTimeout(() => setToast(null), 260);
      }
    } catch { /* nop */ } finally { setBusy(false); }
  }

  return (
    <>
      <div className={styles['zone-label']} style={{ marginTop: 28 }}>
        <span style={{ color: 'var(--fg-dim)' }}>■</span> МЕРЕЖІ
      </div>
      <div className={styles.section}>
        <div className={styles.members}>
          <div className={`${styles.member} ${rowFresh ? styles['network-changed'] : ''}`}>
            {status === 'active' && glyph('var(--accent)')}
            {status === 'none' && glyph('var(--fg-dim)')}
            {status === 'expired' && glyph('var(--amber)')}
            {status === 'disconnected' && glyph('var(--fg-dim)')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span className={styles.name}>Сільпо</span>
              {status === 'active' && <span style={mono}>{fmtSync(syncedAt)}</span>}
              {status === 'expired' && <span style={{ ...mono, color: 'var(--amber)' }}>сесія закінчилась</span>}
            </div>
            {status === 'none' && (
              <a href="/v1/retail/silpo/connect" style={{ ...linkBtn, textDecoration: 'none' }}>Підключити →</a>
            )}
            {status === 'expired' && (
              <a href="/v1/retail/silpo/connect" style={{ ...linkBtn, textDecoration: 'none', color: 'var(--amber)' }}>Увійти знову →</a>
            )}
            {status === 'disconnected' && (
              <button type="button" onClick={() => void reconnect()} style={linkBtn}>Повернути ↩</button>
            )}
            {status === 'active' && (
              <button
                type="button"
                onClick={() => void disconnect()}
                title="Відключити"
                style={{
                  border: 0, background: 'transparent', color: 'var(--fg-dim)',
                  cursor: 'pointer', fontSize: 14, marginLeft: 'auto', padding: '4px 6px',
                }}
              >✕</button>
            )}
          </div>
          <div className={styles.member} style={{ color: 'var(--fg-dim)' }}>
            {glyph('var(--fg-dim)')}
            <span className={styles.name} style={{ color: 'var(--fg-dim)' }}>АТБ</span>
            <span style={{ ...mono, marginLeft: 'auto' }}>скоро</span>
          </div>
        </div>
        {toast && (
          <div
            className={`${styles['network-toast']} ${toast === 'leaving' ? styles.leaving : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 12,
              padding: '10px 14px', borderRadius: 12,
              background: 'var(--fg)', color: 'var(--bg-body)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
            }}
          >
            Сільпо відключено
            <button
              type="button"
              onClick={() => void reconnect()}
              style={{
                border: 0, background: 'transparent', color: 'var(--accent)',
                fontWeight: 600, cursor: 'pointer', padding: 0, marginLeft: 'auto',
                fontFamily: 'var(--font-body)', fontSize: 14,
              }}
            >Повернути ↩</button>
          </div>
        )}
      </div>
    </>
  );
}

const DIET_VISIBLE_LIMIT = 7;
function isDietWish(w: string): boolean {
  return DIET_PRESETS.some((d) => d.toLowerCase() === w.toLowerCase());
}

function DietRow({ wishes, onToggle }: {
  wishes: string[];
  onToggle: (label: string, selected: boolean) => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const prevRects = useRef<Map<string, DOMRect> | null>(null);

  const selected = DIET_PRESETS.filter((d) => wishes.some((w) => w.toLowerCase() === d.toLowerCase()));
  const rest = DIET_PRESETS.filter((d) => !selected.includes(d));
  const ordered = [...selected, ...rest];
  const visible = expanded ? ordered : ordered.slice(0, Math.max(DIET_VISIBLE_LIMIT, selected.length));
  const hiddenCount = ordered.length - visible.length;

  // FLIP: позиції знімаються В МОМЕНТ тапу, а після перезбору ряду кожен чіп
  // доїжджає зі старого місця на нове — «обрана спливає наперед» читається
  // рухом, а не телепортом.
  function snapshot() {
    const row = rowRef.current;
    if (!row || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const m = new Map<string, DOMRect>();
    row.querySelectorAll<HTMLElement>('[data-diet]').forEach((el) => m.set(el.dataset.diet!, el.getBoundingClientRect()));
    prevRects.current = m;
  }
  useLayoutEffect(() => {
    const prev = prevRects.current;
    prevRects.current = null;
    if (!prev || !rowRef.current) return;
    rowRef.current.querySelectorAll<HTMLElement>('[data-diet]').forEach((el) => {
      const p = prev.get(el.dataset.diet!);
      if (!p) return;
      const n = el.getBoundingClientRect();
      const dx = p.left - n.left;
      const dy = p.top - n.top;
      if (!dx && !dy) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 250, easing: 'cubic-bezier(0, 0, 0.2, 1)' },
      );
    });
  }, [wishes.join(' '), expanded]);

  return (
    <div ref={rowRef} className={styles['diet-row']}>
      {visible.map((d) => {
        const sel = selected.includes(d);
        return (
          <button
            key={`${d}:${sel ? 1 : 0}`}
            data-diet={d}
            type="button"
            className={`${styles['diet-chip']} ${sel ? styles['diet-on'] : ''}`}
            onClick={() => { snapshot(); void onToggle(d, sel); }}
            title={sel ? 'Прибрати дієту' : 'Додати дієту'}
          >
            {sel ? '✓' : '+'} {d}
          </button>
        );
      })}
      {hiddenCount > 0 && (
        <button type="button" className={styles['diet-more']} onClick={() => { snapshot(); setExpanded(true); }}>
          ще {hiddenCount} ▾
        </button>
      )}
      {expanded && (
        <button type="button" className={styles['diet-more']} onClick={() => { snapshot(); setExpanded(false); }}>
          згорнути ▴
        </button>
      )}
    </div>
  );
}

// Пул-5 №1: причини виходу — легкий опитувальник перед видаленням.
const EXIT_REASONS: Array<{ code: string; label: string }> = [
  { code: 'unused', label: 'Не користуюсь' },
  { code: 'hard', label: 'Незручно або складно' },
  { code: 'privacy', label: 'Питання приватності' },
  { code: 'other', label: 'Інше' },
];

export function ProfilePage() {
  // Рік уперед — тільки довідник (сезони, свята, редакційні). Домашні події
  // сюди не йдуть: вони живуть у календарі, і другий список тих самих рядків
  // нікому не потрібен.
  const [ahead, setAhead] = useState<EventOccurrence[]>([]);
  useEffect(() => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = new Date();
    const to = new Date(from.getTime() + 365 * 86_400_000);
    api.events.list(iso(from), iso(to))
      .then(({ events }) => {
        const seen = new Set<string>();
        const now = Date.now();
        // Сортуємо за ПОКАЗАНОЮ датою, а не за початком: те, що триває,
        // названо кінцем, і «ДО 31 ЖОВТ» мусить стояти після «5 ВЕР», а не
        // перед ним лише тому, що сезон почався в липні.
        const shownAt = (e: EventOccurrence) =>
          (now >= e.start && now <= e.end ? e.end : e.start);
        const rows = events
          .filter((e) => e.scope === 'catalog')
          .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
          .sort((a, b) => shownAt(a) - shownAt(b))
          .slice(0, 8);
        setAhead(rows);
      })
      .catch(() => {/* профіль без стрічки — не трагедія */});
  }, []);

  // «Рік на кухні» (2.8, Д10): ретроспективний дзеркальний блок до «рік
  // уперед» вище — не наперед, а те, що вже спіймано цього року. Домовий
  // читач: спіймання виводиться зі спільного готування.
  const [yearStrips, setYearStrips] = useState<YearStrip[]>([]);
  useEffect(() => {
    api.events.year(new Date().getFullYear())
      .then(({ strips }) => setYearStrips(strips))
      .catch(() => {/* профіль без річного зведення — не трагедія */});
  }, []);

  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  // Здогад сервера з побажань — показуємо, поки традиції не обрано явно.
  const [inferredTrads, setInferredTrads] = useState<Tradition[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // Пул-8: лінк запрошення в інтерфейс. Сирий токен приходить тільки у
  // відповіді на створення — тримаємо останній інвайт, щоб дати «Скопіювати».
  const [lastInvite, setLastInvite] = useState<InviteCreated | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Пул-5 №1: стан поп-апа видалення акаунта.
  const [exitOpen, setExitOpen] = useState(false);
  const [exitReason, setExitReason] = useState<string | null>(null);
  const [exitComment, setExitComment] = useState('');
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  // Пул-7 №4: довгий список висновків згорнутий до 4 рядків.
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [eaters, setEaters] = useState<EaterInfo[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Одна точка правки на всі три блоки. Відповідь сервера — джерело істини:
  // локально нічого не домальовуємо, щоб на екрані не з'явилось те, чого
  // в базі немає.
  async function patch(op: 'add' | 'remove', kind: 'allergy' | 'wish' | 'anti' | 'equip' | 'tradition', label: string) {
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

  // Моушн-кіт §03: видалений їдець чи нотатка згортаються 250ms exit.
  const [leavingRows, setLeavingRows] = useState<Set<string>>(new Set());
  const leaveRow = async (id: string, del: () => Promise<unknown>) => {
    setLeavingRows((prev) => new Set(prev).add(id));
    try { await Promise.all([del(), new Promise<void>((r) => window.setTimeout(r, 250))]); }
    finally { setLeavingRows((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
  };
  async function dropEater(id: string) {
    try {
      await leaveRow(id, () => api.deleteEater(id));
      setEaters((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setProfileError((err as Error).message);
    }
  }

  async function dropNote(id: string) {
    try {
      await leaveRow(id, () => api.deleteNote(id));
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setProfileError((err as Error).message);
    }
  }

  useEffect(() => {
    (async () => {
      const [p, m, s] = await Promise.all([
        api.profile().catch(() => ({ profile: null as ProfileData | null, notes: [] as NoteInfo[], eaters: [] as EaterInfo[], inferred_traditions: [] as Tradition[] })),
        api.me().catch(() => null),
        api.shopping.list().catch(() => ({ count: 0 })),
      ]);
      setProfile(p.profile);
      setInferredTrads(p.inferred_traditions ?? []);
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
    setLinkCopied(false);
    try {
      const created = await api.households.invite(me.household.id, email);
      setLastInvite(created);
      setInviteEmail('');
      const fresh = await api.households.listInvites(me.household.id);
      setInvites(fresh.invites);
    } catch (err) {
      setInviteError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function copyInviteLink() {
    if (!lastInvite) return;
    try {
      await navigator.clipboard.writeText(lastInvite.link);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Буфер недоступний (http/дозволи) — показуємо лінк текстом, хай виділить.
      window.prompt('Скопіюй лінк запрошення:', lastInvite.link);
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
          <div className={styles.title}>{me ? `Кухня ${me.user.name}` : 'Профіль'}</div>
        </div>
        {me && (
          <div className={styles['head-right']}>
            <span className={styles.who}>{me.user.email}</span>
          </div>
        )}
      </div>

      <div className={styles.body}>
        {/* Пул-6 №7 (v2): чотири зони журнального ритму — лінія + ■-мітка. */}
        {/* Пул-7 №4 (v3): канон «поле + полиця + пресети». Хінти-абзаци
            прибрані з полотна — живуть у плейсхолдерах і (i)-тултіпах. */}
        <div className={styles.zone}>
        <div className={styles['zone-label']}><span style={{ color: 'var(--danger)' }}>■</span> ЇЖА</div>
        <div className={styles['zone-grid']}>
        <div className={styles.section}>
          <div className={styles['section-label']}>
            <span style={{ color: '#7c352c' }}>Алергії</span>
            <span className={styles['label-sub']}> · це не пропонуємо ніколи</span>
            <span className={styles.info} title="Для алергій краще бути конкретним: додай окремо всі назви, під якими продукт може зустрітися.">i</span>
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
          <div className={styles['section-label']}>
            <span style={{ color: 'var(--plum)' }}>Не їм</span>
            <span className={styles['label-sub']}> · не їм або просто не люблю</span>
            <span className={styles.info} title="«Не їм» — це правило. «Не люблю» — побажання. Можеш просто написати як є.">i</span>
          </div>
          <TagInput
            values={profile?.antipatterns ?? []}
            tone="anti"
            placeholder="не їм свинину, не люблю кінзу…"
            onAdd={(l) => patch('add', 'anti', l)}
            onRemove={(l) => patch('remove', 'anti', l)}
          />
        </div>

        <div className={styles.section}>
          <div className={styles['section-label']}>
            <span style={{ color: 'var(--plum)' }}>Дієти</span>
            <span className={styles['label-sub']}> · пресети, тогл на місці</span>
            <span className={styles.info} title="Не знайшов свою дієту? Просто напиши її в «Не їм» або «Побажаннях».">i</span>
          </div>
          <DietRow
            wishes={profile?.wishes ?? []}
            onToggle={(d, sel) => patch(sel ? 'remove' : 'add', 'wish', d)}
          />
        </div>

        <div className={styles.section}>
          <div className={styles['section-label']}>
            Побажання
            <span className={styles['label-sub']}> · добре б частіше</span>
            <span className={styles.info} title="Що хотілося б частіше: більше риби, менше цукру, українське на свята.">i</span>
          </div>
          <TagInput
            values={profile?.wishes ?? []}
            tone="wish"
            placeholder="більше риби, постуємо…"
            hidden={isDietWish}
            onAdd={(l) => patch('add', 'wish', l)}
            onRemove={(l) => patch('remove', 'wish', l)}
          />
        </div>

        {/* Традиції — явний вибір, не здогад. Свято в календарі — «напів-
            редагована» подія: дату й правило дає довідник, а чи є вона в
            цьому домі взагалі — вирішується тут. Поки нічого не обрано,
            календар іде за розпізнаним із побажань («постуємо» →
            православна), і ці чіпи показані як розпізнані; перший тап
            матеріалізує вибір. */}
        <div className={styles.section}>
          <div className={styles['section-label']}>
            Традиції
            <span className={styles['label-sub']}> · щоб кухня памʼятала, коли в домі все трохи інакше</span>
          </div>
          <div className={styles.hint}>
            {profile?.traditions == null && inferredTrads.length > 0
              ? 'Схоже, це одна з твоїх традицій. Підтвердити?'
              : profile?.traditions?.length === 0
                ? 'Вимкнено. Релігійні свята й пости не враховуватимемо.'
                : 'Обери традиції, які живуть у твоєму домі. Якщо нічого не обрати — календар просто не буде про них нагадувати.'}
          </div>
          <div className={styles.chips}>
            {TRADITION_CHIPS.map(([id, name]) => {
              const explicit = profile?.traditions != null;
              const chosen = explicit ? profile!.traditions!.includes(id) : inferredTrads.includes(id);
              return (
                <button
                  key={`${id}:${chosen ? 1 : 0}:${explicit ? 'e' : 'i'}`}
                  type="button"
                  onClick={() => patch(chosen ? 'remove' : 'add', 'tradition', id)}
                  className={`${styles.chip} ${styles['equip-tick']}`}
                  style={{
                    cursor: 'pointer',
                    ...(chosen && explicit
                      ? { background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }
                      : chosen
                        ? { background: 'transparent', border: '1px dashed var(--accent-border)', color: 'var(--accent)' }
                        : { background: 'transparent', border: '1px solid var(--border)', color: 'var(--fg-dim)' }),
                  }}
                  title={chosen ? (explicit ? 'Обрано → вимкнути' : 'Знайшли в побажаннях → підтвердити') : 'Увімкнути'}
                >
                  {chosen ? '●' : '○'} {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Пікер техніки з прототипу (EQUIP_EXTRA): весь список одразу, тап
            крутить цикл ○ невідомо → ● є → ✕ немає → ○. До цього техніка
            зʼявлялась тут лише після того, як людина сама згадала її в чаті
            (QA6-09) — тобто список був порожній рівно тоді, коли він
            найпотрібніший. */}
        </div>
        </div>

        <div className={styles.zone}>
        <div className={styles['zone-label']}><span style={{ color: 'var(--accent)' }}>■</span> ТЕХНІКА <span className={styles['zone-hint']}>Натискай, щоб змінити: невідомо → є → немає</span></div>
        <div className={styles.section}>
          <div className={styles['section-label']} style={{ display: 'none' }}>Техніка</div>
          <div className={styles.hint}>
            Пательню, каструлю й ніж вважаємо базою. Якщо навіть цього нема — кухня в тебе зараз цікава.
          </div>
          <div className={styles.chips}>
            {[...EQUIP_EXTRA, ...Object.keys(profile?.equipment ?? {}).filter((k) => !(EQUIP_EXTRA as readonly string[]).includes(k))].map((name) => {
              const state = (profile?.equipment ?? {})[name] as EquipState;
              const next = cycleEquip(state);
              return (
                // Пул-7 №4: key включає стан — зміна перезбирає вузол і
                // replay-ить tick-анімацію (.94→1), тап «клацає» відчутно.
                <button
                  key={`${name}:${state ?? 'u'}`}
                  type="button"
                  onClick={() => {
                    if (next.op === 'remove') void patch('remove', 'equip', name);
                    else void patchEquip(name, next.has);
                  }}
                  className={`${styles.chip} ${state !== undefined ? styles['equip-tick'] : ''}`}
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
            Хто ще їсть із тобою. Їхні алергії й обмеження врахуємо так само, як твої.
          </div>
          {eaters.length === 0 && (
            <span className={styles['empty-chip']}>
              Поки нікого. Якщо хтось зʼявиться — просто скажи в чаті. Навіть якщо це мама на три дні з пакетом цибулі.
            </span>
          )}
          {eaters.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {eaters.map((e) => {
                // UX9-33: однакові за суттю дані — однакова форма. Алергії
                // фарбуються danger поштучно; анти/побажання — рівним muted
                // тим самим моно-ритмом, а не «чипи проти прози».
                const limits: { text: string; danger: boolean }[] = [
                  ...e.allergies.map((a) => ({ text: `⚠ ${a}`, danger: true })),
                  ...e.antipatterns.map((a) => ({ text: a, danger: false })),
                  ...e.wishes.map((w) => ({ text: w, danger: false })),
                ];
                return (
                  <div
                    key={e.id}
                    className={leavingRows.has(e.id) ? styles['row-leave'] : ''}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 10,
                      padding: '10px 0', borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg)' }}>
                        {e.name}
                      </div>
                      {limits.length > 0 && (
                        <div style={{
                          marginTop: 3, fontFamily: 'var(--font-mono)', fontSize: 11,
                          letterSpacing: '0.04em', color: 'var(--fg-dim)',
                        }}>
                          {limits.map((l, i) => (
                            <span key={i}>
                              {i > 0 && ' · '}
                              <span style={l.danger ? { color: 'var(--danger)' } : undefined}>{l.text}</span>
                            </span>
                          ))}
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

        </div>
        {/* Стрічка «Попереду» була в прототипі й не доїхала в прод: apps/web
            не імпортував календар узагалі. Тут вона повертається — рік уперед,
            вісім рядків, дата в колонці 96px і назва поруч.

            Тільки довідник: власні плани людина бачить у календарі, і дублювати
            їх тут означало б показувати той самий список двічі. */}
        {ahead.length > 0 && (
          <div className={styles.zone}>
          <div className={styles['zone-label']}><span style={{ color: 'var(--amber)' }}>■</span> ПОПЕРЕДУ · НА РІК</div>
          <div className={styles.section}>
            {ahead.map((e) => {
              const soon = endingSoon(e.start, e.end);
              return (
                <div key={`${e.id}:${e.start}`} className={styles['ahead-row']}>
                  <span
                    className={styles['ahead-date']}
                    style={soon ? { color: 'var(--amber)' } : undefined}
                  >{ribbonDate(e.start, e.end, e.approx)}</span>
                  <span className={styles['ahead-title']}>
                    {e.title}{soon ? ' · останні дні' : ''}
                  </span>
                </div>
              );
            })}
          </div>
          </div>
        )}

        {/* Дзеркало до блоку вище: не наперед, а назад — що вже спіймано цього
            року. Без вигаданого «дванадцять смуг» — під це ще нема макета, і
            малювати заливні смуги самому означало б повторити те, за що вже
            поправляли: гейміфікація тут — марки в паспорті, показані тим самим
            рядком дата+назва, що й «попереду», і глухою крапкою замість
            заливки. Місяці без нічого спійманого просто відсутні в списку:
            порожнє — тиша, не докір. */}
        {yearStrips.some((s) => s.caught) && (
          <div className={styles.zone}>
          <div className={styles['zone-label']}><span style={{ color: 'var(--amber)' }}>■</span> РІК НА КУХНІ</div>
          <div className={styles.section}>
            {yearStrips.filter((s) => s.caught).map((s) => (
              <div key={s.occasion_id} className={styles['ahead-row']}>
                <span className={styles['ahead-date']}>
                  {['СІЧ','ЛЮТ','БЕР','КВІ','ТРА','ЧЕР','ЛИП','СЕР','ВЕР','ЖОВ','ЛИС','ГРУ'][s.month - 1]}
                </span>
                <span className={styles['ahead-title']}>
                  {s.title}{s.by ? ` · ${s.by}` : ''}
                </span>
              </div>
            ))}
          </div>
          </div>
        )}

        <div className={styles.zone}>
        <div className={styles['zone-label']}><span style={{ color: 'var(--amber)' }}>■</span> ПАМ'ЯТЬ КУХНІ</div>
        {/* Пул-2 №6: наміри — «що хочу спробувати», окремо від висновків. */}
        {notes.some((n) => n.kind === 'intent') && (
          <div className={styles.section}>
            <div className={styles['section-label']}>Наміри</div>
            <div className={styles.hint}>
              Ідеї на потім. Коли все потрібне зʼявиться вдома — нагадаємо. Додати або прибрати можна в чаті.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {notes.filter((n) => n.kind === 'intent').map((n) => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--accent)', flex: 'none' }}>⏳</span>
                  <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg)' }}>{n.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Висновки з готування. Єдине в профілі, що написала не система про
            людину, а людина про свою кухню — тому окремим блоком. */}
        {notes.some((n) => (n.kind ?? 'lesson') === 'lesson') && (
          <div className={styles.section}>
            <div className={styles['section-label']}>
              Висновки з готування
              <span className={styles['label-sub']}> · ★ згадується завжди</span>
              <span className={styles.info} title="Те, що варто памʼятати наступного разу: менше перцю, більше соусу, не пересушувати фует.">i</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Пул-7 №4: ★ закріплені зверху, ☆ решта; довгий список
                  згорнутий до 4 рядків — «Показати всі N ▾» розкриває.
                  Тогла ★/☆ тут НЕМА — закріплення живе в розмові, як і було. */}
              {(() => {
                const lessons = notes.filter((n) => (n.kind ?? 'lesson') === 'lesson');
                const sorted = [...lessons.filter((n) => n.pinned), ...lessons.filter((n) => !n.pinned)];
                return (lessonsOpen ? sorted : sorted.slice(0, 4));
              })().map((n) => (
                <div
                  key={n.id}
                  className={`${styles['lesson-row']} ${leavingRows.has(n.id) ? styles['row-leave'] : ''}`}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 10,
                    padding: '10px 0', borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={{ color: n.pinned ? 'var(--amber)' : 'var(--fg-dim)', flex: 'none' }}>
                    {n.pinned ? '★' : '☆'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg)' }}>
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
            {!lessonsOpen && notes.filter((n) => (n.kind ?? 'lesson') === 'lesson').length > 4 && (
              <button type="button" className={styles['lessons-more']} onClick={() => setLessonsOpen(true)}>
                Показати всі {notes.filter((n) => (n.kind ?? 'lesson') === 'lesson').length} ▾
              </button>
            )}
            {lessonsOpen && (
              <button type="button" className={styles['lessons-more']} onClick={() => setLessonsOpen(false)}>
                Згорнути ▴
              </button>
            )}
          </div>
        )}

        {profileError && (
          <div className={styles.section}>
            <div style={{ color: 'var(--danger)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
              Не вдалося зберегти: {profileError}
            </div>
          </div>
        )}

        </div>
        <div className={styles.zone}>
        <div className={styles['zone-label']}><span style={{ color: 'var(--fg-dim)' }}>■</span> ДІМ</div>
        {me && me.household.members.length > 0 && (
          <div className={styles.section}>
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
            {/* Пул-8: лінк — це і є перепустка. Показуємо один раз, одразу
                після створення; далі його вже не відновити (у БД — хеш). */}
            {lastInvite && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                marginTop: 10, padding: '10px 12px', borderRadius: 10,
                background: lastInvite.mail_sent ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
                border: `1px solid ${lastInvite.mail_sent ? 'var(--accent-border)' : 'var(--border-strong)'}`,
              }}>
                <span style={{ flex: 1, minWidth: 180, fontFamily: 'var(--font-body)', fontSize: 13, color: lastInvite.mail_sent ? 'var(--accent)' : 'var(--fg-muted)' }}>
                  {lastInvite.mail_sent
                    ? <>Лист пішов на {lastInvite.email}. Або передай лінк сам:</>
                    : <>Лист не доставлено — передай {lastInvite.email} лінк сам (месенджером):</>}
                </span>
                <button
                  type="button"
                  onClick={() => void copyInviteLink()}
                  style={{
                    border: '1px solid var(--border-strong)', borderRadius: 8,
                    background: 'var(--bg-surface)', color: 'var(--fg)',
                    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
                    textTransform: 'uppercase', padding: '7px 12px', cursor: 'pointer',
                  }}
                >
                  {linkCopied ? '✓ Скопійовано' : '⧉ Скопіювати лінк'}
                </button>
              </div>
            )}
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

        <NetworksSection />

        </div>
        <div className={styles.logout}>
          {/* Повернуто вниз на прохання юзера (пул-8): тихий напис у шапці
              читався як «кнопку прибрали». */}
          <Button variant="secondary" onClick={() => logout()}>Вийти</Button>
          <button
            type="button"
            className={styles['delete-account']}
            onClick={() => { setExitOpen(true); setExitReason(null); setExitComment(''); setExitError(null); }}
          >
            Видалити акаунт
          </button>
        </div>
      </div>

      {exitOpen && (
        <Sheet onClose={() => !exitBusy && setExitOpen(false)} ariaLabel="Видалення акаунта">
          <div className={styles['exit-sheet']}>
            <h2 className={styles['exit-title']}>Видалити акаунт назавжди?</h2>
            <p className={styles['exit-sub']}>
              Зникне все: комора, рецепти, журнал готувань, профіль смаків. Це не «вийти» —
              відновити буде неможливо. Розкажи чому — одна відповідь дуже допоможе.
            </p>
            <div className={styles['exit-reasons']}>
              {EXIT_REASONS.map((r) => (
                <label key={r.code} className={styles['exit-reason']}>
                  <input
                    type="radio"
                    name="exit-reason"
                    checked={exitReason === r.code}
                    onChange={() => setExitReason(r.code)}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
            {exitReason === 'other' && (
              <Input
                placeholder="Кілька слів — що саме?"
                value={exitComment}
                onChange={(e) => setExitComment(e.target.value)}
              />
            )}
            {exitError && <p className={styles['exit-error']}>{exitError}</p>}
            <div className={styles['exit-actions']}>
              <Button variant="secondary" block onClick={() => setExitOpen(false)} disabled={exitBusy}>
                Лишаюсь
              </Button>
              <button
                type="button"
                className={styles['exit-confirm']}
                disabled={exitBusy || !exitReason}
                onClick={async () => {
                  if (!exitReason) return;
                  setExitBusy(true);
                  setExitError(null);
                  try {
                    await api.deleteAccount(exitReason, exitComment.trim() || undefined);
                    await logout().catch(() => {/* кука вже мертва — ок */});
                    navigate('/', { replace: true });
                  } catch (err) {
                    setExitError((err as Error).message);
                    setExitBusy(false);
                  }
                }}
              >
                {exitBusy ? 'Видаляю…' : 'Видалити назавжди'}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {/* Д03/Д06: на десктопі сайдбар є всюди, крім Cook Mode. */}
    </div>
  );
}
