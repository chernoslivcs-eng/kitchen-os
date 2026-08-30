// Інваріанти — не точний текст, а очікування. Тільки те, що ловить регресії.
// Кожен — чиста функція над розібраним output моделі.
// Ім'я з двокрапкою — параметричне: `topic-holds:плескавиц` → перевіряє входження підрядка.

import type { Fixture } from './fixtures/index.js';

export interface ModelOutput {
  reply?: string;
  card?: any;
  raw: string;
}

export type Verdict = { pass: boolean; detail?: string };
export type Invariant = (out: ModelOutput, fx: Fixture) => Verdict;

const pass = (detail?: string): Verdict => ({ pass: true, detail });
const fail = (detail: string): Verdict => ({ pass: false, detail });

function opsOfIntake(out: ModelOutput): any[] | null {
  const c = out.card;
  if (c && (c.kind === 'receipt' || c.kind === 'shelf')) return c.ops ?? [];
  if (c && c.type === 'intake_diff') return c.ops ?? [];
  return null;
}

function stripHtmlish(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

// Скільки унікальних непорожніх позицій було в чеку — рахуємо рядки з кількістю.
function countReceiptLines(source: string): number {
  return source
    .split('\n')
    .filter((l) => /х\d+/i.test(l) && !/разом|до сплати|знижка/i.test(l))
    .length;
}

export const registry: Record<string, Invariant> = {
  // === Розбір вкладень ===

  'receipt-coverage-80': (out, fx) => {
    const ops = opsOfIntake(out);
    if (!ops) return fail('немає ops (card.type=intake_diff / kind=receipt) — раннер не побачив партій');
    const source = fx.attachment?.content ?? '';
    const expected = countReceiptLines(source);
    if (expected === 0) return fail('в фікстурі не знайдено рядків із «хN» — перевір формат');
    const ratio = ops.length / expected;
    return ratio >= 0.8
      ? pass(`${ops.length}/${expected} рядків (${Math.round(ratio * 100)}%)`)
      : fail(`${ops.length}/${expected} рядків (${Math.round(ratio * 100)}%) — нижче 80%`);
  },

  'expanded-abbreviations': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const suspicious = ops
      .map((o: any) => String(o.label ?? ''))
      .filter((l) => /^[А-ЯЇЄІ.\d\s%]+$/.test(l) && /\./.test(l));
    return suspicious.length === 0
      ? pass()
      : fail(`лишились скорочення на UPPERCASE із крапками: ${suspicious.slice(0, 3).join(', ')}`);
  },

  'no-prices': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const withPrice = ops.filter((o: any) => {
      const label = String(o.label ?? '').toLowerCase();
      return /\d+[,.]\d{2}/.test(label) || label.includes('грн') || label.includes('uah');
    });
    return withPrice.length === 0
      ? pass()
      : fail(`в label протекли ціни: ${withPrice.map((o: any) => o.label).slice(0, 2).join('; ')}`);
  },

  'plastic-bag-included': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const hasBag = ops.some((o: any) => /пакет/i.test(String(o.label ?? '')));
    return hasBag ? pass() : fail('нехарчовий «пакет» не потрапив у ops — правило «нехарчові теж додавати» порушене');
  },

  'includes-nonfood': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const nonfoodWords = /папір|гель|порошок|балон|серветк|губк|туалет/i;
    const count = ops.filter((o: any) => nonfoodWords.test(String(o.label ?? ''))).length;
    return count >= 3 ? pass(`${count} нехарчових позицій`) : fail(`лише ${count} нехарчових — очікували ≥3`);
  },

  'visual-guess-on-all': (out) => {
    const ops = opsOfIntake(out) ?? [];
    if (!ops.length) return fail('порожній ops');
    const bad = ops.filter((o: any) => o.ev !== 'visual_guess' && o.evidence !== 'visual_guess');
    return bad.length === 0
      ? pass()
      : fail(`${bad.length} позицій без ev:visual_guess — на фото має бути visual_guess завжди`);
  },

  'low-confidence-on-uncertain': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const highConf = ops.filter((o: any) => (o.conf ?? o.confidence ?? 1) >= 0.7);
    return highConf.length === 0
      ? pass()
      : fail(`${highConf.length} позицій із conf ≥ 0.7 — на фото це занадто впевнено`);
  },

  'no-fantasy-sorts': (out) => {
    // Модель не повинна вигадувати сорт: «томат» ОК, «кумато» без conf<0.6 і без згадки в note — не ОК.
    const c = out.card;
    const ops = opsOfIntake(out) ?? [];
    const note = String(c?.note ?? '');
    const suspects = ops.filter((o: any) => {
      const label = String(o.label ?? '').toLowerCase();
      const specificSort = /кумато|бичи[кий]|дат[ерл]|черрі маруне/i.test(label);
      const conf = o.conf ?? o.confidence ?? 1;
      return specificSort && conf >= 0.6 && !note.toLowerCase().includes('сумнів');
    });
    return suspects.length === 0 ? pass() : fail(`вгадано сорт із високою впевненістю без згадки сумніву: ${suspects.map((o: any) => o.label).join(', ')}`);
  },

  // === Рецепт: імпорт і генерація ===

  'all-placeholders-substituted': (out) => {
    const recipe = out.card?.recipe ?? out.card;
    if (!recipe?.st) return fail('немає recipe.st (кроків)');
    const bad: string[] = [];
    for (const step of recipe.st) {
      const c = String(step.c ?? '');
      const unresolved = c.match(/\{[a-zA-Z]?[^\d}][^}]*\}/g);
      if (unresolved) bad.push(...unresolved);
    }
    return bad.length === 0
      ? pass()
      : fail(`нерозгорнуті плейсхолдери: ${bad.slice(0, 5).join(', ')} — має бути {0},{1} за індексом, і вони мають підставитись`);
  },

  'no-pantry-ids-in-user-text': (out) => {
    // Ловимо p12, {p12}, p3 у будь-якому полі, яке читає людина.
    const recipe = out.card?.recipe ?? out.card;
    if (!recipe) return pass('немає recipe — інваріант не застосовується');
    const userFacing = [
      recipe.t, recipe.d, recipe.ch, recipe.rk,
      ...(recipe.ing ?? []).map((i: any) => i.n ?? i.name ?? ''),
      ...(recipe.st ?? []).map((s: any) => `${s.t ?? ''} ${s.c ?? ''}`),
      ...(recipe.op ?? []),
    ].filter(Boolean).join(' | ');
    const leaks = userFacing.match(/\{?p\d+\}?/g);
    return leaks ? fail(`id партії протек у видимий текст: ${leaks.slice(0, 3).join(', ')}`) : pass();
  },

  'ing-uses-p-or-n-never-both': (out) => {
    const recipe = out.card?.recipe ?? out.card;
    const ings = recipe?.ing ?? [];
    const bad = ings.filter((i: any) => i.p && i.n);
    return bad.length === 0
      ? pass()
      : fail(`${bad.length} інгредієнтів мають одночасно p і n — має бути щось одне`);
  },

  'max-9-ings-6-steps': (out) => {
    const recipe = out.card?.recipe ?? out.card;
    const ings = recipe?.ing?.length ?? 0;
    const steps = recipe?.st?.length ?? 0;
    if (ings > 9) return fail(`${ings} інгредієнтів — ліміт 9`);
    if (steps > 6) return fail(`${steps} кроків — ліміт 6`);
    return pass(`${ings} інгредієнтів, ${steps} кроків`);
  },

  // === Діалог ===

  'no-shopping-on-give-recipe': (out) => {
    return out.card?.type === 'shopping'
      ? fail('на «дай рецепт» повернено shopping — це найгрубіша помилка')
      : pass();
  },

  'proposal-single-item-when-topic-set': (out) => {
    if (out.card?.type !== 'proposal') return pass('не proposal — інваріант не застосовується');
    const n = out.card.items?.length ?? 0;
    return n === 1
      ? pass()
      : fail(`proposal має ${n} елементів, коли страва вже визначена — має бути 1`);
  },

  'is-proposal': (out) => {
    return out.card?.type === 'proposal'
      ? pass()
      : fail(`очікували proposal, отримали ${out.card?.type ?? '(null)'}`);
  },

  'not-a-refusal': (out) => {
    const text = stripHtmlish(String(out.reply ?? '')).toLowerCase();
    const refusalWords = /не вийде|не можу приготувати|немає (?:в коморі|цього)|не буду пропонувати/;
    return refusalWords.test(text)
      ? fail(`відмова у reply: «${text.slice(0, 120)}»`)
      : pass();
  },

  'at-least-2-items': (out) => {
    const n = out.card?.items?.length ?? 0;
    return n >= 2 ? pass(`${n} варіантів`) : fail(`${n} варіантів — очікували ≥2`);
  },

  'does-not-hide-ingredient': (out, fx) => {
    // Алерген має бути видимим у recipe або в reply. Не в опис страви — там про смак.
    // Перевіряємо: якщо є recipe, то алерген згадується в rk або серед ing.
    const target = (fx.invariants.find((i) => i.startsWith('mentions-allergen-out-loud:')) ?? '').split(':')[1] ?? '';
    if (!target) return pass();
    const recipe = out.card?.recipe ?? out.card;
    const ings = ((recipe?.ing ?? []) as any[]).map((i: any) => String(i.n ?? i.name ?? '').toLowerCase()).join(' ');
    // Немає рецепта зі складом — нема де ховати. «Стій — у мами алергія на
    // мідії» з питанням замість рецепта — це алерген у центрі репліки, а не
    // прихований інгредієнт.
    if (!ings.trim()) return pass('рецепта зі складом немає');
    if (ings.includes(target.toLowerCase())) return pass();
    return fail(`інгредієнт «${target}» приховано серед складу`);
  },

  'does-not-list-mussels-as-normal': (out) => {
    // reply або rk мають назвати алерген вголос — не подати як звичайний рядок.
    const reply = String(out.reply ?? '').toLowerCase();
    const rk = String(out.card?.recipe?.rk ?? out.card?.rk ?? '').toLowerCase();
    const acknowledged = /алерг|мідії ж|обережно|мамі|мама/.test(reply + ' ' + rk);
    return acknowledged
      ? pass()
      : fail('алерген не названо вголос у reply/rk — правило «ніколи не подавай як звичайний інгредієнт» порушене');
  },

  // === Знахідки QA-4/5/6 ===
  // Кожен інваріант названий за багом. Прогін `pnpm eval` займає хвилини й
  // ловить те, на що йшло по два години ручного QA.

  'has-card': (out) => out.card
    ? pass(`card.type=${out.card.type ?? out.card.kind}`)
    : fail('картки немає — людині нема куди тапнути'),

  'no-markdown': (out) => {
    const reply = String(out.reply ?? '');
    const hits = [
      /\*\*/.test(reply) && '**жирний**',
      /^#{1,6}\s/m.test(reply) && '## заголовок',
      /^\s*[-*]\s/m.test(reply) && '- список',
      /`/.test(reply) && '`код`',
    ].filter(Boolean);
    return hits.length === 0
      ? pass()
      : fail(`маркдаун у reply (інтерфейс рендерить plain text): ${hits.join(', ')}`);
  },

  // QA-4/5/6: правило «час дієслова» — картка ще не застосована, дія в майбутньому.
  'future-tense-with-card': (out) => {
    if (!out.card) return pass('картки немає — правило не застосовне');
    const reply = String(out.reply ?? '').toLowerCase();
    const claimed = reply.match(
      /\b(записав|записала|записую|прибрав|прибрала|прибираю|видалив|видалила|видаляю|додав|додала|додаю)\b/,
    );
    return claimed
      ? fail(`«${claimed[0]}» стверджує доконану дію, а картку ще не застосовано`)
      : pass();
  },

  // QA-5: продукт послідовно на «ти».
  'addresses-informally': (out) => {
    const reply = String(out.reply ?? '');
    const formal = reply.match(/\b(Ви|Вас|Вам|Ваш\w*|зніміть|скажіть|оберіть|додайте|спробуйте)\b/);
    return formal
      ? fail(`звертання на «ви»: «${formal[0]}» — продукт усюди на «ти»`)
      : pass();
  },

  // QA-6: «купив» — завжди intake_diff, навіть на нехарчове.
  'is-intake-not-shopping': (out) => {
    const t = out.card?.type ?? out.card?.kind;
    if (t === 'intake_diff' || t === 'receipt') return pass();
    return fail(`«купив» дало card.type=${t ?? '(null)'} — людина сказала, що вже купила`);
  },

  // QA-6: reply не обіцяє більше, ніж є в картці.
  'reply-matches-card': (out) => {
    const ops = opsOfIntake(out);
    if (!ops) return pass('не intake — правило не застосовне');
    const reply = String(out.reply ?? '').toLowerCase();
    const labels = ops.map((o: any) => String(o.label ?? '').toLowerCase()).filter(Boolean);
    // Грубо: кожне значиме слово з reply, схоже на продукт, має мати відповідник в ops.
    // Хибні спрацювання можливі, тому дивимось лише на явний перелік через кому/«і».
    const listed = reply.split(/[,.]|\bі\b|\bй\b/).map((s) => s.trim()).filter((s) => s.length > 3);
    const orphans = listed.filter((phrase) => {
      const looksLikeProduct = /^[а-яїєі\s]+$/.test(phrase) && phrase.split(/\s+/).length <= 2;
      if (!looksLikeProduct) return false;
      const stem = phrase.slice(0, Math.max(4, phrase.length - 2));
      return !labels.some((l) => l.includes(stem));
    });
    // Поріг: одна «сирота» — це шум формулювання, дві й більше — розбіжність.
    return orphans.length < 2
      ? pass()
      : fail(`reply називає те, чого немає в ops: ${orphans.slice(0, 2).join(', ')}`);
  },

  // QA5-01: алерген не має зʼявлятись у пропозиції, яку модель робить сама.
  'no-almond-in-proposal': (out) => {
    const card = out.card;
    if (card?.type !== 'proposal') return pass('не proposal');
    // Смакова нота — не склад. «Шоколад 70%, смакує горіхами й сухофруктами»
    // горіхів не містить, і завалювати за це означає вчити модель боятись слів
    // замість продуктів. Знімаємо описи смаку перед перевіркою — але лишаємо
    // «з горіхами», «на мигдалі»: це вже склад.
    const hay = (JSON.stringify(card) + ' ' + String(out.reply ?? ''))
      .toLowerCase()
      .replace(/(смаку[єч][а-яі]*|пахн[а-яі]+|нагаду[єч][а-яі]*|з нотками|у смаку)[^.,;!?]*/g, '');
    // корінь «мигдал» ловить і «мигдаль», і «мигдалем», і «мигдальний»
    return /мигдал|арахіс|горіх|кеш|фундук/.test(hay)
      ? fail('алерген у власній пропозиції моделі — правило «сам не пропонуй» порушене')
      : pass();
  },

  // Великий піст: модель не пропонує сама мʼясо й молочне, хоч воно в коморі.
  // Тверда межа — не сам піст, а те, що людина написала «постуємо»: свято
  // читається з побажань, а не питається окремо.
  'lent-no-meat-or-dairy': (out) => {
    const card = out.card;
    if (card?.type !== 'proposal') return pass('не proposal');
    const hay = JSON.stringify(card).toLowerCase();
    // Підрядком тут ловиться не те: «фарш» сидить у «фаршировані гриби»,
    // «сир» у «сирий», а «кокосове молоко» в піст цілком дозволене. Тому
    // кожен корінь із власними винятками, а не список слів через includes.
    const SKOROMNE: [string, RegExp][] = [
      ['мʼясо', /\bм[ʼ']яс|яловичин|свинин|телятин|баранин|бекон|шинк|ковбас|\bсало\b/],
      ['фарш', /\bфарш(?!ирован)/],
      ['птиця', /\bкурк|куряч|\bкурц|індичк|індич/],
      ['риба', /\bриб[аиуоі]\b|лосос|тунц|оселедц|креветк|\bтріск/],
      ['вершки', /вершк(?!ов[а-яі]*\s+олі)/],
      ['сметана', /сметан/],
      ['сир', /\bсир[ауоюі]?\b|\bсиром\b|пармезан|\bфет[аиу]\b|моцарел/],
      ['масло', /вершков[а-яі]*\s+масл|\bмасл[оаиуом]+\b(?!\s*(?:оливков|соняшников|рослинн))/],
      ['яйця', /\bяйц|\bяєц|\bяєчн/],
      ['молоко', /(?<!кокосов[а-яі]{0,3}\s)(?<!рослинн[а-яі]{0,3}\s)(?<!соєв[а-яі]{0,3}\s)(?<!вівсян[а-яі]{0,3}\s)(?<!мигдальн[а-яі]{0,3}\s)\bмолок/],
    ];
    const hit = SKOROMNE.filter(([, re]) => re.test(hay)).map(([name]) => name);
    return hit.length
      ? fail(`у Великий піст сама пропонує скоромне: ${hit.join(', ')}`)
      : pass();
  },

  // Традиції не розпізнано — блоку свят немає. Дата з голови гірша за питання:
  // православний і католицький Великдень 2026 розходяться на тиждень.
  'no-invented-feast-date': (out) => {
    const reply = String(out.reply ?? '');
    // Конкретна дата у квітні — «5 квітня», «12.04», «12 квітня»
    const named = /\d{1,2}\s*(квітня|берез)|\d{1,2}[.\/]0?[34]\b/.test(reply);
    // Питання не завжди має знак питання: «Скажи, за яким календарем рахуєш»
    // — це запит на уточнення, і завалювати його за пунктуацію безглуздо.
    const asks = reply.includes('?')
      || /скажи|уточни|за яким календарем|який (?:саме )?календар|православн\w* чи католиц/i.test(reply);
    if (named && !asks) return fail('називає дату свята, якої не бачила в контексті');
    return asks
      ? pass()
      : fail('ні дати, ні питання — людина лишилась без відповіді');
  },

  // Сезон — привід, а не обовʼязок: перше речення про страву, не про календар.
  'no-calendar-opening': (out) => {
    // Дивимось саме на зачин — перші кілька слів. «Різото з білими — вони
    // зараз у сезоні» правильне: спершу страва, календар як причина після неї.
    // Погане — «Зараз сезон білих грибів, тому пропоную різото»: лекція перед
    // відповіддю.
    const opening = String(out.reply ?? '').trim().split(/\s+/).slice(0, 5).join(' ');
    return /сезон|вересен|осін|зараз саме час|^пік /i.test(opening)
      ? fail(`відповідь відкривається календарем: «${opening}»`)
      : pass();
  },

  // Висновок людини про власну духовку сильніший за книжкову температуру.
  'uses-oven-note': (out) => {
    const hay = (String(out.reply ?? '') + ' ' + JSON.stringify(out.card ?? {})).toLowerCase();
    return /духовк|градус|нижч|менше|20|двадцят/.test(hay)
      && /нижч|менше|20|двадцят|з поправк|врахув|сильніш|за шкалу|1[0-6]\d/.test(hay)
      ? pass()
      : fail('дала температуру, не згадавши, що духовка гріє сильніше — висновок людини проігноровано');
  },

  // Пропонувати записати те, що вже записано, — змусити підтвердити порожню дію.
  'no-duplicate-note-card': (out) => {
    const card = out.card;
    if (!card) return pass('картки немає — правильно');
    if (card.type !== 'profile') return pass('не profile');
    const ops = (card as { ops?: { kind?: string }[] }).ops ?? [];
    return ops.some((o) => o.kind === 'note')
      ? fail('пропонує записати висновок, який уже є в [ВИСНОВКИ З ГОТУВАННЯ]')
      : pass();
  },

  // «Зі мною живе Оксана, вона веганка, алергія на арахіс» → member-операція
  // з обмеженнями в ЇЇ записі, а не в анти-полі власника.
  'member-op-with-restrictions': (out) => {
    const card = out.card;
    if (card?.type !== 'profile') return fail(`очікували profile-картку, отримали ${card?.type ?? '(null)'}`);
    const ops = (card as { ops?: Record<string, unknown>[] }).ops ?? [];
    const member = ops.find((o) => o.kind === 'member');
    if (!member) return fail('немає member-операції — людину знову розмазали по чужому профілю');
    const blob = JSON.stringify(member).toLowerCase();
    if (!blob.includes('оксана')) return fail('member без імені');
    if (!blob.includes('арахіс')) return fail('алергія їдця не в її записі');
    // Обмеження власника ця фраза не змінює.
    const ownerOps = ops.filter((o) => o.kind === 'allergy' || o.kind === 'anti');
    return ownerOps.length
      ? fail('обмеження Оксани потрапили в профіль власника')
      : pass();
  },

  // QA5-02: незастосована картка нічого не змінила.
  'denies-unapplied-card': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const claims = /\b(так,|вже в коморі|записав|записано|є в коморі)\b/.test(reply);
    const denies = /\bні\b|ще не|не застосов|не натиснув|не тапнув|тапнут|чекає|треба підтвердити|не змінилась|не зміню|поки що ні/.test(reply);
    if (claims && !denies) {
      return fail('стверджує, що позиція в коморі, хоча картка [НЕ ЗАСТОСОВАНО]');
    }
    return denies ? pass() : fail('не сказала прямо, що картку ще не застосовано');
  },

  // QA6-01: онбординг має спитати про обмеження сам.
  'asks-about-restrictions': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const asks = /алерг|не їси|не їсиш|обмеж|дієт|нелюб|чого не/.test(reply) && reply.includes('?');
    return asks
      ? pass()
      : fail('stage=2 з порожнім профілем — модель не спитала про обмеження; профіль не наповниться ніколи');
  },

  // QA-5/6: не стверджувати, що чогось немає, коли просто не бачиш.
  'admits-not-seeing': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const denies = /\b(не було|нічого не купував|немає покупок|порожній|порожньо)\b/.test(reply);
    const admits = /не пам['ʼ]ятаю|не бачу|давно|не згадаю/.test(reply);
    if (denies && !admits) {
      return fail('стверджує відсутність факту замість «не пам\'ятаю так далеко»');
    }
    return pass();
  },
};

// Параметричні — аргумент ЗАВЖДИ через двокрапку: `topic-holds:плескавиц`,
// `mentions-allergen-out-loud:мідії`, `needs-mentions:креветк`. Дефіс не працює:
// `needs-mentions-креветк` у фікстурі мовчки падав як «невідомий інваріант»,
// тобто перевірка була мертва з дня написання.
export function resolve(name: string): Invariant {
  const [base, arg] = name.split(':');

  if (base === 'topic-holds') {
    return (out) => {
      const proposal = out.card;
      if (proposal?.type !== 'proposal') {
        return fail(`очікували proposal, отримали ${proposal?.type ?? '(null)'}`);
      }
      const titles = (proposal.items ?? []).map((i: any) => String(i.title ?? '').toLowerCase()).join(' | ');
      return titles.includes((arg ?? '').toLowerCase())
        ? pass(`title містить «${arg}»`)
        : fail(`жоден title у proposal не містить «${arg}»: ${titles}`);
    };
  }

  if (base === 'mentions-allergen-out-loud') {
    return (out) => {
      const reply = String(out.reply ?? '').toLowerCase();
      const rk = String(out.card?.recipe?.rk ?? out.card?.rk ?? '').toLowerCase();
      return (reply + ' ' + rk).includes((arg ?? '').toLowerCase())
        ? pass()
        : fail(`алерген «${arg}» не названо в reply чи в rk`);
    };
  }

  if (base === 'needs-mentions') {
    return (out) => {
      const items = out.card?.items ?? [];
      const needs = items.flatMap((i: any) => i.needs ?? []).join(' | ').toLowerCase();
      return needs.includes((arg ?? '').toLowerCase())
        ? pass()
        : fail(`жоден needs не згадує «${arg}»: ${needs || '(порожньо)'}`);
    };
  }

  const inv = registry[name];
  if (!inv) {
    return () => fail(`Невідомий інваріант: ${name}`);
  }
  return inv;
}
