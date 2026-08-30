// Календар: сезони й свята.
//
// Це найдовший борг із прототипу. Промпт шість QA-прогонів обіцяв «Дати свят я
// порахую сам, розпізнавши традицію з фрази» — і нічого їх не рахувало. Модель
// відповідала на «коли Великдень» з голови, тобто вгадувала. QA тестувало
// функцію, якої не існувало.
//
// Два принципи, обидва з прототипу:
//
// 1. Традиція не окреме поле профілю, а висновок із побажань. Людина пише
//    «постуємо» або «дотримуємось халяль» — система впізнає й бере дати з
//    таблиці. Окреме питання «яка у вас конфесія?» продукт ставити не буде.
//
// 2. Свято — привід, а не обовʼязок. Блок іде в системний промпт як контекст,
//    із явною вказівкою згадувати лише коли доречно. Інакше асистент починає
//    кожну розмову з календаря, і це швидко бісить.

export type Tradition = 'orthodox' | 'catholic' | 'islamic' | 'jewish';

export interface Occasion {
  id: string;
  type: 'season' | 'tradition';
  title: string;
  meaning: string;
  buy?: string[];
  seeds?: string[];
  // Більшість подій — привід: сезон грибів нічого не забороняє. Але піст, поки
  // він триває, це обмеження тієї ж сили, що «не їм свинину»: людина сама
  // сказала, що його дотримується. Спільне формулювання «привід, а не
  // обовʼязок» знецінювало пост — модель у Великий піст пропонувала вершковий
  // суп-пюре, маючи блок посту прямо перед очима.
  restricts?: string;
}

export interface UpcomingEvent {
  at: number;
  title: string;
  kind: 'season' | 'tradition';
  approx?: boolean;
}

const DAY = 86400000;

// ── Пасхалія ────────────────────────────────────────────────────────────────
// Католицька — Meeus/Jones/Butcher. Православна — олександрійська пасхалія,
// порахована в юліанському й переведена в григоріанський (+13 діб; ця поправка
// вірна до 2100 року, далі стане +14).
export function easterDate(year: number, tradition: 'orthodox' | 'catholic'): Date {
  if (tradition === 'catholic') {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(year, month - 1, day);
  julian.setDate(julian.getDate() + 13);
  return julian;
}

// ── Місячні свята ───────────────────────────────────────────────────────────
// Ісламський рік ≈ 354.367 доби, тож дати дрейфують. Фактичний початок залежить
// від спостереження молодика — подаємо як орієнтир і завжди позначаємо approx,
// щоб модель не сказала точну дату там, де її ніхто не знає.
const ISLAMIC_ANCHORS = [
  { id: 'ramadan', title: 'початок Рамадану', base: Date.UTC(2026, 1, 18) },
  { id: 'eid-fitr', title: 'Ід аль-Фітр', base: Date.UTC(2026, 2, 20) },
  { id: 'eid-adha', title: 'Курбан-байрам', base: Date.UTC(2026, 4, 27) },
];
const LUNAR_YEAR = 354.367 * DAY;

const JEWISH_ANCHORS = [
  { id: 'pesach', title: 'Песах', base: Date.UTC(2026, 3, 2) },
  { id: 'rosh', title: 'Рош га-Шана', base: Date.UTC(2026, 8, 12) },
];

// ── Сезонні вікна й нерухомі свята ──────────────────────────────────────────
// `meaning` пишеться так, щоб модель могла процитувати його майже дослівно:
// це не довідка, а причина щось приготувати саме зараз.
const OCCASIONS: (Occasion & { from: string; to: string; tradition?: Tradition })[] = [
  {
    id: 'veg-peak', type: 'season', title: 'пік овочевого сезону',
    from: '07-15', to: '09-20',
    meaning: 'Томати, перець, баклажани, кабачки зараз найдешевші й найсмачніші за рік.',
    buy: ['баклажани', 'солодкий перець', 'томати на гілці', 'кабачки', 'свіжий базилік'],
    seeds: ['печені овочі з часником', 'капоната', 'аджапсандалі', 'томатний салат із базиліком'],
  },
  {
    id: 'melon', type: 'season', title: 'кавуни й дині',
    from: '08-01', to: '09-15',
    meaning: 'Короткий сезон. Диня добре йде з прошуто, кавун — із фетою й мʼятою.',
    buy: ['кавун', 'диня', 'фета', 'мʼята'],
    seeds: ['диня з прошуто', 'кавун з фетою і мʼятою'],
  },
  {
    id: 'mushroom', type: 'season', title: 'сезон білих грибів',
    from: '09-01', to: '10-31',
    meaning: 'Свіжі білі бувають кілька тижнів на рік. Найкраще розкриваються в різото, жульєні й паштеті.',
    buy: ['білі гриби', 'рис арборіо', 'вершки'],
    seeds: ['різото з білими', 'гриби в сметані', 'грибний крем-суп'],
  },
  {
    id: 'pumpkin', type: 'season', title: 'гарбузи й коренеплоди',
    from: '10-01', to: '11-30',
    meaning: 'Гарбуз, буряк, пастернак. Все, що добре запікається довго й повільно.',
    buy: ['гарбуз', 'пастернак', 'буряк'],
    seeds: ['запечений гарбуз із фетою', 'гарбузовий суп', 'печений буряк із горіхами'],
  },
  {
    id: 'xmas-eve', type: 'tradition', title: 'Святвечір', tradition: 'orthodox',
    from: '12-20', to: '12-24',
    meaning: 'Дванадцять пісних страв. Кутя, узвар, пісні вареники, риба, гриби.',
    buy: ['пшениця', 'мак', 'сухофрукти', 'мед', 'гриби сушені'],
    seeds: ['кутя', 'узвар', 'вареники з капустою', 'оселедець під шубою'],
  },
  {
    id: 'spas', type: 'tradition', title: 'Яблучний Спас', tradition: 'orthodox',
    from: '08-17', to: '08-21',
    meaning: 'Початок яблучного сезону. Печені яблука, шарлотки, яблука до мʼяса й сирів.',
    buy: ['яблука', 'мед', 'кориця'],
    seeds: ['печені яблука з медом', 'шарлотка', 'яблука до блакитного сиру'],
  },
];

// ── Розпізнавання традиції з побажань ───────────────────────────────────────
// Латиниця в патернах — бо люди пишуть і «postuemo», і «halal». Одна людина
// може мати кілька традицій: змішані сімʼї — норма, а не край.
const TRADITION_PATTERNS: { id: Tradition; re: RegExp }[] = [
  { id: 'orthodox', re: /пост|пісн|велик[ыi]?ден|паск|православ|кут[яі]|святвеч|piст|post|velykden|pravoslav/i },
  { id: 'catholic', re: /католиц|katolic|catholic/i },
  { id: 'islamic', re: /халял|рамадан|іслам|ислам|мусульман|курбан|ураза|halal|ramadan|islam|kurban/i },
  { id: 'jewish', re: /кошер|кашрут|песах|шабат|іудей|иудей|єврей|еврей|kosher|kashrut|pesah|pesach|shabat/i },
];

export function traditionsFrom(wishes: string[] = []): Tradition[] {
  const text = wishes.join(' ');
  if (!text.trim()) return [];
  return TRADITION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}

// Рухомі свята християнського циклу — вікнами навколо Великодня.
function movableOccasions(date: Date, trads: Tradition[]): Occasion[] {
  const trad = trads.includes('catholic') ? 'catholic' : trads.includes('orthodox') ? 'orthodox' : null;
  if (!trad) return [];
  const e = easterDate(date.getFullYear(), trad);
  const shift = (days: number) => {
    const d = new Date(e);
    d.setDate(d.getDate() + days);
    return d;
  };
  const inRange = (from: Date, to: Date) => date >= from && date <= to;
  const out: Occasion[] = [];
  if (inRange(shift(-55), shift(-49))) out.push({
    id: 'maslyana', type: 'tradition', title: 'Масниця',
    meaning: 'Тиждень перед постом. Млинці, налисники, вершкове й сирне — усе, що потім не можна.',
    buy: ['сметана', 'кисломолочний сир', 'масло'],
  });
  if (inRange(shift(-48), shift(-1))) out.push({
    id: 'lent', type: 'tradition', title: 'Великий піст',
    meaning: 'Привід зайти в бобові, гриби й крупи глибше, ніж зазвичай.',
    restricts: 'жодного мʼяса, риби, молочного і яєць — ні у стравах, ні в needs, ні в rescues, ні як альтернатива («пармезан — або без нього» — це теж пропозиція пармезану). Рослинні аналоги (кокосове молоко, тахіні) можна',
    buy: ['нут', 'сочевиця', 'гриби', 'тахіні', 'кокосове молоко'],
  });
  if (inRange(shift(0), shift(2))) out.push({
    id: 'easter', type: 'tradition', title: 'Великдень',
    meaning: 'Паска, крашанки, шинка, сирна паска. Після посту — навпаки, все найситніше.',
    buy: ['сир кисломолочний', 'яйця', 'шинка'],
  });
  return out;
}

/** Що триває просто зараз. Сезони — для всіх; свята — лише за розпізнаною традицією. */
export function activeOccasions(date = new Date(), trads: Tradition[] = []): Occasion[] {
  const md = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const fixed = OCCASIONS.filter((o) => {
    // Вікно може перетинати новий рік (12-20 → 01-07), тому дві гілки.
    const inWindow = o.from <= o.to
      ? md >= o.from && md <= o.to
      : md >= o.from || md <= o.to;
    if (!inWindow) return false;
    return o.tradition ? trads.includes(o.tradition) : true;
  });
  return [...movableOccasions(date, trads), ...fixed];
}

/** Що попереду в межах горизонту (днів). Сортовано за датою. */
export function upcomingEvents(from = new Date(), trads: Tradition[] = [], horizonDays = 21): UpcomingEvent[] {
  const now = from.getTime();
  const until = now + horizonDays * DAY;
  const out: UpcomingEvent[] = [];
  const push = (at: number, title: string, kind: 'season' | 'tradition', approx = false) => {
    if (at > now && at <= until) out.push({ at, title, kind, approx });
  };
  const yearOf = (md: string, y: number) => {
    const [m = 1, d = 1] = md.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };

  const y = from.getFullYear();
  for (const year of [y, y + 1]) {
    for (const o of OCCASIONS) {
      if (o.tradition && !trads.includes(o.tradition)) continue;
      push(yearOf(o.from, year), `${o.title} — починається`, o.type);
      // Сезон, що закінчується, — сильніший привід за сезон, що триває.
      push(yearOf(o.to, year), `${o.title} — останні дні`, o.type);
    }
    if (trads.includes('orthodox') || trads.includes('catholic')) {
      const trad = trads.includes('catholic') ? 'catholic' : 'orthodox';
      const e = easterDate(year, trad).getTime();
      push(e - 55 * DAY, 'починається Масниця', 'tradition');
      push(e - 48 * DAY, 'починається Великий піст', 'tradition');
      push(e, 'Великдень', 'tradition');
    }
  }
  if (trads.includes('islamic')) {
    for (const a of ISLAMIC_ANCHORS) {
      for (let k = 0; k < 3; k++) push(a.base + k * LUNAR_YEAR, a.title, 'tradition', true);
    }
  }
  if (trads.includes('jewish')) {
    for (const a of JEWISH_ANCHORS) {
      for (let k = 0; k < 3; k++) push(a.base + k * 365.25 * DAY, a.title, 'tradition', true);
    }
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
export function serializeOccasions(now = new Date(), wishes: string[] = []): string {
  const trads = traditionsFrom(wishes);
  const act = activeOccasions(now, trads);
  const soon = upcomingEvents(now, trads, 21).slice(0, 4);
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
      const label = t === 'catholic' ? 'катол.' : 'правосл.';
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
    if (trads.includes('islamic')) {
      for (const a of ISLAMIC_ANCHORS) {
        for (let k = 0; k < 4; k++) {
          const at = a.base + k * LUNAR_YEAR;
          if (at > now.getTime()) {
            anchors.push(`${a.title} — ${fmt(new Date(at))} ${new Date(at).getFullYear()} (орієнтовно, місячний календар)`);
            break;
          }
        }
      }
    }
    if (trads.includes('jewish')) {
      for (const a of JEWISH_ANCHORS) {
        for (let k = 0; k < 4; k++) {
          const at = a.base + k * 365.25 * DAY;
          if (at > now.getTime()) {
            anchors.push(`${a.title} — ${fmt(new Date(at))} ${new Date(at).getFullYear()} (орієнтовно)`);
            break;
          }
        }
      }
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
