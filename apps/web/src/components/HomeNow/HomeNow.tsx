// Панель «Дім зараз» (6b-5) — вміст за Components «home now»: card r18 --sh,
// 20, gap 18. Відкриває чіп у шапці чату накладкою (Prototype openHome); на
// 390 (за шириною контейнера) — шторкою (Responsive G3).
//
//   «Горить · N» 12/500 amber; до 3 рядків 44 з волосиною: назва 14/500 ·
//   крапка 6 + строк 13 кольором стану (danger «−9 дн» / «≈ сьогодні», amber
//   «2 дн»); хвіст 12 dim «Ще N прострочених — у коморі, за свіжістю».
//   «Зараз» 12/500 muted; рядки 48: крапка 8 роду (кільце 1.5 = орієнтовно),
//   назва 14/500, підрядок 12 dim зі знаком джерела 11, праворуч строк кольором
//   роду. Дія лише де є що робити зараз («Готуємо», «До плити»), решта —
//   шеврон. Тимчасово, до QUESTIONS §14: 3 рядки + хвіст «Ще N — у календарі».
//   Порожні слова — три з Components (nowEmptyText).
//   Низ — «Що на вечерю?» у композитор (Prototype openHome).
import { useEffect } from 'react';
import { Icon } from '../Icon/Icon';
import { CookCountdown } from '../../lib/cook-watch';
import { nowWhen, nowEmptyKind, nowEmptyText, toneOfNow, TRADITION_LABEL } from '../../lib/period';
import type { CookSession } from '../../lib/cook-session';
import type { HomeNow as HomeState } from '../../store/homeNow';
import type { NowItem } from '../../api';
import styles from './HomeNow.module.css';

function daysText(days: number): string {
  if (days < 0) return `−${Math.abs(days)} дн`;
  if (days === 0) return '≈ сьогодні';
  return `${days} дн`;
}

/** Підрядок «Зараз»: джерело · сила. */
function nowSub(e: NowItem): { icon: 'sys.tradition' | 'sys.chat' | 'live.byHand'; text: string } {
  if (e.source === 'catalog') {
    const who = e.kind === 'tradition' && e.meaning && (e.meaning as string) in TRADITION_LABEL
      ? TRADITION_LABEL[e.meaning as keyof typeof TRADITION_LABEL] : 'каталог';
    return { icon: 'sys.tradition', text: `${who} · ${e.strict ? 'суворо' : 'мʼяко'}` };
  }
  if (e.source === 'chat') return { icon: 'sys.chat', text: `з розмови${e.rule_text ? ` · ${e.rule_text}` : ''}` };
  return { icon: 'live.byHand', text: `своє${e.strict ? ' · суворо' : ''}` };
}

export function HomeNowPanel({ home, cookLive, sheet, onClose, onCook, onOverdue, onCalendar, onAsk, dateLabel }: {
  home: HomeState; cookLive: CookSession | null; sheet: boolean;
  onClose: () => void; onCook: () => void; onOverdue: () => void; onCalendar: () => void;
  /** «Що на вечерю?» / «Приготуй щось із того, що горить» — у композитор. */
  onAsk: (text: string) => void;
  dateLabel: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = home.now.slice(0, 3);
  const restNow = Math.max(0, home.now.length - shown.length);
  const shownOverdue = home.burning.filter((b) => b.days < 0).length;
  const restOverdue = Math.max(0, home.overdue - shownOverdue);
  const empty = home.burning.length === 0 && home.now.length === 0 && !cookLive;

  return (
    <>
      <div className={`${styles.scrim} ${sheet ? styles['scrim-dark'] : ''}`} onClick={onClose} />
      <div className={`${styles.panel} ${sheet ? styles.sheet : styles.popover}`} role="dialog" aria-label="Дім зараз" data-home-now>
        {sheet && <span className={styles.handle} aria-hidden />}
        <div className={styles.head}>
          <Icon name="sys.home" size={18} inherit decorative />
          <span className={styles.title}>Дім зараз</span>
          <span className={styles.date}>{dateLabel}</span>
          <span className={styles.gap} />
          <button type="button" className={styles.close} onClick={onClose} aria-label="Закрити"><Icon name="sys.close" size={16} inherit decorative /></button>
        </div>

        {home.burning.length > 0 && (
          <section className={styles.block} data-home-burning>
            <span className={`${styles.label} ${styles['label-amber']}`}>Горить · {home.overdue > 0 ? home.overdue : home.burning.length}</span>
            {home.burning.map((b) => (
              <div key={b.id} className={styles.row44}>
                <span className={styles.name}>{b.label}</span>
                <span className={`${styles.when} ${styles[`tone-${b.tone}`]}`}><span className={styles.dot6} aria-hidden />{daysText(b.days)}</span>
              </div>
            ))}
            {restOverdue > 0 && (
              <button type="button" className={styles.tail} onClick={onOverdue}>Ще {restOverdue} прострочених — у коморі, за свіжістю</button>
            )}
            <button type="button" className={`${styles.act} ${styles['act-ink']}`} onClick={() => onAsk('Приготуй щось із того, що горить')}>Готуємо</button>
          </section>
        )}

        {(cookLive || shown.length > 0) && (
          <section className={styles.block} data-home-now-rows>
            <span className={styles.label}>Зараз</span>
            {cookLive && (
              <div className={styles.row48}>
                <span className={`${styles.dot8} ${styles['dot-sage']}`} aria-hidden />
                <span className={styles.text}>
                  <span className={styles.name}>Готуємо · {cookLive.recipe.t}</span>
                  <span className={styles.sub}>крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)} з {cookLive.recipe.st.length} · таймер <CookCountdown deadline={cookLive.deadline} /></span>
                </span>
                <button type="button" className={`${styles.act} ${styles['act-sage']}`} onClick={onCook}>До плити</button>
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
            {restNow > 0 && <button type="button" className={styles.tail} onClick={onCalendar}>Ще {restNow} — у календарі</button>}
          </section>
        )}

        {empty && (
          <div className={styles.empty} data-home-empty={nowEmptyKind(home.facts)}>
            <Icon name={nowEmptyKind(home.facts) === 'calm' ? 'sys.done' : nowEmptyKind(home.facts) === 'pantry-empty' ? 'sys.pantry' : 'sys.calendar'} size={16} inherit decorative />
            {nowEmptyText(home.facts)}
          </div>
        )}

        <button type="button" className={styles.ask} onClick={() => onAsk('Що на вечерю?')}>Що на вечерю?<Icon name="sys.next" size={12} inherit decorative /></button>
      </div>
    </>
  );
}
