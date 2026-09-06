// Крок Д1 (макет v7): картка від Кухні, поки файл тримають над вікном.
//
// Не накладка й не рамка: Кухня просто відповідає ходом у стрічці, як на будь-що
// інше. Зміст залежить від роду файла — вона каже, що саме зробить, ще до того,
// як людина відпустила.
//
// Імені файла тут немає навмисно: браузер віддає його лише на drop, а під час
// перетягування доступний тільки MIME. Тому картка говорить про рід, а не
// називає файл — вигадувати назву було б гірше за мовчання.

import { useLayoutEffect, useRef } from 'react';
import type { DragState } from './useDropZone';
import styles from './DropCard.module.css';

interface Copy {
  kicker: string;
  title: string;
  slot: string;
  body: string;
  effect: string | null;
}

export function copyFor(d: DragState, max: number): Copy {
  switch (d.kind) {
    case 'pdf':
      return {
        kicker: 'файл · pdf',
        title: 'Зараз прийму',
        slot: 'PDF',
        body: 'Прочитаю позиції й ціни, розкладу в комору.',
        effect: '→ у комору · позиції з чека',
      };
    case 'image':
      return {
        kicker: 'фото',
        title: 'Зараз подивлюсь',
        slot: 'JPG',
        body: 'Розберу, що видно на фото, і додам у комору.',
        effect: '→ у комору · що видно на фото',
      };
    case 'many':
      return {
        kicker: `файли · ${d.count} шт`,
        title: 'Зараз розберу',
        slot: `×${d.count}`,
        body: 'Візьму всі за раз.',
        effect: `→ у комору · до ${max} файлів за раз`,
      };
    case 'full':
      return {
        kicker: 'вкладення',
        title: `Більше ${max} за раз не візьму`,
        slot: `${max}/${max}`,
        // Тут не «що зроблю», а «чому не зроблю»: обіцяти дію, якої не буде,
        // гірше, ніж сказати межу.
        body: 'Надішли ці — і принось наступні.',
        effect: null,
      };
  }
}

export function DropCard({ drag, max }: { drag: DragState; max: number }) {
  const c = copyFor(drag, max);
  const slotRef = useRef<HTMLSpanElement>(null);

  // Слот тягнеться до курсора — єдиний рух, що лишився від макета після того,
  // як привид файла викинули (його малює операційна система). Через layout-
  // ефект і transform, без перерахунку розкладки.
  useLayoutEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = Math.max(-9, Math.min(9, (drag.x - (r.left + r.width / 2)) * 0.05));
    const dy = Math.max(-7, Math.min(7, (drag.y - (r.top + r.height / 2)) * 0.05));
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }, [drag.x, drag.y]);

  return (
    <div className={styles.wrap} data-drop-card>
      <div className={styles.who}>КУХНЯ</div>
      <div className={styles.card}>
        <span className={styles.kicker}>{c.kicker}</span>
        {/* Після чотирьох секунд утримання заголовок міняється — це про
            тривожність людини, яка не наважується відпустити, а не інструкція. */}
        <span className={styles.title}>
          {drag.long ? 'Ти можеш відпустити. Він не втече.' : c.title}
        </span>
        <div className={styles.row}>
          <span ref={slotRef} className={styles.slot} data-drop-slot>{c.slot}</span>
          <span className={styles.body}>{c.body}</span>
        </div>
        {c.effect && <span className={styles.effect}>{c.effect}</span>}
      </div>
    </div>
  );
}
