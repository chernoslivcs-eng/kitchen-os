// Профіль за Prototype (`Kitchen OS - Prototype.dc.html`, вкладка «Профіль»,
// 1440 і 390) — рішення власника 13.09, PROFILE-LOGIC-0913.md §7. Логіка і
// склад елементів — як були (сім речень з автозбереженням, нотатки з undo,
// дім, мережі, акаунт, видалення шторкою); змінилось розташування:
//   1440 — ліворуч картка-аркуш (Профіль · вступ · імʼя · речення рядками
//   «початок · відповідь» з волосинами · підпис про вето · Нотатки), праворуч
//   Дім · Мережі · Акаунт без карток і без чорнильних шапок (Р90 знято);
//   390 — один стовпчик у тому ж порядку.
// Підказок нема зовсім; лічильник «N / 200» — лише під час введення. Дії з
// людиною — з меню «…» (ті самі запити й підтвердження, що були).
//
// Рядок — речення: початок сірим (для «Мені не можна» — --plum з ban), відповідь
// contenteditable. Автозбереження PATCH /v1/profile/:key по blur і по паузі
// 800 мс, оптимістично, без спінерів; помилка — тост і один повтор.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ClipboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, type ProfileV2Response, type ProfileFieldV2, type ProfileNoteV2, type InviteInfo, type InviteCreated, type AccountConflict } from '../../api';
import { PROFILE_ROWS, SECTION, PLAN_LABEL, TELEGRAM, MERGE, type ProfileRowCopy } from '../../lib/profile-copy';
import { TABLET_MIN } from '../../lib/device';
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
const hoursLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000));

const EXIT_REASONS: Array<{ code: string; label: string }> = [
  { code: 'unused', label: 'Не користуюсь' },
  { code: 'hard', label: 'Незручно або складно' },
  { code: 'privacy', label: 'Питання приватності' },
  { code: 'other', label: 'Інше' },
];

type RetailStatus = 'loading' | 'unavailable' | 'none' | 'active' | 'expired' | 'disconnected';

export function ProfileV2({ initial }: { initial: ProfileV2Response }) {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useAuth((s) => s.me);
  const logout = useAuth((s) => s.logout);
  const openNav = useNavStore((s) => s.setOpen);

  // ----- Речення ------------------------------------------------------------
  const [fields, setFields] = useState<Fields>(initial.fields);
  const [focus, setFocus] = useState<ProfileFieldKey | null>(null);
  const [typing, setTyping] = useState<ProfileFieldKey | null>(null);
  const [lens, setLens] = useState<Record<ProfileFieldKey, number>>(() =>
    Object.fromEntries(PROFILE_ROWS.map((r) => [r.k, len(initial.fields[r.k].text)])) as Record<ProfileFieldKey, number>);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- скидання contentEditable лише при монтуванні — initial першого рендера навмисно
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
    window.clearTimeout(timers.current[`save-${k}`]);
    void persist(k);
  }
  function onKeyDown(_k: ProfileFieldKey, row: ProfileRowCopy, e: KeyboardEvent<HTMLSpanElement>) {
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

  // Етап 4 (PLAN §3, §6): лічильник зʼявляється за 20 знаків до стелі; тепер
  // (§7) — лише під час введення в рядку, без підказки.
  const COUNTER_AHEAD = 20;
  const counter = (row: ProfileRowCopy) => {
    const n = lens[row.k];
    const atLimit = n >= row.max;
    const near = row.max - n <= COUNTER_AHEAD;
    const active = focus === row.k;
    return {
      text: atLimit ? `${n} / ${row.max} · ${row.lim}` : `${n} / ${row.max}`,
      visible: active && (typing === row.k || atLimit || near),
      atLimit,
      near,
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

  // ----- Дім (9а(7)): люди, з якими ділиш комору — існуючі ендпоінти ------
  const refreshMe = useAuth((s) => s.refresh);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<InviteCreated | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const householdId = me?.household.id;
  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    api.households.listInvites(householdId).then((r) => { if (alive) setInvites(r.invites); }).catch(() => {});
    return () => { alive = false; };
  }, [householdId]);
  // Меню «…» закривається кліком повз і Escape.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, [menuFor]);
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

  // ----- Додати пошту (PR 2, TELEGRAM-AUTH-PAY-PLAN-0915): акаунт без пошти
  // (Telegram-only) — рядок «Пошта» замість значення показує «Додати пошту»;
  // тап відкриває поле, той самий magic-link конвеєр (лінк несе &attach=1,
  // не логінить, а дописує пошту в поточну сесію). --------------------------
  type EmailAddState = 'idle' | 'editing' | 'sending' | 'sent';
  const [emailAdd, setEmailAdd] = useState<EmailAddState>('idle');
  const [emailDraft, setEmailDraft] = useState('');
  const [emailAddError, setEmailAddError] = useState<string | null>(null);
  async function emailAddSubmit(e: FormEvent) {
    e.preventDefault();
    const value = emailDraft.trim().toLowerCase();
    if (!value) return;
    setEmailAdd('sending');
    setEmailAddError(null);
    try {
      await api.auth.attachEmailRequest(value);
      setEmailAdd('sent');
    } catch (err) {
      setEmailAdd('editing');
      setEmailAddError(err instanceof ApiError && err.status === 409 ? SECTION.emailTaken : SECTION.emailAddError);
    }
  }

  // ----- Telegram (Р148): рядок в «Акаунті» -------------------------------------
  type TgState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; linked: boolean; username: string | null };
  const [tg, setTg] = useState<TgState>({ kind: 'loading' });
  const [tgBusy, setTgBusy] = useState(false);
  const [tgLink, setTgLink] = useState<string | null>(null);
  const [tgCopied, setTgCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    void api.telegram.status()
      .then((r) => { if (alive) setTg({ kind: 'ready', linked: r.linked, username: r.username }); })
      .catch(() => { if (alive) setTg({ kind: 'error' }); });
    return () => { alive = false; };
  }, []);
  async function tgConnect() {
    if (tgBusy) return;
    setTgBusy(true);
    try {
      const { url } = await api.telegram.linkToken();
      // До 768 Telegram перехопить лінк сам; далі — лінк у рядку, бо телефон окремо.
      if (window.innerWidth < TABLET_MIN) window.open(url); else { setTgLink(url); setTgCopied(false); }
    } catch { setTg({ kind: 'error' }); } finally { setTgBusy(false); }
  }
  async function tgDisconnect() {
    if (tgBusy || !confirm(TELEGRAM.disconnectConfirm)) return;
    setTgBusy(true);
    try { await api.telegram.unlink(); setTg({ kind: 'ready', linked: false, username: null }); setTgLink(null); }
    catch { setTg({ kind: 'error' }); } finally { setTgBusy(false); }
  }
  // ----- Злиття акаунтів (15.09): Telegram чи пошта вже мають свій акаунт ---
  // Доведення живе 15 хв; профіль питає раз при відкритті і після кожного
  // «Підключити»/листа (раз на 3 с, поки лінк відкритий) — і показує note.
  type MergeState =
    | { kind: 'none' }
    | { kind: 'ask'; conflict: AccountConflict }
    | { kind: 'busy'; conflict: AccountConflict }
    | { kind: 'done'; which: 'telegram' | 'email'; batches: number; emailMoved: boolean }
    | { kind: 'error'; conflict: AccountConflict };
  const [merge, setMerge] = useState<MergeState>({ kind: 'none' });
  const pollConflict = useCallback(async () => {
    try {
      const c = await api.account.conflict();
      setMerge((m) => (m.kind === 'busy' || m.kind === 'done' ? m : c ? { kind: 'ask', conflict: c } : { kind: 'none' }));
      return c;
    } catch { return null; }
  }, []);
  useEffect(() => { void pollConflict(); }, [pollConflict]);
  useEffect(() => {
    if (!tgLink) return;
    const id = window.setInterval(() => { void pollConflict().then((c) => { if (c) setTgLink(null); }); }, 3000);
    return () => window.clearInterval(id);
  }, [tgLink, pollConflict]);
  async function mergeAccounts() {
    if (merge.kind !== 'ask' && merge.kind !== 'error') return;
    const { conflict } = merge;
    setMerge({ kind: 'busy', conflict });
    try {
      const r = await api.account.merge(conflict.from_user_id);
      setMerge({ kind: 'done', which: r.kind, batches: r.stats.batches, emailMoved: r.stats.email_moved });
      // Пошта переїхала — перечитати me, щоб рядок «Пошта» показав її без перезавантаження.
      if (r.stats.email_moved) { setEmailAdd('idle'); void useAuth.getState().refresh(); }
      if (r.kind === 'telegram') { setTg({ kind: 'ready', linked: true, username: tg.kind === 'ready' ? tg.username : null }); setTgLink(null); }
    } catch { setMerge({ kind: 'error', conflict }); }
  }
  async function keepSeparate() {
    if (merge.kind !== 'ask' && merge.kind !== 'error') return;
    setMerge({ kind: 'none' });
    try { await api.account.dismissConflict(); } catch { /* доведення саме згорить за 15 хв */ }
  }
  const mergeNote = merge.kind === 'none' ? null : (
    <div className={`${styles.mergeNote} ${merge.kind === 'done' ? styles.mergeNoteDone : ''}`} data-merge={merge.kind} role="status">
      {merge.kind === 'done' ? (
        <span>{MERGE.done(merge.which, merge.batches, merge.emailMoved)}</span>
      ) : (
        <>
          <span>{merge.conflict.sole_member
            ? MERGE.ask(merge.conflict.kind, merge.conflict.household_name, merge.conflict.pantry_count, merge.conflict.recipe_count)
            : MERGE.blocked(merge.conflict.kind, merge.conflict.household_name)}</span>
          {merge.kind === 'error' && <span className={styles.tgError}>{MERGE.error}</span>}
          <div className={styles.mergeActions}>
            {merge.conflict.sole_member && (
              <button type="button" className={styles.mergeBtn} data-tap onClick={() => void mergeAccounts()} disabled={merge.kind === 'busy'}>{MERGE.merge}</button>
            )}
            <button type="button" className={styles.tgConnect} data-tap onClick={() => void keepSeparate()} disabled={merge.kind === 'busy'}>{MERGE.keep}</button>
          </div>
        </>
      )}
    </div>
  );

  async function tgCopy() {
    if (!tgLink) return;
    try { await navigator.clipboard.writeText(tgLink); setTgCopied(true); } catch { /* лінк видно — скопіює рукою */ }
  }

  // ----- Мережі (існуючі ендпоінти M13, без нової логіки) --------------------
  const [retail, setRetail] = useState<RetailStatus>('loading');
  const [receiptAt, setReceiptAt] = useState<string | null>(null);
  const [karpaty, setKarpaty] = useState(false);
  const [retailBusy, setRetailBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    // Після підключення — наступне відкриття стрічки синкає одразу (тротл у localStorage, як у Feed).
    if (new URLSearchParams(window.location.search).get('retail') === 'connected') { try { localStorage.removeItem('kos_retail_sync_at'); } catch { /* ок */ } }
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
  // Тема · Світла / Темна / Авто; без вибору — Світла (рішення власника 13.09).
  const [theme, setTheme] = useState<ThemeSetting>(() => (typeof document === 'undefined' ? 'light' : themeSetting()));
  function pickTheme(next: ThemeSetting) { setThemeSetting(next); setTheme(next); }
  const THEMES: { v: ThemeSetting; label: string }[] = [
    { v: 'light', label: SECTION.themeLight }, { v: 'dark', label: SECTION.themeDark }, { v: 'auto', label: SECTION.themeAuto },
  ];
  const [exitOpen, setExitOpen] = useState(false);
  const [exitReason, setExitReason] = useState<string | null>(null);
  const [exitComment, setExitComment] = useState('');
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  // PR 1 (0036): акаунт народжений із Telegram — пошти нема, рядок каже «Telegram».
  const email = me?.user.email ?? SECTION.emailNone;
  const plan = PLAN_LABEL[me?.user.plan ?? 'beta'] ?? me?.user.plan ?? '';
  const others = me ? me.household.members.filter((m) => m.user_id !== me.user.id).map((m) => m.name) : [];

  const me1 = me;
  const homeSection = me1 && (
    <section className={styles.svc} data-section="home">
      <div className={styles.svcHead}>
        <span className={styles.svcName}>{SECTION.home}</span>
        <span className={styles.svcGap} />
        {!inviteOpen && <button type="button" className={styles.svcAction} data-tap onClick={() => setInviteOpen(true)}>{SECTION.invite}</button>}
      </div>
      <span className={styles.svcSub}>{SECTION.homeSub}</span>
      {me1.household.members.length <= 1 && (
        <p className={styles.svcEmpty}>{SECTION.homeEmpty}</p>
      )}
      {me1.household.members.length > 1 && me1.household.members.map((mem) => {
        const isMe = mem.user_id === me1.user.id;
        const iAmOwner = me1.household.role === 'owner';
        // Дії — як були: власник передає роль і виключає; учасник виходить сам.
        const actions: { label: string; danger?: boolean; go: () => void }[] = [];
        if (iAmOwner && !isMe && mem.role === 'member') actions.push({ label: SECTION.memberPromote, go: () => void memberPromote(mem.user_id, mem.name) });
        if (iAmOwner && !isMe) actions.push({ label: SECTION.memberRemove, danger: true, go: () => void memberRemove(mem.user_id, false, mem.name) });
        if (isMe && !iAmOwner) actions.push({ label: SECTION.memberLeave, danger: true, go: () => void memberRemove(mem.user_id, true, mem.name) });
        const open = menuFor === mem.user_id;
        return (
          <div key={mem.user_id} className={styles.person} data-member={mem.user_id}>
            <span className={`${styles.avatar} ${isMe ? styles.avatarMe : styles.avatarGuest}`}>{initialOf(mem.name)}</span>
            <span className={styles.personName}>{mem.name}{isMe && <span className={styles.dim}> (ти)</span>}</span>
            <span className={styles.personRole}>{mem.role === 'owner' ? 'власник' : 'учасник'}</span>
            {actions.length > 0 && (
              <button type="button" className={`${styles.more} ${open ? styles.moreOn : ''}`} data-tap aria-label={`Дії · ${mem.name}`} aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); setMenuFor(open ? null : mem.user_id); }}>
                <Icon name="sys.more" size={16} inherit decorative />
              </button>
            )}
            {open && (
              <div className={styles.menu} role="menu" data-member-menu onClick={(e) => e.stopPropagation()}>
                {actions.map((a) => (
                  <button key={a.label} type="button" role="menuitem" className={`${styles.menuItem} ${a.danger ? styles.menuDanger : ''}`}
                    onClick={() => { setMenuFor(null); a.go(); }}>{a.label}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {activeInvites.map((inv) => {
        const st = inviteStatus(inv);
        const h = hoursLeft(inv.expires_at);
        return (
          <div key={inv.id} className={styles.person} data-invite={inv.id}>
            <span className={`${styles.avatar} ${styles.avatarPending}`} aria-hidden><Icon name="sys.mail" size={12} inherit decorative /></span>
            <span className={styles.personText}>
              <span className={`${styles.personName} ${styles.muted}`}>{inv.email}</span>
              {st.text === 'чекає' && <span className={styles.personSub}>{SECTION.inviteLinkHours(h)}</span>}
            </span>
            <span className={`${styles.personRole} ${st.cls}`}>{st.text}</span>
            {st.text === 'чекає' && <button type="button" className={styles.svcLink} data-tap onClick={() => void inviteRevoke(inv.id)}>Скасувати</button>}
          </div>
        );
      })}
      {lastInvite && (
        <div className={`${styles.banner} ${lastInvite.mail_sent ? styles.bannerOk : ''}`} data-invite-link>
          <span className={styles.bannerText}>
            {lastInvite.mail_sent ? `Лист пішов на ${lastInvite.email}. Або передай лінк сам.` : `Лист до ${lastInvite.email} не дійшов. Передай лінк сам, месенджером.`}
          </span>
          <button type="button" className={styles.bannerAction} data-tap onClick={() => void copyInviteLink()}>{linkCopied ? 'Скопійовано' : 'Скопіювати'}</button>
        </div>
      )}
      {inviteOpen && (
        <form onSubmit={inviteSend} className={styles.inviteForm} data-invite-form>
          <input type="email" inputMode="email" autoComplete="email" enterKeyHint="send" placeholder="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className={styles.inviteInput} aria-label="email" />
          <button type="submit" className={styles.inviteSend} data-tap disabled={inviting}>{SECTION.inviteSend}</button>
        </form>
      )}
      {inviteError && <div className={styles.inviteError}>{inviteError}</div>}
    </section>
  );

  const networksSection = (
    <section className={styles.svc} data-section="networks">
      <div className={styles.svcHead}><span className={styles.svcName}>{SECTION.networks}</span></div>
      <span className={styles.svcSub}>{SECTION.networksSub}</span>
      {retail !== 'loading' && retail !== 'unavailable' && (
        <div className={styles.netRow}>
          <span className={styles.netName}>Сільпо</span>
          {retail === 'active' && <span className={`${styles.netState} ${styles.metaOk}`}>{receiptAt ? `чек ${fmtDay(receiptAt)}` : 'підключено'}</span>}
          {retail === 'expired' && <span className={`${styles.netState} ${styles.metaAmber}`}>сесія закінчилась</span>}
          {retail === 'disconnected' && <span className={styles.netState}>відключено</span>}
          {retail === 'none' && <span className={styles.netState}>без підключення</span>}
          {retail === 'none' && <a className={`${styles.svcLink} ${styles.linkSage}`} data-tap href="/v1/retail/silpo/connect">Підключити</a>}
          {retail === 'expired' && <a className={`${styles.svcLink} ${styles.metaAmber}`} data-tap href="/v1/retail/silpo/connect">Увійти знову</a>}
          {retail === 'disconnected' && <button type="button" className={`${styles.svcLink} ${styles.linkSage}`} data-tap onClick={() => void retailReconnect()} disabled={retailBusy}>Повернути</button>}
          {retail === 'active' && <button type="button" className={styles.svcLink} data-tap onClick={() => void retailDisconnect()} disabled={retailBusy}>Відключити</button>}
        </div>
      )}
      {retail !== 'loading' && retail !== 'unavailable' && karpaty && (
        <div className={styles.netRow}>
          <span className={styles.netName}>Стейки Карпат</span>
          <span className={styles.netState}>без підключення</span>
        </div>
      )}
    </section>
  );

  const accountSection = (
    <section className={styles.svc} data-section="account">
      <div className={styles.svcHead}><span className={styles.svcName}>{SECTION.account}</span></div>
      <div className={styles.accRow}>
        <span className={styles.accKey}>{SECTION.email}</span>
        {me?.user.email ? (
          <span className={styles.accVal}>{email}</span>
        ) : emailAdd === 'sent' ? (
          <span className={styles.accVal}>{SECTION.emailSent}</span>
        ) : emailAdd === 'editing' || emailAdd === 'sending' ? (
          <form className={styles.tgLinkRow} onSubmit={(e) => void emailAddSubmit(e)}>
            <input
              type="email" inputMode="email" autoComplete="email" placeholder={SECTION.emailPlaceholder} required autoFocus
              value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} aria-label={SECTION.email}
              disabled={emailAdd === 'sending'} className={styles.inviteInput}
            />
            <button type="submit" className={styles.svcLink} disabled={emailAdd === 'sending'}>{SECTION.emailSend}</button>
          </form>
        ) : (
          // PR 1 дає лише статичне «Telegram» (SECTION.emailNone); тут — те
          // саме значення (з @username, коли відомий), плюс дія поруч.
          <span className={styles.tgLinkRow}>
            <span className={styles.accVal}>{email}{tg.kind === 'ready' && tg.linked && tg.username ? ` · @${tg.username}` : ''}</span>
            <button type="button" className={styles.svcLink} data-tap onClick={() => setEmailAdd('editing')}>{SECTION.emailAdd}</button>
          </span>
        )}
      </div>
      {emailAddError && <span className={styles.tgError}>{emailAddError}</span>}
      {(merge.kind === 'done' ? merge.which : merge.kind !== 'none' ? merge.conflict.kind : null) === 'email' && mergeNote}
      <div className={styles.accRow}>
        <span className={styles.accKey}>{SECTION.plan}</span>
        <span className={styles.accVal}>{plan}</span>
      </div>
      <div className={`${styles.accRow} ${styles.accRowTg}`} data-telegram>
        <span className={styles.accKey}>{TELEGRAM.row}</span>
        {tg.kind === 'error' && <span className={`${styles.accVal} ${styles.tgError}`}>{TELEGRAM.error}</span>}
        {tg.kind === 'ready' && tg.linked && (
          <>
            <span className={styles.accVal}>{TELEGRAM.linked(tg.username)}</span>
            <button type="button" className={styles.svcLink} data-tap onClick={() => void tgDisconnect()} disabled={tgBusy}>{TELEGRAM.disconnect}</button>
          </>
        )}
        {(tg.kind === 'loading' || (tg.kind === 'ready' && !tg.linked)) && (
          <button type="button" className={styles.tgConnect} data-tap onClick={() => void tgConnect()} disabled={tg.kind === 'loading' || tgBusy}>{TELEGRAM.connect}</button>
        )}
      </div>
      {tgLink && tg.kind === 'ready' && !tg.linked && (
        <div className={styles.tgLinkBox} data-telegram-link>
          <div className={styles.tgLinkRow}>
            <code className={styles.tgLink}>{tgLink}</code>
            <button type="button" className={styles.svcLink} data-tap onClick={() => void tgCopy()}>{tgCopied ? TELEGRAM.copied : TELEGRAM.copy}</button>
          </div>
          <span className={styles.tgHint}>{TELEGRAM.linkHint}</span>
        </div>
      )}
      {(merge.kind === 'done' ? merge.which : merge.kind !== 'none' ? merge.conflict.kind : null) === 'telegram' && mergeNote}
      <div className={`${styles.accRow} ${styles.accRowTheme}`}>
        <span className={styles.accKey}>{SECTION.theme}<span className={styles.accKeySub}>{SECTION.themeSub}</span></span>
        <span className={styles.segment} role="radiogroup" aria-label={SECTION.theme}>
          {THEMES.map((t) => (
            <button key={t.v} type="button" role="radio" aria-checked={theme === t.v}
              className={`${styles.seg} ${theme === t.v ? styles.segOn : ''}`} data-tap onClick={() => pickTheme(t.v)}>{t.label}</button>
          ))}
        </span>
      </div>
      <div className={`${styles.accRow} ${styles.accRowDocs}`}>
        <span className={styles.accKey}>{SECTION.documents}</span>
        <span className={styles.docsLinks}>
          <Link to="/terms" state={{ background: location }} className={styles.svcLink}>{SECTION.documentsTerms}</Link>
          <Link to="/privacy" state={{ background: location }} className={styles.svcLink}>{SECTION.documentsPrivacy}</Link>
          <Link to="/refund" state={{ background: location }} className={styles.svcLink}>{SECTION.documentsRefund}</Link>
          <Link to="/contacts" state={{ background: location }} className={styles.svcLink}>{SECTION.documentsContacts}</Link>
        </span>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.logout} data-tap onClick={() => void logout()}>{SECTION.logout}</button>
        <button
          type="button"
          className={styles.deleteAccount} data-tap
          onClick={() => { setExitOpen(true); setExitReason(null); setExitComment(''); setExitError(null); }}
        >{SECTION.deleteAccount}</button>
      </div>
      {others.length > 0 && <p className={styles.deleteNote} data-delete-note>{SECTION.deleteNote(others.join(', '))}</p>}
    </section>
  );

  return (
    <div className={`${styles.screen} screen-view`}>
      {/* Заголовок сторінки — в аркуші (Prototype); шапка оболонки лишається
          лише на <1024 заради кнопки шухляди, без власного «Профіль». */}
      <div className={styles.head}><AppHeader title="" onMenu={() => openNav(true)} /></div>

      <div className={styles.main}>
        {/* ── Аркуш: Профіль · вступ · імʼя · речення · вето · Нотатки ── */}
        <div className={styles.left}>
          <div className={styles.sheet}>
            <div className={styles.sheetHead}>
              <h1 className={styles.sheetTitle}>{SECTION.title}</h1>
              <p className={styles.intro}><span className={styles.introDesktop}>{SECTION.intro}</span><span className={styles.introMobile}>{SECTION.introMobile}</span></p>
            </div>
            <div className={styles.rule} />
            <div className={styles.name}>{me?.user.name ?? ''}</div>

            <div className={styles.rows}>
              {PROFILE_ROWS.map((row) => {
                const active = focus === row.k;
                const c = counter(row);
                const st = fields[row.k].status;
                return (
                  <div key={row.k} className={styles.rowWrap}>
                    {/* Етап 4 (PLAN §6, Б2): status — три різні ФОРМИ, не тон.
                        filled — чорнило; empty — плейсхолдер dim курсивом (єдине
                        місце курсиву в продукті, tokens-v3); none — «нічого
                        такого» muted без курсиву + галочка в шавлієвому колі. */}
                    <div
                      data-row={row.k}
                      data-status={st}
                      className={[styles.row, active ? styles.rowActive : '', st === 'none' ? styles.rowNone : '', st === 'empty' ? styles.rowEmpty : ''].filter(Boolean).join(' ')}
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
                          className={`${styles.edit} ${row.danger ? styles.editDanger : ''}`}
                          contentEditable
                          suppressContentEditableWarning
                          enterKeyHint="done"
                          role="textbox"
                          aria-label={row.start}
                          data-ph={row.ph}
                          spellCheck={false}
                          onInput={() => onInput(row.k)}
                          onFocus={() => setFocus(row.k)}
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
                    </div>
                    {/* Р8: «база кухні» — єдиний текст у профілі, якого людина не
                        писала: під полем і не в ньому, роллю caption. */}
                    {row.k === 'kit' && (
                      <div className={styles.baseline} data-baseline="kit">
                        {KIT_DEFAULTS.join(' · ')} — є за замовчуванням, це не твої слова
                      </div>
                    )}
                    {/* Юридичні документи (23.09): підказка під полем алергій — без
                        чекбоксу, не блокує ввід, лише лінк на політику. */}
                    {row.k === 'ban' && (
                      <div className={styles.baseline} data-privacy-note="ban">
                        <Link to="/privacy" state={{ background: location }} className={styles.baselineLink}>{SECTION.banPrivacyNote}</Link>
                      </div>
                    )}
                  </div>
                );
              })}
              <p className={styles.vetoNote}>{SECTION.vetoNote}</p>
            </div>

            {/* ── Нотатки ── */}
            <div className={styles.notes} data-section="notes">
              <div className={styles.notesHead}>
                <span className={styles.notesTitle}>{SECTION.notes}</span>
                <span className={styles.notesSub}>{SECTION.notesSub}</span>
              </div>
              {notes.length === 0 && !noteToast && <p className={styles.notesEmpty}>{SECTION.notesEmpty}</p>}
              {notes.map((n) => (
                <div key={n.id} className={styles.note} data-note={n.id}>
                  <span className={styles.noteDate}>{fmtDate(n.created_at)}</span>
                  <span className={styles.noteText}>{n.text}</span>
                  <button type="button" className={styles.noteRemove} data-tap onClick={() => void removeNote(n)}>{SECTION.noteRemove}</button>
                </div>
              ))}
              {noteToast && (
                <div className={`${styles.note} ${styles.noteRemoved}`} role="status" data-note-removed>
                  <span className={styles.noteDate}>{fmtDate(noteToast.note.created_at)}</span>
                  <span className={`${styles.noteText} ${styles.noteStruck}`}>{noteToast.note.text}</span>
                  <span className={styles.noteRestore}>{SECTION.removed} <button type="button" className={styles.noteRestoreBtn} data-tap onClick={() => void restoreNote()}>{SECTION.restore}</button></span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── Права колонка без карток і шапок: Дім → Мережі → Акаунт ── */}
        <div className={styles.right}>
          {homeSection}
          <div className={styles.divider} />
          {networksSection}
          <div className={styles.divider} />
          {accountSection}
        </div>

        {/* ── Джерела даних (раунд 5, Н1): під аркушем на 1440, останнім на 390 ── */}
        <div className={styles.data} data-section="data">
          <span className={styles.dataName}>{SECTION.data}</span>
          <p className={styles.dataText}>{SECTION.dataText}</p>
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
                    void navigate('/', { replace: true });
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
