// Власник 15.09: свята з бота — серія з кнопками, як картка period у вебі
// (галочки → «Записати»). Стан тоглів живе в callback data бітмаскою (≤ 64
// байт): `pt:<card_id>:<mask hex>` — тогл (mask уже з перевернутим бітом),
// `pa:<card_id>:<mask hex>` — «Записати N», `dismiss:<card_id>` — «Не треба».
// Тогл редагує повідомлення на місці (як /list). Тоглів на клавіатурі — до 8;
// набори з каталогу ≤ 7, тож понад ліміт — лише рядок «решта у вебі» (рішення
// виконавця: посторінково не робимо, поки нема набору > 8).
import { TG_EMOJI, tgHeading, type PeriodCard, type Tradition } from '@kitchen/domain';

// Той самий формат дати, що в /calendar (telegram-nomodel): «18 вер» без крапки.
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
function shortDate(iso: string): string { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
import { escapeHtml } from './telegram.js';

export const SERIES_TOGGLE_MAX = 8;

export const TRADITION_LABEL: Record<Tradition, string> = {
  orthodox: 'православні', catholic: 'католицькі', islamic: 'ісламські', jewish: 'юдейські', secular: 'світські',
};
export const TRADITION_SETS: Tradition[] = ['orthodox', 'catholic', 'jewish', 'islamic', 'secular'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Маска «усе увімкнено» на n рядків. */
export function maskOf(n: number): number { return (1 << Math.min(n, 31)) - 1; }
export function parseMask(hex: string): number { const v = parseInt(hex, 16); return Number.isFinite(v) ? v : 0; }
export function selectedOf(mask: number, n: number): number[] { return Array.from({ length: n }, (_, i) => i).filter((i) => mask & (1 << i)); }
const plural = (n: number, f: [string, string, string]) => (n % 10 === 1 && n % 100 !== 11 ? f[0] : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? f[1] : f[2]);

export function seriesTitle(card: PeriodCard): string {
  if (card.set === 'seasons') return 'Сезони';
  return card.tradition ? `${cap(TRADITION_LABEL[card.tradition])} свята` : cap(card.title ?? 'свята');
}

/** «📅 Католицькі свята · 3 свят» + рядки «☑ Різдво · 25 гру» (HTML). */
export function renderPeriodSeriesText(card: PeriodCard, mask: number): string {
  const items = card.items ?? [];
  const head = `<b>${tgHeading(TG_EMOJI.cmd.calendar, seriesTitle(card), undefined)} · ${items.length} ${plural(items.length, ['свято', 'свята', 'свят'])}</b>`;
  const lines = items.map((it, i) => {
    const on = !!(mask & (1 << i));
    const when = it.from === it.to ? shortDate(it.to) : `${shortDate(it.from)} — ${shortDate(it.to)}`;
    return `${on ? '☑' : '☐'} ${escapeHtml(it.title)} · ${when}${it.approx ? ' (орієнтовно)' : ''}`;
  });
  const tail = items.length > SERIES_TOGGLE_MAX ? ['', 'Решта — у вебі.'] : [];
  return [head, ...lines, ...tail].join('\n');
}

export function periodSeriesKeyboard(card: PeriodCard, card_id: string, mask: number): { text: string; data?: string; url?: string }[][] {
  const items = card.items ?? [];
  const rows = items.slice(0, SERIES_TOGGLE_MAX).map((it, i) => [{ text: `${mask & (1 << i) ? '☑' : '☐'} ${it.title}`, data: `pt:${card_id}:${(mask ^ (1 << i)).toString(16)}` }]);
  const n = selectedOf(mask, items.length).length;
  rows.push([{ text: `Записати ${n}`, data: `pa:${card_id}:${mask.toString(16)}` }, { text: 'Не треба', data: `dismiss:${card_id}` }]);
  return rows;
}

/** Підпис після «Записати» для custom/diet: «Записав: гості · 18 вер · на 5». */
export function periodAppliedStatus(card: PeriodCard): string {
  const when = card.resolved ? (card.resolved.from === card.resolved.to ? shortDate(card.resolved.to) : `${shortDate(card.resolved.from)} — ${shortDate(card.resolved.to)}`) : null;
  return `Записав: ${card.title ?? card.rule_text ?? 'період'}${when ? ` · ${when}` : ''}${card.servings != null ? ` · на ${card.servings}` : ''}`;
}
