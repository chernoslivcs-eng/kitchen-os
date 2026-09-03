// Як подія називає свій час у блоці «ЗАРАЗ».
//
// Двійник `whenLabel` із домену, а не імпорт: веб не залежить від
// @kitchen/domain (там серверні типи й Repo), і тягнути пакет заради однієї
// функції дорожче, ніж повторити двадцять рядків — так само вже зроблено з
// `plural`.
//
// Різниця з доменним не косметична. Домен відповідає на «за скільки це
// станеться», бо пише в промпт про майбутнє. Блок у навігації показує ще й те,
// що ТРИВАЄ, і для нього головне інше: коли воно закінчиться. Сезон грибів,
// який іде другий тиждень, нічого не змінює; сезон, у якого лишилось чотири
// дні, — змінює.

const DAY = 86_400_000;

/**
 * Різниця в КАЛЕНДАРНИХ днях, не в добах.
 *
 * Перша версія ділила мілісекунди й округляла — і подія завтра о 00:00 при
 * поточних 12:24 давала 0.48 доби, тобто «сьогодні». Живий прогін показав це
 * на «щопʼятниці риба»: найближча пʼятниця завтра, а сторінка казала
 * «сьогодні». Дата — це день, а не проміжок.
 */
function daysBetween(from: number, to: number): number {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

function short(at: number): string {
  return new Date(at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

/**
 * Подія, що триває, подається КІНЦЕМ, а не серединою: «до 31 жовт · ще 4
 * тижні», не «триває пік сезону». Те, що закінчується, змінює поведінку;
 * те, що просто триває, — ні.
 */
export function whenLabel(start: number, end: number, now = Date.now()): string {
  if (now >= start && now <= end) {
    const left = daysBetween(now, end);
    if (left <= 0) return 'останній день';
    if (left === 1) return 'до завтра';
    if (left < 7) return `ще ${left} ${plural(left, ['день', 'дні', 'днів'])}`;
    const w = Math.round(left / 7);
    return `до ${short(end)} · ще ${w} ${plural(w, ['тиждень', 'тижні', 'тижнів'])}`;
  }
  const d = daysBetween(now, start);
  if (d <= 0) return 'сьогодні';
  if (d === 1) return 'завтра';
  if (d < 7) return `за ${d} ${plural(d, ['день', 'дні', 'днів'])}`;
  if (d < 14) return 'за тиждень';
  if (d < 45) {
    const w = Math.round(d / 7);
    return `за ${w} ${plural(w, ['тиждень', 'тижні', 'тижнів'])}`;
  }
  return short(start);
}

/** Чи подія триває просто зараз — активні йдуть у блоці першими. */
export function isLive(start: number, end: number, now = Date.now()): boolean {
  return now >= start && now <= end;
}

/**
 * Підпис дати у стрічці «Попереду» профілю.
 *
 * Те, що триває, називається кінцем («ДО 31 ЖОВТ»); те, що попереду —
 * початком («24 ГРУД»). Орієнтовне несе «≈» просто в даті, а не приміткою
 * збоку: позначку губити не можна, і в тому ж рядку її не загубиш.
 */
export function ribbonDate(start: number, end: number, approx = false, now = Date.now()): string {
  const running = now >= start && now <= end;
  const at = running ? end : start;
  const d = new Date(at);
  const mon = d.toLocaleDateString('uk-UA', { month: 'short' }).replace('.', '').toUpperCase();
  const body = `${d.getDate()} ${mon}`;
  return `${approx ? '≈' : ''}${running ? 'ДО ' : ''}${body}`;
}

/** Сезон, у якого лишилось менше місяця, — привід; той, що просто триває, ні. */
export function endingSoon(start: number, end: number, now = Date.now()): boolean {
  return now >= start && now <= end && end - now < 28 * DAY;
}
