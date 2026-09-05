// Інваріанти — не точний текст, а очікування. Тільки те, що ловить регресії.
// Кожен — чиста функція над розібраним output моделі.
// Ім'я з двокрапкою — параметричне: `topic-holds:плескавиц` → перевіряє входження підрядка.

import type { Fixture } from './fixtures/index.js';
import { applyMode, CARD_BUTTON_LABEL, buildVetoIndex, vetoCard, vetoRecipe, stripVetoMentions, matchVeto, resolveRecipeLabels, type Card, type VetoRow, type PantryBatch } from '@kitchen/domain';

// Індекс вето з фікстури: profile_text.no / .ban → buildVetoIndex (той самий
// витяг, що PATCH /v1/profile/:key у проді).
function vetoIndexOf(fx: Fixture): VetoRow[] {
  const pt = fx.profile_text ?? {};
  return [
    ...(pt.no && pt.no !== 'none' ? buildVetoIndex('u1', 'no', pt.no) : []),
    ...(pt.ban && pt.ban !== 'none' ? buildVetoIndex('u1', 'ban', pt.ban) : []),
  ];
}

export interface ModelOutput {
  reply?: string;
  card?: any;
  raw: string;
  /** Динамічний блок системного промпту, який пішов у модель (для інваріантів на вхід, не на вихід). */
  dynamic?: string;
}

export type Verdict = { pass: boolean; detail?: string };
export type Invariant = (out: ModelOutput, fx: Fixture) => Verdict;

const pass = (detail?: string): Verdict => ({ pass: true, detail });

// Крок 4в (2): службові позначки, які модель бачить в історії/контексті й не
// має переказувати в reply. Той самий список, що guard у model.ts.
const SERVICE_MARKER_RE = /\[(?:картка:|рецепт у стрічці|НЕ ЗАСТОСОВАНО|ЗАСТОСОВАНО|ВІДХИЛЕНО|СКАСОВАНО|ПРО ЛЮДИНУ|КОМОРА|НОТАТКИ|ОСТАННІ ДІЇ|СЬОГОДНІ|СПИСОК ПОКУПОК|ДОМАШНІ|ТРАДИЦІЇ|СЕЗОН І СВЯТА|ТВОЇ ПЛАНИ|РЕЖИМ|МЕРЕЖІ|СЕРВЕР)/;

// `\b` у JS — межа [A-Za-z0-9_]; кирилиця вся «поза словом», тож
// /\bні\b/.test('ні') === false. Кілька інваріантів через це місяцями або
// нічого не ловили, або валили правильні відповіді. Юнікодні межі вручну:
const LB = "(?<![а-щьюяіїєґА-ЩЬЮЯІЇЄҐʼ'])";
const RB = "(?![а-щьюяіїєґА-ЩЬЮЯІЇЄҐʼ'])";
const word = (w: string) => new RegExp(LB + w + RB);
const anyWord = (ws: string[]) => new RegExp(LB + '(?:' + ws.join('|') + ')' + RB, 'i');
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

// Скільки товарних позицій було в чеку. Два формати, бо обидва реальні:
//   · роздрукований список із маркером кількості — «СИР КАМБОЦ.70% 193Г х1»;
//   · паперовий касовий друк — маркера немає взагалі, рядок закінчується
//     ціною й літерою ставки: «Пакет18СільпоПакЗПак    9.99   A».
// Другий формат я спершу проґавив, і фікстура receipt-till-silpo впала не
// через модель, а через те, що інваріант не знайшов жодного рядка й вирішив,
// що фікстура зламана. Підсумкові рядки відсіюються за словами.
const SUMMARY = /разом|до сплати|знижка|підсумок|решта|готівка|картка|решто/i;
function countReceiptLines(source: string): number {
  return source
    .split('\n')
    .filter((l) => {
      if (SUMMARY.test(l)) return false;
      if (/х\d+/i.test(l)) return true;
      return /\d+[.,]\d{2}\s*[A-ZА-Я]?\s*$/.test(l.trim());
    })
    .length;
}

export const registry: Record<string, Invariant> = {
  // Крок 7 (3): резюме «Про тебе» (no-card — існуючий інваріант нижче).
  'summary-order-ban-then-no': (out, fx) => {
    const r = String(out.reply ?? '').toLowerCase();
    const pt = (fx.profile_text ?? {}) as Record<string, string>;
    const banAt = pt.ban ? r.indexOf(String(pt.ban).split(/[,;]/)[0]!.trim().toLowerCase().slice(0, 5)) : -1;
    const noAt = pt.no ? r.indexOf(String(pt.no).split(/[,;]/)[0]!.trim().toLowerCase().replace(/ʼ/g, '').slice(0, 3)) : -1;
    const noAt2 = pt.no ? r.replace(/ʼ|'/g, '').indexOf(String(pt.no).split(/[,;]/)[0]!.trim().toLowerCase().replace(/ʼ|'/g, '').slice(0, 3)) : -1;
    const noPos = noAt >= 0 ? noAt : noAt2;
    if (banAt < 0) return fail(`«не можна» (${pt.ban}) у резюме не згадано`);
    if (noPos < 0) return fail(`«не їм» (${pt.no}) у резюме не згадано`);
    return banAt < noPos ? pass(`ban@${banAt} < no@${noPos}`) : fail(`порядок: не їм (@${noPos}) раніше за не можна (@${banAt})`);
  },
  'summary-offers-pantry': (out) => {
    const r = String(out.reply ?? '');
    return /чек|фото|полиц|список|комор/i.test(r) ? pass() : fail(`без пропозиції почати з комори: «${r.slice(0, 160)}»`);
  },
  'summary-no-invented': (out, fx) => {
    const r = String(out.reply ?? '').toLowerCase();
    const pt = (fx.profile_text ?? {}) as Record<string, string>;
    const bad: string[] = [];
    if (!pt.ban && /алерг|не можна/.test(r)) bad.push('алергія/не можна');
    if (!pt.no && /не їси|не їш|веган|мʼяс|м'яс/.test(r)) bad.push('не їм');
    if (!pt.kit && /аерогриль|блендер|духовк|мультиварк/.test(r)) bad.push('техніка');
    if (!pt.love && /любиш|тягне/.test(r)) bad.push('любить');
    return bad.length ? fail(`вигадано: ${bad.join(', ')} — «${r.slice(0, 160)}»`) : pass();
  },
  // Крок 4в (2): у reply нема службових позначок історії/контексту.
  'reply-no-service-markers': (out) => {
    const hit = SERVICE_MARKER_RE.exec(String(out.reply ?? ''));
    return hit ? fail(`службова позначка в reply: «${hit[0]}»`) : pass();
  },
  // Крок 4в (2): «я веган» → розгорнутий перелік, не слово.
  'profile-text-expands-vegan': (out) => {
    const c = out.card;
    if (!c || c.type !== 'profile' || !c.field) return fail(`card.type=${c?.type ?? 'null'} — очікував картку поля`);
    const t = String(c.text ?? '').toLowerCase();
    const want = [/мʼяс|м'яс/, /риб/, /яєц|яйц/, /молоч/];
    const missing = want.filter((re) => !re.test(t));
    return missing.length ? fail(`text «${c.text}» не розгортає: бракує ${missing.length} з 4 груп`) : pass(c.text);
  },
  // Крок 4в (4): відповідь без зустрічного питання.
  'reply-no-question': (out) => {
    const r = String(out.reply ?? '');
    return r.includes('?') ? fail(`питання в reply: «${r}»`) : pass();
  },
  // Крок 4в (1): reply одним реченням каже про «не їм» (людина просить сама).
  'reply-mentions-no-eat': (out) => {
    const r = String(out.reply ?? '');
    return /не їси|не їш|не їсте|не їмо|не для тебе|якщо не собі/i.test(r) ? pass() : fail(`reply без згадки «не їси»: «${r.slice(0, 160)}»`);
  },
  // Раунд 4 §9, крок 4: вето по індексу з profile_text (no/ban). Перевірка
  // «жодного мʼясного кандидата» — через саме вето, не через текст: пройдено,
  // коли після вето лишився хоч один кандидат (модель або сама не запропонувала
  // заборонене, або вето його зняло, а решта жива). detail — лог вето.
  'veto-survivors': (out, fx) => {
    const index = vetoIndexOf(fx);
    if (!index.length) return fail('індекс порожній — profile_text без no/ban?');
    const c = out.card;
    if (c?.type === 'proposal') {
      const userText = [...(fx.conversation ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
      const call = { card: JSON.parse(JSON.stringify(c)) as Card, reply: out.reply ?? '' };
      const r = vetoCard(call, index, userText);
      const log = r.rejected.map((x) => `${x.title} ← ${x.ingredient} [${x.rows.map((w) => `${w.field}:${w.kind}:${w.ref}`).join(', ')}]`);
      if (r.emptied) return fail(`вето зняло всі кандидати: ${log.join('; ')}`);
      return pass(r.rejected.length ? `вето зняло ${r.rejected.length}: ${log.join('; ')}` : 'вето не спрацювало — модель сама не пропонувала');
    }
    const rawRecipe = c?.recipe ?? (c && c.t && c.ing ? c : null);
    if (rawRecipe) {
      // Інгредієнт із комори — `p` без `n`; резолвимо назви по коморі
      // фікстури, як прод по живій (resolveRecipeLabels), інакше «рибний
      // соус» із комори невидимий для вето. Саме так фікстура впала вперше.
      const recipe = resolveRecipeLabels(rawRecipe, (fx.pantry ?? []) as PantryBatch[]);
      const hits = vetoRecipe(recipe, index);
      return hits.length
        ? fail(`рецепт зачепив індекс: ${hits.map((h) => `${h.ingredient} [${h.row.field}:${h.row.kind}:${h.row.ref}]`).join('; ')}`)
        : pass(`${(recipe.ing ?? []).length} інгредієнтів чисті`);
    }
    return fail(`card.type=${c?.type ?? 'null'} — ні proposal, ні recipe`);
  },
  // Рядок з allergy=true: після серверної зачистки репліка не згадує алерген,
  // якого людина сама не називала, і не порожня. Перевіряється результат
  // конвеєра (як і veto-survivors), а не сира репліка: що саме вирізано —
  // у detail, це сигнал про промпт, не провал продукту.
  'veto-reply-clean': (out, fx) => {
    const index = vetoIndexOf(fx);
    const userText = [...(fx.conversation ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
    const call = { card: JSON.parse(JSON.stringify(out.card ?? null)) as Card | null, reply: out.reply ?? '' };
    vetoCard(call, index, userText);
    const r = stripVetoMentions(call, index, userText);
    if (!(call.reply ?? '').trim() && !call.card) return fail('після вето й зачистки не лишилось ні картки, ні репліки');
    if (matchVeto(call.reply ?? '', index.filter((x) => x.allergy)).length) return fail(`алерген лишився в репліці: «${call.reply}»`);
    return pass(r.stripped.length ? `сервер вирізав ${r.stripped.length}: «${r.stripped[0]}»` : 'модель сама не згадала');
  },
  // meh — не вето, а нахил: мʼяка перевірка, більшість варіантів без мʼяса.
  'mostly-meatless': (out) => {
    const c = out.card;
    if (c?.type !== 'proposal' || !Array.isArray(c.items)) return fail(`card.type=${c?.type ?? 'null'}`);
    const meat = /мʼяс|м'яс|стейк|свинин|ялович|курк|куряч|курч|індич|бекон|ковбас|котлет|фарш|барани|телятин/i;
    const meaty = c.items.filter((it: { title?: string; desc?: string; rescues?: string[] }) =>
      meat.test([it.title, it.desc, ...(it.rescues ?? [])].join(' ')));
    return meaty.length * 2 <= c.items.length
      ? pass(`${c.items.length - meaty.length}/${c.items.length} без мʼяса`)
      : fail(`мʼясних ${meaty.length}/${c.items.length}: ${meaty.map((m: { title: string }) => m.title).join(', ')}`);
  },
  // Раунд 4 §9 profile-verbatim: текст кожного заповненого поля стоїть у
  // промті ДОСЛІВНО, після свого початку речення. Інваріант на ВХІД моделі:
  // саме серіалізація, а не переказ, — обіцянка контракту.
  'profile-verbatim': (out, fx) => {
    const spec = (fx.profile_text ?? {}) as Record<string, string>;
    const dyn = out.dynamic ?? '';
    if (!dyn.includes('[ПРО ЛЮДИНУ — її власні слова]')) return fail('блоку [ПРО ЛЮДИНУ] у промті немає (PROFILE_V2 вимкнено?)');
    const leads: Record<string, string> = {
      name: 'Мене звати', no: 'Я не їм', ban: 'Мені не можна', love: 'Я люблю',
      meh: 'Я не дуже люблю', kit: 'У мене на кухні є', when: 'Я зазвичай готую',
    };
    for (const [k, v] of Object.entries(spec)) {
      const want = v === 'none' ? `${leads[k]} — нічого такого.` : `${leads[k]} ${v.replace(/\.+$/, '')}.`;
      if (!dyn.includes(want)) return fail(`поле ${k}: у промті немає рядка «${want}»`);
    }
    return pass(`${Object.keys(spec).length} полів дослівно`);
  },
  // Пул-4 №4б/в: генерація з хвостом розмови.
  'recipe-returned': (out) => {
    const c = out.card;
    const r = c?.recipe ?? (c && c.t && c.ing ? c : null);
    return r ? pass(r.t) : fail(`рецепта немає — модель відповіла прозою: ${String(out.reply ?? out.raw).slice(0, 120)}`);
  },
  'no-rice-interrogation': (out) => {
    const hay = String(out.reply ?? '') + String(out.raw ?? '');
    const hit = /рис.{0,30}(є\?|у тебе|в тебе|маєш)/i.exec(hay);
    return hit ? fail(`перепитує вже вирішене: «${hit[0]}»`) : pass();
  },
  'no-alias-leak': (out) => {
    const hay = String(out.reply ?? out.raw ?? '');
    const hit = /\(?[pр]\d{1,3}\)?/i.exec(hay.replace(/"[pр]\d+"/g, ''));   // JSON-поля p1 — легальні
    return hit && !/"/.test(hit[0]) ? fail(`аліас протік у текст: «${hit[0]}»`) : pass();
  },

  // Чек Сільпо: вагові рядки «0.114 X 899.00» — вага в кг × ціна/кг.
  // Вага мусить стати value у ГРАМАХ (114/502/488), ціна — ніколи.
  'silpo-weights': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const val = (o: any) => o.value ?? o.v;
    const findW = (re: RegExp) => ops.find((o: any) => re.test(String(o.label ?? '') + String(o.product ?? '')));
    const checks: [string, RegExp, number][] = [
      ['ковбаса', /ковб|мілан/i, 114],
      ['яловичина', /ялович|портерхаус|стейк/i, 502],
      ['томати', /томат|помідор/i, 488],
    ];
    const bad: string[] = [];
    for (const [name, re, grams] of checks) {
      const op = findW(re);
      if (!op) { bad.push(`${name}: не знайдено`); continue; }
      const v = val(op); const u = String(op.unit ?? op.u ?? '');
      const okG = Math.abs((v ?? 0) - grams) <= 2 && /^g|г/.test(u);
      const okKg = Math.abs((v ?? 0) - grams / 1000) < 0.01 && /kg|кг/.test(u);
      if (!okG && !okKg) bad.push(`${name}: v=${v}${u} (чекав ${grams} г)`);
    }
    const priceLeak = ops.filter((o: any) => [899, 1799, 903.1, 102.49].includes(val(o)));
    if (priceLeak.length) bad.push(`ціна протекла у value: ${priceLeak.map((o: any) => o.label).join(', ')}`);
    return bad.length ? fail(bad.join(' · ')) : pass();
  },

  // Розгортання склеєних обрубків у людські назви + бренд із каші.
  'silpo-expansions': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const hay = ops.map((o: any) => `${o.label ?? ''} ${o.product ?? ''} ${o.brand ?? ''}`.toLowerCase());
    const has = (re: RegExp) => hay.some((h) => re.test(h));
    const bad: string[] = [];
    if (!has(/вод/) || !has(/моршин/)) bad.push('М/в1.5МоршинН/газ не стала водою Моршинська');
    // «Н/газ» = НЕгазована — обрізок небезпечний: прочитаний як «газована»
    // він каже протилежне. Вимагаємо явного «негазован», і щоб газованість
    // без заперечення ніде при воді не стояла.
    const water = ops.map((o: any) => `${o.label ?? ''} ${o.variant ?? ''}`.toLowerCase()).filter((h) => /вод|моршин/.test(h));
    if (!water.some((h) => /негазован|без газу/.test(h))) bad.push('«Н/газ» не розгорнуто в «негазована»');
    if (water.some((h) => /(?<!не)газован/.test(h) && !/негазован/.test(h))) bad.push('вода стала ГАЗОВАНОЮ — протилежність!');
    if (!has(/ковбас/)) bad.push('КовбКг… не стала ковбасою');
    if (!has(/пиво|kronen/)) bad.push('П0.33Kronenb не стало пивом');
    if (!has(/квас/)) bad.push('квас загубився');
    return bad.length ? fail(bad.join(' · ')) : pass(`${ops.length} ops`);
  },

  // Пул-2 №8: юзер назвав страву з відсутнім інгредієнтом — картка мусить
  // бути ПРО НЕЇ (страус у title або needs), а не про заміну з комори.
  'ostrich-dish-offered': (out) => {
    const c = out.card;
    if (!c) return fail('картки немає — зустрічна вилка замість пропозиції?');
    const hay = JSON.stringify(c).toLowerCase();
    if (!/страус/.test(hay)) return fail('у картці немає страуса — бажання підмінене наявним');
    if (c.type === 'proposal') {
      const items = (c.items ?? []) as { title?: string; needs?: string[] }[];
      const withOstrich = items.filter((i) =>
        /страус/i.test(i.title ?? '') || (i.needs ?? []).some((n) => /страус/i.test(n)));
      if (!withOstrich.length) return fail('страус згаданий, але не в title/needs жодної страви');
    }
    return pass();
  },

  // «Рідко буває в магазинах» — модель не оцінює досяжність продуктів.
  // Пул-5 №4: замусорений ввід (диктовка задублювала текст ×3) → інтейк без
  // дублів: кожен продукт — один op.
  'intake-no-dup': (out) => {
    const c = out.card;
    if (!c || c.type !== 'intake_diff') return fail(`card.type=${c?.type ?? 'null'} — очікував intake_diff`);
    const labels = ((c.ops ?? []) as { label?: string }[])
      .map((o) => (o.label ?? '').toLowerCase().trim()).filter(Boolean);
    const dup = labels.find((l, i) => labels.indexOf(l) !== i);
    return dup ? fail(`дубльований op: «${dup}»`) : pass(`${labels.length} унікальних ops`);
  },

  'no-availability-excuse': (out) => {
    const r = out.reply ?? '';
    const hit = /рідко (буває|зустрічається|трапляється)|важко (знайти|дістати)|не буває в магазин|складно (знайти|дістати)/i.exec(r);
    return hit ? fail(`відмовка про досяжність: «${hit[0]}»`) : pass();
  },

  // Пул-2 №9: відкрите «що купити?» відштовхується від залежаного/намірів —
  // міст (маш / рисовий папір / роли) мусить прозвучати, одна позиція — замало.
  'bridge-from-idle': (out) => {
    const hay = ((out.reply ?? '') + JSON.stringify(out.card ?? {})).toLowerCase();
    if (!/маш|рисов|рол/.test(hay)) return fail('ні маш, ні рисовий папір, ні роли не згадані — залежане й наміри проігноровані');
    return pass();
  },

  // Пул-2 №6: «тримай в голові» → profile-картка з op kind:"intent".
  'intent-op': (out) => {
    const c = out.card;
    if (!c || c.type !== 'profile') return fail(`card.type=${c?.type ?? 'null'} — очікував profile`);
    const ops = (c.ops ?? []) as { kind?: string; label?: string }[];
    const hit = ops.find((o) => o.kind === 'intent');
    if (!hit) return fail(`kind-и в ops: ${ops.map((o) => o.kind).join(',')} — intent немає`);
    return /рол|рисов|креветк/i.test(hit.label ?? '') ? pass(hit.label) : fail(`label не про роли: ${hit.label}`);
  },

  // Черга Д (№2): тегер. Кожен add-оп чека несе трійку (мінімум product);
  // молочне мусить отримати allergens з коренем «молок». Ліміт 70% — чек
  // містить нехарчове/неоднозначне, де трійка може бути голим product.
  'tagger-triples': (out) => {
    const ops = (opsOfIntake(out) ?? []).filter((o: any) => (o.op ?? 'add') === 'add');
    if (!ops.length) return fail('немає add-ops');
    const withProduct = ops.filter((o: any) => typeof o.product === 'string' && o.product.trim());
    const ratio = withProduct.length / ops.length;
    if (ratio < 0.7) return fail(`product лише в ${withProduct.length}/${ops.length} ops`);
    const dairy = ops.filter((o: any) => /сир|молок|сметан|вершк|йогурт|кефір|камбоц|моцарел|парме/i.test(String(o.label ?? '') + String(o.product ?? '')));
    if (dairy.length) {
      const tagged = dairy.filter((o: any) => (o.tags?.allergens ?? []).some((a: string) => /молок/i.test(a)));
      if (!tagged.length) return fail(`молочні позиції без allergens: ${dairy.map((o: any) => o.label).slice(0, 3).join(', ')}`);
    }
    return pass(`product у ${withProduct.length}/${ops.length}, молочних із тегом: ${dairy.length}`);
  },

  // Чат-інтейк із названим брендом: трійка розкладена (product без бренду,
  // brand окремо), а не злита в один label.
  'tagger-chat-triple': (out) => {
    const ops = (opsOfIntake(out) ?? []).filter((o: any) => (o.op ?? 'add') === 'add');
    if (!ops.length) return fail('немає add-ops');
    const parm = ops.find((o: any) => /парме/i.test(String(o.label ?? '') + String(o.product ?? '')));
    if (!parm) return fail('пармезан не знайдено в ops');
    if (!/парме/i.test(String(parm.product ?? ''))) return fail(`product не «пармезан»: ${JSON.stringify(parm.product)}`);
    if (!/galbani/i.test(String(parm.brand ?? ''))) return fail(`brand не Galbani: ${JSON.stringify(parm.brand)}`);
    if (/galbani/i.test(String(parm.product))) return fail('бренд злитий у product');
    const dairyTag = (parm.tags?.allergens ?? []).some((a: string) => /молок/i.test(a));
    return dairyTag ? pass() : fail('у пармезана немає тега allergens: молоко');
  },

  // === Розбір вкладень ===

  'receipt-coverage-80': (out, fx) => {
    const ops = opsOfIntake(out);
    if (!ops) return fail('немає ops (card.type=intake_diff / kind=receipt) — раннер не побачив партій');
    // У текстової фікстури рядки рахуються з самого вкладення; у фото тексту
    // немає, і кількість мусить бути оголошена (expect_lines). Доти
    // фотофікстура падала з «перевір формат» — це була вада інваріанта, а не
    // розбору, і вона маскувала справжні провали поруч.
    const declared = (fx as { expect_lines?: number }).expect_lines;
    const source = fx.attachment?.content ?? '';
    const expected = declared ?? countReceiptLines(source);
    if (!expected) {
      return fail(fx.attachment?.kind === 'image'
        ? 'фото-фікстура без expect_lines — скільки позицій має бути, знає тільки автор'
        : 'у фікстурі не знайдено товарних рядків — перевір формат');
    }
    const ratio = ops.length / expected;
    // Перебір теж провал, і рівно він тут стався: на фото чека з 21 позицією
    // модель нарахувала 23. Вигадані рядки в коморі гірші за пропущені —
    // пропущене людина побачить і додасть, вигаданого вона не шукає.
    // Одна зайва може бути чесно розділеним рядком; дві — вже вигадка.
    // Частку тут не беремо навмисно: на короткому чеку 1.1 не спрацьовує.
    if (ops.length - expected >= 2) {
      return fail(`${ops.length}/${expected} — ${ops.length - expected} зайвих позицій, це вигадка`);
    }
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
      // Обсяги ≠ ціни: «0,25 л», «1,5» — дробові < 10 це фасування; ціни
      // в labels практично завжди ≥ 10 із двома знаками після коми.
      const suspicious = [...label.matchAll(/(\d+)[,.](\d+)/g)]
        .filter((m) => Number(m[1]) >= 10 && (m[2] ?? '').length === 2);
      return suspicious.length > 0 || label.includes('грн') || label.includes('uah');
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

  // Дисципліна трійки. Живий репро 02.09: модель ПРОДОВЖУВАЛА давати трійку,
  // але розкладала її навпаки — у label лишався огризок («папір», «напій»),
  // а бренд їхав у variant («Zew Pure Moist», «Schweppes Pink Tonic»).
  // Жоден наявний інваріант цього не ловив: silpo-expansions шукає текст у
  // label+product+brand і задовольняється тим, що розгортка є ДЕСЬ, а
  // includes-nonfood дивиться взагалі лише на label.
  //
  // Ціна помилки не косметична. По-перше, людина підтверджує картку, а
  // картка показує label — тобто огризок. По-друге, tripleKey — суворий
  // збіг: бренд, що гуляє між brand і variant, дає РІЗНІ ключі, і той самий
  // Schweppes наступного разу народить другий «продукт дому» замість злиття.
  // 02.09 (гілка catalog/resolver): «купив мʼясо» — це категорія, а не
  // продукт. Каталог міряє її широту (categoryBreadth: «мʼясо» 560 позицій),
  // і комора малює таку партію позначкою «?рід». Промпт має на це реагувати
  // ОДНИМ уточненням поряд із карткою — не замість неї і не анкетою на
  // двадцять рядків.
  //
  // Перевіряємо три речі разом, бо поодинці кожна проходить хибно: картка
  // мусить лишитись; питання мусить бути; питань мусить бути НЕ БІЛЬШЕ
  // одного. Найчастіший провал тут не «не спитала», а «спитала про все».
  'generic-label-asks-once': (out) => {
    const ops = opsOfIntake(out) ?? [];
    if (!ops.length) return fail('немає ops — картка мала лишитись, уточнення її не заміняє');
    const GENERIC = ['мʼясо', 'мясо', 'риба', 'сир', 'овочі', 'фрукти', 'зелень', 'крупа', 'молочне', 'консерви'];
    const generic = (ops as any[]).filter((o) => {
      const base = String(o.product ?? o.label ?? '').trim().toLowerCase();
      return GENERIC.includes(base);
    });
    // Звітуємо ЗАВЖДИ, і на успіху теж. Мовчазний pass тут небезпечний:
    // гілка «родових ops немає» проходить тривіально, і в терміналі вона
    // виглядає точно так само, як справжня перевірка. Живий випадок 02.09 —
    // фікстура дала PASS, і з виводу не було видно, чи правило спрацювало.
    const names = generic.map((o: any) => String(o.product ?? o.label)).join(', ');
    if (!generic.length) {
      return pass(`родових назв не було — правило не перевірялось (ops: ${ops.length})`);
    }
    const reply = stripHtmlish(String(out.reply ?? ''));
    const questions = (reply.match(/\?/g) ?? []).length;
    if (questions === 0) {
      return fail(`родове «${names}» записано без жодного уточнення`);
    }
    if (questions > 1) {
      return fail(`${questions} питань в одній репліці про «${names}» — уточнення має бути ОДНЕ, не анкета`);
    }
    return pass(`родове «${names}» → одне уточнення`);
  },

  // Розбір мусить упізнати конкретні продукти, а не «щось схоже».
  //
  // Живий провал 02.09: касовий чек ФОТОГРАФІЄЮ дав «хусь» замість хустинок,
  // «батер» замість багета, «папір» замість туалетного паперу Zewa, а два
  // різні шоколади злились в один. Той самий чек ТЕКСТОМ розібрався добре —
  // отже ламається саме зоровий шлях, і жодна фікстура його не перевіряла.
  //
  // Еталон не вигаданий: пари А↔Б із корпусу, зіставлені за ціною рядка.
  // Мережа сама надрукувала, як називається те, що на касі скоротилось.
  'expected-expansions': (out, fx) => {
    const want = (fx as { expect_products?: string[] }).expect_products ?? [];
    if (!want.length) return pass('еталонів не задано — нема чого звіряти');
    const ops = opsOfIntake(out) ?? [];
    if (!ops.length) return fail('немає ops');
    // Правопис не має вирішувати долю тесту. «Чипси» і «чіпси» — те саме
    // слово, і модель законно пише то так, то так; апостроф теж буває трьох
    // накреслень. Тому звіряємо на нормалізованому вигляді.
    const norm = (x: string) => x.toLowerCase()
      .replace(/[’'ʼ`]/g, '')
      .replace(/[іїй]/g, 'и');
    const hay = norm((ops as any[])
      .map((o) => `${o.label ?? ''} ${o.product ?? ''} ${o.brand ?? ''} ${o.variant ?? ''}`)
      .join(' | '));
    const missing = want.filter((w) => !hay.includes(norm(w)));
    if (missing.length) {
      // Показуємо ЩО модель написала натомість — інакше «не впізнано: чипси»
      // не діагностується без ручного читання сирого виходу.
      const got = (ops as any[]).map((o) => o.product ?? o.label).filter(Boolean).slice(0, 8).join(', ');
      return fail(`не впізнано ${missing.length} з ${want.length}: ${missing.slice(0, 4).join(', ')} · було: ${got}`);
    }
    return pass(`усі ${want.length} еталонних продуктів на місці`);
  },

  'triple-discipline': (out) => {
    const ops = opsOfIntake(out) ?? [];
    if (!ops.length) return fail('немає ops');
    const bad: string[] = [];

    // 1. label — «людська назва цілком»: обрубок у ньому неприпустимий.
    //
    // 02.09, після переходу на smart: правило почало кричати на ПРАВИЛЬНІ
    // розбори, і причини були дві, обидві мої.
    //   · відмінок — variant «молочний з кокосом» проти label «…Кокос»;
    //   · письмо — variant «тонік» проти label «…Pink Tonic».
    // Модель обидва рази розібрала добре, а буквальне порівняння слів
    // розсипалось. Сильніша модель пише багатші назви, і мірило під неї
    // не годилось.
    //
    // Тому дві зміни. Порівнюємо за КОРЕНЕМ (той самий дешевий стемер, що в
    // каталозі): «кокосом» і «Кокос» дають один корінь. І variant із
    // перевірки прибрано — це вільний опис, який законно переформульовують
    // («Pink Tonic» у назві, «тонік рожевий» у варіанті). Лишились product і
    // brand: вони ідентифікують товар і мусять стояти в назві як є.
    //
    // Первісний дефект це ловить так само: label «папір» при product «папір
    // туалетний» дає пропущене слово «туалетний».
    const root = (w: string) => (w.length <= 4 ? w : w.slice(0, Math.max(4, w.length - 2)));
    const words = (s: unknown) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}%]+/u).filter((w) => w.length > 2);
    for (const o of ops as any[]) {
      const labelRoots = words(o.label).map(root);
      const missing = [...words(o.product), ...words(o.brand)]
        .filter((w) => !labelRoots.includes(root(w)));
      if (missing.length) bad.push(`label «${o.label}» бідніший за трійку: бракує ${missing.slice(0, 3).join(', ')}`);
      if (bad.length >= 3) break;
    }

    // 2. Бренд — у brand, а не в variant. Список узято з рядків самого чека.
    const BRANDS = /моршин|schweppes|zew|ponti|lay|kronenb|jarrkof|weekend|penok|біоранж|тарас/i;
    const misplaced = (ops as any[]).filter((o) => !o.brand && BRANDS.test(String(o.variant ?? '')));
    if (misplaced.length) {
      bad.push(`бренд у variant при порожньому brand: ${misplaced.map((o) => o.variant).slice(0, 2).join('; ')}`);
    }

    // 3. Чек із брендами не може дати нуль брендів на весь розбір.
    const withBrand = (ops as any[]).filter((o) => o.brand).length;
    if (withBrand === 0) bad.push('жодного brand на весь чек');

    return bad.length ? fail(bad.join(' · ')) : pass(`${withBrand} брендів, label повні`);
  },

  'includes-nonfood': (out) => {
    const ops = opsOfIntake(out) ?? [];
    const nonfoodWords = /папір|гель|порошок|балон|серветк|губк|туалет|дрова|розпал|гриль|пакет|хустин/i;
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
    // Крок 6в: додано фрази для відмови ПОЗА ТЕМОЮ («не можу», «тільки про
    // …», «поза темою», «не моя тема», «лише кухн…») поруч із наявними
    // (рецепт/інгредієнт не вийшов) — той самий інваріант обслуговує обидва
    // роди відмови, старі фікстури (allergen-conflict, missing-ingredient,
    // qa5-allergen-on-request) не чіпались.
    const refusalWords = /не вийде|не можу приготувати|немає (?:в коморі|цього)|не буду пропонувати|не можу|тільки про|поза темою|не моя тема|лише кухн/;
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

  // ── Календар: модель пише події ────────────────────────────────────────
  // Головне, що тут перевіряється, — не формат, а те, що модель НЕ РАХУЄ дат.
  // Промпт шість прогонів обіцяв рахувати їх сам і вигадував: піст «2 березня»
  // замість 15-го. Дозволивши їй писати події, ми тим більше не даємо рахувати.
  'event-relative-when': (out) => {
    const c = out.card as { type?: string; ops?: Record<string, unknown>[] } | null;
    if (!c || c.type !== 'event') return fail(`card.type=${c?.type ?? 'null'} — очікував event`);
    const add = (c.ops ?? []).find((o) => (o.op ?? 'add') === 'add');
    if (!add) return fail(`ops: ${(c.ops ?? []).map((o) => o.op).join(',')} — add немає`);
    const when = add.when as Record<string, unknown> | undefined;
    if (!when) return fail('when немає — сервер не знатиме, коли це');
    if (typeof when.date === 'string') {
      return fail(`when.date=${when.date} — дату модель порахувала САМА, хоч людина її не називала`);
    }
    if (typeof when.rel === 'string') return pass(`when.rel=${when.rel}`);
    if (when.weekly != null) return pass(`when.weekly=${when.weekly}`);
    return fail(`форма when невідома: ${JSON.stringify(when)}`);
  },

  // Часу немає — події немає. Подія з вигаданою датою гірша за відсутню: вона
  // виглядає як факт. Правильна поведінка — питання одним реченням.
  'no-invented-event': (out) => {
    const c = out.card as { type?: string; ops?: Record<string, unknown>[] } | null;
    if (c?.type === 'event' && (c.ops ?? []).some((o) => (o.op ?? 'add') === 'add')) {
      return fail(`подія створена без названого часу: ${JSON.stringify(c.ops)}`);
    }
    const reply = String(out.reply ?? '');
    return /\?/.test(reply) ? pass('перепитала') : fail(`ні події, ні питання: «${reply.slice(0, 90)}»`);
  },

  // Правка наявного плану — edit по id з блоку, а не другий add. Інакше в
  // календарі опиняться дві події про одне, і жодна не буде правдою.
  'event-edit-not-add': (out) => {
    const c = out.card as { type?: string; ops?: Record<string, unknown>[] } | null;
    if (!c || c.type !== 'event') return fail(`card.type=${c?.type ?? 'null'} — очікував event`);
    const ops = c.ops ?? [];
    const add = ops.find((o) => (o.op ?? 'add') === 'add');
    if (add) return fail(`замість правки створено нову подію: ${JSON.stringify(add)}`);
    const edit = ops.find((o) => o.op === 'edit');
    if (!edit) return fail(`ops: ${ops.map((o) => o.op).join(',')} — edit немає`);
    if (!edit.id) return fail('edit без id — сервер не знатиме, що правити');
    return pass(`edit id=${edit.id} ${JSON.stringify({ servings: edit.servings, title: edit.title })}`);
  },

  'has-card': (out) => out.card
    ? pass(`card.type=${out.card.type ?? out.card.kind}`)
    : fail('картки немає — людині нема куди тапнути'),

  // Аудит раунд 3, крок 2, рішення: «не називай кнопок» ловило й дієслово
  // «натисни» — а воно легальне, коли назва кнопки за ним правдива
  // (CARD_BUTTON_LABEL, те саме, що рендерить cards.tsx). Забороняємо не
  // дію, а ВИГАДКУ: назву в лапках, якої немає в жодній картці, і два
  // конкретне фантомне слово — «Застосувати» — такої кнопки не існує в
  // жодному компоненті («Записати» з раунду 4 — існує).
  'no-invented-buttons': (out) => {
    const reply = String(out.reply ?? '');
    // Апостроф — не сигнал: «Запам'ятати» і «Запамʼятати» — та сама кнопка,
    // різні розкладки/типографіка. Нормалізуємо ОБИДВА боки порівняння —
    // і CARD_BUTTON_LABEL (пише 'straight'), і те, що сказала модель.
    const normApo = (s: string) => s.replace(/[ʼ’'`]/g, "'");
    const realLabels = new Set(
      Object.values(CARD_BUTTON_LABEL).filter((v): v is string => !!v).map(normApo),
    );
    const quoted = [...reply.matchAll(/«([^»]+)»/g)].map((m) => normApo(m[1] ?? ''));
    const invented = quoted.filter((q) => !realLabels.has(q));
    if (invented.length) {
      return fail(`вигадана назва кнопки в лапках: «${invented[0]}» — такої немає в CARD_BUTTON_LABEL`);
    }
    // Раунд 4: «Записати» — справжня кнопка картки профілю (CARD_BUTTON_LABEL).
    const phantom = /застосувати/i.exec(reply);
    if (phantom) {
      return fail(`репліка називає неіснуючу кнопку: «${phantom[0]}»`);
    }
    return pass();
  },

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

  // Знахідка A аудиту. Було `future-tense-with-card`: майбутній час вимагався
  // від БУДЬ-ЯКОЇ картки — правило, писане під рантайм, де кожна чекала тапу.
  // Пул-8 №2 і M13 01.09 зробили intake_diff і shopping автозастосовними, і
  // вимога стала хибною саме на найчастіших типах. Джерело режиму одне —
  // applyMode() з домену, той самий, що читають промпт і пост-процесор.
  'tense-matches-apply-mode': (out) => {
    const type = out.card?.type as Card['type'] | undefined;
    if (!type) return pass('картки немає — правило не застосовне');
    if (applyMode(type) !== 'confirm') {
      return pass(`${type}: застосування не чекає тапу, минулий час — факт`);
    }
    const reply = String(out.reply ?? '').toLowerCase();
    const claimed = reply.match(
      anyWord(['записав', 'записала', 'записую', 'прибрав', 'прибрала', 'прибираю', 'видалив', 'видалила', 'видаляю', 'додав', 'додала', 'додаю']),
    );
    return claimed
      ? fail(`«${claimed[0]}» стверджує доконану дію, а картку ${type} ще не застосовано`)
      : pass();
  },

  // QA-5: продукт послідовно на «ти».
  'addresses-informally': (out) => {
    const reply = String(out.reply ?? '');
    const formal = reply.match(new RegExp(LB + '(Ви|Вас|Вам|Ваш[а-яіїє]*|зніміть|скажіть|оберіть|додайте|спробуйте)' + RB));
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
    const listed = reply.split(new RegExp('[,.]|' + LB + '[ій]' + RB)).map((s) => s.trim()).filter((s) => s.length > 3);
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
      .replace(/(смаку[єч][а-яі]*|пахн[а-яі]+|нагаду[єч][а-яі]*|з нотками|у смаку|[а-яіїє]+ нотк[а-яіїє]*)[^.,;!?]*/g, '');
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
    // desc — мова смаку й текстури («крем-вершкова каша» з нуту вершків не
    // містить); продукти живуть у title, needs і rescues — їх і перевіряємо.
    const items = (card as { items?: { title?: string; needs?: string[]; rescues?: string[] }[] }).items ?? [];
    const hay = items
      .map((i) => [i.title ?? '', ...(i.needs ?? []), ...(i.rescues ?? [])].join(' '))
      .join(' | ')
      .toLowerCase();
    // Підрядком тут ловиться не те: «фарш» сидить у «фаршировані гриби»,
    // «сир» у «сирий», а «кокосове молоко» в піст цілком дозволене. Тому
    // кожен корінь із власними винятками, а не список слів через includes.
    const SKOROMNE: [string, RegExp][] = [
      // (?!ист) — «гриби дають мʼясистість» це текстура, не мʼясо.
      ['мʼясо', new RegExp(`${LB}м[ʼ']яс(?!ист)|яловичин|свинин|телятин|баранин|бекон|шинк|ковбас|${LB}сало${RB}`)],
      ['фарш', new RegExp(`${LB}фарш(?!ирован)`)],
      // (?!ум) — «куркума» це спеція; четвертий флап calendar-lent був саме
      // на ній: модель відповіла бездоганно, а інваріант побачив «курк».
      ['птиця', new RegExp(`${LB}курк(?!ум)|куряч|${LB}курц|індичк|індич`)],
      ['риба', new RegExp(`${LB}риб[аиуоі]${RB}|лосос|тунц|оселедц|креветк|${LB}тріск`)],
      // Іменник («вершки», «вершків») — продукт; прикметник — текстура
      // («крем-вершкова каша» з нуту), КРІМ пари з «соус»: вершковий соус
      // робиться з вершків.
      ['вершки', /вершк(и|ів|ами|ах)(?![а-яіїє])|вершков[а-яіїє]*\s+(соус|масл)/],
      ['сметана', /сметан/],
      ['сир', new RegExp(`${LB}сир[ауоюі]?${RB}|${LB}сиром${RB}|пармезан|${LB}фет[аиу]${RB}|моцарел`)],
      ['масло', new RegExp(`вершков[а-яі]*\\s+масл|${LB}масл[оаиуом]+${RB}(?!\\s*(?:оливков|соняшников|рослинн))`)],
      ['яйця', new RegExp(`${LB}яйц|${LB}яєц|${LB}яєчн`)],
      ['молоко', new RegExp(`(?<!кокосов[а-яі]{0,3}\\s)(?<!рослинн[а-яі]{0,3}\\s)(?<!соєв[а-яі]{0,3}\\s)(?<!вівсян[а-яі]{0,3}\\s)(?<!мигдальн[а-яі]{0,3}\\s)${LB}молок`)],
    ];
    // «Підходить під піст — без вершків і пармезану» — це дотримання, а не
    // порушення: заперечені згадки знімаємо перед пошуком.
    const affirmed = hay
      .replace(/без\s+[^.,;!?"»]{0,60}/g, '')
      .replace(/не\s+(?:бере|містить|додава[а-яіїє]*|клади[а-яіїє]*)[^.,;!?]{0,40}/g, '')
      // «Вершкове різото, але на кокосовому молоці» — «вершковий» тут текстура,
      // а не продукт: прикметник поруч із рослинним замінником не рахується.
      .replace(/вершков[а-яі]*(?=[^.;!?]{0,60}(?:кокосов|рослинн|соєв|вівсян|мигдальн))/g, '');
    const hit = SKOROMNE.filter(([, re]) => re.test(affirmed)).map(([name]) => name);
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

  // QA7-02: дата з КЛЮЧОВИХ ДАТ, названа впевнено. Великдень-2026 (правосл.) —
  // 12 квітня; будь-яка інша конкретна дата — вигадка.
  'names-correct-easter': (out) => {
    const reply = String(out.reply ?? '');
    if (!/12\s*квітня/.test(reply)) {
      return /\d{1,2}\s*(квітня|березня|травня)/.test(reply)
        ? fail(`названо неправильну дату: «${reply.slice(0, 120)}»`)
        : fail('дату не названо, хоча вона стоїть у КЛЮЧОВИХ ДАТАХ');
    }
    return pass();
  },

  // Модель не описує механіку своєї памʼяті — QA-7 ловив «розпізнається
  // поступово», «заповнюється», «прийде автоматично» три репліки поспіль.
  'no-memory-mechanics': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const hit = ['розпізна', 'заповню', 'прийде автоматично', 'зчита', 'блоці', 'блок ', 'контекст']
      .filter((w) => reply.includes(w));
    return hit.length
      ? fail(`описує внутрішню механіку: ${hit.join(', ')}`)
      : pass();
  },

  // DA2-23: продиктований рецепт — recipe-картка зі структурою, не note.
  'is-recipe-card': (out) => {
    const card = out.card;
    if (!card) return fail('картки немає — рецепт загубився в прозі');
    if (card.type === 'profile') {
      const ops = (card as { ops?: { kind?: string }[] }).ops ?? [];
      if (ops.some((o) => o.kind === 'note')) {
        return fail('рецепт поїхав у kind:note — за нотаткою неможливо готувати');
      }
    }
    if (card.type !== 'recipe') return fail(`очікували recipe, отримали ${card.type}`);
    const r = (card as { recipe?: { ing?: unknown[]; st?: unknown[] } }).recipe;
    if (!r?.ing?.length || !r?.st?.length) return fail('recipe без ing або st — структури немає');
    return pass();
  },

  // Модель памʼятає ВЛАСНИЙ рецепт: склад із [ЗГЕНЕРОВАНІ РЕЦЕПТИ], а не
  // нова вигадка. Скріни: яловичина → свинина на ту саму назву.
  'recalls-own-recipe': (out) => {
    const hay = (String(out.reply ?? '') + ' ' + JSON.stringify(out.card ?? {})).toLowerCase();
    if (!hay.includes('яловичин')) {
      return hay.includes('свинин') || hay.includes('курк')
        ? fail('вигадала нове мʼясо замість того, що в її ж рецепті')
        : fail('не назвала склад із власного рецепта');
    }
    return pass();
  },

  // QA9-02 (скріни з тостом): «поміняй в рецепті багет на батон» ішло в
  // комору (intake_diff «+батон −багет»), а модель брехала «замінив у
  // рецепті». Правка рецепта зі стрічки — це recipe_edit: назва + інструкція,
  // рецепт оновлює сервер.
  'is-recipe-edit-card': (out) => {
    const card = out.card;
    if (!card) return fail('картки немає — правка рецепта загубилась у прозі');
    if (card.type === 'intake_diff') {
      return fail('правка рецепта поїхала в комору (intake_diff) — точний баг зі скрінів');
    }
    if (card.type !== 'recipe_edit') return fail(`очікували recipe_edit, отримали ${card.type}`);
    const c = card as { title?: string; instruction?: string };
    if (!c.title?.trim()) return fail('recipe_edit без назви рецепта — сервер не знайде базовий');
    if (!c.instruction?.trim()) return fail('recipe_edit без інструкції — нема чого міняти');
    return pass();
  },

  // UX9-03 (скріни: «фует варити до аль денте»): правка рецепта не сміє
  // мовчки міняти акторський склад. Пармезан→вершки НЕ чіпає спагеті.
  'edit-keeps-cast': (out) => {
    const r = (out.card as { recipe?: { ing?: { p?: string; n?: string }[]; st?: { c?: string; t?: string }[] } } | null)?.recipe;
    if (!r?.ing?.length) return fail('рецепта немає — правка не відбулась');
    const hay = (i: { p?: string; n?: string }) => (i.n ?? '').toLowerCase();
    const hasSpaghetti = r.ing.some((i) => hay(i).includes('спагет') || i.p === 'p5');
    if (!hasSpaghetti) return fail('спагеті зникли з рецепта — саме баг зі скрінів');
    const hasFuet = r.ing.some((i) => hay(i).includes('фует'))
      || (r.st ?? []).some((s) => `${s.t} ${s.c}`.toLowerCase().includes('фует'));
    if (hasFuet) return fail('фует пробрався в пасту — переплутаний вказівник');
    const hasCream = r.ing.some((i) => hay(i).includes('вершк') || i.p === 'p1');
    if (!hasCream) return fail('вершки не зʼявились — правку не виконано');
    const hasParm = r.ing.some((i) => hay(i).includes('пармезан'));
    if (hasParm) return fail('пармезан лишився — правку не виконано');
    return pass();
  },

  // UX9-13: «зроби на чотирьох» = sv:4 і кількості ×2 від бази, не тільки ×2.
  'servings-scaled': (out) => {
    const r = (out.card as { recipe?: { sv?: number; ing?: { v?: number }[] } } | null)?.recipe;
    if (!r) return fail('рецепта немає');
    if (r.sv !== 4) return fail(`sv=${r.sv} — табличку на дверях не переписано (очікували 4)`);
    const scaled = (r.ing ?? []).some((i) => i.v === 400);
    return scaled ? pass() : fail('кількості не перераховані від базових (немає 400 після 200×2)');
  },

  // UX9-04: [КОМОРА] — єдине джерело правди про стан; історія — події.
  // M13-ROLE-VOICE: тоніки лежать у КОМОРІ (приїхали з чеків), у списку —
  // молоко й хліб. Питання саме про список. Назвати тоніки тут означає
  // приписати позиції одного стан-блока іншому — той самий живий баг 01.09.
  'shopping-truth-no-pantry-leak': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    if (/tonic|швепс|schweppes|bitter lemon/.test(reply)) {
      return fail('назвала тоніки з [КОМОРА] як вміст списку покупок');
    }
    if (!/молок|хліб/.test(reply)) return fail('не назвала те, що справді в списку (молоко, хліб)');
    return pass();
  },

  // №4: кошик відкритий (блок [РЕЖИМ]), «додай колу» → розширення кошика.
  // Головна помилка, яку ловимо, — shopping: саме так система поводилась,
  // поки модель не знала ситуації (живий репро M13 п.3).
  'cart-extend-not-shopping': (out) => {
    const t = out.card?.type;
    if (t === 'shopping') return fail('повела в список покупок замість розширити відкритий кошик');
    if (t !== 'cart_go') return fail(`очікували cart_go, отримали ${t ?? 'нічого'}`);
    const items = (out.card as { items?: string[] }).items ?? [];
    if (!items.length) return fail('cart_go без items — це перезбирання, а не розширення');
    if (!items.some((i) => /кол/i.test(i))) return fail('у items немає коли');
    return pass();
  },

  'pantry-truth-100': (out) => {
    const reply = String(out.reply ?? '');
    if (/500/.test(reply)) return fail('назвала 500 г з історії — блок каже 100');
    if (!/100/.test(reply)) return fail('не назвала 100 г із [КОМОРА]');
    return pass();
  },

  // UX9-28: перша страва дня — з пармезаном (15:24), модель плутала порядок.
  // Порівнюємо ПОЗИЦІЇ згадок: правильна відповідь називає пармезан раніше
  // за вершки («Першою була з пармезаном, потім з вершками»).
  'chronology-first-parmesan': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const iParm = reply.indexOf('пармезан');
    const iCream = reply.indexOf('вершк');
    if (iParm < 0) return fail('не назвала першу страву (з пармезаном)');
    if (iCream >= 0 && iCream < iParm) return fail('назвала пасту з вершками першою — хронологію перевернуто');
    return pass();
  },

  // UX9-30: виключив через алерген → заміна в ТІЙ ЖЕ відповіді, не питання.
  'excluded-offers-alternative': (out) => {
    const card = out.card as { type?: string; items?: unknown[] } | null;
    if (card?.type !== 'proposal' || !card.items?.length) {
      return fail('виключення без заміни: proposal-картки немає — зустрічне питання замість страв');
    }
    // «Кремова текстура БЕЗ вершків» — заперечення, не порушення.
    const hay = JSON.stringify(card).toLowerCase()
      .replace(/без\s+[а-яіїєʼ']*(вершк|молок|молоч|сметан|йогурт|кефір|сир)[а-яіїєʼ']*/g, '');
    const dairy = ['молок', 'вершк', 'сметан', 'йогурт', 'кефір', 'сир '].filter((w) => hay.includes(w));
    return dairy.length ? fail(`молочне в пропозиції для Олі: ${dairy.join(', ')}`) : pass();
  },

  // UX9-23: rescues — обіцянка «страва це використає», ковбаса — не хліб.
  'no-sausage-in-toast-rescues': (out) => {
    const card = out.card as { type?: string; items?: { title?: string; rescues?: string[] }[] } | null;
    if (card?.type !== 'proposal') return pass('не proposal');
    for (const it of card.items ?? []) {
      const toasty = /тост|грінк|перду|крутон/i.test(it.title ?? '');
      if (toasty && (it.rescues ?? []).some((r) => /фует|ковбас/i.test(r))) {
        return fail(`«${it.title}»: ковбаса в rescues страви з хліба — точний кейс тостів`);
      }
    }
    return pass();
  },

  // Г: «урок вбудовується в крок» — захист у ТЕКСТІ кроку, не блоком порад.
  'lesson-into-step': (out) => {
    const r = (out.card as { recipe?: { st?: { c?: string }[] } } | null)?.recipe;
    if (!r?.st?.length) return fail('рецепта немає');
    const embedded = r.st.some((s) => /зсіда|зменшен[а-яіїє]* вогн|не кипʼят|не кип'ят/i.test(s.c ?? ''));
    return embedded
      ? pass()
      : fail('захист про вершки не вбудований у жоден крок — висновок людини проігноровано');
  },

  // Г: фідбек — діагноз із причиною, не «врахую».
  'diagnosis-names-cause': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const cause = /анчоус|каперс|солон[а-яіїє]* (склал|склад|додал)|кілька солоних|вже солон/.test(reply);
    return cause
      ? pass()
      : fail('причину пересолу (солоні складові склались) не названо — співчуття замість діагнозу');
  },

  // QA8-08: спільна трапеза — алерген їдця виключає страву, а не маркує.
  'shared-meal-no-eater-allergen': (out) => {
    const card = out.card;
    if (card?.type !== 'proposal') return pass('не proposal');
    const hay = JSON.stringify(card).toLowerCase();
    return /арахіс/.test(hay)
      ? fail('арахіс у пропозиції на спільний сніданок при алергії Оксани')
      : pass();
  },

  // QA5-02: незастосована картка нічого не змінила.
  'denies-unapplied-card': (out, fx) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const claims = anyWord(['так,', 'вже в коморі', 'записав', 'записано', 'є в коморі']).test(reply);
    const denies = word('ні').test(reply)
      || /ще не|ще ні|не застосов|не натиснув|не тапнув|тапнут|натисну|чекає|треба підтвердити|не змінилась|не зміню|поки що ні|тільки в пропозиції/.test(reply);
    if (denies) return pass();
    if (claims) {
      // Аудит раунд 3, крок 2 (закриття): «Записав X» над НЕзастосованою
      // карткою — не обовʼязково брехня. Якщо модель заразом повернула
      // СВІЖУ intake_diff з тими самими позиціями — це чесна повторна
      // пропозиція (в проді fixTense перепише «Записав» на «Запишу» саме
      // тому, що картка ще не застосована — tense-matches-apply-mode).
      // Брехня — це коли reply стверджує зроблене, а картки-підтвердження
      // немає взагалі.
      const c = out.card as { type?: string; ops?: { label?: string }[] } | null;
      if (c?.type === 'intake_diff' && c.ops?.length) {
        const lastAssistant = [...(fx.conversation ?? [])].reverse().find((m) => m.role === 'assistant');
        const priorLabels = [...(lastAssistant?.content ?? '').matchAll(/\badd\s+(\S+)/gi)]
          .map((m) => (m[1] ?? '').toLowerCase()).filter(Boolean);
        const newLabels = c.ops.map((o) => (o.label ?? '').toLowerCase());
        const sameItems = priorLabels.length > 0
          && priorLabels.every((pl) => newLabels.some((nl) => nl.includes(pl) || pl.includes(nl)));
        if (sameItems) {
          return pass(`перевидала картку з тими самими позиціями (${priorLabels.join(', ')}) — не брехня, це нова пропозиція`);
        }
      }
      return fail('стверджує, що позиція в коморі, хоча картка [НЕ ЗАСТОСОВАНО]');
    }
    return fail('не сказала прямо, що картку ще не застосовано, і нової картки з тими самими позиціями немає');
  },

  // QA6-01: онбординг має спитати про обмеження сам.
  'asks-about-restrictions': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const asks = /алерг|не їси|не їсиш|обмеж|дієт|нелюб|чого не/.test(reply) && reply.includes('?');
    return asks
      ? pass()
      : fail('stage=2 з порожнім профілем — модель не спитала про обмеження; профіль не наповниться ніколи');
  },

  // Аудит 04.09, раунд 2 — три фікстури з проду (AUDIT-ROUND-2.md §4).

  // s41: повтор «Оці чеки візьми» після ЗАСТОСОВАНОЇ intake-картки в історії
  // не має породжувати нову intake_diff — інакше комора подвоюється.
  'no-reintake-after-applied': (out) => {
    const c = out.card;
    if (c?.type === 'intake_diff') {
      const n = ((c.ops ?? []) as unknown[]).length;
      return fail(`повторний intake_diff на ${n} ops — ті самі чеки лягли б у комору вдруге`);
    }
    const reply = String(out.reply ?? '').toLowerCase();
    // Крок 5 (закриття): суть — відсутність повторного intake + визнання,
    // що воно вже є. «Так, записав» підтверджує це не гірше за «вже
    // записав» — «вже» не обов'язкове слово для чесної відповіді.
    const acknowledges = /вже (розібрав|записав|в коморі|є)|уже (розібрав|записав|в коморі|є)|ці (ж|самі) чеки|повтор|записав|записано|є в коморі|в коморі/.test(reply);
    return acknowledges ? pass() : fail('без картки, але й не сказала, що ці чеки вже розібрано');
  },

  // Аудит раунд 3, крок 5: підтвердження вже застосованого факту — це текст,
  // не дія. Будь-яка картка тут (не лише intake_diff, як вище) означає, що
  // модель або перезаписує, або пропонує щось замість чесного «так, вже».
  'no-card': (out) => out.card
    ? fail(`картка є (${(out.card as { type?: string }).type ?? '?'}), а мала бути card: null`)
    : pass(),

  // s41: «запамʼятаємо цей рецепт» → «Записав у бібліотеку» з card: null.
  // Збереження згенерованого рецепта — кнопка «У рецепти», картки для нього
  // немає. Чесно — назвати кнопку; брехня — стверджувати, що зберегла.
  'save-recipe-honest': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const claims = /записав (у|в) (бібліотек|рецепт)|зберіг|збережено|тепер він твій|додав (у|в) (бібліотек|рецепт)/.test(reply);
    const points = /у рецепти|кнопк|натисни|тапни|під рецептом/.test(reply);
    if (out.card && (out.card as { type?: string }).type === 'recipe') {
      // Продиктований рецепт із голови — не той випадок: згенерований уже є в стрічці.
      return fail('склала recipe-картку з голови замість вказати на «У рецепти» під наявним рецептом');
    }
    if (claims && !points) return fail('стверджує, що зберегла рецепт, хоча картки немає і зберегти може лише людина кнопкою');
    return points ? pass() : fail('не сказала, як зберегти («У рецепти» під рецептом)');
  },

  // s45/s46: «весь наступний тиждень риба» — план із часом, не wish і не intent.
  'event-with-duration': (out) => {
    const c = out.card as { type?: string; ops?: Record<string, unknown>[] } | null;
    if (!c || c.type !== 'event') return fail(`card.type=${c?.type ?? 'null'} — очікував event (план із часом), а не побажання/намір`);
    const add = (c.ops ?? []).find((o) => (o.op ?? 'add') === 'add');
    if (!add) return fail('event без add');
    const when = add.when as Record<string, unknown> | undefined;
    if (!when) return fail('when немає');
    if (typeof when.date === 'string') return fail(`when.date=${when.date} — дату порахувала сама`);
    const days = Number(add.days ?? 0);
    if (days < 5) return fail(`days=${add.days ?? '—'} — «весь тиждень» має тривалість`);
    return pass(`when=${JSON.stringify(when)} days=${days} kind=${String(add.kind ?? '')}`);
  },

  // 1.2 (s42): уподобання після фідбеку — note, привʼязана до щойно
  // готованої страви. Без картки воно зникає в тексті.
  'preference-note-with-recipe': (out) => {
    const c = out.card as { type?: string; ops?: Record<string, unknown>[] } | null;
    if (!c || c.type !== 'profile') return fail(`card.type=${c?.type ?? 'null'} — очікував profile з kind:note (уподобання)`);
    const note = (c.ops ?? []).find((o) => o.kind === 'note' && (o.op ?? 'add') === 'add');
    if (!note) return fail(`ops: ${(c.ops ?? []).map((o) => o.kind).join(',')} — note немає`);
    const recipe = String(note.recipe ?? note.recipe_title ?? '').toLowerCase();
    if (!recipe.includes('феттучіне')) return fail(`note без recipe або з чужою стравою: «${recipe || '—'}»`);
    const label = String(note.label ?? '').toLowerCase();
    if (!/овоч|черрі|томат|шпинат|спарж/.test(label)) return fail(`label не про овочевий смак: «${label}»`);
    return pass(`note «${label}» до «${recipe}»`);
  },

  // s42: «які овочі додати — черрі, шпинат, спаржу?» замість діагнозу —
  // зустрічна вилка, яку proposal-flow забороняє. Питання можна, але не
  // ЗАМІСТЬ пропозиції: reply має назвати конкретну заміну сам.
  'no-counter-fork': (out) => {
    const reply = String(out.reply ?? '');
    const names = /черрі|томат|шпинат|спарж|цукін|кабач|перц|броко|горош|цибул/i.test(reply);
    const onlyAsks = /\?/.test(reply) && !/(додай|кинь|додати|візьми|поклади|я б)/i.test(reply);
    if (!names) return fail('не назвала жодного конкретного овоча');
    if (onlyAsks) return fail('лише спитала, що додати, замість порадити конкретне');
    return pass();
  },

  // QA-5/6: не стверджувати, що чогось немає, коли просто не бачиш.
  'admits-not-seeing': (out) => {
    const reply = String(out.reply ?? '').toLowerCase();
    const denies = anyWord(['не було', 'нічого не купував', 'немає покупок', 'порожній', 'порожньо']).test(reply);
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

  // Крок 7 (3): кількість речень у резюме, «a-b».
  if (base === 'summary-length') {
    return (out) => {
      const [lo, hi] = (arg ?? '1-5').split('-').map(Number);
      const n = String(out.reply ?? '').split(/(?<=[.!?…])\s+/).filter((x) => x.trim()).length;
      return n >= lo! && n <= hi! ? pass(`${n} речень`) : fail(`${n} речень, очікував ${lo}–${hi}`);
    };
  }

  // Крок 4в (3): картка поля профілю з полем `arg` (no|meh|ban|…).
  if (base === 'profile-field') {
    return (out) => {
      const c = out.card;
      if (!c || c.type !== 'profile') return fail(`card.type=${c?.type ?? 'null'} — очікував profile`);
      if (!c.field) return fail(`картка profile без field (ops: ${JSON.stringify(c.ops).slice(0, 80)})`);
      return c.field === arg ? pass(`${c.field}: «${c.text}»`) : fail(`field=${c.field}, очікував ${arg}; text «${c.text}»`);
    };
  }

  // Крок 4в (1): прямий запит виконано — картка (cook_go/proposal/recipe) про названу страву.
  if (base === 'direct-request-honored') {
    return (out) => {
      const c = out.card;
      const want = (arg ?? '').toLowerCase();
      if (!c) return fail(`картки немає — reply: «${String(out.reply ?? '').slice(0, 120)}»`);
      const hay = c.type === 'cook_go' ? String(c.title ?? '')
        : c.type === 'proposal' ? (c.items ?? []).map((i: { title?: string }) => i.title ?? '').join(' ')
        : c.type === 'recipe' ? String(c.recipe?.t ?? '') : '';
      return hay.toLowerCase().includes(want) ? pass(`${c.type}: ${hay}`) : fail(`${c.type} без «${want}»: ${hay}`);
    };
  }

  // Пул-5 №6: згода на страву → cook_go з дослівною назвою (аргумент —
  // обов'язковий фрагмент title, і назви страви, і механіки: `cook-go-card:сковород`).
  if (base === 'cook-go-card') {
    return (out) => {
      const c = out.card;
      if (!c || c.type !== 'cook_go') return fail(`card.type=${c?.type ?? 'null'} — очікував cook_go`);
      const title = String((c as { title?: string }).title ?? '').toLowerCase();
      return title.includes((arg ?? '').toLowerCase())
        ? pass(`title: ${title}`)
        : fail(`title «${title}» не містить «${arg}»`);
    };
  }

  // Пул-5 №4: `intake-count:банан=3` — op із фрагментом назви має value N
  // (повтори тексту не множать кількість).
  if (base === 'intake-count') {
    return (out) => {
      const [frag, wantRaw] = (arg ?? '').split('=');
      const want = Number(wantRaw);
      const c = out.card;
      if (!c || c.type !== 'intake_diff') return fail(`card.type=${c?.type ?? 'null'} — очікував intake_diff`);
      const hit = ((c.ops ?? []) as { label?: string; value?: number; v?: number }[])
        .find((o) => (o.label ?? '').toLowerCase().includes((frag ?? '').toLowerCase()));
      if (!hit) return fail(`немає op з «${frag}»`);
      const val = hit.value ?? hit.v;
      return val === want ? pass(`${frag}=${val}`) : fail(`${frag}: value=${val}, очікував ${want}`);
    };
  }

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

  // Крок 6в: off-topic-neighbor/off-topic-joke міряють довжину репліки —
  // не заглиблюється в тему (>=40) проти не розписується (<=200).
  if (base === 'reply-min-length') {
    return (out) => {
      const n = String(out.reply ?? '').trim().length;
      const min = Number(arg);
      return n >= min ? pass(`${n} символів`) : fail(`reply ${n} символів — коротше за мінімум ${min}`);
    };
  }

  if (base === 'reply-max-length') {
    return (out) => {
      const n = String(out.reply ?? '').trim().length;
      const max = Number(arg);
      return n <= max ? pass(`${n} символів`) : fail(`reply ${n} символів — довше за максимум ${max}`);
    };
  }

  const inv = registry[name];
  if (!inv) {
    return () => fail(`Невідомий інваріант: ${name}`);
  }
  return inv;
}
