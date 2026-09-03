// Подія як артефакт. Один компонент, три входи.
//
// Рішення власника 03.09: «картки подій — уніфікувати з артефактами; намір на
// тиждень редагується як артефакт тут же. Подія і її редагування — одна
// сутність». До цього подію показувала одна шторка (EventSheet), а правила —
// інша, з формою (NewEventSheet): два файли, дві правди про те, з чого
// складається подія. Тепер хребет один — кікер → заголовок → коли → речення →
// що з цього робити, — і для особистих родів поля правляться НА МІСЦІ, як рядки
// чека в артефакті комори. Дії йдуть у підвал панелі тим самим слотом
// (PanelFootSlot), що в решти артефактів; поза панеллю — інлайн.
//
// Роди розповідають різне, але сила читається без нового кольору: семантика
// палітри зайнята (шавлія — дія, бурштин — час іде, слива — анти). Обмеження
// бере сливу й приглушений заголовок, а не теракоту: піст — рамка, не помилка.

import { useContext, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, type EventOccurrence } from '../../api';
import { whenLabel } from '../../lib/when';
import { PanelFootSlot } from '../../pages/Feed/panel-slots';
import styles from './EventArtifact.module.css';

export type EventMode = 'view' | 'edit' | 'new';

interface Props {
  /** Відсутня лише в режимі 'new'. */
  event?: EventOccurrence;
  mode?: EventMode;
  /** Після будь-якої зміни стану на сервері (add/patch/remove/mute). Для add — id нової події. */
  onChanged?: (id?: string) => void;
  /** Закрити контейнер (шторку). У панелі немає — артефакт лишається. */
  onClose?: () => void;
  /** Панель: заголовок 22, дії — у підвал панелі. */
  compact?: boolean;
}

const DOW = [
  { v: 1, l: 'пн' }, { v: 2, l: 'вт' }, { v: 3, l: 'ср' }, { v: 4, l: 'чт' },
  { v: 5, l: 'пт' }, { v: 6, l: 'сб' }, { v: 0, l: 'нд' },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Кікер несе РІД І СТАН: «Сезон · останні дні» — інша річ, ніж «Сезон».
function kicker(e: EventOccurrence, now = Date.now()): { text: string; tone: string } {
  const live = now >= e.start && now <= e.end;
  const endsSoon = live && e.end - now < 7 * 86_400_000;
  if (e.force === 'restrict') return { text: live ? 'Обмеження · діє' : 'Обмеження', tone: styles.plum! };
  if (e.source) return { text: `Від ${e.source}`, tone: styles.muted! };
  if (e.kind === 'season') return { text: endsSoon ? 'Сезон · останні дні' : 'Сезон', tone: styles.amber! };
  if (e.kind === 'supply') return { text: '＋ Завіз', tone: styles.sage! };
  if (e.kind === 'tradition') return { text: 'Свято', tone: styles.muted! };
  if (e.kind === 'constraint') return { text: 'Рамка на день', tone: styles.muted! };
  return { text: e.scope === 'household' ? '＋ Особиста' : 'Подія', tone: e.scope === 'household' ? styles.sage! : styles.muted! };
}

// Моно-мета в підвалі: коротке «що тут є», щоб дія не стояла в порожньому рядку.
function footerMeta(e: EventOccurrence): string | null {
  if (e.caught_by !== undefined) return e.caught_by ? `СПІЙМАНО · ${e.caught_by.toUpperCase()}` : 'СПІЙМАНО';
  if (e.force === 'restrict') return 'ДІЄ У ВСІХ ПОРАДАХ';
  if (e.source) return 'НЕ СПОНСОРОВАНО';
  const parts: string[] = [];
  if (e.seeds?.length) parts.push(`${e.seeds.length} ЗЕРНА`);
  if (e.buy?.length) parts.push(`${e.buy.length} ДОКУПИТИ`);
  if (e.servings) parts.push(`${e.servings} ПОРЦ.`);
  if (e.kind === 'tradition' && !parts.length) return 'РОЗПІЗНАНО ЗА ТРАДИЦІЄЮ';
  return parts.length ? parts.join(' · ') : null;
}

// Поля правки — з правила події, а не з дати входження: «щовівторка» має
// відкритись як «щотижня · вт», а не як конкретна дата.
function fieldsFrom(e?: EventOccurrence) {
  const r = e?.rule as { t: string; at?: string; days?: number; dow?: number } | undefined;
  if (r?.t === 'weekly') return { mode: 'weekly' as const, date: todayIso(), dateTo: '', dow: r.dow ?? 2 };
  const at = r?.at ?? todayIso();
  const days = r?.days ?? 1;
  return { mode: 'date' as const, date: at, dateTo: days > 1 ? addDays(at, days - 1) : '', dow: 2 };
}

export function EventArtifact({ event, mode: initialMode = 'view', onChanged, onClose, compact }: Props) {
  const navigate = useNavigate();
  const footSlot = useContext(PanelFootSlot);
  const [mode, setMode] = useState<EventMode>(event ? initialMode : 'new');
  // Локальна копія: після правки показуємо нове одразу, не чекаючи перечитання
  // календаря — інакше між «Зберегти» й оновленням миготів би старий заголовок.
  const [e, setE] = useState<EventOccurrence | undefined>(event);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const init = fieldsFrom(event);
  const [title, setTitle] = useState(event?.title ?? '');
  const [note, setNote] = useState(event?.note ?? '');
  const [whenMode, setWhenMode] = useState<'date' | 'weekly'>(init.mode);
  const [date, setDate] = useState(init.date);
  const [dateTo, setDateTo] = useState(init.dateTo);
  const [dow, setDow] = useState(init.dow);

  const own = e?.scope === 'household';
  const restrict = e?.force === 'restrict';

  function discuss() {
    if (!e) return;
    navigate('/app', { state: { composePrefix: `${e.title} — ` } });
  }
  async function mute() {
    if (!e) return;
    setBusy(true);
    try { await api.events.mute(e.id); onChanged?.(); onClose?.(); } catch { setBusy(false); }
  }
  const [added, setAdded] = useState(false);
  async function addAllToList() {
    if (!e?.buy?.length) return;
    setBusy(true);
    try {
      for (const label of e.buy) await api.shopping.add(label, undefined, undefined, e.title);
      setAdded(true);
    } catch { /* тихо: кнопка лишається, можна повторити */ }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!e) return;
    setBusy(true);
    try { await api.events.remove(e.id); onChanged?.(); onClose?.(); } catch { setBusy(false); }
  }

  async function save(ev?: FormEvent) {
    ev?.preventDefault();
    const t = title.trim();
    if (!t) { setErr('Скажи, що це'); return; }
    const days = whenMode === 'date' && dateTo
      ? Math.round((new Date(`${dateTo}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000) + 1
      : 1;
    if (whenMode === 'date' && dateTo && days < 1) { setErr('Кінець раніше за початок'); return; }
    const rule = whenMode === 'date'
      ? (days > 1 ? { t: 'once', at: date, days } : { t: 'once', at: date })
      : { t: 'weekly', dow };
    setBusy(true); setErr(null);
    try {
      if (mode === 'new') {
        const res = await api.events.add({ title: t, kind: 'custom', rule, note: note.trim() || null }) as { event?: { id?: string } };
        onChanged?.(res.event?.id);
        onClose?.();
        return;
      }
      if (!e) return;
      await api.events.patch(e.id, { title: t, note: note.trim() || null, rule });
      // Локально: назва й нотатка одразу; діапазон перерахує календар за onChanged.
      setE({ ...e, title: t, note: note.trim() || null, rule: rule as EventOccurrence['rule'] });
      setMode('view');
      onChanged?.(e.id);
    } catch {
      setErr('Не вийшло записати. Спробуй ще раз');
    } finally { setBusy(false); }
  }

  const editing = mode === 'edit' || mode === 'new';
  const k = e ? kicker(e) : { text: 'НОВА ПОДІЯ', tone: styles.muted! };
  const meta = e && !editing ? footerMeta(e) : null;

  // Дії: у панелі — портал у підвал (той самий слот, що в чека й рецепта),
  // інакше — інлайн під хребтом.
  const actionsRaw = (
    <div className={styles.actions}>
      {meta && <span className={styles.meta}>{meta}</span>}
      {editing ? (
        <>
          {mode === 'edit' && (
            <button type="button" className={styles.ghost} disabled={busy}
              onClick={() => { setMode('view'); setTitle(e?.title ?? ''); setNote(e?.note ?? ''); setErr(null); }}>
              Скасувати
            </button>
          )}
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Записую…' : mode === 'new' ? 'Додати' : 'Зберегти'}
          </button>
        </>
      ) : (
        <>
          {e?.source && (
            <button type="button" className={styles.ghost} onClick={mute} disabled={busy}>
              {busy ? 'Прибираю…' : 'Не нагадувати'}
            </button>
          )}
          {restrict && (
            <button type="button" className={styles.ghost} disabled title="Знімається в профілі, у побажаннях">
              Не дотримуюсь
            </button>
          )}
          {own && (
            <>
              <button type="button" className={styles.ghost} onClick={remove} disabled={busy}>
                {busy ? 'Прибираю…' : 'Прибрати'}
              </button>
              <button type="button" className={styles.secondary} onClick={() => setMode('edit')}>Редагувати</button>
            </>
          )}
          {/* Канвас: головна дія довідникової події — «Додати в список» (усе
              з «варто докупити» одним рухом). Без списку докупівлі — розмова. */}
          {!restrict && e?.scope === 'catalog' && (
            (e.buy?.length ?? 0) > 0 ? (
              <button type="button" className={styles.primary} onClick={addAllToList} disabled={busy || added}>
                {added ? 'У списку ✓' : busy ? 'Додаю…' : 'Додати в список'}
              </button>
            ) : (
              <button type="button" className={styles.primary} onClick={discuss}>Обговорити з Кухнею</button>
            )
          )}
        </>
      )}
    </div>
  );
  const actions = footSlot ? createPortal(actionsRaw, footSlot) : actionsRaw;

  return (
    <form className={`${styles.body} ${compact ? styles.compact : ''}`} onSubmit={save}>
      <div className={`${styles.kicker} ${k.tone}`}>{k.text}</div>

      {editing ? (
        <input
          className={styles['title-input']}
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
          placeholder="гості, шестеро"
          aria-label="Що"
          autoFocus
        />
      ) : (
        <h2 className={`${styles.title} ${restrict ? styles['title-quiet'] : ''}`}>{e?.title}</h2>
      )}

      {editing ? (
        <>
          <div className={styles.label}>Коли</div>
          <div className={styles.segments}>
            <button type="button" className={`${styles.seg} ${whenMode === 'date' ? styles['seg-on'] : ''}`} onClick={() => setWhenMode('date')}>Дата</button>
            <button type="button" className={`${styles.seg} ${whenMode === 'weekly' ? styles['seg-on'] : ''}`} onClick={() => setWhenMode('weekly')}>Щотижня</button>
          </div>
          {whenMode === 'date' ? (
            <div className={styles.range}>
              <input type="date" className={styles.input} value={date} onChange={(ev) => setDate(ev.target.value)} aria-label="Від" />
              <span className={styles.dash}>—</span>
              <input type="date" className={styles.input} value={dateTo} min={date} onChange={(ev) => setDateTo(ev.target.value)} aria-label="По (необовʼязково)" />
            </div>
          ) : (
            <div className={styles.dows}>
              {DOW.map((d) => (
                <button key={d.v} type="button" className={`${styles.dow} ${dow === d.v ? styles['dow-on'] : ''}`} onClick={() => setDow(d.v)}>{d.l}</button>
              ))}
            </div>
          )}
        </>
      ) : e && (
        <div className={styles.when}>
          {whenLabel(e.start, e.end)}
          {e.approx && <span className={styles.approx}> · орієнтовно, місячний календар</span>}
        </div>
      )}

      {!editing && e?.meaning && <p className={styles.meaning}>{e.meaning}</p>}

      {editing ? (
        <>
          <label className={styles.label} htmlFor="ev-note">Нотатка</label>
          <textarea id="ev-note" className={`${styles.input} ${styles.area}`} value={note}
            onChange={(ev) => setNote(ev.target.value)} placeholder="необовʼязково" rows={2} />
        </>
      ) : e?.note && <p className={styles.note}>{e.note}</p>}

      {/* Тексту `restricts` тут навмисно НЕМАЄ: він написаний для моделі. */}

      {!editing && (e?.buy?.length ?? 0) > 0 && (
        <div className={styles.block}>
          <div className={styles['block-label']}>ВАРТО ДОКУПИТИ</div>
          <div className={styles.chips}>{e!.buy!.map((b) => <span key={b} className={styles.chip}>{b}</span>)}</div>
        </div>
      )}
      {/* Канвас «Календар — інтерфейс»: «Що з цим приготувати» — рядки з ›,
          тап веде в розмову з цією стравою на руках. Не чіпи: чіп нікуди не
          веде, а зерно — це саме привід почати. */}
      {!editing && (e?.seeds?.length ?? 0) > 0 && (
        <div className={styles.block}>
          <div className={styles['block-label']}>ЩО З ЦИМ ПРИГОТУВАТИ</div>
          <div className={styles.rows}>
            {e!.seeds!.map((s) => (
              <button key={s} type="button" className={styles.row}
                onClick={() => navigate('/app', { state: { composePrefix: `${s} — ` } })}>
                <span className={styles['row-name']}>{s}</span>
                <span className={styles['row-go']}>›</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!editing && (e?.supply?.length ?? 0) > 0 && (
        <div className={styles.block}>
          <div className={styles['block-label']}>ЩО ПРИЙДЕ</div>
          <div className={styles.chips}>
            {e!.supply!.map((s) => <span key={s.label} className={styles.chip}>{s.label}{s.v ? ` · ${s.v}${s.u ?? ''}` : ''}</span>)}
          </div>
        </div>
      )}

      {err && <div className={styles.err}>{err}</div>}
      {actions}
    </form>
  );
}
