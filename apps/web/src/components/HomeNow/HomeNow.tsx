// Панель «Дім зараз» (6b-5) — вміст за Components «home now»: card r18 --sh,
// 20, gap 18. Відкриває чіп у шапці чату; на ≥704 — ВІКНО по центру вʼюпорту
// з темним скримом (рішення власника 12.09, Р116; раніше — накладка під
// чіпом), на вузькому контейнері (<704, Р38) — шторкою за Responsive G3.
// Вікно: фокус на відкритті — на ✕ усередині, на закритті — назад на чіп;
// Esc і клік по скриму закривають; низ — одна головна кнопка «Що на вечерю?».
//
// Накладка (Components):
//   «Горить · N» 12/500 amber — завжди; до 3 рядків 44 з волосиною: назва
//   14/500 · крапка 6 + строк 13 кольором стану (danger «−9 дн» / «≈ сьогодні»,
//   amber «2 дн»); хвіст 12 dim «Ще N прострочених — у коморі, за свіжістю»;
//   порожня — «Нічого не горить. N позицій у порядку.»; комора порожня —
//   «Комора порожня — розкажи, що є вдома.» замість секції.
//   «Зараз» 12/500 muted — завжди; рядки 48: крапка 8 роду (кільце 1.5 =
//   орієнтовно), назва 14/500, підрядок 12 dim зі знаком джерела 11, строк
//   кольором роду; порожня — «Зараз нічого не триває. Свята можна підключити в
//   календарі.». Дія лише де є що робити зараз («Готуємо», «До плити»), решта —
//   шеврон. Тимчасово, до QUESTIONS §14: 3 рядки + хвіст «Ще N — у календарі».
//   Низ — «Що на вечерю?» у композитор (Prototype openHome).
// Шторка (G3): рядки 14 0 з волосиною: квадрат 40 r10 роду зі знаком
//   (flame/danger-bg · moon/plum-bg · timer/sage-bg; тихі — сірий квадрат,
//   users / list-checks / sun), назва 15/600 (тихі 500), деталь 13 muted, дія
//   («Готуємо» ink 34 / «До плити» sage 34) лише де є що робити, решта — шеврон.
import { useEffect, useRef } from 'react';
import { lockBodyScroll } from '../../lib/lockBodyScroll';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import { CookCountdown } from '../../lib/cook-watch';
import { nowWhen, nowEmptyKind, toneOfNow, TRADITION_LABEL, shortDate } from '../../lib/period';
import { plural } from '../../lib/plural';
import type { CookSession } from '../../lib/cook-session';
import type { HomeNow as HomeState } from '../../store/homeNow';
import type { NowItem } from '../../api';
import styles from './HomeNow.module.css';
import { useSheetDrag } from '../../lib/useSheetDrag';

function daysText(days: number): string {
  if (days < 0) return `−${Math.abs(days)} дн`;
  if (days === 0) return '≈ сьогодні';
  return `${days} дн`;
}
function daysShort(days: number): string {
  if (days < 0) return `−${Math.abs(days)}`;
  if (days === 0) return 'сьогодні';
  return `${days} дн`;
}

/** Підрядок «Зараз»: джерело · сила. */
function nowSub(e: NowItem): { icon: IconName; text: string } {
  if (e.source === 'catalog') {
    const who = e.kind === 'tradition' && e.meaning && (e.meaning as string) in TRADITION_LABEL
      ? TRADITION_LABEL[e.meaning as keyof typeof TRADITION_LABEL] : 'каталог';
    return { icon: 'sys.tradition', text: `${who} · ${e.strict ? 'суворо' : 'мʼяко'}` };
  }
  if (e.source === 'chat') return { icon: 'sys.chat', text: `з розмови${e.rule_text ? ` · ${e.rule_text}` : ''}` };
  return { icon: 'live.byHand', text: `своє${e.strict ? ' · суворо' : ''}` };
}
/** Знак тихого рядка в шторці (G3): сезон — sun, своє — users, традиція — book-marked. */
function quietIcon(e: NowItem): IconName {
  if (e.kind === 'season') return 'live.season';
  if (e.kind === 'tradition') return 'sys.tradition';
  return 'live.household';
}

const EMPTY = {
  calm: (n: number) => `Нічого не горить. ${n} ${plural(n, ['позиція', 'позиції', 'позицій'])} у порядку.`,
  pantryEmpty: 'Комора порожня — розкажи, що є вдома.',
  noEvents: 'Зараз нічого не триває. Свята можна підключити в календарі.',
};

export function HomeNowPanel({ home, cookLive, sheet, onClose, onCook, onOverdue, onCalendar, onList, onAsk, dateLabel }: {
  home: HomeState; cookLive: CookSession | null; sheet: boolean;
  onClose: () => void; onCook: () => void; onOverdue: () => void; onCalendar: () => void; onList: () => void;
  /** «Що на вечерю?» / «Приготуй щось із того, що горить» — у композитор. */
  onAsk: (text: string) => void;
  dateLabel: string;
}) {
  // №35: змах униз закриває шторку — один механізм на всі шторки.
  const drag = useSheetDrag(onClose, sheet);
  // 0912 D (№42): поки «Дім зараз» відкрито, документ під ним не скролиться.
  useEffect(() => lockBodyScroll(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Р116: вікно — фокус на ✕ при відкритті, назад на те, що було активне
  // (чіп «Дім зараз»), при закритті. Шторка на 390 фокус не перехоплює.
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (sheet) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { openerRef.current?.focus?.(); };
  }, [sheet]);

  const shown = home.now.slice(0, 3);
  const restNow = Math.max(0, home.now.length - shown.length);
  const shownOverdue = home.burning.filter((b) => b.days < 0).length;
  const restOverdue = Math.max(0, home.overdue - shownOverdue);
  const pantryEmpty = nowEmptyKind(home.facts) === 'pantry-empty';
  const askBurning = () => onAsk('Приготуй щось із того, що горить');

  const head = (
    <div className={styles.head}>
      <Icon name="sys.home" size={18} inherit decorative />
      <span className={styles.title}>Дім зараз</span>
      <span className={styles.date}>{dateLabel}</span>
      <span className={styles.gap} />
      <button type="button" ref={closeRef} className={styles.close} data-tap onClick={onClose} aria-label="Закрити"><Icon name="sys.close" size={16} inherit decorative /></button>
    </div>
  );

  if (sheet) {
    // G3 — список станів рядками; тихі рядки внизу.
    // (хук викликано вище, до гілки — Rules of Hooks)
    const strict = home.strict;
    const quiet = home.now.filter((e) => e !== strict).slice(0, 3);
    return (
      <>
        <div className={`${styles.scrim} ${styles['scrim-dark']}`} onClick={onClose} />
        <div className={`${styles.panel} ${styles.sheet}`} role="dialog" aria-label="Дім зараз" data-home-now data-home-form="sheet" style={drag.panelStyle}>
          {/* №35: змах униз по граберу/шапці закриває (lib/useSheetDrag). */}
          <div className={styles.grab} {...drag.handleProps} data-sheet-grab><span className={styles.handle} aria-hidden /></div>
          <div {...drag.handleProps} data-sheet-head>{head}</div>
          <div className={styles.rows}>
            {pantryEmpty ? (
              <div className={`${styles.g3} ${styles['g3-quiet']}`} data-home-empty="pantry-empty">
                <span className={`${styles.sq} ${styles['sq-grey']}`}><Icon name="sys.pantry" size={18} inherit decorative /></span>
                <span className={styles['g3-text']}><span className={styles['g3-title-quiet']}>{EMPTY.pantryEmpty}</span></span>
              </div>
            ) : home.burning.length > 0 ? (
              <div className={styles.g3} data-home-burning>
                {/* 12.09 (A10): знак іде за родом — прострочено danger/alert-triangle, горить amber/flame. */}
                <span className={`${styles.sq} ${home.overdue > 0 ? styles['sq-danger'] : styles['sq-amber']}`}><Icon name={home.overdue > 0 ? 'live.overdue' : 'live.burning'} size={18} inherit decorative /></span>
                <span className={styles['g3-text']}>
                  <span className={styles['g3-title']}>{home.overdue > 0 ? `Прострочено ${home.overdue}` : `Горить ${home.burning.length}`}</span>
                  <span className={styles['g3-sub']}>{home.burning.map((b) => `${b.label} ${daysShort(b.days)}`).join(' · ')}</span>
                </span>
                <button type="button" className={`${styles.act} ${styles['act-ink']}`} data-tap onClick={askBurning}>Готуємо</button>
              </div>
            ) : (
              <div className={`${styles.g3} ${styles['g3-quiet']}`} data-home-empty="calm">
                <span className={`${styles.sq} ${styles['sq-grey']}`}><Icon name="sys.done" size={18} inherit decorative /></span>
                <span className={styles['g3-text']}><span className={styles['g3-title-quiet']}>{EMPTY.calm(home.facts?.count ?? 0)}</span></span>
              </div>
            )}
            {strict && (
              <button type="button" className={styles.g3} onClick={onCalendar} data-home-strict>
                <span className={`${styles.sq} ${styles['sq-plum']}`}><Icon name="live.fast" size={18} inherit decorative /></span>
                <span className={styles['g3-text']}>
                  <span className={styles['g3-title']}>{strict.title} · до {shortDate(strict.to)}</span>
                  <span className={styles['g3-sub']}>{strict.rule_text ? `${strict.rule_text} · ` : ''}{nowWhen(strict) ?? 'триває'}</span>
                </span>
                <Icon name="sys.next" size={16} inherit decorative />
              </button>
            )}
            {cookLive && (
              <div className={styles.g3} data-home-cooking>
                <span className={`${styles.sq} ${styles['sq-sage']}`}><Icon name="cook.timer" size={18} inherit decorative /></span>
                <span className={styles['g3-text']}>
                  <span className={styles['g3-title']}>Готуємо · {cookLive.recipe.t}</span>
                  <span className={styles['g3-sub']}>крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)} з {cookLive.recipe.st.length}{cookLive.deadline ? <> · таймер <CookCountdown deadline={cookLive.deadline} /></> : null}</span>
                </span>
                <button type="button" className={`${styles.act} ${styles['act-sage']}`} data-tap onClick={onCook}>До плити</button>
              </div>
            )}
            {quiet.map((e) => (
              <button key={`${e.occasion_id ?? e.id}:${e.from}`} type="button" className={`${styles.g3} ${styles['g3-quiet']}`} onClick={onCalendar}>
                <span className={`${styles.sq} ${styles['sq-grey']}`}><Icon name={quietIcon(e)} size={18} inherit decorative /></span>
                <span className={styles['g3-text']}>
                  <span className={styles['g3-title-quiet']}>{e.title}</span>
                  <span className={styles['g3-sub']}>{nowWhen(e) ?? 'триває'} · {nowSub(e).text}</span>
                </span>
                <Icon name="sys.next" size={16} inherit decorative />
              </button>
            ))}
            {!strict && quiet.length === 0 && (
              <div className={`${styles.g3} ${styles['g3-quiet']}`} data-home-empty="no-events">
                <span className={`${styles.sq} ${styles['sq-grey']}`}><Icon name="sys.calendar" size={18} inherit decorative /></span>
                <span className={styles['g3-text']}><span className={styles['g3-title-quiet']}>{EMPTY.noEvents}</span></span>
              </div>
            )}
            {home.shopping && home.shopping.count > 0 && (
              <button type="button" className={`${styles.g3} ${styles['g3-quiet']}`} onClick={onList} data-home-list>
                <span className={`${styles.sq} ${styles['sq-grey']}`}><Icon name="sys.list" size={18} inherit decorative /></span>
                <span className={styles['g3-text']}>
                  <span className={styles['g3-title-quiet']}>Список · {home.shopping.count}</span>
                  <span className={styles['g3-sub']}>{home.shopping.labels.join(', ')}{home.shopping.count > home.shopping.labels.length ? `, ще ${home.shopping.count - home.shopping.labels.length}` : ''}</span>
                </span>
                <Icon name="sys.next" size={16} inherit decorative />
              </button>
            )}
          </div>
          <button type="button" className={styles.ask} data-tap onClick={() => onAsk('Що на вечерю?')}>Що на вечерю?<Icon name="sys.next" size={12} inherit decorative /></button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={`${styles.scrim} ${styles['scrim-dark']}`} onClick={onClose} />
      <div className={`${styles.panel} ${styles.dialog}`} role="dialog" aria-modal="true" aria-label="Дім зараз" data-home-now data-home-form="dialog">
        {head}

        {/* «Горить» — секція є завжди; комора порожня — її слово замість секції. */}
        <section className={styles.block} data-home-burning>
          {pantryEmpty ? (
            <div className={styles.empty} data-home-empty="pantry-empty"><Icon name="sys.pantry" size={16} inherit decorative />{EMPTY.pantryEmpty}</div>
          ) : (
            <>
              <span className={`${styles.label} ${styles['label-amber']}`}>Горить · {home.overdue > 0 ? home.overdue : home.burning.length}</span>
              {home.burning.length === 0 && (
                <div className={styles.empty} data-home-empty="calm"><Icon name="sys.done" size={16} inherit decorative />{EMPTY.calm(home.facts?.count ?? 0)}</div>
              )}
              {home.burning.map((b) => (
                <div key={b.id} className={styles.row44}>
                  <span className={styles.name}>{b.label}</span>
                  <span className={`${styles.when} ${styles[`tone-${b.tone}`]}`}><span className={styles.dot6} aria-hidden />{daysText(b.days)}</span>
                </div>
              ))}
              {restOverdue > 0 && (
                <button type="button" className={styles.tail} data-tap onClick={onOverdue}>Ще {restOverdue} прострочених — у коморі, за свіжістю</button>
              )}
              {home.burning.length > 0 && (
                <button type="button" className={`${styles.act} ${styles['act-ink']}`} data-tap onClick={askBurning}>Готуємо</button>
              )}
            </>
          )}
        </section>

        <section className={styles.block} data-home-now-rows>
          <span className={styles.label}>Зараз</span>
          {cookLive && (
            <div className={styles.row48}>
              <span className={`${styles.dot8} ${styles['dot-sage']}`} aria-hidden />
              <span className={styles.text}>
                <span className={styles.name}>Готуємо · {cookLive.recipe.t}</span>
                <span className={styles.sub}>крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)} з {cookLive.recipe.st.length}{cookLive.deadline ? <> · таймер <CookCountdown deadline={cookLive.deadline} /></> : null}</span>
              </span>
              <button type="button" className={`${styles.act} ${styles['act-sage']}`} data-tap onClick={onCook}>До плити</button>
            </div>
          )}
          {shown.map((e) => {
            const tone = toneOfNow(e);
            const sub = nowSub(e);
            return (
              <button key={`${e.occasion_id ?? e.id}:${e.from}`} type="button" className={styles.row48} onClick={onCalendar}>
                <span className={`${styles.dot8} ${styles[`dot-${tone}`]} ${e.approx ? styles['dot-ring'] : ''}`} aria-hidden />
                <span className={styles.text}>
                  <span className={styles.name}>{e.title}</span>
                  <span className={styles.sub}><Icon name={sub.icon} size={12} inherit decorative />{sub.text}</span>
                </span>
                <span className={`${styles.when} ${styles[`tone-${tone}`]}`}>{nowWhen(e) ?? 'триває'}</span>
                <Icon name="sys.next" size={16} inherit decorative />
              </button>
            );
          })}
          {!cookLive && shown.length === 0 && (
            <div className={styles.empty} data-home-empty="no-events"><Icon name="sys.calendar" size={16} inherit decorative />{EMPTY.noEvents}</div>
          )}
          {restNow > 0 && <button type="button" className={styles.tail} data-tap onClick={onCalendar}>Ще {restNow} — у календарі</button>}
        </section>

        {/* Р116: у вікні — одна головна дія на всю ширину, чорнило 44; у шторці лишається посилання. */}
        <button type="button" className={styles['ask-main']} onClick={() => onAsk('Що на вечерю?')} data-home-ask>
          <Icon name="sys.chat" size={16} inherit decorative />Що на вечерю?
        </button>
      </div>
    </>
  );
}
