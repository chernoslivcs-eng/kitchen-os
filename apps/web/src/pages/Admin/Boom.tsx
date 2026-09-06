// Крок О1: димовий тест символікації, фронтова половина.
//
// Перевіряє одразу дві речі, і друга важливіша за першу:
//   1. чи читається стек у Sentry після цієї збірки;
//   2. чи бачить людина ЕКРАН падіння з Е1, а не білий екран.
//
// Друге ламається найтихіше з усього: ErrorBoundary стоїть у каркасі, його
// ніхто не чіпає місяцями, і виявити, що він десь перестав ловити, можна лише
// падінням. Тому падіння має бути під рукою.
//
// Кидаємо в РЕНДЕРІ, а не в обробнику події й не в useEffect: межа React ловить
// лише рендер, і саме цей шлях і треба перевіряти.
//
// Кадри вглиб — з тієї ж причини, що на сервері: стек з одного рядка нічого не
// каже про символікацію.
//
// Маршрут ніде не показаний — ні в TabBar, ні в шухляді. Стороннього зустрічає
// 404: сторінка питає сервер (`?dry=1`), і той відповідає тим самим 404, що на
// решті адмінки.

import { useEffect, useState } from 'react';
import { api } from '../../api';

/** Кадр 3. */
function measureShelf(shelf: string): number {
  throw new Error(`димовий тест символікації: полиці «${shelf}» не існує`);
}

/** Кадр 2. */
function describeShelf(shelves: string[]): string {
  return `${shelves[0]} (${measureShelf(shelves[0] ?? 'порожньо')})`;
}

/** Кадр 1 — його викликає рендер. */
function renderNightPlan(): string {
  return describeShelf(['холодильник', 'морозилка']);
}

type Gate = 'checking' | 'allowed' | 'denied';

export function BoomPage() {
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    let alive = true;
    api.admin.boomDry()
      .then(() => { if (alive) setGate('allowed'); })
      .catch(() => { if (alive) setGate('denied'); });
    return () => { alive = false; };
  }, []);

  // Той самий 404, що й на сервері: сторінка не видає, що вона існує.
  if (gate === 'denied') {
    return <div style={{ padding: 24, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)' }}>404</div>;
  }
  if (gate === 'allowed') {
    // Звідси вгору вже нічого не повернеться — ловить ErrorBoundary у каркасі.
    return <>{renderNightPlan()}</>;
  }
  return null;
}
