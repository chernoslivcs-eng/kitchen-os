// Профіль v6 (AUDIT-ROUND-4.md §8, design/PROFILE-v6.dc.html): сім речень,
// нотатки, мережі, акаунт. Крок 11: єдина сторінка профілю (ProfileRoute
// лише завантажує GET /v1/profile).
//
// Рядок — речення: початок сірим (для «Мені не можна» — --danger), закінчення
// contenteditable з пунктиром. Автозбереження PATCH /v1/profile/:key по blur і
// по паузі 800 мс, оптимістично, без спінерів; помилка — тост і один повтор.

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProfileV2Response, type ProfileFieldV2, type ProfileNoteV2, type InviteInfo, type InviteCreated } from '../../api';
import { PROFILE_ROWS, HINT_IDLE, SECTION, PLAN_LABEL, type ProfileRowCopy } from '../../lib/profile-copy';
import type { ProfileFieldKey } from '@kitchen/domain/profile-fields';
import { useAuth } from '../../store/auth';
import { currentTheme, setThemeOverride, type ThemeChoice } from '../../theme';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Sheet } from '../../components/Sheet/Sheet';
import { ProfileAbout } from './ProfileAbout';
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
  const M = ['СІЧ', 'ЛЮТ', 'БЕР', 'КВІ', 'ТРА', 'ЧЕР', 'ЛИП', 'СЕР', 'ВЕР', 'ЖОВ', 'ЛИС', 'ГРУ'];
  return `${d.getDate()} ${M[d.getMonth()]}`;
};

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

  // Крок П3 (2): «ПРО ТЕБЕ» і «НОТАТКИ» живуть у ProfileAbout — тому самому
  // компоненті, який стоїть у панелі артефактів. Копії тут більше немає.

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
    if (inv.consumed_at) return { text: 'ПРИЙНЯТО', cls: styles.metaOk ?? '' };
    if (inv.revoked_at) return { text: 'СКАСОВАНО', cls: '' };
    if (new Date(inv.expires_at).getTime() < Date.now()) return { text: 'ТЕРМІН СПЛИВ', cls: '' };
    return { text: 'ЧЕКАЄ', cls: styles.metaAmber ?? '' };
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
  const [theme, setTheme] = useState<ThemeChoice>(() => (typeof document === 'undefined' ? 'dark' : currentTheme()));
  function toggleTheme() {
    const next: ThemeChoice = theme === 'light' ? 'dark' : 'light';
    setThemeOverride(next);
    setTheme(next);
  }
  const [exitOpen, setExitOpen] = useState(false);
  const [exitReason, setExitReason] = useState<string | null>(null);
  const [exitComment, setExitComment] = useState('');
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  const email = me?.user.email ?? '';
  const plan = PLAN_LABEL[me?.user.plan ?? 'beta'] ?? me?.user.plan ?? '';

  return (
    <div className={`${styles.screen} screen-view`}>
      <div className={styles.head}><h1 className={styles.title}>{SECTION.title}</h1></div>

      <ProfileAbout initial={initial} />

      {/* ----- Дім: список людей, запрошення, ролі — ендпоінти v1 без змін ----- */}
      {me && (
        <div className={styles.section} data-section="home">
          <div className={styles.sectionLabel}>
            <span>{SECTION.home}</span>
            <span className={styles.sectionSubDesktop}>{SECTION.homeDesktop}</span>
          </div>
          {me.household.members.length <= 1 && !inviteOpen && (
            <div className={styles.listRow}>
              <span className={styles.listNameMuted}>{SECTION.homeEmpty}</span>
              <button type="button" className={styles.listAction} onClick={() => setInviteOpen(true)}>{SECTION.invite}</button>
            </div>
          )}
          {me.household.members.length > 1 && me.household.members.map((mem) => {
            const isMe = mem.user_id === me.user.id;
            const iAmOwner = me.household.role === 'owner';
            const canRemove = (iAmOwner && !isMe) || (isMe && me.household.role !== 'owner');
            return (
              <div key={mem.user_id} className={styles.listRow} data-member={mem.user_id}>
                <span className={styles.listName}>{mem.name}{isMe ? ' (ти)' : ''}</span>
                <span className={styles.listMeta}>{mem.role === 'owner' ? 'ВЛАСНИК' : 'УЧАСНИК'}</span>
                {iAmOwner && !isMe && mem.role === 'member' && (
                  <button type="button" className={styles.listActionDim} onClick={() => void memberPromote(mem.user_id, mem.name)}>Передати роль</button>
                )}
                {canRemove && (
                  <button type="button" className={styles.listActionDim} onClick={() => void memberRemove(mem.user_id, isMe, mem.name)}>{isMe ? 'Вийти з дому' : 'Виключити'}</button>
                )}
              </div>
            );
          })}
          {activeInvites.map((inv) => {
            const st = inviteStatus(inv);
            return (
              <div key={inv.id} className={styles.listRow} data-invite={inv.id}>
                <span className={styles.listName}>{inv.email}</span>
                <span className={`${styles.listMeta} ${st.cls}`}>{st.text}</span>
                {st.text === 'ЧЕКАЄ' && <button type="button" className={styles.listActionDim} onClick={() => void inviteRevoke(inv.id)}>Скасувати</button>}
              </div>
            );
          })}
          {(me.household.members.length > 1 || activeInvites.length > 0) && !inviteOpen && (
            <div className={styles.listRow}>
              <span className={styles.listNameMuted}>{SECTION.homeInviteHint.replace('{home}', me.household.name)}</span>
              <button type="button" className={styles.listAction} onClick={() => setInviteOpen(true)}>{SECTION.invite}</button>
            </div>
          )}
          {inviteOpen && (
            <form onSubmit={inviteSend} className={styles.inviteForm} data-invite-form>
              <div style={{ flex: 1 }}>
                <Input type="email" inputMode="email" placeholder="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} error={inviteError} />
              </div>
              <Button type="submit" loading={inviting}>{SECTION.inviteSend}</Button>
            </form>
          )}
          {lastInvite && (
            <div className={`${styles.listRow} ${lastInvite.mail_sent ? styles.inviteOk : ''}`} data-invite-link>
              <span className={styles.listNameMuted}>
                {lastInvite.mail_sent ? `Лист пішов на ${lastInvite.email}. Або передай лінк сам:` : `Лист не дійшов. Передай ${lastInvite.email} лінк сам, месенджером:`}
              </span>
              <button type="button" className={styles.listAction} onClick={() => void copyInviteLink()}>{linkCopied ? '✓ Скопійовано' : 'Скопіювати лінк'}</button>
            </div>
          )}
        </div>
      )}

      {/* ----- Мережі: підключення/статуси — ті самі ендпоінти, що на старій сторінці ----- */}
      {retail !== 'loading' && retail !== 'unavailable' && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            <span>{SECTION.networks}</span>
            <span className={styles.sectionSubDesktop}>{SECTION.networksDesktop}</span>
          </div>
          <div className={styles.listRow}>
            <span className={styles.listName}>Сільпо</span>
            {retail === 'active' && <span className={`${styles.listMeta} ${styles.metaOk}`}>{receiptAt ? `ПІДКЛЮЧЕНО · ЧЕК ${fmtDay(receiptAt)}` : 'ПІДКЛЮЧЕНО'}</span>}
            {retail === 'expired' && <span className={`${styles.listMeta} ${styles.metaAmber}`}>СЕСІЯ ЗАКІНЧИЛАСЬ</span>}
            {retail === 'disconnected' && <span className={styles.listMeta}>ВІДКЛЮЧЕНО</span>}
            {retail === 'none' && <a className={styles.listAction} href="/v1/retail/silpo/connect">Підключити</a>}
            {retail === 'expired' && <a className={styles.listAction} href="/v1/retail/silpo/connect">Увійти знову</a>}
            {retail === 'disconnected' && <button type="button" className={styles.listAction} onClick={() => void retailReconnect()} disabled={retailBusy}>Повернути ↩</button>}
            {retail === 'active' && <button type="button" className={styles.listActionDim} onClick={() => void retailDisconnect()} disabled={retailBusy}>Відключити</button>}
          </div>
          {karpaty && (
            <div className={styles.listRow}>
              <span className={styles.listName}>Стейки Карпат</span>
              <span className={styles.listMeta}>ДОСТУПНО БЕЗ ПІДКЛЮЧЕННЯ</span>
            </div>
          )}
        </div>
      )}

      {/* ----- Акаунт ----- */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}><span>{SECTION.account}</span></div>
        <div className={styles.listRow}>
          <span className={styles.listName}>{SECTION.email}</span>
          <span className={styles.listMeta}>{email.toUpperCase()}</span>
        </div>
        <div className={styles.listRow}>
          <span className={styles.listName}>{SECTION.plan}</span>
          <span className={styles.listMeta}>{plan.toUpperCase()}</span>
        </div>
        <div className={styles.listRow}>
          <span className={styles.listName}>{SECTION.theme}</span>
          <span className={styles.listMeta}>{theme === 'light' ? SECTION.themeLight.toUpperCase() : SECTION.themeDark.toUpperCase()}</span>
          <button type="button" className={styles.listAction} onClick={toggleTheme}>{theme === 'light' ? SECTION.themeDark : SECTION.themeLight}</button>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => void logout()}>{SECTION.logout}</Button>
          <button
            type="button"
            className={styles.deleteAccount}
            onClick={() => { setExitOpen(true); setExitReason(null); setExitComment(''); setExitError(null); }}
          >{SECTION.deleteAccount}</button>
        </div>
      </div>

      {/* ----- Джерела даних (раунд 5, крок Н1): один абзац, без лінків на кожен продукт ----- */}
      <div className={styles.section} data-section="data">
        <div className={styles.sectionLabel}><span>{SECTION.data}</span></div>
        <p className={styles.dataText}>{SECTION.dataText}</p>
      </div>

      {exitOpen && (
        <Sheet onClose={() => !exitBusy && setExitOpen(false)} ariaLabel="Видалення акаунта">
          <div className={styles.exitSheet}>
            <h2 className={styles.exitTitle}>Видалити акаунт назавжди?</h2>
            <p className={styles.exitSub}>
              Зникне все: комора, рецепти, журнал готувань, профіль смаків. Це не «вийти» —
              відновити буде неможливо. Розкажи чому — одна відповідь дуже допоможе.
            </p>
            <div className={styles.exitReasons}>
              {EXIT_REASONS.map((r) => (
                <label key={r.code} className={styles.exitReason}>
                  <input type="radio" name="exit-reason" checked={exitReason === r.code} onChange={() => setExitReason(r.code)} />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
            {exitReason === 'other' && (
              <Input placeholder="Кілька слів — що саме?" value={exitComment} onChange={(e) => setExitComment(e.target.value)} />
            )}
            {exitError && <p className={styles.exitError}>{exitError}</p>}
            <div className={styles.exitActions}>
              <Button variant="secondary" block onClick={() => setExitOpen(false)} disabled={exitBusy}>Лишаюсь</Button>
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
