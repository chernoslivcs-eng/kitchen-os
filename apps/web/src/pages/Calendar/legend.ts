// Легенда «що триває зараз» — чіпи над стрічкою (Screens D3a/D3b): іконка
// роду + підпис за правилами legendLabel. Тон — з toneKey, як на рисках.
//
// Підпис: «Піст · день 12 з 46», «Помідори · до ≈ 30.09», «Гарбуз · з пн 15 ·
// до ≈ 30.11», «Мама · чт 11 – нд 14». День тижня має сенс лише поки старт
// близько — сезон, що почався півтора місяця тому, називає лише кінець.
// Речення, не капс: бандл пише чіпи 12/500 звичайним регістром.

import type { EventOccurrence } from '../../api';
import type { IconName } from '../../components/Icon/icons';
import { dayStart, DAY } from './days';
import { coversDay, edgeCaption } from '../../lib/spans';

const dow = (at: number) => new Date(at).toLocaleDateString('uk-UA', { weekday: 'short' });
const num = (at: number) => new Date(at).getDate();

export function legendLabel(e: EventOccurrence, today: number): string {
  const days = Math.round((dayStart(e.end) - dayStart(e.start)) / DAY) + 1;
  const dayN = Math.round((today - dayStart(e.start)) / DAY) + 1;
  const t = e.title;
  if (e.force === 'restrict') return `${t} · день ${dayN} з ${days}`;
  const d = (at: number) => `${dow(at)} ${num(at)}`;
  const until = `до ${e.approx ? '≈ ' : ''}${new Date(e.end).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}`;
  if (days <= 14) return `${t} · ${d(e.start)} – ${d(e.end)}`;
  return dayN <= 7 ? `${t} · з ${d(e.start)} · ${until}` : `${t} · ${until}`;
}

/** Знак роду на чіпі: сезон · піст (обмеження) · свято · завіз · подія дому; рамка дня — без знака.
 *  12.09 (уточнення до A7): стан обмеження — moon (`live.fast`); church — свято
 *  без обмеження й кікер «з традиції» (джерело), не стан. */
export function legendIcon(e: EventOccurrence): IconName | null {
  if (e.kind === 'season' || e.kind === 'editorial') return 'live.season';
  if (e.force === 'restrict' && e.scope === 'catalog') return 'live.fast';
  if (e.kind === 'tradition') return 'live.tradition';
  if (e.kind === 'supply') return 'live.supply';
  if (e.kind === 'constraint') return null;
  return 'live.household';
}

/**
 * Підпис смуги тривалої в картці тижня (D3a): у тижні, де подія починається
 * (або в першому видимому, якщо почалась раніше), — повний, як у легенді
 * («Великий піст · день 12 з 46», «Гарбуз · сезон · з пн 15 · до ≈ 30.11»);
 * у наступних тижнях — лише назва: смуга вже все сказала, а повторений
 * щотижня підпис і є те, чого уникаємо. Тривала, що не триває сьогодні,
 * у своєму тижні підписана формою краю («Гарбуз · сезон · до ≈ 30.11»).
 */
export function barLabel(e: EventOccurrence, weekStart: number, today: number, continued: boolean): string {
  if (continued && dayStart(e.start) < weekStart) return e.title;
  if (coversDay(e, today)) return legendLabel(e, today);
  return edgeCaption(e, e.start) ?? e.title;
}

/** Знак і тон точкової події в дні (D3a/D3b): рід кольором, приготоване — muted із галочкою. */
export function pointIcon(e: EventOccurrence): { icon: IconName | null; tone: 'ink' | 'muted' | 'sage' | 'amber' | 'plum' } {
  if (e.done_at) return { icon: 'sys.done', tone: 'muted' };
  if (e.kind === 'meal') return { icon: 'cook.type', tone: 'ink' };
  if (e.kind === 'supply') return { icon: 'live.supply', tone: 'sage' };
  if (e.kind === 'season') return { icon: 'live.season', tone: 'amber' };
  if (e.kind === 'editorial' || e.source) return { icon: 'live.season', tone: 'amber' };
  if (e.force === 'restrict' && e.scope === 'catalog') return { icon: 'live.fast', tone: 'plum' };
  if (e.kind === 'tradition') return { icon: 'live.tradition', tone: 'plum' };
  if (e.kind === 'constraint') return { icon: null, tone: 'muted' };
  if (e.force === 'restrict') return { icon: 'live.household', tone: 'plum' };
  return { icon: 'live.household', tone: 'ink' };
}
