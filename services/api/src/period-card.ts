// Раунд 5, крок П1: картка `period` від моделі → артефакт, який людина
// підтверджує. Модель віддає мінімум (рід, назву, відносний час, правило
// словами); дати рахує сервер від сьогодні тим самим resolveWhen, що для
// подій, а список свят традиції — з довідника крізь підписку дому.
//
// Повертає null, коли добудувати нічого: невідомий сезон у «не показуй»,
// традиція без жодного приводу, дієта без назви. Картка з вигаданим змістом
// гірша за відсутню — хай модель перепитає.

import type { PeriodCard, PeriodItem, OccasionRow, Repo } from '@kitchen/domain';
import {
  isWindowRow, occasionSet, isSubscribed, subscribedRows, subscribedTraditions, nextWindow, occasionWhat,
  findOccasionByTitle, isoDay,
} from '@kitchen/domain';
import { resolveWhen } from './event-when.js';

const DIET_DEFAULT_DAYS = 30;

function itemOf(row: OccasionRow, subs: { occasion_id: string; enabled: boolean }[], trads: Parameters<typeof nextWindow>[2], now: Date): PeriodItem | null {
  if (!isWindowRow(row)) return null;
  const w = nextWindow(row, now, trads);
  if (!w) return null;
  return {
    occasion_id: row.id, title: row.title, from: w.from, to: w.to,
    ...(w.approx ? { approx: true } : {}),
    enabled: isSubscribed(row, subs), what: occasionWhat(row), strict: !!row.restricts,
  };
}

export async function buildPeriodCard(repo: Repo, card: PeriodCard, household_id: string, now = new Date()): Promise<PeriodCard | null> {
  const catalog = await repo.listOccasionCatalog();
  const subs = await repo.listOccasionSubscriptions(household_id);

  // «Не показуй мені кавуни»: рядок довідника за id або назвою, галочка знята.
  if (card.unsubscribe) {
    const visible = subscribedRows(catalog, subs);
    const row = findOccasionByTitle(visible, card.unsubscribe) ?? findOccasionByTitle(catalog, card.unsubscribe);
    if (!row) return null;
    const it = itemOf(row, subs, subscribedTraditions(visible), now);
    if (!it) return null;
    return { type: 'period', kind: 'tradition', title: card.title ?? row.title, unsubscribe: row.id, items: [{ ...it, enabled: false }] };
  }

  // П2a: масова відписка / повернення — серія всіх сезонів (і редакційних)
  // на рік, галочки за `all`. Людина повертає частину і тисне.
  if (card.kind === 'tradition' && card.set === 'seasons') {
    const rows = occasionSet(catalog, 'seasons');
    const all = !!card.all;
    const items = rows.map((r) => itemOf(r, subs, [], now)).filter((x): x is PeriodItem => !!x)
      .map((it) => ({ ...it, enabled: all }))
      .sort((a, b) => a.from.localeCompare(b.from));
    if (!items.length) return null;
    return { type: 'period', kind: 'tradition', set: 'seasons', all, title: card.title ?? 'сезони', items };
  }

  if (card.kind === 'tradition') {
    if (!card.tradition) return null;
    const rows = occasionSet(catalog, card.tradition);
    // Дати набору — за його ж пасхалією, а не за тим, що дім уже має.
    const items = rows.map((r) => itemOf(r, subs, [card.tradition!], now)).filter((x): x is PeriodItem => !!x)
      .sort((a, b) => a.from.localeCompare(b.from));
    if (!items.length) return null;
    return { type: 'period', kind: 'tradition', tradition: card.tradition, title: card.title, items };
  }

  // diet / custom: один запис із датами від [СЬОГОДНІ].
  const title = (card.title ?? card.rule_text ?? '').trim();
  if (!title) return null;
  const fromRule = resolveWhen(card.from ?? { rel: 'today' }, now);
  if (!fromRule || fromRule.t !== 'once') return null;
  const from = fromRule.at;
  let to: string | null = null;
  if (card.to) {
    const toRule = resolveWhen(card.to, now);
    if (!toRule || toRule.t !== 'once') return null;
    to = toRule.at;
  } else if (card.days && Number.isFinite(card.days) && card.days >= 1) {
    to = isoShift(from, Math.floor(card.days) - 1);
  } else {
    to = card.kind === 'diet' ? isoShift(from, DIET_DEFAULT_DAYS - 1) : from;
  }
  if (to < from) to = from;
  return {
    type: 'period', kind: card.kind, title,
    ...(card.rule_text ? { rule_text: card.rule_text.trim() } : {}),
    strict: !!card.strict,
    ...(card.servings != null ? { servings: card.servings } : {}),
    from: card.from, to: card.to, days: card.days,
    resolved: { from, to },
  };
}

/**
 * Картка впала (buildPeriodCard → null) — reply не бреше «прибрав». Детермінований
 * текст замість репліки моделі; це запобіжник, а не заміна правилу в промті.
 */
export function droppedPeriodReply(card: PeriodCard): string {
  if (card.unsubscribe) return `Не знайшов «${card.unsubscribe}» серед сезонів і свят. Скажи точніше або зніми внизу календаря.`;
  if (card.kind === 'tradition') return 'Такої традиції в довіднику нема — можеш додати свої свята карткою.';
  return 'Не зрозумів, що записати — назви період одним словом.';
}

function isoShift(iso: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + days));
}
