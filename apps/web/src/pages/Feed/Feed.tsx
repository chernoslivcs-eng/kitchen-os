// Стрічка — робочий цикл продукту з тризмісткою карток: intake_diff, proposal,
// shopping, profile. Дизайн ближче до брифу 04 Стрічка: заголовок «Кухня»,
// мета-рядок про стан комори/списку, mono-мітки перед секціями, спокійні
// переходи між станами картки (◌ ОЧІКУЄ → ✓ ЗАСТОСОВАНО → ↩ СКАСОВАНО).

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo/Logo';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { TabBar } from '../../components/TabBar/TabBar';
import { Sheet } from '../../components/Sheet/Sheet';
import { api, type AttachmentUploaded, type ChatCard, type ChatResponse, type MessageInfo } from '../../api';
import { Card, labelFor } from './cards';
import styles from './Feed.module.css';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  time: string;
  text?: string;
  card?: ChatCard | null;
  cardId?: string | null;
  applied?: boolean;
  applying?: boolean;
  undoToken?: string;
  undone?: boolean;
}

interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
  onUndo?: () => void;
}

function hhmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function kindLabel(k: 'image' | 'pdf' | 'text'): string {
  if (k === 'image') return 'фото';
  if (k === 'pdf') return 'PDF';
  return 'текст';
}

function messageToTurn(m: MessageInfo): Turn {
  const d = new Date(m.created_at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const applied = m.applied > 0;
  return {
    id: newId(),
    role: m.role,
    time,
    text: m.text ?? undefined,
    card: m.card,
    cardId: m.card ? m.id : null,     // message.id === card_id за нашою інваріантою
    applied,
    // undoToken на клієнті не відновлюємо — apply вже пройшов, повторний
    // apply/undo вимагатимуть нового токена. Кнопки undo після F5 нема.
  };
}

let nextId = 1;
const newId = () => `t${nextId++}`;

export function Feed() {
  const navigate = useNavigate();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pantryCount, setPantryCount] = useState<number | null>(null);
  const [staleBatches, setStaleBatches] = useState<{ id: string; label: string; days: number }[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [openingRecipe, setOpeningRecipe] = useState(false);
  const [pending, setPending] = useState<AttachmentUploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);

  async function refreshCounts() {
    try {
      const [p, s] = await Promise.all([
        api.pantry(),
        api.shopping.list().catch(() => ({ count: 0 })),
      ]);
      setPantryCount(p.count);
      setShoppingCount(s.count);
      // Догоряння: беремо активні партії з expires_at ≤ 3 днів. Показуємо 3 перших.
      // Це «підказка одним рядком», не панель — юзер може її ігнорувати або тапнути,
      // щоб модель сама запропонувала, що з ними зробити.
      const now = Date.now();
      const stale = p.batches
        .filter((b) => b.state !== 'depleted' && b.expires_at)
        .map((b) => ({
          id: b.id,
          label: b.label,
          days: Math.round((new Date(b.expires_at!).getTime() - now) / 86_400_000),
        }))
        .filter((b) => b.days <= 3)
        .sort((a, b) => a.days - b.days)
        .slice(0, 3);
      setStaleBatches(stale);
    } catch { /* offline: лишаємо старе значення */ }
  }

  useEffect(() => { void refreshCounts(); }, []);

  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    // Гідратуємо стрічку з сесії дня. Показуємо кожне message як окремий turn.
    // Cards із applied>0 показуються в стані «застосовано» (без Apply-кнопки).
    (async () => {
      try {
        const { session, messages } = await api.session.today();
        setSessionId(session.id);
        setTurns(messages.map((m) => messageToTurn(m)));
      } catch {/* offline: залишаємо порожню стрічку */}
    })();
  }, []);

  async function startFreshSession() {
    try {
      const { session } = await api.session.fresh();
      setSessionId(session.id);
      setTurns([]);
    } catch {/* тихо: наступним разом */}
  }

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<{ id: string; day: string; created_at: string; message_count: number }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const { sessions } = await api.session.list();
      // Не показуємо порожні сесії — свіжі, куди юзер не встиг нічого написати.
      setHistorySessions(sessions.filter((s) => s.message_count > 0));
    } catch {/* тихо */}
    finally { setHistoryLoading(false); }
  }
  async function loadHistorySession(id: string) {
    try {
      const { session, messages } = await api.session.get(id);
      setSessionId(session.id);
      setTurns(messages.map((m) => messageToTurn(m)));
      setHistoryOpen(false);
    } catch {/* тихо */}
  }

  useEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // Keyboard shortcuts на десктопі:
  //   Ctrl+K / Cmd+K — фокус у композитор (як у Slack/Linear/Notion — універсальний
  //     жест для «швидко почати вводити»)
  //   Ctrl+Enter / Cmd+Enter в композиторі — Apply на найновішу unapplied+undone
  //     картку (щоб не тягнути мишу до карток після кожного «купив X»)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        composerInputRef.current?.focus();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const target = [...turns].reverse().find((t) => t.card && !t.applied && !t.undone && t.cardId);
        if (target) {
          e.preventDefault();
          void apply(target.id);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    if (pending.length + list.length > 5) {
      setToast({ id: Date.now(), kind: 'err', text: 'Максимум 5 вкладень за раз' });
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        const rec = await api.attachments.upload(file);
        setPending((p) => [...p, rec]);
      }
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removePending(id: string) {
    setPending((p) => p.filter((x) => x.id !== id));
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text && pending.length === 0) return;
    setInput('');
    const attachments = pending.map((p) => ({ id: p.id }));
    setPending([]);
    setSending(true);

    const userTurnText = text || (attachments.length === 1 ? '[вкладення]' : `[${attachments.length} вкладення]`);
    const userTurn: Turn = { id: newId(), role: 'user', time: hhmm(), text: userTurnText };
    setTurns((prev) => [...prev, userTurn]);

    try {
      const res: ChatResponse = await api.chat({ text, attachments: attachments.length ? attachments : undefined, session_id: sessionId ?? undefined });
      const turn: Turn = {
        id: newId(),
        role: 'assistant',
        time: hhmm(),
        text: res.reply || undefined,
        card: res.card,
        cardId: res.card_id,
      };
      setTurns((prev) => [...prev, turn]);
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  async function apply(turnId: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId || turn.applying) return;
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: true } : t));
    try {
      const r = await api.cards.apply(turn.cardId);
      setTurns((prev) => prev.map((t) => t.id === turnId
        ? { ...t, applied: true, applying: false, undoToken: r.undo_token }
        : t,
      ));
      // Оновлюємо лічильники для комори/списку — profile тепер теж може змінити те, що показуємо
      await refreshCounts();
      const count = turn.card?.type === 'intake_diff'
        ? ((turn.card.ops as unknown[] | undefined)?.length ?? 0)
        : ((turn.card?.items as unknown[] | undefined)?.length ?? 0);
      const noun = turn.card?.type === 'shopping' ? 'позиція у списку' : 'позиція у коморі';
      const nounPl = turn.card?.type === 'shopping' ? 'позицій у списку' : 'позицій у коморі';
      setToast({
        id: Date.now(),
        kind: 'ok',
        text: `${count} ${count === 1 ? noun : nounPl}`,
        onUndo: () => undo(turnId, r.undo_token),
      });
    } catch (err) {
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: false } : t));
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  async function openRecipe(turn: Turn) {
    // Клік «Рецепт →» на пропозиції: беремо перший title як seed для генератора.
    if (turn.card?.type !== 'proposal') return;
    const items = (turn.card.items as { title?: string; desc?: string }[] | undefined) ?? [];
    const first = items[0];
    if (!first?.title) return;
    setOpeningRecipe(true);
    setToast({ id: Date.now(), kind: 'ok', text: 'Готую рецепт…' });
    try {
      const { recipe } = await api.recipes.generate(first.title, first.desc);
      setToast(null);
      navigate('/recipe', { state: { recipe } });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setOpeningRecipe(false);
    }
  }

  async function undo(turnId: string, undoToken: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId) return;
    try {
      await api.cards.undo(turn.cardId, undoToken);
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, undone: true } : t));
      await refreshCounts();
      setToast({ id: Date.now(), kind: 'ok', text: 'Скасовано' });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles['head-left']}>
          <Logo variant="wordmark" size={30} />
        </div>
        <div className={styles['head-actions']}>
          <button
            onClick={openHistory}
            title="Історія чатів"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              padding: '5px 10px',
              color: 'var(--fg-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            ⌚ Історія
          </button>
          {turns.length > 0 && (
            <button
              onClick={startFreshSession}
              title="Почати новий чат"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--r-pill)',
                padding: '5px 10px',
                color: 'var(--fg-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              + Новий
            </button>
          )}
          {pantryCount !== null && (
            <MonoLabel className={styles['head-meta']}>КОМОРА {pantryCount}</MonoLabel>
          )}
        </div>
      </div>

      {historyOpen && (
        <Sheet onClose={() => setHistoryOpen(false)} ariaLabel="Історія чатів">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <MonoLabel>ІСТОРІЯ ЧАТІВ</MonoLabel>
            <button
              onClick={() => setHistoryOpen(false)}
              style={{ background: 'transparent', border: 0, color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 20 }}
              aria-label="Закрити"
            >✕</button>
          </div>
          {historyLoading && <div style={{ color: 'var(--fg-muted)', padding: '20px 0' }}>Завантажую…</div>}
          {!historyLoading && historySessions.length === 0 && (
            <div style={{ color: 'var(--fg-muted)', padding: '20px 0', fontSize: 14 }}>
              Тут порожньо. Кожна сесія зберігається — вона зʼявиться тут завтра.
            </div>
          )}
          {historySessions.map((s) => {
            const d = new Date(s.created_at);
            const dayLabel = formatDayLabel(d);
            return (
              <button
                key={s.id}
                onClick={() => loadHistorySession(s.id)}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 12,
                  padding: '14px 0',
                  borderBottom: '1px solid var(--border)',
                  border: 0, borderBottomWidth: 1, borderBottomStyle: 'solid',
                  borderColor: 'var(--border)',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--fg)' }}>{dayLabel}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase', marginTop: 3 }}>
                    {d.getHours().toString().padStart(2, '0')}:{d.getMinutes().toString().padStart(2, '0')} · {s.message_count} {s.message_count === 1 ? 'ПОВІДОМЛЕННЯ' : 'ПОВІДОМЛЕНЬ'}
                  </div>
                </div>
                <span style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>→</span>
              </button>
            );
          })}
        </Sheet>
      )}

      <div className={styles.timeline} ref={timelineRef}>
        {turns.length === 0 && (
          <div className={styles.empty}>
            <h3>Скажи, що купив або що хочеш приготувати</h3>
            <p>
              «купив моцарелу 250 г», «поклав у морозилку лосось», «дай рецепт з
              вершків і фуета», «додай молоко в список», «Оля не їсть лактозу» — все
              одне поле, усе через підтвердження.
            </p>
            {pantryCount === 0 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  marginTop: 18,
                  padding: '14px 20px',
                  background: 'var(--accent-bg)',
                  border: '1px solid var(--accent)',
                  borderRadius: 'var(--r)',
                  color: 'var(--accent)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                📷 Сфотографуй чек — я розкладу
              </button>
            )}
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className={styles.turn}>
            <MonoLabel tone="muted">
              {t.time} {t.role === 'user' ? 'ТИ' : t.card
                ? labelFor(t.card.type, t.applied, t.undone).text
                : 'АСИСТЕНТ'}
            </MonoLabel>
            {t.text && <div className={styles['turn-text']}>{t.text}</div>}
            {t.card && (
              <Card
                card={t.card}
                applied={t.applied}
                applying={t.applying}
                undone={t.undone}
                undoAvailable={!!t.undoToken}
                onApply={() => apply(t.id)}
                onUndo={t.undoToken ? () => undo(t.id, t.undoToken!) : undefined}
                onOpen={t.card.type === 'proposal' ? () => openRecipe(t) : undefined}
              />
            )}
          </div>
        ))}
      </div>

      <div className={styles['composer-wrap']}>
        {staleBatches.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Тап по підказці — питання моделі, не відкриття панелі. Модель бачить
              // ті ж партії в контексті (з !Nдн-маркерами), відповість по-своєму.
              const labels = staleBatches.map((b) => b.label).join(', ');
              setInput(`Що зробити з ${labels}? Скоро згорять.`);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 14px',
              margin: '0 0 8px',
              background: 'var(--amber-bg)',
              border: '1px solid var(--amber-border)',
              borderRadius: 'var(--r)',
              color: 'var(--amber)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            aria-label="Спитати модель, що зробити з тим, що згоряє"
          >
            <span>◔</span>
            <span style={{ flex: 1 }}>
              СКОРО ЗГОРИТЬ · {staleBatches.map((b) => (
                b.days <= 0 ? `${b.label.toUpperCase()} (сьогодні)`
                : b.days === 1 ? `${b.label.toUpperCase()} (завтра)`
                : `${b.label.toUpperCase()} (${b.days}дн)`
              )).join(' · ')}
            </span>
            <span>→</span>
          </button>
        )}
        {pending.length > 0 && (
          <div className={styles['pending-attachments']}>
            {pending.map((a) => (
              <span key={a.id} className={styles['att-chip']} title={a.content_type}>
                {a.kind === 'image' ? '📷' : a.kind === 'pdf' ? '📄' : '📝'} {kindLabel(a.kind)} · {formatBytes(a.bytes)}
                <button
                  type="button"
                  className={styles['att-remove']}
                  onClick={() => removePending(a.id)}
                  aria-label="Прибрати"
                >×</button>
              </span>
            ))}
            {uploading && <span className={styles['att-chip']}>завантажую…</span>}
          </div>
        )}
        <form className={styles.composer} onSubmit={send}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,text/plain"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => pickFiles(e.target.files)}
          />
          <button
            type="button"
            className={styles['attach-btn']}
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploading}
            aria-label="Додати вкладення"
          >
            📎
          </button>
          <input
            ref={composerInputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pending.length > 0 ? 'Що з цим?' : 'Записати в журнал…'}
            disabled={sending}
            autoFocus
          />
          <button
            type="submit"
            disabled={sending || (!input.trim() && pending.length === 0)}
            aria-label="Надіслати"
          >↑</button>
        </form>
      </div>

      <TabBar shoppingCount={shoppingCount} />

      {toast && (
        <div className={styles.toast}>
          <span className={toast.kind === 'ok' ? styles.ok : styles.err}>
            {toast.kind === 'ok' ? '✓' : '✕'}
          </span>
          <span className={styles['toast-text']}>{toast.text}</span>
          {toast.onUndo && (
            <button
              className={styles.undo}
              onClick={() => { toast.onUndo?.(); setToast(null); }}
            >
              ↩ Скасувати
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ['НД', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const MONTHS = ['СІЧ', 'ЛЮТ', 'БЕР', 'КВІ', 'ТРА', 'ЧЕР', 'ЛИП', 'СЕР', 'ВЕР', 'ЖОВ', 'ЛИС', 'ГРУ'];
function formatDayLabel(d: Date): string {
  const today = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(d, today)) return 'Сьогодні';
  if (same(d, yesterday)) return 'Вчора';
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
