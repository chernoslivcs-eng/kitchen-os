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
    const ings = (recipe?.ing ?? []).map((i: any) => String(i.n ?? i.name ?? '').toLowerCase()).join(' ');
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
};

// Параметричні: `topic-holds:плескавиц`, `mentions-allergen-out-loud:мідії`, `needs-mentions-креветк`.
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
