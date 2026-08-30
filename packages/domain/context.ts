// Як стан кухні описується моделі.
//
// Живе в домені, а не в services/api, з однієї причини: цим користуються двоє —
// прод і eval. Поки серіалізація сиділа в model.ts, eval складав свій власний
// промпт (стан як JSON у user-turn), тобто перевіряв не те, що працює у проді.
// Зелений eval не означав нічого.
//
// Порядок блоків не косметичний. Обмеження стоять ПЕРЕД інвентарем: модель
// читає [КОМОРА] згори вниз, і якщо профіль після — вона встигає перелічити
// алергени, не дійшовши до обмеження (QA5-01).

import { root, meaningfulWords } from '@kitchen/catalog';
import type { PantryBatch, Profile, ShoppingItemRow, MemoryNote, EaterRow, RecipeRow, Recipe } from './types.js';
import type { HouseholdProduct } from './product.js';
import { serializeOccasions, fastingActive, isFastingRestricted } from './occasions.js';

export interface RecentCookRunSummary {
  title: string;
  rating: number | null;
  verdict: string | null;
  finished_at: string;
}

export interface KitchenContext {
  pantry: PantryBatch[];
  profile?: Profile | null;
  shopping?: ShoppingItemRow[];
  recentCookRuns?: RecentCookRunSummary[];
  notes?: MemoryNote[];
  eaters?: EaterRow[];
  recentRecipes?: RecipeRow[];
  // Черга Д (№2): продукти дому — теги живлять ⚠-мітки і «~строк≈».
  products?: HouseholdProduct[];
  now?: Date;                            // для тестів — інакше Date.now()
}

export function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Профіль. QA4-02: до цього алергії зберігались, показувались у UI — і не
// впливали ні на що; модель двічі пропонувала мигдаль людині з алергією.
export function serializeProfile(p?: Profile | null): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.allergies.length) {
    parts.push('АЛЕРГІЇ (тверда межа — ніколи не пропонуй сам): ' + p.allergies.join(', '));
  }
  if (p.antipatterns.length) parts.push('НЕ ЇСТЬ / НЕ ЛЮБИТЬ: ' + p.antipatterns.join(', '));
  if (p.wishes.length) parts.push('ЛЮБИТЬ / ТЯГНЕ ДО: ' + p.wishes.join(', '));
  const eq = Object.entries(p.equipment ?? {});
  const has = eq.filter(([, v]) => v === 'has').map(([k]) => k);
  const lacks = eq.filter(([, v]) => v === 'lacks').map(([k]) => k);
  if (has.length) parts.push('Є ТЕХНІКА: ' + has.join(', '));
  if (lacks.length) parts.push('НЕМАЄ ТЕХНІКИ: ' + lacks.join(', '));
  return parts.length ? '\n\n[ПРОФІЛЬ]\n' + parts.join('\n') : '';
}

// Комора: id · назва · зона · кількість · стан. Термін догоряння як «!Nдн»,
// щоб модель могла згадати про нього в репліці (бриф §04: інформація — репліка).
//
// QA5-01: алерген позначається ПРЯМО В РЯДКУ ПАРТІЇ, а не окремим правилом —
// правило за пів промпту від даних ігнорувалось. Збіг за коренем, не за
// підрядком: «шоколад з мигдалем».includes('мигдаль') дає false через відмінок.
// QA7-06: алергія домашнього — така сама тверда межа, як алергія власника,
// і позначається так само в рядку партії. Раніше мітка ставилась тільки за
// профілем власника, а алергії їдців лежали в блоці [ДОМАШНІ] в кінці промпту
// — і модель пропонувала арахісову пасту на сніданок для дому, де живе людина
// з алергією на арахіс. Той самий урок, що QA5-01: правило далеко від даних
// не працює, мітка мусить стояти там, куди модель дивиться.
export function serializePantry(
  bs: PantryBatch[],
  p?: Profile | null,
  now = Date.now(),
  eaters: EaterRow[] = [],
  fasting = false,
  // UX9-03/04: як показувати id партій. За замовчуванням — сирі uuid (як
  // було); Map uuid→alias — короткі p1..pN для recipe_gen (переписувати 36
  // символів модель не вміє); 'none' — без id взагалі (чат ними не
  // користується, це чистий шум і токени).
  ids: 'uuid' | 'none' | Map<string, string> = 'uuid',
  // B1 (OPTIMIZATION_PLAN): хард-кеп рядків. Без нього токени росли лінійно
  // з накопиченням комори (компаундна проблема, ~15-25 ток./рядок). Відбір:
  // позначені (⚠алерген/⚠піст) — ЗАВЖДИ, поза кепом (важіль якості: модель
  // бачить і може попередити); далі термінові (відкриті/догоряють); далі
  // свіжіші за added_at. Порядок рендера — вихідний (мінімум пертурбацій).
  cap = 60,
  // Черга Д (№2): продукти дому — подвійний алерген-захист (тег АБО корінь
  // у назві) і приблизний «вжити до» з shelf_open_days тегів.
  products: HouseholdProduct[] = [],
): string {
  const allergens = [
    ...(p?.allergies ?? []).map((a) => ({ label: a, who: '' })),
    ...eaters.flatMap((e) => e.allergies.map((a) => ({ label: a, who: ` в ${e.name}` }))),
  ]
    .filter((a) => a.label)
    .map((a) => ({ ...a, root: root(a.label) }));

  const prodById = new Map(products.map((pr) => [pr.id, pr]));
  const active = bs.filter((b) => b.state !== 'depleted');

  const scored = active.map((b) => {
    const prod = b.product_id ? prodById.get(b.product_id) : undefined;
    const words = meaningfulWords(b.label).map(root);
    // Тег АБО корінь: «камбоцола» без слова «молоко» ловиться тегом продукту.
    const tagRoots = (prod?.tags.allergens ?? []).map(root);
    const hit = allergens
      .filter((a) =>
        words.some((w) => w === a.root || w.startsWith(a.root) || a.root.startsWith(w))
        || tagRoots.some((t) => t === a.root || t.startsWith(a.root) || a.root.startsWith(t)))
      .map((a) => a.label + a.who);
    const fastHit = fasting && (isFastingRestricted(b.label) || prod?.tags.fasting === true);
    const days = b.expires_at
      ? Math.round((new Date(b.expires_at).getTime() - now) / 86_400_000)
      : null;
    // Приблизний «вжити до»: expires_at немає, партія відкрита, і теги (або
    // сама партія) знають, скільки живе відкрите. НЕ точна дата — «~».
    const shelf = prod?.tags.shelf_open_days ?? b.best_before_opened_days;
    const approxDays = days == null && b.state === 'opened' && b.opened_at && shelf != null
      ? shelf - Math.floor((now - new Date(b.opened_at).getTime()) / 86_400_000)
      : null;
    const ageDays = Math.floor((now - new Date(b.added_at).getTime()) / 86_400_000);
    return {
      b, hit, fastHit, days, approxDays, ageDays,
      marked: hit.length > 0 || fastHit,
      urgent: b.state === 'opened' || (days != null && days <= 7) || (approxDays != null && approxDays <= 3),
    };
  });

  let shown = scored;
  let hidden = 0;
  if (scored.length > cap) {
    const picked = new Set<string>();
    for (const s of scored) if (s.marked) picked.add(s.b.id);           // поза кепом
    const byRecency = [...scored].sort((a, b2) => b2.b.added_at.localeCompare(a.b.added_at));
    for (const s of byRecency) {
      if (picked.size >= cap) break;
      if (s.urgent) picked.add(s.b.id);
    }
    for (const s of byRecency) {
      if (picked.size >= cap) break;
      picked.add(s.b.id);
    }
    shown = scored.filter((s) => picked.has(s.b.id));
    hidden = scored.length - shown.length;
  }

  const rows = shown.map(({ b, hit, fastHit, days, approxDays, ageDays }) => {
    const shownId = ids === 'uuid' ? b.id : ids === 'none' ? null : (ids.get(b.id) ?? null);
    const parts = [...(shownId ? [shownId] : []), b.label, b.zone];
    if (b.value && b.unit) parts.push(`${b.value}${b.unit}`);
    if (b.state === 'opened') parts.push('вдкр');
    // Вік партії — щоб «свіже» і «лежить другий тиждень» розрізнялись.
    if (ageDays >= 2) parts.push(`дод.${ageDays}дн`);
    if (days != null && days <= 7) parts.push(`!${days}дн`);
    // Приблизна оцінка (з тегів продукту) — «~», щоб модель говорила м'яко.
    if (approxDays != null && approxDays <= 7) parts.push(`~строк≈${approxDays}дн`);
    // «...теж є, але не беру» — теж пропозиція: людина щойно прочитала
    // спокусу. Тому «не згадуй ВЗАГАЛІ», а не лише «не пропонуй».
    if (hit.length) parts.push(`⚠АЛЕРГЕН (${hit.join(', ')}) — сам не пропонуй і НЕ ЗГАДУЙ цю позицію взагалі (навіть «є, але не беру»); просять прямо — дай і назви алергію першою фразою reply`);
    // Третій flap calendar-lent: правило посту в середині контексту модель
    // ігнорувала і «рятувала» фарш тефтелями. Мітка в рядку партії — той
    // самий механізм, що двічі рятував з алергенами.
    if (fastHit) {
      parts.push('⚠ПІСТ — зараз піст: сам не пропонуй і не «рятуй» стравами; можна запропонувати заморозити одним реченням');
    }
    return parts.join(' · ');
  });

  // Хвіст — ТІЛЬКИ число, без зон/категорій/прикладів: натяк на вміст
  // перетворив би відрізане на «агрегат», який модель може «рятувати» наосліп
  // (ризик-профіль B2 з OPTIMIZATION_PLAN).
  if (hidden > 0) rows.push(`…і ще ${hidden} позицій — спитай, якщо треба`);
  return rows.join('\n');
}

// QA6-04: без списку в контексті модель у новій сесії казала «порожній» при
// двох позиціях і додавала дубль за один тап.
export function serializeShopping(items: ShoppingItemRow[]): string {
  if (!items.length) return '';
  const lines = items.map((i) => {
    const parts = [i.label];
    if (i.value != null && i.unit) parts.push(`${i.value}${i.unit}`);
    if (i.checked) parts.push('куплено');
    return parts.join(' · ');
  });
  return '\n\n[СПИСОК ПОКУПОК]\n' + lines.join('\n');
}

// QA4-08: Math.round давав «0дн тому» для готування 20 хвилин тому, і модель
// казала «вчора» — продукт брехав про факт із життя людини.
// UX9-28: дві страви за день без часу — модель вгадувала порядок і вгадала
// навпаки. Сьогодні/вчора несуть HH:MM, найсвіжіший запис позначений явно:
// переплутане гірше за забуте, бо переплутаного не видно.
export function serializeCookRun(r: RecentCookRunSummary, now = Date.now(), latest = false): string {
  const d = new Date(r.finished_at);
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const when = days === 0 ? `сьогодні ${hhmm}` : days === 1 ? `вчора ${hhmm}` : `${days} дн тому`;
  const parts = [r.title, latest ? `${when} (останнє)` : when];
  if (r.rating != null) parts.push(`★${r.rating}/5`);
  if (r.verdict) parts.push(`«${r.verdict}»`);
  return parts.join(' · ');
}

// Їдці дому: «зі мною живе Оксана, вона веганка». Страва готується на всіх,
// хто за столом, тому алергія їдця — така сама тверда межа, як алергія
// власника, і позначається тими самими словами.
export function serializeEaters(eaters: EaterRow[]): string {
  if (!eaters.length) return '';
  const lines = eaters.map((e) => {
    const parts = [e.name];
    if (e.allergies.length) parts.push(`АЛЕРГІЯ (тверда межа — ніколи не пропонуй сам): ${e.allergies.join(', ')}`);
    if (e.antipatterns.length) parts.push(`не їсть: ${e.antipatterns.join(', ')}`);
    if (e.wishes.length) parts.push(`тягне до: ${e.wishes.join(', ')}`);
    return '— ' + parts.join(' · ');
  });
  return '\n\n[ДОМАШНІ]\n' + lines.join('\n')
    + '\nСтрава готується на всіх за столом: обмеження домашніх враховуй нарівні з профілем.'
    + ' Якщо трапеза СПІЛЬНА («на нас», «на двох», «на сімʼю», «на вечерю всім») — алерген будь-кого з домашніх'
    + ' ВИКЛЮЧАЄ страву з пропозицій, а не додає позначку: за спільним столом «позначка, не заборона» не працює.'
    + ' Виключення покриває і НЕДОКУПЛЕНЕ: класти алерген у needs («докупити пармезан») для спільної страви так само не можна —'
    + ' підбирай страви, яким алерген не потрібен узагалі.'
    + ' Попередження про алерген ЗАВЖДИ перша фраза reply, ніколи не в why/desc — why це слот переконування, не безпеки.';
}

// Останні згенеровані рецепти. Без цього блоку модель не бачила ВЛАСНИХ
// рецептів: «а що ти там пропонував з борщем?» — і вона вигадувала борщ
// заново, з іншим мʼясом і іншими калоріями (скріни Пилипа: 280 ккал з
// яловичиною проти 180 зі свининою на ту саму назву).
export function serializeRecentRecipes(rows: RecipeRow[]): string {
  if (!rows.length) return '';
  const lines = rows.map((r) => {
    const payload = r.payload as Recipe | null;
    const ing = (payload?.ing ?? [])
      .map((i) => i.n)
      .filter((n): n is string => !!n)      // партії без назви (лише p) — не смітимо id-ами
      .join(', ');
    return `— ${r.title}${ing ? `: ${ing}` : ''}`;
  });
  return '\n\n[ЗГЕНЕРОВАНІ РЕЦЕПТИ]\n' + lines.join('\n')
    + '\nЯкщо людина повертається до однієї з цих страв — тримайся ЦЬОГО складу, не вигадуй новий підхід.'
    + ' Хоче інакше — вона скаже прямо.';
}

// Висновки з готування. Це єдине в контексті, що написала не система, а сама
// людина про свою кухню: «фует знімати, щойно краї хрусткі». Тому вони йдуть
// окремим блоком, а не тонуть у профілі серед побажань.
export function serializeNotes(notes: MemoryNote[]): string {
  if (!notes.length) return '';
  const line = (n: MemoryNote) => {
    const parts = [n.text];
    if (n.recipe_title) parts.push(`до «${n.recipe_title}»`);
    if (n.pinned) parts.push('закріплено');
    return '— ' + parts.join(' · ');
  };
  // Пул-2 №6: наміри — окремий блок. Висновок каже «як не помилитись»,
  // намір — «що заплановано»; змішані вони читались би як одна каша.
  const lessons = notes.filter((n) => (n.kind ?? 'lesson') === 'lesson');
  const intents = notes.filter((n) => n.kind === 'intent');
  let out = '';
  if (lessons.length) out += '\n\n[ВИСНОВКИ З ГОТУВАННЯ]\n' + lessons.map(line).join('\n');
  if (intents.length) {
    out += '\n\n[НАМІРИ] (ідеї, які людина відклала на потім — нагадай, коли складники в наявності або момент слушний)\n'
      + intents.map(line).join('\n');
  }
  return out;
}

// Повний блок стану, який іде в системний промпт після composed-промпту.
// Одна функція для прода і для eval — саме тому вона тут, а не в model.ts.
export function buildKitchenContext(ctx: KitchenContext): string {
  const now = ctx.now ?? new Date();
  const cookLog = ctx.recentCookRuns?.length
    ? '\n\n[ОСТАННІ ГОТУВАННЯ]\n'
      + ctx.recentCookRuns.map((r, i) => serializeCookRun(r, now.getTime(), i === 0)).join('\n')
    : '';
  return serializeProfile(ctx.profile)
    + '\n\n[СЬОГОДНІ] ' + todayLabel(now)
    // Календар іде одразу за датою: він її пояснює. Порожній, якщо нічого не
    // триває — і завжди порожній, поки традиція не розпізнана з побажань.
    + serializeOccasions(now, ctx.profile?.wishes ?? [])
    // UX9-04: чат-модель id партій не вживає НІДЕ — а отримувала uuid першим
    // словом кожного рядка. Шум і токени; вказівники бачить лише recipe_gen
    // (окрема серіалізація в callRecipe, з аліасами p1..pN).
    // UX9-04, «творча бухгалтерія»: модель додавала числа з історії до чисел
    // блока (500 з «купив» + 100 з блока = «600 г»). Рядок-нагадування в
    // самому блоці — той самий механізм, що рятував з алергенами й постом.
    + '\n\n[КОМОРА] (ПОВНИЙ перелік станом на зараз — інших партій не існує. Покупки з розмови ВЖЕ влиті в ці рядки, а готування вже віднято. Протокол на «скільки є X?»: знайди рядок X нижче → назви його число → крапка. Число менше, ніж купували? Так і має бути — різницю зʼїли готування. «~строк≈» — приблизна оцінка від відкриття: згадуй мʼяко — «варто передивитись», точні дні називай лише для «!Nдн»)\n'
    + serializePantry(ctx.pantry, ctx.profile, now.getTime(), ctx.eaters ?? [], fastingActive(now, ctx.profile?.wishes ?? []), 'none', 60, ctx.products ?? [])
    + serializeShopping(ctx.shopping ?? [])
    + cookLog
    + serializeNotes(ctx.notes ?? [])
    + serializeEaters(ctx.eaters ?? [])
    + serializeRecentRecipes(ctx.recentRecipes ?? []);
}
