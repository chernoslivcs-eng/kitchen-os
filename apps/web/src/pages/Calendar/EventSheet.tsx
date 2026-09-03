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
import { api, type EventOccurrence } from '../../api';
import { Sheet } from '../../components/Sheet/Sheet';
import { whenLabel } from '../../lib/when';
import styles from './EventSheet.module.css';

interface Props {
  event: EventOccurrence;
  onClose: () => void;
  onChanged: () => void;
}

function kicker(e: EventOccurrence): { text: string; tone: string } {
  if (e.force === 'restrict') return { text: 'ОБМЕЖЕННЯ', tone: styles.plum! };
  if (e.source) return { text: `ВІД ${e.source.toUpperCase()}`, tone: styles.muted! };
  if (e.kind === 'season') return { text: 'СЕЗОН', tone: styles.amber! };
  if (e.kind === 'supply') return { text: '＋ ЗАВІЗ', tone: styles.sage! };
  if (e.kind === 'tradition') return { text: 'СВЯТО', tone: styles.muted! };
  if (e.kind === 'constraint') return { text: 'РАМКА НА ДЕНЬ', tone: styles.muted! };
  return { text: 'ПОДІЯ', tone: styles.muted! };
}

export function EventSheet({ event: e, onClose, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const k = kicker(e);
  const restrict = e.force === 'restrict';

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
          {/* Редакційну подію завжди можна вимкнути, і це повноправна дія, а не
              дрібне посилання: інакше привід непомітно стає рекламним каналом. */}
          {e.source && (
            <button className={styles.quiet} disabled title="Буде у наступному кроці">
              Не показувати такі
            </button>
          )}
          {/* Обмеження знімається лише зміною побажань — тут тихий вихід, а не
              кнопка «порушити». */}
          {restrict && (
            <button className={styles.quiet} disabled title="Знімається в профілі, у побажаннях">
              Не дотримуюсь
            </button>
          )}
          {e.scope === 'household' && (
            <button className={styles.remove} onClick={remove} disabled={busy}>
              {busy ? 'Прибираю…' : 'Прибрати'}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
