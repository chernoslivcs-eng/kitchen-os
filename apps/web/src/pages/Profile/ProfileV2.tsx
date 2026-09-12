// Профіль v6 (AUDIT-ROUND-4.md §8, design/PROFILE-v6.dc.html): сім речень,
// нотатки, мережі, акаунт. Крок 11: єдина сторінка профілю (ProfileRoute
// лише завантажує GET /v1/profile).
//
// Рядок — речення: початок сірим (для «Мені не можна» — --plum з ban, 12.09 A10), закінчення
// contenteditable з пунктиром. Автозбереження PATCH /v1/profile/:key по blur і
// по паузі 800 мс, оптимістично, без спінерів; помилка — тост і один повтор.

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProfileV2Response, type ProfileFieldV2, type ProfileNoteV2, type InviteInfo, type InviteCreated } from '../../api';
import { PROFILE_ROWS, HINT_IDLE, SECTION, PLAN_LABEL, type ProfileRowCopy } from '../../lib/profile-copy';
import { KIT_DEFAULTS, type ProfileFieldKey } from '@kitchen/domain/profile-fields';
import { useAuth } from '../../store/auth';
import { themeSetting, setThemeSetting, type ThemeSetting } from '../../theme';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { Icon } from '../../components/Icon/Icon';
import { useNavStore } from '../../store/nav';
import { Input } from '../../components/Input/Input';
import { Sheet } from '../../components/Sheet/Sheet';
import styles from './ProfileV2.module.css';

type Fields = ProfileV2Response['fields'];

const SAVE_DEBOUNCE_MS = 800;
const TYPING_HOLD_MS = 1000;
const NOTE_TOAST_MS = 5000;
const RETRY_MS = 1500;

const len = (s: string) => Array.from(s).length;
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const M = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  return `${d.getDate()} ${M[d.getMonth()]}`;
};
const initialOf = (name: string) => (name.trim().charAt(0) || "·").toUpperCase();

const EXIT_REASONS: Array<{ code: string; label: string }> = [
  { code: 'unused', label: 'Не користуюсь' },
  { code: 'hard', label: 'Незручно або складно' },
  { code: 'privacy', label: 'Питання приватності' },
  { code: 'other', label: 'Інше' },
];

type RetailStatus = 'loading' | 'unavailable' | 'none' | 'active' | 'expired' | 'disconnected';

export function ProfileV2({ initial }: { initial: ProfileV2Response }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.me);
  const logout = useAuth((s) => s.logout);
  const openNav = useNavStore((s) => s.setOpen);

  // ----- Про тебе ---------------------------------------------------------
  const [fields, setFields] = useState<Fields>(initial.fields);
  const [focus, setFocus] = useState<ProfileFieldKey | null>(null);
  const [hover, setHover] = useState<ProfileFieldKey | null>(null);
  const [typing, setTyping] = useState<ProfileFieldKey | null>(null);
  const [lens, setLens] = useState<Record<ProfileFieldKey, number>>(() =>
    Object.fromEntries(PROFILE_ROWS.map((r) => [r.k, len(initial.fields[r.k].text)])) as Record<ProfileFieldKey, number>);
  const [hintKey, setHintKey] = useState(0);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const edits = useRef<Partial<Record<ProfileFieldKey, HTMLSpanElement | null>>>({});
  const lastSaved = useRef<Record<ProfileFieldKey, string>>(
    Object.fromEntries(PROFILE_ROWS.map((r) => [r.k, initial.fields[r.k].text])) as Record<ProfileFieldKey, string>,
  );
  const timers = useRef<Record<string, number>>({});

  // Текст у contenteditable живе в DOM, а не в стейті: перерендер стейтом
  // скидав би курсор. Заповнюємо один раз на монтуванні.
  useEffect(() => {
    for (const r of PROFILE_ROWS) {
      const el = edits.current[r.k];
      if (el && el.textContent !== initial.fields[r.k].text) el.textContent = initial.fields[r.k].text;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { for (const t of Object.values(timers.current)) window.clearTimeout(t); }, []);

  const textOf = (k: ProfileFieldKey) => (edits.current[k]?.textContent ?? '').trim();

  async function persist(k: ProfileFieldKey, attempt = 0) {
    const text = textOf(k);
    if (text === lastSaved.current[k]) return;
    try {
      const r = await api.profileV2.patchField(k, { text });
      lastSaved.current[k] = r.field.text;
      setFields((f) => ({ ...f, [k]: r.field }));
      setSaveToast(null);
    } catch {
      setSaveToast(SECTION.saveFailed);
      if (attempt === 0) timers.current[`retry-${k}`] = window.setTimeout(() => void persist(k, 1), RETRY_MS);
    }
  }

  function onInput(k: ProfileFieldKey) {
    setLens((l) => ({ ...l, [k]: len(textOf(k)) }));
    setTyping(k);
    window.clearTimeout(timers.current[`typing-${k}`]);
    timers.current[`typing-${k}`] = window.setTimeout(() => setTyping((t) => (t === k ? null : t)), TYPING_HOLD_MS);
    window.clearTimeout(timers.current[`save-${k}`]);
    timers.current[`save-${k}`] = window.setTimeout(() => void persist(k), SAVE_DEBOUNCE_MS);
  }
  function onBlur(k: ProfileFieldKey) {
    setFocus((f) => (f === k ? null : f));
    setHintKey((n) => n + 1);
    window.clearTimeout(timers.current[`save-${k}`]);
    void persist(k);
  }
  function onFocus(k: ProfileFieldKey) { setFocus(k); setHintKey((n) => n + 1); }
  function onKeyDown(k: ProfileFieldKey, row: ProfileRowCopy, e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); return; }
    // Ліміт: набір блокується, лічильник лишається з текстом ліміту.
    if (len(e.currentTarget.textContent ?? '') >= row.max && e.key.length === 1 && !e.metaKey && !e.ctrlKey) e.preventDefault();
  }
  function onPaste(k: ProfileFieldKey, row: ProfileRowCopy, e: ClipboardEvent<HTMLSpanElement>) {
    e.preventDefault();
    const room = row.max - len(e.currentTarget.textContent ?? '');
    if (room <= 0) return;
    const chunk = Array.from(e.clipboardData.getData('text/plain').replace(/\s+/g, ' ')).slice(0, room).join('');
    if (typeof document.execCommand === 'function') document.execCommand('insertText', false, chunk);
    else e.currentTarget.textContent = (e.currentTarget.textContent ?? '') + chunk;
    onInput(k);
  }

  const firstDay = PROFILE_ROWS.every((r) => fields[r.k].status === 'empty');
  const hintRow = PROFILE_ROWS.find((r) => r.k === focus) ?? null;

  // Етап 4 (PLAN §3, §6): лічильник зʼявляється за 20 знаків до стелі — на
  // кожному з пʼяти лімітів (30 / 140 / 200 / 250 / 260), і не лише під час
  // набору. Обрізати не мовчки: людина має бачити межу ДО того, як у неї
  // впреться. Доти лічильник жив лише ~1 с після останнього символа — тобто
  // з'являвся, коли вже пізно.
  const COUNTER_AHEAD = 20;
  const counter = (row: ProfileRowCopy) => {
    const n = lens[row.k];
    const atLimit = n >= row.max;
    const near = row.max - n <= COUNTER_AHEAD;
    const active = focus === row.k;
    // Components «profile states»: «176 / 200 · далі вже мемуари» — число і
    // текст ліміту разом, під рядком, зі смужкою.
    return {
      text: atLimit ? `${n} / ${row.max} · ${row.lim}` : `${n} / ${row.max}`,
      visible: active && (typing === row.k || atLimit || near),
      atLimit,
      near,
      pct: Math.min(100, Math.round((n / row.max) * 100)),
    };
  };

  // ----- Нотатки ---------------------------------------------------------
  const [notes, setNotes] = useState<ProfileNoteV2[]>(initial.notes);
  const [noteToast, setNoteToast] = useState<{ note: ProfileNoteV2; index: number } | null>(null);
  async function removeNote(n: ProfileNoteV2) {
    const index = notes.findIndex((x) => x.id === n.id);
    setNotes((ns) => ns.filter((x) => x.id !== n.id));
    window.clearTimeout(timers.current['note-toast']);
    setNoteToast({ note: n, index });
    timers.current['note-toast'] = window.setTimeout(() => setNoteToast(null), NOTE_TOAST_MS);
    try { await api.profileV2.removeNote(n.id); } catch {
      // Сервер не прийняв — повертаємо як було, без окремого тосту.
      setNotes((ns) => { const arr = [...ns]; arr.splice(index, 0, n); return arr; });
      setNoteToast(null);
    }
  }
  async function restoreNote() {
    const t = noteToast;
    if (!t) return;
    window.clearTimeout(timers.current['note-toast']);
    setNoteToast(null);
    setNotes((ns) => { const arr = [...ns]; arr.splice(Math.min(t.index, arr.length), 0, t.note); return arr; });
    try { await api.profileV2.restoreNote(t.note.id); } catch { /* рядок уже на місці; повторний DELETE поверне все назад */ }
  }

  // ----- Дім (9а(7)): люди, з якими ділиш комору — існуючі ендпоінти, як у v1 ---
  const refreshMe = useAuth((s) => s.refresh);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<InviteCreated | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const householdId = me?.household.id;
  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    api.households.listInvites(householdId).then((r) => { if (alive) setInvites(r.invites); }).catch(() => {});
    return () => { alive = false; };
  }, [householdId]);
  const activeInvites = invites.filter((i) => !i.consumed_at && !i.revoked_at);
  const inviteStatus = (inv: InviteInfo): { text: string; cls: string } => {
    if (inv.consumed_at) return { text: 'прийнято', cls: styles.metaOk ?? '' };
    if (inv.revoked_at) return { text: 'скасовано', cls: '' };
    if (new Date(inv.expires_at).getTime() < Date.now()) return { text: 'термін сплив', cls: '' };
    return { text: 'чекає', cls: styles.metaAmber ?? '' };
  };
  async function inviteSend(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    const emailTo = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTo)) { setInviteError('Схоже, це не email'); return; }
    setInviting(true); setInviteError(null); setLinkCopied(false);
    try {
      const created = await api.households.invite(me.household.id, emailTo);
      setLastInvite(created);
      setInviteEmail('');
      setInvites((await api.households.listInvites(me.household.id)).invites);
    } catch (err) { setInviteError((err as Error).message); } finally { setInviting(false); }
  }
  async function copyInviteLink() {
    if (!lastInvite) return;
    try { await navigator.clipboard.writeText(lastInvite.link); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2000); }
    catch { window.prompt('Скопіюй лінк запрошення:', lastInvite.link); }
  }
  async function inviteRevoke(id: string) {
    try { await api.invites.revoke(id); if (me) setInvites((await api.households.listInvites(me.household.id)).invites); } catch { /* MVP */ }
  }
  async function memberRemove(user_id: string, isMe: boolean, name: string) {
    if (!me) return;
    if (!confirm(isMe ? 'Вийти з дому?' : `Виключити ${name}?`)) return;
    try {
      await api.households.removeMember(me.household.id, user_id);
      if (isMe) await logout(); else await refreshMe();
    } catch (err) { alert((err as Error).message); }
  }
  async function memberPromote(user_id: string, name: string) {
    if (!me) return;
    if (!confirm(`Передати роль власника ${name}? Ти станеш звичайним учасником.`)) return;
    try {
      await api.households.setRole(me.household.id, user_id, 'owner');
      await api.households.setRole(me.household.id, me.user.id, 'member');
      await refreshMe();
    } catch (err) { alert((err as Error).message); }
  }

  // ----- Мережі (існуючі ендпоінти M13, без нової логіки) --------------------
  const [retail, setRetail] = useState<RetailStatus>('loading');
  const [receiptAt, setReceiptAt] = useState<string | null>(null);
  const [karpaty, setKarpaty] = useState(false);
  const [retailBusy, setRetailBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    if (new URLSearchParams(window.location.search).get('retail') === 'connected') sessionStorage.removeItem('kos_retail_sync_at');
    void api.retail.status()
      .then((r) => { if (alive) { setRetail(r.silpo.status); setReceiptAt(r.silpo.last_receipt_at ?? null); setKarpaty(r.karpaty?.status === 'available'); } })
      .catch(() => { if (alive) setRetail('unavailable'); });
    return () => { alive = false; };
  }, []);
  async function retailDisconnect() {
    if (retailBusy) return;
    setRetailBusy(true);
    try { await api.retail.disconnect(); setRetail('disconnected'); } catch { /* рядок лишається як був */ } finally { setRetailBusy(false); }
  }
  async function retailReconnect() {
    if (retailBusy) return;
    setRetailBusy(true);
    try { await api.retail.reconnect(); setRetail('active'); } catch { /* nop */ } finally { setRetailBusy(false); }
  }

  // ----- Акаунт -----------------------------------------------------------
  // Тема · Світла / Темна / Авто (Screens D2a, Prototype; «Авто» — підтверджене
  // відхилення від проду): сегмент, не кнопка «Темна».
  const [theme, setTheme] = useState<ThemeSetting>(() => (typeof document === 'undefined' ? 'auto' : themeSetting()));
  function pickTheme(next: ThemeSetting) { setThemeSetting(next); setTheme(next); }
  const THEMES: { v: ThemeSetting; label: string }[] = [
    { v: 'light', label: SECTION.themeLight }, { v: 'dark', label: SECTION.themeDark }, { v: 'auto', label: SECTION.themeAuto },
  ];
  const [exitOpen, setExitOpen] = useState(false);
  const [exitReason, setExitReason] = useState<string | null>(null);
  const [exitComment, setExitComment] = useState('');
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  const email = me?.user.email ?? '';
  const plan = PLAN_LABEL[me?.user.plan ?? 'beta'] ?? me?.user.plan ?? '';

  const me1 = me;
  const svcCards = (
    <>
          {me1 && (
            <div className={styles.svc} data-section="home">
              <div className={styles.svcHead}>
                <Icon name="sys.home" size={16} inherit decorative />
                <span className={styles.svcName}>{SECTION.home}</span>
                <span className={styles.svcSub}>{SECTION.homeDesktop}</span>
                <span className={styles.svcGap} />
                {!inviteOpen && <button type="button" className={styles.svcAction} onClick={() => setInviteOpen(true)}>{SECTION.invite}</button>}
              </div>
              {me1.household.members.length <= 1 && (
                <div className={styles.svcRow}><span className={styles.svcMuted}>{SECTION.homeEmpty}</span></div>
              )}
              {me1.household.members.length > 1 && me1.household.members.map((mem) => {
                const isMe = mem.user_id === me1.user.id;
                const iAmOwner = me1.household.role === 'owner';
                const canRemove = (iAmOwner && !isMe) || (isMe && me1.household.role !== 'owner');
                return (
                  <div key={mem.user_id} className={styles.svcRow} data-member={mem.user_id}>
                    <span className={`${styles.avatar} ${isMe ? '' : styles.avatarGuest}`}>{initialOf(mem.name)}</span>
                    <span className={styles.svcText}>{mem.name}{isMe && <span className={styles.dim}> (ти)</span>}</span>
                    <span className={styles.svcMeta}>{mem.role === 'owner' ? 'власник' : 'учасник'}</span>
                    {iAmOwner && !isMe && mem.role === 'member' && (
                      <button type="button" className={styles.svcLink} onClick={() => void memberPromote(mem.user_id, mem.name)}>Передати роль</button>
                    )}
                    {canRemove && (
                      <button type="button" className={styles.svcLink} onClick={() => void memberRemove(mem.user_id, isMe, mem.name)}>{isMe ? 'Вийти з дому' : 'Виключити'}</button>
                    )}
                  </div>
                );
              })}
              {activeInvites.map((inv) => {
                const st = inviteStatus(inv);
                return (
                  <div key={inv.id} className={styles.svcRow} data-invite={inv.id}>
                    <span className={`${styles.avatar} ${styles.avatarPending}`} aria-hidden />
                    <span className={`${styles.svcText} ${styles.svcMuted} ${styles.ellipsis}`}>{inv.email}</span>
                    <span className={`${styles.svcMeta} ${st.cls}`}>{st.text}</span>
                    {st.text === 'чекає' && <button type="button" className={styles.svcLink} onClick={() => void inviteRevoke(inv.id)}>Скасувати</button>}
                  </div>
                );
              })}
              {lastInvite && (
                <div className={`${styles.banner} ${lastInvite.mail_sent ? styles.bannerOk : ''}`} data-invite-link>
                  <span className={styles.bannerText}>
                    {lastInvite.mail_sent ? `Лист пішов на ${lastInvite.email}. Або передай лінк сам.` : `Лист до ${lastInvite.email} не дійшов. Передай лінк сам, месенджером.`}
                  </span>
                  <button type="button" className={styles.bannerAction} onClick={() => void copyInviteLink()}>{linkCopied ? 'Скопійовано' : 'Скопіювати'}</button>
                </div>
              )}
              {inviteOpen && (
                <form onSubmit={inviteSend} className={styles.inviteForm} data-invite-form>
                  <input type="email" inputMode="email" placeholder="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className={styles.inviteInput} aria-label="email" />
                  <button type="submit" className={styles.inviteSend} disabled={inviting}>{SECTION.inviteSend}</button>
                </form>
              )}
              {inviteError && <div className={styles.inviteError}>{inviteError}</div>}
            </div>
          )}

          {retail !== 'loading' && retail !== 'unavailable' && (
            <div className={styles.svc} data-section="networks">
              <div className={styles.svcHead}>
                <Icon name="sys.receipt" size={16} inherit decorative />
                <span className={styles.svcName}>{SECTION.networks}</span>
                <span className={styles.svcSub}>{SECTION.networksDesktop}</span>
              </div>
              <div className={styles.svcRow}>
                <span className={styles.svcText}>Сільпо</span>
                {retail === 'active' && <span className={`${styles.svcMeta} ${styles.metaOk}`}><span className={styles.dot} />{receiptAt ? `чек ${fmtDay(receiptAt)}` : 'підключено'}</span>}
                {retail === 'expired' && <span className={`${styles.svcMeta} ${styles.metaAmber}`}>сесія закінчилась</span>}
                {retail === 'disconnected' && <span className={styles.svcMeta}>відключено</span>}
                {retail === 'none' && <a className={styles.svcAction} href="/v1/retail/silpo/connect">Підключити</a>}
                {retail === 'expired' && <a className={`${styles.svcAction} ${styles.metaAmber}`} href="/v1/retail/silpo/connect">Увійти знову</a>}
                {retail === 'disconnected' && <button type="button" className={styles.svcAction} onClick={() => void retailReconnect()} disabled={retailBusy}>Повернути</button>}
                {retail === 'active' && <button type="button" className={styles.svcLink} onClick={() => void retailDisconnect()} disabled={retailBusy}>Відключити</button>}
              </div>
              {karpaty && (
                <div className={styles.svcRow}>
                  <span className={styles.svcText}>Стейки Карпат</span>
                  <span className={styles.svcMeta}>без підключення</span>
                </div>
              )}
            </div>
          )}

          <div className={styles.svc} data-section="account">
            <div className={styles.svcHead}>
              <Icon name="sys.profile" size={16} inherit decorative />
              <span className={styles.svcName}>{SECTION.account}</span>
            </div>
            <div className={styles.svcRow}>
              <span className={`${styles.svcText} ${styles.svcMuted}`}>{SECTION.email}</span>
              <span className={styles.svcValue}>{email}</span>
            </div>
            <div className={styles.svcRow}>
              <span className={`${styles.svcText} ${styles.svcMuted}`}>{SECTION.plan}</span>
              <span className={styles.svcValue}>{plan}</span>
            </div>
            <div className={styles.svcRow}>
              <span className={`${styles.svcText} ${styles.svcMuted}`}>{SECTION.theme}</span>
              <span className={styles.segment} role="radiogroup" aria-label={SECTION.theme}>
                {THEMES.map((t) => (
                  <button key={t.v} type="button" role="radio" aria-checked={theme === t.v}
                    className={`${styles.seg} ${theme === t.v ? styles.segOn : ''}`} onClick={() => pickTheme(t.v)}>{t.label}</button>
                ))}
              </span>
            </div>
            {/* tokens-v3 (11.09): «Вийти» — контурна кнопка; «Видалити акаунт» — текст danger без рамки. */}
            <div className={styles.actions}>
              <button type="button" className={styles.logout} onClick={() => void logout()}>{SECTION.logout}</button>
              <button
                type="button"
                className={styles.deleteAccount}
                onClick={() => { setExitOpen(true); setExitReason(null); setExitComment(''); setExitError(null); }}
              >{SECTION.deleteAccount}</button>
            </div>
          </div>
    </>
  );
  return (
    <div className={`${styles.screen} screen-view`}>
      <AppHeader title={SECTION.title} onMenu={() => openNav(true)} />

      <div className={styles.main}>
        {/* ── Ліва колонка: речення · підказка · нотатки · джерела ── */}
        <div className={styles.left}>
          {/* Вступ: 1440 — «Про тебе · закінчи…» під h1; 390 — перший день /
              заповнений двома різними абзацами (D4). */}
          <p className={styles.introDesktop}>{SECTION.about} {SECTION.aboutDesktop}</p>
          <p className={styles.introMobile}>{firstDay ? SECTION.aboutFirstDay : SECTION.aboutMobile}</p>

          <div className={styles.about}>
            <div className={styles.card}>
              {PROFILE_ROWS.map((row) => {
                const active = focus === row.k;
                const c = counter(row);
                const st = fields[row.k].status;
                return (
                  <div key={row.k} className={styles.rowWrap}>
                    {/* Етап 4 (PLAN §6, Б2): status — три різні ФОРМИ, не тон.
                        filled — чорнило; empty — плейсхолдер dim курсивом з
                        пунктиром (єдине місце курсиву в продукті, tokens-v3);
                        none — «нічого такого» muted без курсиву + галочка в
                        шавлієвому колі (Components «profile states»). */}
                    <div
                      data-row={row.k}
                      data-status={st}
                      className={[styles.row, active ? styles.rowActive : '', hover === row.k && !active ? styles.rowHover : '', st === 'none' ? styles.rowNone : '', st === 'empty' ? styles.rowEmpty : ''].filter(Boolean).join(' ')}
                      onMouseEnter={() => setHover(row.k)}
                      onMouseLeave={() => setHover(null)}
                      onClick={(e) => { if (e.target === e.currentTarget) edits.current[row.k]?.focus(); }}
                    >
                      <span className={row.danger ? styles.startDanger : styles.start}>
                        {row.danger && <Icon name="cook.ban" size={12} inherit decorative />}
                        {row.start}
                      </span>
                      <span className={styles.line}>
                        {st === 'none' && !fields[row.k].text && (
                          <span className={styles.none} data-none onClick={() => edits.current[row.k]?.focus()}>нічого такого</span>
                        )}
                        <span
                          ref={(el) => { edits.current[row.k] = el; }}
                          className={styles.edit}
                          contentEditable
                          suppressContentEditableWarning
                          role="textbox"
                          aria-label={row.start}
                          data-ph={row.ph}
                          spellCheck={false}
                          onInput={() => onInput(row.k)}
                          onFocus={() => onFocus(row.k)}
                          onBlur={() => onBlur(row.k)}
                          onKeyDown={(e) => onKeyDown(row.k, row, e)}
                          onPaste={(e) => onPaste(row.k, row, e)}
                        />
                        {st === 'none' && !fields[row.k].text && (
                          <span className={styles.noneMark} aria-hidden><Icon name="sys.done" size={12} inherit decorative /></span>
                        )}
                      </span>
                      <span
                        className={[styles.counter, c.atLimit ? styles.counterLimit : '', c.near ? styles.counterNear : ''].filter(Boolean).join(' ')}
                        style={{ opacity: c.visible ? 1 : 0 }}
                        aria-hidden={!c.visible}
                        data-counter={row.k}
                      >{c.text}</span>
                      {c.visible && c.near && (
                        <span className={styles.bar} aria-hidden><span className={styles.barFill} style={{ width: `${c.pct}%` }} /></span>
                      )}
                    </div>
                    {/* Р8: «база кухні» — єдиний текст у профілі, якого людина не
                        писала: під полем і не в ньому, роллю caption. */}
                    {row.k === 'kit' && (
                      <div className={styles.baseline} data-baseline="kit">
                        {KIT_DEFAULTS.join(' · ')} — є за замовчуванням, це не твої слова
                      </div>
                    )}
                    {/* 390 (D4): підказка розкривається під активним рядком, шавлією. */}
                    {active && (
                      <div className={styles.hintMobile} key={hintKey}>{row.hint}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* ── Права колонка (№16, порядок aside Prototype): Підказка → Дім →
            Мережі → Акаунт; нижче ~1100 — та сама колонка одразу після речень,
            підказка не sticky. Третьої колонки не буває. ── */}
        <div className={styles.right}>
          <aside className={styles.hintAside} key={hintKey} data-hint-aside>
            <span className={styles.hintLabel}>{hintRow ? hintRow.start : HINT_IDLE.label}</span>
            {/* 9а(5): приклади (`ex`) з копі не рендеряться — лишається текст підказки. */}
            <p className={styles.hintText}>{hintRow ? hintRow.hint : HINT_IDLE.text}</p>
          </aside>
          {svcCards}
        </div>

        <div className={styles.bottom}>
          {/* ── Нотатки (D4): підпис + картка рядків 48 ── */}
          <div className={styles.section} data-section="notes">
            {/* №15: хедер картки — чорнильний, як зони комори; знака для нотаток у
                словнику нема (питання дизайн-чату), тож лише назва. */}
            <div className={styles.notesCard}>
              <div className={styles.svcHead}>
                <span className={styles.svcName}>{SECTION.notes}</span>
                <span className={styles.svcSub} title={SECTION.notesDesktop}>{SECTION.notesDesktop}</span>
              </div>
              {notes.length === 0 && !noteToast && <span className={styles.empty}>{SECTION.notesEmpty}</span>}
              {notes.map((n) => (
                <div key={n.id} className={styles.note} data-note={n.id}>
                  <span className={styles.noteDate}>{fmtDate(n.created_at)}</span>
                  <span className={styles.noteText}>{n.text}</span>
                  <button type="button" className={styles.noteRemove} onClick={() => void removeNote(n)}>{SECTION.noteRemove}</button>
                </div>
              ))}
              {noteToast && (
                <div className={`${styles.note} ${styles.noteRemoved}`} role="status" data-note-removed>
                  <span className={styles.noteDate}>{fmtDate(noteToast.note.created_at)}</span>
                  <span className={`${styles.noteText} ${styles.noteStruck}`}>{noteToast.note.text}</span>
                  <span className={styles.noteRestore}>{SECTION.removed} <button type="button" className={styles.noteRestoreBtn} onClick={() => void restoreNote()}>{SECTION.restore}</button></span>
                </div>
              )}
            </div>
          </div>

          {/* ── Джерела даних (раунд 5, Н1): абзац, у D4 — під нотатками ── */}
          <div className={styles.section} data-section="data">
            <div className={styles.sectionLabel}><span className={styles.sectionName}>{SECTION.data}</span></div>
            <p className={styles.dataText}>{SECTION.dataText}</p>
          </div>
        </div>

      </div>

      {saveToast && <div className={styles.toast} role="status">{saveToast}</div>}

      {/* Видалення (D4 «Профіль · 390 · видалення», Prototype): шторка з
          кікером «Назавжди», чотирма причинами; «Лишаюсь» головна, «Видалити
          назавжди» контурна danger і неактивна, поки не вибрано причину. */}
      {exitOpen && (
        <Sheet onClose={() => !exitBusy && setExitOpen(false)} ariaLabel="Видалення акаунта">
          <div className={styles.exitSheet}>
            <div className={styles.exitHead}>
              <span className={styles.exitKicker}>Назавжди</span>
              <h2 className={styles.exitTitle}>Видалити акаунт назавжди?</h2>
              <p className={styles.exitSub}>
                Зникне все: комора, рецепти, журнал готувань, профіль смаків. Це не «вийти» —
                відновити буде неможливо. Розкажи чому — одна відповідь дуже допоможе.
              </p>
            </div>
            <div className={styles.exitReasons} role="radiogroup" aria-label="Причина">
              {EXIT_REASONS.map((r) => (
                <label key={r.code} className={`${styles.exitReason} ${exitReason === r.code ? styles.exitReasonOn : ''}`}>
                  <input type="radio" name="exit-reason" className={styles.exitRadio} checked={exitReason === r.code} onChange={() => setExitReason(r.code)} />
                  <span className={styles.radioMark} aria-hidden />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
            {exitReason === 'other' && (
              <Input placeholder="Кілька слів — що саме?" value={exitComment} onChange={(e) => setExitComment(e.target.value)} />
            )}
            {exitError && <p className={styles.exitError}>{exitError}</p>}
            <div className={styles.exitActions}>
              <button type="button" className={styles.exitStay} onClick={() => setExitOpen(false)} disabled={exitBusy}>Лишаюсь</button>
              <button
                type="button"
                className={styles.exitConfirm}
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
              >{exitBusy ? 'Видаляю…' : 'Видалити назавжди'}</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// Для тестів і сторінки: чи всі сім полів порожні («перший день»).
export function isFirstDay(fields: Record<string, ProfileFieldV2>): boolean {
  return PROFILE_ROWS.every((r) => fields[r.k]?.status === 'empty');
}

export const _styles: CSSProperties = {};
