// Власник 15.09: емодзі в Telegram-боті — лише як знаки розділів (заголовки,
// підписи кнопок довідок, маркер на початку абзацу-кроку). Не всередині речень
// і ніколи у відповідях моделі. Один набір тут, щоб не розповзлось; веб не
// чіпаємо — там знаки з набору іконок.
import type { HelpTopicId } from './help-topics.js';

export const TG_EMOJI = {
  zone: { fresh: '🥬', fridge: '🧊', freezer: '❄️', dry: '🥫', spices: '🧂', drinks: '🧃' } as const,
  burning: '🔥',
  cmd: { list: '🛒', recipes: '📖', home: '🏠', calendar: '📅' } as const,
  calendar: { now: '🔴', seasons: '🌿', upcoming: '📌' } as const,
  help: { start: '🍽', telegram: '💻', app: '🧭', list: '🛒', pantry: '🥬', calendar: '📅' } as const satisfies Record<HelpTopicId, string>,
} as const;

/** «🥬 Свіже · 3» / «🏠 Дім зараз» — заголовок бота зі знаком. */
export function tgHeading(emoji: string, title: string, count?: number): string {
  return `${emoji} ${title}${count != null ? ` · ${count}` : ''}`;
}
