// Стан дії — що показує рядок над композитором (Components · «Стани дії»,
// PLAN §4). Чотири стани з бандла плюс один лише для карток.
//
// Пріоритет: те, що блокує наступну дію, старше за те, що вже сталось.
// Мережа перебиває ліміт (без мережі ліміт і не побачиш), ліміт перебиває
// «думаю» (відповіді не буде), а «нічого не змінилось» — найтихіше і живе,
// поки не сталось чогось нового.
//
// «Ліміт ≠ мережа ≠ нічого не змінилось» — три різні знаки і три різні
// дії від людини: ліміт — чекати, і ЖОДНОГО «повторити», бо рано; мережа —
// повторити, коли зʼявиться; нічого — нічого.

export type ActionStateKind = 'thinking' | 'limit' | 'offline' | 'nothing' | 'conflict' | null;

export interface ActionStateInput {
  /** Запит до кухні триває. */
  sending: boolean;
  /** Секунд від початку запиту — для «0:07». */
  waited: number;
  /** Розбір вкладення, не відповідь: інше слово. */
  parsing: boolean;
  offline: boolean;
  /** Мс, коли ліміт зніметься; null — ліміту немає. */
  throttledUntil: number | null;
  /** Який ліміт — з `kind` у тілі 429; null — сервер не сказав. */
  throttledKind: string | null;
  /** Останнє застосування дало нуль. */
  nothingChanged: boolean;
  /** 409 на картці: її вже закрив хтось у домі. Лише для карток (DEBT §34). */
  cardConflict: boolean;
  now?: number;
}

export interface ActionState {
  kind: Exclude<ActionStateKind, null>;
  /** Знак зі словника. */
  icon: 'live.thinking' | 'live.limit' | 'live.offline' | 'live.nothing' | 'sys.retry';
  tone: 'muted' | 'amber' | 'danger';
  text: string;
  /** Дія праворуч, якщо є: «Стоп», «Повторити», «Оновити». */
  action: 'stop' | 'retry' | 'refresh' | null;
}

/** Слово за видом ліміту. Без виду — загальне; це запасний варіант, не помилка. */
const LIMIT_TEXT: Record<string, string> = {
  recipe_gen: 'Десять рецептів за хвилину — моя стеля. Ті, що вже є, на місці.',
  chat: 'Забагато повідомлень за раз. Написане в полі не зникне.',
  shopping: 'Список не встигає за тобою. Усе, що вже додано, — там.',
  retail: 'Сільпо просить зачекати. Це їхній ліміт, не наш.',
};
const LIMIT_GENERIC = 'Дай мені хвилину наздогнати. Усе вже зроблене на місці.';

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function actionState(i: ActionStateInput): ActionState | null {
  const now = i.now ?? Date.now();
  if (i.offline) {
    return { kind: 'offline', icon: 'live.offline', tone: 'danger', text: 'Написане нікуди не дінеться. Чекаю на мережу.', action: 'retry' };
  }
  if (i.throttledUntil !== null && i.throttledUntil > now) {
    const text = (i.throttledKind && LIMIT_TEXT[i.throttledKind]) || LIMIT_GENERIC;
    // Ліміт — без «Повторити»: повторювати рано, і кнопка це обіцяла б.
    return { kind: 'limit', icon: 'live.limit', tone: 'amber', text, action: null };
  }
  if (i.sending) {
    return { kind: 'thinking', icon: 'live.thinking', tone: 'muted', text: `${i.parsing ? 'Дивлюся, що тут' : 'Думаю'} · ${clock(i.waited)}`, action: 'stop' };
  }
  if (i.cardConflict) {
    return { kind: 'conflict', icon: 'sys.retry', tone: 'muted', text: 'Хтось у домі вже закрив цю картку.', action: 'refresh' };
  }
  if (i.nothingChanged) {
    return { kind: 'nothing', icon: 'live.nothing', tone: 'muted', text: 'Нічого не змінилось — усе це вже було вдома.', action: null };
  }
  return null;
}
