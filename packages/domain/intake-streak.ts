// Серія «наповнюю комору» в Telegram (живий прохід 19.09: 79 фото = 70 тапів
// «У комору», хоч на пʼятому фото людина сказала «все у комору»).
//
// Стан живе на telegram-акаунті (лямбда, памʼять процесу не тримає):
//   intake_streak_until       — серія активна, поки now < until;
//   intake_streak_last_apply  — коли востаннє застосували intake_diff з фото
//                               (два поспіль за 15 хв вмикають серію).
// Увімкнути: (1) два apply поспіль за 15 хв; (2) «все у комору» текстом/голосом
// (тоді ще й застосувати всі pending intake_diff за 30 хв). Кожен apply
// продовжує until = now + 20 хв. Поки активна — фото з intake_diff іде auto
// (як текст) з однією кнопкою «Скасувати». Рветься: dismiss/«Скасувати»,
// фото-страва чи порожня картка, сплив until.
//
// Тут — лише чиста арифметика стану; Telegram-обробники (services/api) її кличуть.

export const STREAK_EXTEND_MS = 20 * 60_000;
export const STREAK_PAIR_WINDOW_MS = 15 * 60_000;
export const ALL_TO_PANTRY_LOOKBACK_MS = 30 * 60_000;

export interface IntakeStreakState {
  intake_streak_until?: string | null;
  intake_streak_last_apply?: string | null;
}

export const streakActive = (s: IntakeStreakState, now: Date): boolean =>
  !!s.intake_streak_until && Date.parse(s.intake_streak_until) > now.getTime();

/** Apply intake_diff з фото: продовжує активну серію; інакше вмикає, якщо попередній apply був ≤ 15 хв тому. */
export function onIntakeApply(s: IntakeStreakState, now: Date): { intake_streak_until: string | null; intake_streak_last_apply: string | null } {
  const nowIso = now.toISOString();
  const active = streakActive(s, now);
  const pair = !!s.intake_streak_last_apply && now.getTime() - Date.parse(s.intake_streak_last_apply) <= STREAK_PAIR_WINDOW_MS;
  return {
    intake_streak_last_apply: nowIso,
    intake_streak_until: active || pair ? new Date(now.getTime() + STREAK_EXTEND_MS).toISOString() : s.intake_streak_until ?? null,
  };
}

/** «Все у комору» — серія вмикається одразу. */
export const startStreak = (now: Date) => ({
  intake_streak_until: new Date(now.getTime() + STREAK_EXTEND_MS).toISOString(),
  intake_streak_last_apply: now.toISOString(),
});

export const breakStreak = () => ({ intake_streak_until: null as string | null, intake_streak_last_apply: null as string | null });

/** «все у комору» / «всё в комору» / «все в комору» — нормалізований збіг, як YES_WORDS. */
export function isAllToPantry(text: string): boolean {
  const norm = text.toLowerCase().replace(/[.,!?…:;«»"']/g, ' ').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  return /(^|\s)(все|всё|усе)\s+(у|в)\s+комору(\s|$)/.test(norm);
}
