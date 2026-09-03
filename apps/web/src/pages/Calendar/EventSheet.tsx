// Сторінка події — один шаблон, пʼять станів.
//
// Роди розповідають різне, але спільний хребет у них один:
//   кікер → заголовок → коли → одне речення сенсу → що з цього робити.
//
// Головна складність не в розкладці, а в тому, що сила має читатись БЕЗ нового
// кольору: семантика палітри вже зайнята (шавлія — дія, бурштин — очікування,
// слива — анти, теракота — помилка). Тому обмеження бере сливу й приглушений
// заголовок, а не теракоту: піст — це рамка, а не помилка.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type EventOccurrence } from '../../api';
import { Sheet } from '../../components/Sheet/Sheet';
import { whenLabel } from '../../lib/when';
import styles from './EventSheet.module.css';

interface Props {
  event: EventOccurrence;
  onClose: () => void;
  onChanged: () => void;
  /** Правка особистої події — та сама форма, що створення. */
  onEdit: (e: EventOccurrence) => void;
}

// Кікер несе РІД І СТАН, не лише рід: «Сезон · останні дні» — інша річ, ніж
// «Сезон». Те, що закінчується, змінює поведінку; те, що просто триває, ні.
function kicker(e: EventOccurrence, now = Date.now()): { text: string; tone: string } {
  const live = now >= e.start && now <= e.end;
  const endsSoon = live && e.end - now < 7 * 86_400_000;
  if (e.force === 'restrict') {
    return { text: live ? 'Обмеження · діє' : 'Обмеження', tone: styles.plum! };
  }
  if (e.source) return { text: `Від ${e.source}`, tone: styles.muted! };
  if (e.kind === 'season') {
    return { text: endsSoon ? 'Сезон · останні дні' : 'Сезон', tone: styles.amber! };
  }
  if (e.kind === 'supply') return { text: '＋ Завіз', tone: styles.sage! };
  if (e.kind === 'tradition') return { text: 'Свято', tone: styles.muted! };
  if (e.kind === 'constraint') return { text: 'Рамка на день', tone: styles.muted! };
  return { text: 'Подія', tone: styles.muted! };
}

// Моно-мета в підвалі: коротке «що тут є», щоб дія не стояла в порожньому
// рядку. Для обмеження — його сила, для решти — те, що можна взяти.
function footerMeta(e: EventOccurrence): string | null {
  if (e.force === 'restrict') return 'ДІЄ У ВСІХ ПОРАДАХ';
  if (e.source) return 'НЕ СПОНСОРОВАНО';
  const parts: string[] = [];
  if (e.seeds?.length) parts.push(`${e.seeds.length} ЗЕРНА`);
  if (e.buy?.length) parts.push(`${e.buy.length} ДОКУПИТИ`);
  if (e.kind === 'tradition' && !parts.length) return 'РОЗПІЗНАНО ЗА ТРАДИЦІЄЮ';
  return parts.length ? parts.join(' · ') : null;
}

export function EventSheet({ event: e, onClose, onChanged, onEdit }: Props) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const k = kicker(e);
  const meta = footerMeta(e);
  const restrict = e.force === 'restrict';

  // Головна дія сторінки — повернутись у розмову з цією подією на руках.
  // Календар показує, а готує все одно Кухня; без цього мосту екран лишався б
  // довідкою про себе самого.
  function discuss() {
    navigate('/app', { state: { composePrefix: `${e.title} — ` } });
  }

  async function remove() {
    setBusy(true);
    try {
      await api.events.remove(e.id);
      onChanged();
      onClose();
    } catch { setBusy(false); }
  }

  return (
    <Sheet onClose={onClose} ariaLabel={e.title}>
      <div className={styles.body}>
        <div className={`${styles.kicker} ${k.tone}`}>{k.text}</div>

        {/* Заголовок обмеження приглушений: воно не кличе, воно окреслює. */}
        <h2 className={`${styles.title} ${restrict ? styles['title-quiet'] : ''}`}>{e.title}</h2>

        <div className={styles.when}>
          {whenLabel(e.start, e.end)}
          {e.approx && <span className={styles.approx}> · орієнтовно, місячний календар</span>}
        </div>

        {e.meaning && <p className={styles.meaning}>{e.meaning}</p>}
        {e.note && <p className={styles.note}>{e.note}</p>}

        {/* Тексту `restricts` тут навмисно НЕМАЄ, хоч він і приходить з API.
            Він написаний для моделі, не для людини: «ні у стравах, ні в needs,
            ні в rescues» — це поля картки, службовий словник. Продукт має
            тверде правило не показувати людині власну механіку, і перший же
            живий прогін цієї шторки його порушив.

            Людське пояснення дає `meaning` вище. Коли обмеженню знадобиться
            власне формулювання для екрана — це окреме поле, а не переклад
            інструкції моделі. */}

        {(e.buy?.length ?? 0) > 0 && (
          <div className={styles.block}>
            <div className={styles['block-label']}>ВАРТО ДОКУПИТИ</div>
            <div className={styles.chips}>
              {e.buy!.map((b) => <span key={b} className={styles.chip}>{b}</span>)}
            </div>
          </div>
        )}

        {(e.seeds?.length ?? 0) > 0 && (
          <div className={styles.block}>
            <div className={styles['block-label']}>ЩО З ЦЬОГО ВАРИТИ</div>
            <div className={styles.chips}>
              {e.seeds!.map((s) => <span key={s} className={styles.chip}>{s}</span>)}
            </div>
          </div>
        )}

        {(e.supply?.length ?? 0) > 0 && (
          <div className={styles.block}>
            <div className={styles['block-label']}>ЩО ПРИЙДЕ</div>
            <div className={styles.chips}>
              {e.supply!.map((s) => (
                <span key={s.label} className={styles.chip}>
                  {s.label}{s.v ? ` · ${s.v}${s.u ?? ''}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={styles.actions}>
          {meta && <span className={styles.meta}>{meta}</span>}

          {/* Редакційну подію завжди можна вимкнути, і це повноправна дія, а не
              дрібне посилання: інакше привід непомітно стає рекламним каналом. */}
          {e.source && (
            <button className={styles.ghost} disabled title="Буде у наступному кроці">
              Не показувати такі
            </button>
          )}

          {/* Обмеження знімається зміною побажань у профілі — тут тихий вихід,
              а не кнопка «порушити». І головної дії в нього немає: рамку не
              обговорюють, її дотримуються. */}
          {restrict && (
            <button className={styles.ghost} disabled title="Знімається в профілі, у побажаннях">
              Не дотримуюсь
            </button>
          )}

          {e.scope === 'household' && (
            <>
              <button className={styles.ghost} onClick={remove} disabled={busy}>
                {busy ? 'Прибираю…' : 'Прибрати'}
              </button>
              <button className={styles.secondary} onClick={() => onEdit(e)}>Редагувати</button>
            </>
          )}

          {!restrict && e.scope === 'catalog' && (
            <button className={e.source ? styles.secondary : styles.primary} onClick={discuss}>
              {e.source ? 'Обговорити' : 'Обговорити з Кухнею'}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
