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

/** Знак роду на чіпі: сезон · традиція · завіз · подія дому; рамка дня — без знака. */
export function legendIcon(e: EventOccurrence): IconName | null {
  if (e.kind === 'season' || e.kind === 'editorial') return 'live.season';
  if (e.kind === 'tradition' || e.force === 'restrict' && e.scope === 'catalog') return 'live.tradition';
  if (e.kind === 'supply') return 'live.supply';
  if (e.kind === 'constraint') return null;
  return 'live.household';
}
