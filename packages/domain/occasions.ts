// Календар: сезони й свята. Двигун.
//
// Це найдовший борг із прототипу. Промпт шість QA-прогонів обіцяв «Дати свят я
// порахую сам, розпізнавши традицію з фрази» — і нічого їх не рахувало. Модель
// відповідала на «коли Великдень» з голови, тобто вгадувала. QA тестувало
// функцію, якої не існувало.
//
// Б2 плану календаря: механіка й дані розділені. Тут лишився двигун; правила
// дат — у occasion-rules.ts, самі свята — в occasion-data.ts. Кожна функція,
// що читала список зі своєї константи, тепер бере його аргументом із
// замовчуванням. Підпис не змінився для жодного наявного виклику, але список
// уже можна подати з БД — саме це відмикає і події дому, і адмінку.
//
// Два принципи лишаються з прототипу:
//
// 1. Традиція не окреме поле профілю, а висновок із побажань.
// 2. Свято — привід, а не обовʼязок. Блок іде в системний промпт як контекст,
//    із явною вказівкою згадувати лише коли доречно. Інакше асистент починає
//    кожну розмову з календаря, і це швидко бісить.

import {
  DAY, easterDate, ruleActive, ruleWindow, anchorAt, nextAnchorAfter,
  type Rule, type Tradition,
} from './occasion-rules.js';
import {
  BUILTIN_OCCASIONS, TRADITION_PATTERNS, SKOROMNE_ROOTS, LEAN_EXCEPTIONS,
  isWindowRow, type OccasionRow, type WindowOccasion,
} from './occasion-data.js';

export { easterDate };
export type { Rule, Tradition };
export type { OccasionRow };

export interface Occasion {
  id: string;
  type: 'season' | 'tradition';
  title: string;
  meaning: string;
  buy?: string[];
  seeds?: string[];
  restricts?: string;
}

export interface UpcomingEvent {
  at: number;
  title: string;
  kind: 'season' | 'tradition';
  approx?: boolean;
}

export function traditionsFrom(wishes: string[] = []): Tradition[] {
  const text = wishes.join(' ');
  if (!text.trim()) return [];
  return TRADITION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}

/** Чи цей рядок узагалі показувати цьому дому. */
function visible(row: OccasionRow, trads: Tradition[]): boolean {
  return row.tradition ? trads.includes(row.tradition) : true;
}

/**
 * Що триває просто зараз. Сезони — для всіх; свята — лише за розпізнаною
 * традицією. Рухомі йдуть перед фіксованими: обмеження має потрапити в блок
 * раніше за привід, і порядок масиву це задає.
 */
export function activeOccasions(
  date = new Date(),
  trads: Tradition[] = [],
  rows: OccasionRow[] = BUILTIN_OCCASIONS,
): Occasion[] {
  return rows.filter(
    (r): r is WindowOccasion => isWindowRow(r) && visible(r, trads) && ruleActive(r.rule, date, trads),
  );
}

/** Що попереду в межах горизонту (днів). Сортовано за датою. */
export function upcomingEvents(
  from = new Date(),
  trads: Tradition[] = [],
  horizonDays = 21,
  rows: OccasionRow[] = BUILTIN_OCCASIONS,
): UpcomingEvent[] {
  const now = from.getTime();
  const until = now + horizonDays * DAY;
  const out: UpcomingEvent[] = [];
  const push = (at: number | null, title: string, kind: 'season' | 'tradition', approx = false) => {
    if (at !== null && at > now && at <= until) out.push({ at, title, kind, approx });
  };

  const windows = rows.filter(isWindowRow).filter((r) => visible(r, trads));
  const anchors = rows.filter((r) => !isWindowRow(r)).filter((r) => visible(r, trads));

  const y = from.getFullYear();
  for (const year of [y, y + 1]) {
    for (const pass of [windows.filter((r) => r.rule.t === 'window'), windows.filter((r) => r.rule.t === 'easter')]) {
      for (const r of pass) {
        const w = ruleWindow(r.rule, year, trads);
        if (!w) continue;
        if (r.upcomingTitle) {
          // Рухоме свято йде в стрічку тільки початком: «Великдень — останні
          // дні» не означає нічого.
          push(w.start, r.upcomingTitle, r.type);
          continue;
        }
        push(w.start, `${r.title} — починається`, r.type);
        // Сезон, що закінчується, — сильніший привід за сезон, що триває.
        push(w.end, `${r.title} — останні дні`, r.type);
      }
    }
  }
  for (const r of anchors) {
    for (let k = 0; k < 3; k++) push(anchorAt(r.rule, k), r.title, r.type, true);
  }

  return out.sort((a, b) => a.at - b.at);
}

export function whenLabel(at: number, now = Date.now()): string {
  const d = Math.round((at - now) / DAY);
  if (d <= 0) return 'сьогодні';
  if (d === 1) return 'завтра';
  if (d < 7) return `за ${d} дні`;
  if (d < 14) return 'за тиждень';
  if (d < 45) {
    const w = Math.round(d / 7);
    return `за ${w} ${w < 5 ? 'тижні' : 'тижнів'}`;
  }
  return new Date(at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

/**
 * Блок для системного промпта. Порожній рядок, коли нічого не відбувається —
 * не витрачаємо токени на «сьогодні нічого особливого».
 */
export function serializeOccasions(
  now = new Date(),
  wishes: string[] = [],
  rows: OccasionRow[] = BUILTIN_OCCASIONS,
): string {
  const trads = traditionsFrom(wishes);
  const act = activeOccasions(now, trads, rows);
  const soon = upcomingEvents(now, trads, 21, rows).slice(0, 4);
  if (!act.length && !soon.length) return '';

  const parts: string[] = [];
  // Обмеження — окремо й першими. Поки вони стояли в одному абзаці з сезоном
  // грибів, спільна приписка «привід, а не обовʼязок» поширювалась і на них.
  const restricting = act.filter((o) => o.restricts);
  if (restricting.length) {
    // Формулювання «тверда межа, як алергія» тягнуло за собою й алергічний
    // сценарій розмови: модель починала перепитувати замість пропонувати.
    // Обмежуємо зміст пропозиції, а не спосіб розмови.
    parts.push('ТРИВАЄ ОБМЕЖЕННЯ (людина сама сказала, що дотримується). Будуй пропозиції так,'
      + ' ніби переліченого просто немає в коморі — не питай дозволу й не пропонуй порушити.'
      + ' Це сильніше за порятунок: відкриті вершки чи мʼясо, що догоряє, в такі дні не рятують стравою'
      + ' — запропонуй заморозити одним реченням, і все:\n'
      + restricting.map((o) => `${o.title}: ${o.restricts}`).join('\n'));
  }
  if (act.length) {
    parts.push('ЗАРАЗ: ' + act.map((o) =>
      `${o.title} — ${o.meaning}${o.buy?.length ? ` Варто докупити: ${o.buy.join(', ')}.` : ''}`
    ).join('\n'));
  }
  // QA7-02: без цього блок із розпізнаною традицією побайтово збігався з
  // блоком без неї (найближче свято — за межами 21-денного горизонту), і
  // модель на пряме «Коли Великдень?» відповідала «ще не розпізнано», а потім
  // вигадувала дати. Ключові дати року — завжди, коли традиція відома.
  if (trads.length) {
    const y = now.getFullYear();
    const fmt = (dt: Date) => dt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
    const anchors: string[] = [];
    for (const t of trads) {
      if (t !== 'orthodox' && t !== 'catholic') continue;
      const label = t === 'catholic' ? 'католицький' : 'православний';
      for (const yr of [y, y + 1]) {
        const e = easterDate(yr, t);
        if (e.getTime() < now.getTime() && yr === y) continue;  // торішній не потрібен
        const lent = new Date(e);
        lent.setDate(lent.getDate() - 48);
        anchors.push(`Великдень ${yr} (${label}) — ${fmt(e)}; Великий піст — з ${fmt(lent)}`);
      }
    }
    // Місячні — тільки з позначкою орієнтовності; губити її не можна.
    // Кожен якір — тільки найближче майбутнє входження: шість рядків Рамадану
    // на два роки вперед — це шум, а не памʼять.
    for (const r of rows) {
      if (isWindowRow(r) || !visible(r, trads)) continue;
      const at = nextAnchorAfter(r.rule, now.getTime());
      if (at === null) continue;
      const mark = r.rule.t === 'lunar' ? 'орієнтовно, місячний календар' : 'орієнтовно';
      anchors.push(`${r.title} — ${fmt(new Date(at))} ${new Date(at).getFullYear()} (${mark})`);
    }
    if (anchors.length) {
      parts.push('КЛЮЧОВІ ДАТИ (пораховані точно, називай упевнено; «орієнтовно» переказуй як орієнтовно):\n'
        + anchors.join('\n'));
    }
  }
  if (soon.length) {
    parts.push('ПОПЕРЕДУ: ' + soon.map((e) =>
      `${whenLabel(e.at, now.getTime())}: ${e.title}${e.approx ? ' (орієнтовно, місячний календар)' : ''}`
    ).join('; '));
  }
  return '\n\n[СЕЗОН І СВЯТА]\n' + parts.join('\n')
    + '\nСезони й свята — привід, а не обовʼязок: згадуй лише коли доречно, одним реченням усередині відповіді.'
    + ' Не починай розмову з календаря. Дати, яких тут немає, не вигадуй — скажи, що не знаєш.'
    + ' Ніколи не описуй, як улаштована твоя памʼять: ні «розпізнається», ні «заповнюється», ні «прийде автоматично» — людині це нічого не дає й звучить як відмовка.'
    + ' Обмеження вище — виняток: воно діє, поки триває, і не залежить від доречності.';
}

// ── Механічна гвардія посту ─────────────────────────────────────────────────
// Мітка прямо в рядку партії, куди модель дивиться, коли добирає страви.
// Промпт посилювали двічі й це не спрацювало; механізм спрацював.

/** Чи ця назва — скоромне (для мітки в коморі під час посту). */
export function isFastingRestricted(label: string): boolean {
  if (LEAN_EXCEPTIONS.test(label)) return false;
  return SKOROMNE_ROOTS.test(label);
}

/** Чи просто зараз триває піст для розпізнаної традиції. */
export function fastingActive(
  now: Date,
  wishes: string[],
  rows: OccasionRow[] = BUILTIN_OCCASIONS,
): boolean {
  const trads = traditionsFrom(wishes);
  return activeOccasions(now, trads, rows).some((o) => o.restricts);
}
