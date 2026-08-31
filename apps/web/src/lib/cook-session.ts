// Бриф-3 п.2: «✕ Вийти» посеред готування більше не вбиває прогрес. Сесія
// живе в localStorage; стрічка показує «Готування триває · крок N/M ·
// ПРОДОВЖИТИ ›», повернення відновлює крок і таймер. Пул-7 №1: якщо таймер
// ІШОВ — сесія несе deadline і рахунок триває без попапа (банери показують
// живий залишок, вартовий дзвонить на нулі); на паузі — час не
// «відмотується», людина сама вирішить, чи запускати.
//
// TTL 12 годин: «продовжити» вчорашнє тушкування — це вже не продовження.

import type { Recipe } from '../api';

const KEY = 'kos-cook-live';
const TTL = 12 * 3600_000;

export interface CookSession {
  recipe: Recipe;
  stepIdx: number;
  secondsLeft: number;
  // Пул-7 №1: якщо таймер ішов — тут його ДЕДЛАЙН (timestamp). Рахунок
  // триває без Cook Mode: повернення обчислює залишок, глобальний вартовий
  // дзвонить, коли нуль настав деінде. null/відсутній = пауза (як раніше).
  deadline?: number | null;
  savedAt: number;
  // UX9-11: id чернетки рецепта — щоб фініш після resume реюзав той самий
  // рядок, а не плодив другий.
  recipeId?: string;
  // Правка №5: сесія, з якої запустили готування — вихід повертає туди.
  returnSessionId?: string | null;
}

export function saveCookSession(s: Omit<CookSession, 'savedAt'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, savedAt: Date.now() }));
  } catch { /* приватний режим — просто без resume */ }
}

export function loadCookSession(): CookSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CookSession;
    if (!s?.recipe?.t || Date.now() - s.savedAt > TTL) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch { return null; }
}

export function clearCookSession(): void {
  try { localStorage.removeItem(KEY); } catch { /* ок */ }
}
