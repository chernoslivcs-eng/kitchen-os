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

import { root, meaningfulWords, categoryBreadth} from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';
import type { PantryBatch, Profile, ShoppingItemRow, MemoryNote, EaterRow, RecipeRow, Recipe, HouseholdEventRow, Card, PendingCard } from './types.js';
import { catalogGroupsToAllergens, type HouseholdProduct } from './product.js';
import { serializeOccasions, fastingActive, isFastingRestricted, traditionsOf } from './occasions.js';
import { isProfileFieldCard } from './types.js';
import { PROFILE_FIELDS, serializeProfileText, type ProfileText, type ProfileNote } from './profile-text.js';
import type { Tradition } from './occasion-rules.js';

const TRADITION_UA: Record<Tradition, string> = {
  orthodox: 'православна', catholic: 'католицька', islamic: 'ісламська', jewish: 'юдейська',
};
import { serializeModes, type KitchenMode } from './modes.js';

export interface RecentCookRunSummary {
  title: string;
  rating: number | null;
  verdict: string | null;
  finished_at: string;
}

export interface KitchenContext {
  pantry: PantryBatch[];
  profile?: Profile | null;
  // Раунд 4 (PROFILE_V2): сім речень і нотатки. Коли задано profileText —
  // замість [ПРОФІЛЬ] іде [ПРО ЛЮДИНУ] + [НОТАТКИ] на тому самому місці, а
  // [ВИСНОВКИ З ГОТУВАННЯ]/[НАМІРИ] не рендеряться (їх джерело переїхало).
  // `profile` лишається для календаря (традиції) і алерген-вето до кроку 4.
  profileText?: ProfileText | null;
  profileNotes?: ProfileNote[];
  shopping?: ShoppingItemRow[];
  recentCookRuns?: RecentCookRunSummary[];
  notes?: MemoryNote[];
  eaters?: EaterRow[];
  recentRecipes?: RecipeRow[];
  // Черга Д (№2): продукти дому — теги живлять ⚠-мітки і «~строк≈».
  products?: HouseholdProduct[];
  // Пул-3: текст поточної розмови — згадані позиції гарантовано в кепі комори.
  queryText?: string;
  // Календар: події дому. Без них модель не може ні згадати план, ні виправити
  // його — а правити доручено саме їй.
  events?: HouseholdEventRow[];
  now?: Date;                            // для тестів — інакше Date.now()
  // M13: чи підключена мережа (Сільпо). undefined = інтеграція не
  // сконфігурована на сервері — блок мовчить, модель про неї не знає.
  retailConnected?: boolean;
  /** Відкриті джерела без підключення (Стейки Карпат). */
  retailKarpaty?: boolean;
  // №4: що зараз відкрито (кошик, свіжий рецепт, неоцінене готування).
  // Рахує сервер із повідомлень сесії — модель більше не виводить ситуацію
  // з двадцяти рядків історії.
  modes?: KitchenMode[];
  // 8b: чи обрізані блоки з лімітом на рівні репозиторію.
  notesTruncated?: boolean;
  recipesTruncated?: boolean;
  // Аудит раунд 3, крок 5: картки, закриті (застосовані/скасовані/відхилені)
  // поза цією розмовою — щоб модель не реконструювала стан дому із власних
  // минулих реплік. repo.listRecentResolved(), вікно й ліміт рахує викликач.
  recentActions?: PendingCard[];
}

// M13: без цього блока модель на «замов через сільпо» відповідала categorичною
// відмовою — «це робиться в додатку Сільпо», хоча build-cart уже вміє це
// зробити сама. Обидва стани явні: підключено → модель має руки (card_go
// cart_go); не підключено → веде людину в Профіль, а не мовчить і не бреше.
export function serializeRetail(connected: boolean | undefined, karpaty?: boolean): string {
  if (connected === undefined) return '';
  const lines = [connected
    ? 'Сільпо: підключено. Список можна оформити карткою cart_go — сервер сам зіставить позиції з мережею.'
    : 'Сільпо: не підключено. На прохання замовити через мережу — одним реченням направ у Профіль → Мережі → Підключити, картку cart_go НЕ повертай.'];
  // Відкриті джерела: без підключення, без кошика — лише «що є і почім».
  // Питання про наявність (retail_search_go) працює, навіть коли Сільпо не підключено.
  if (karpaty) {
    lines.push('Стейки Карпат: доступно без підключення — крафтове мʼясо (яловичина, стейки, птиця, набори), доставка Новою Поштою по Україні. Питання «що є / почім» по мʼясу — retail_search_go; замовлення — на їхньому сайті, кошика тут нема.');
  }
  return '\n\n[МЕРЕЖІ] ' + lines.join('\n');
}

export function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Профіль. QA4-02: до цього алергії зберігались, показувались у UI — і не
// впливали ні на що; модель двічі пропонувала мигдаль людині з алергією.
// M13-ROLE-VOICE п.1: порожній профіль — НЕ дозвіл. Людину могли ще не
// спитати (саме на порожньому профілі вмикається онбординг stage 2), і тиша
// не сміє читатись як підтверджене «обмежень немає»: ціна цієї підміни —
// алерген у пропозиції. Тому блок присутній завжди і несе різницю явно.
export function serializeProfile(p?: Profile | null): string {
  const parts: string[] = [];
  if (p) {
    if (p.allergies.length) {
      parts.push('АЛЕРГІЇ (тверда межа — ніколи не пропонуй сам): ' + p.allergies.join(', '));
    }
    if (p.antipatterns.length) parts.push('НЕ ЇСТЬ / НЕ ЛЮБИТЬ: ' + p.antipatterns.join(', '));
    if (p.wishes.length) parts.push('ЛЮБИТЬ / ТЯГНЕ ДО: ' + p.wishes.join(', '));
    // Явний вибір у профілі. Порожній масив — теж вибір: людина вимкнула
    // релігійні приводи, і «постуємо» в побажаннях його не скасовує.
    if (Array.isArray(p.traditions)) {
      parts.push(p.traditions.length
        ? 'ТРАДИЦІЇ (обрано в профілі): ' + p.traditions.map((t) => TRADITION_UA[t]).join(', ')
        : 'ТРАДИЦІЇ: вимкнено в профілі — релігійних свят і постів не пропонуй і про календар не питай');
    }
    const eq = Object.entries(p.equipment ?? {});
    const has = eq.filter(([, v]) => v === 'has').map(([k]) => k);
    const lacks = eq.filter(([, v]) => v === 'lacks').map(([k]) => k);
    if (has.length) parts.push('Є ТЕХНІКА: ' + has.join(', '));
    if (lacks.length) parts.push('НЕМАЄ ТЕХНІКИ: ' + lacks.join(', '));
  }
  if (!parts.length) {
    return '\n\n[ПРОФІЛЬ] порожній — обмежень, алергій і побажань ще не записано.'
      + ' Це НЕ означає, що їх немає: найімовірніше, ще не питали.';
  }
  return '\n\n[ПРОФІЛЬ]\n' + parts.join('\n');
}

// Раунд 4: під PROFILE_V2 блок [ПРО ЛЮДИНУ] — лише її слова. Традиції —
// перемикач календаря (раунд 5 вирішить, де він живе), тож ідуть окремим
// коротким блоком і лише коли людина їх обирала (масив, не null).
export function serializeTraditionsV2(p?: Profile | null): string {
  if (!p || !Array.isArray(p.traditions)) return '';
  return p.traditions.length
    ? '\n\n[ТРАДИЦІЇ] обрано в профілі: ' + p.traditions.map((t) => TRADITION_UA[t]).join(', ')
    : '\n\n[ТРАДИЦІЇ] вимкнено в профілі — релігійних свят і постів не пропонуй і про календар не питай';
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
// Партія записана родовим словом, а не назвою продукту. Міряємо по БАЗІ
// трійки («крем-брускетта» з «Крем-брускетта Ponti з чорних оливок»), а не
// по видимій назві: категорійність — властивість продукту, не рядка з
// брендом і сортом.
//
// Партії без продукту (старі, до трійки) НЕ позначаємо: там ми просто не
// знаємо, а мовчання чесніше за здогад.
const GENERIC_BREADTH = 100;
function genericFor(b: PantryBatch, prodById: Map<string, HouseholdProduct>): boolean {
  const prod = b.product_id ? prodById.get(b.product_id) : undefined;
  if (!prod?.product) return false;
  const breadth = categoryBreadth(prod.product);
  return breadth !== null && breadth >= GENERIC_BREADTH;
}

// Поріг сумніву для «?домисл.»: нижче 0.8 або домислено. 0.8 — те, що
// модель ставить на звичайну репліку («купив сир Viola» → 0.8, прод s40);
// 0.7 з evidence: inference — уже здогад. Той самий поріг стане межею
// auto/confirm у card-modes (крок 1.3), щоб мітка і режим казали одне.
export const DOUBT_THRESHOLD = 0.8;
export function isDoubtful(b: Pick<PantryBatch, 'confidence' | 'provenance'>): boolean {
  return b.provenance === 'inference' || b.confidence < DOUBT_THRESHOLD;
}

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
  // Пул-3: кеп піднято 60→120 — реальна комора дому ~110-150 позицій
  // (виміряно на живому інвентарі), 60 ховало майже половину.
  cap = 120,
  // Черга Д (№2): продукти дому — подвійний алерген-захист (тег АБО корінь
  // у назві) і приблизний «вжити до» з shelf_open_days тегів.
  products: HouseholdProduct[] = [],
  // Пул-3: запито-залежний відбір. Текст поточної розмови (репліка + свіжі
  // ходи): згадані в ньому позиції гарантовано їдуть у кеп — «скільки в мене
  // спагеті?» ніколи не впирається у сховану позицію. Тільки додає рядки,
  // ніколи не віднімає — класу «не поклали потрібне» тут не буває.
  queryText = '',
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
    // Три джерела ⚠: корінь у назві АБО тег продукту АБО алерген-групи
    // каталогу через catalog_key («мідії» → «молюски» без жодного кореня).
    const catGroups = prod?.catalog_key
      ? catalogGroupsToAllergens(BY_KEY.get(prod.catalog_key)?.allergen_groups ?? [])
      : [];
    const tagRoots = [...(prod?.tags.allergens ?? []), ...catGroups].map(root);
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
    // Ярус 1: згадане в розмові — той самий кореневий збіг, що ловить алергени.
    const queryRoots = meaningfulWords(queryText).map(root);
    if (queryRoots.length) {
      for (const s of scored) {
        const words = meaningfulWords(s.b.label).map(root);
        if (words.some((w) => queryRoots.some((q) => w === q || w.startsWith(q) || q.startsWith(w)))) {
          picked.add(s.b.id);
        }
      }
    }
    const byRecency = [...scored].sort((a, b2) => b2.b.added_at.localeCompare(a.b.added_at));
    // Ярус 2: термінові (відкриті/догоряють).
    for (const s of byRecency) {
      if (picked.size >= cap) break;
      if (s.urgent) picked.add(s.b.id);
    }
    // Ярус 3: квота залежаним — 10 найстаріших активних. Мости «що купити?»
    // будуються саме від них; сортування за свіжістю ховало їх першими.
    const byAge = [...scored].sort((a, b2) => a.b.added_at.localeCompare(b2.b.added_at));
    let idleQuota = 10;
    for (const s of byAge) {
      if (idleQuota <= 0 || picked.size >= cap) break;
      if (!picked.has(s.b.id)) { picked.add(s.b.id); idleQuota--; }
    }
    // Ярус 4: решта — за свіжістю, до кепа.
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
    // «?рід» — записано КАТЕГОРІЄЮ, не продуктом: під «мʼясо» в каталозі 560
    // позицій, під «сир» 270. Рахує каталог, не модель, тож ознака однакова
    // завжди. Поріг 100 відсікає вузькі категорії («ковбаса» 58, «олія» 49):
    // питати про них — це вже прискіпливість, а не брак даних.
    if (genericFor(b, prodById)) parts.push('?рід');
    // «?домисл.N%» — партія записана з низькою впевненістю або домислена
    // (evidence: inference). Аудит 04.09 (3.3): confidence писався в партію
    // і ніде не читався; лендинг обіцяє «домислено 60%» як перше правило
    // довіри, ToV §7 — «схоже на філе, перевір». Мітка в рядку — той самий
    // механізм, що ?рід: модель бачить, ЩО саме непевне, і може спитати
    // про це одним реченням замість вдавати точність або сумніватись усюди.
    if (isDoubtful(b)) parts.push(`?домисл.${Math.round(b.confidence * 100)}%`);
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
//
// M13-ROLE-VOICE п.1: порожній список — це ВІДПОВІДЬ, а не відсутність даних.
// Поки блок зникав, модель не мала куди подивитись (role.md наказує «подивись
// у блок» і забороняє казати «блок порожній») і добудовувала стан із розмови.
export function serializeShopping(items: ShoppingItemRow[]): string {
  if (!items.length) {
    return '\n\n[СПИСОК ПОКУПОК] порожній — жодної позиції не записано.';
  }
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
  // M13-ROLE-VOICE п.1: порожньо — це «крім власника нікого не записано»,
  // а не «нікого немає». Різниця та сама, що в профілі: могли не спитати.
  if (!eaters.length) {
    return '\n\n[ДОМАШНІ] порожньо — крім власника, їдців не записано.';
  }
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
// 8b: `truncated` — «показано не все». Комора має чесний хвіст «…і ще N
// позицій» від першого дня; решта блоків обрізалась мовчки, і модель бачила
// обрізане як ПОВНЕ. Числа тут немає навмисно: репозиторій віддає лише
// перші N, точна кількість решти невідома — вигадувати її означало б лікувати
// одну неправду іншою.
export function serializeRecentRecipes(rows: RecipeRow[], truncated = false): string {
  if (!rows.length) {
    return '\n\n[ЗГЕНЕРОВАНІ РЕЦЕПТИ] порожньо — у цьому домі ти ще не генерував рецептів.';
  }
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
    + ' Хоче інакше — вона скаже прямо.'
    + (truncated ? '\nПоказано не всі — є й інші, раніші. Спитай, якщо треба.' : '');
}

// Висновки з готування. Це єдине в контексті, що написала не система, а сама
// людина про свою кухню: «фует знімати, щойно краї хрусткі». Тому вони йдуть
// окремим блоком, а не тонуть у профілі серед побажань.
export function serializeNotes(notes: MemoryNote[], truncated = false): string {
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
  // M13-ROLE-VOICE п.1: обидва підблоки присутні завжди. Для висновків це не
  // косметика — card-rules.md наказує «не пропонуй записати те, що вже там є»,
  // а без блока звіряти було ні з чим, і модель пропонувала дублі.
  let out = lessons.length
    ? '\n\n[ВИСНОВКИ З ГОТУВАННЯ]\n' + lessons.map(line).join('\n')
    : '\n\n[ВИСНОВКИ З ГОТУВАННЯ] порожньо — висновків про техніку ще не записано.';
  if (lessons.length && truncated) {
    out += '\nПоказано не всі — є й інші, раніші. Спитай, якщо треба.';
  }
  out += intents.length
    ? '\n\n[НАМІРИ] (ідеї, які людина відклала на потім — нагадай, коли складники в наявності або момент слушний)\n'
      + intents.map(line).join('\n')
    : '\n\n[НАМІРИ] порожньо — відкладених ідей не записано.';
  return out;
}

// Аудит раунд 3, крок 5: [ОСТАННІ ДІЇ] — детермінований підсумок карток дому,
// закритих ПОЗА цією розмовою (repo.listRecentResolved уже виключив поточну
// сесію і вікно старіше 48 год). Без цього блока модель бачить лише свою
// власну історію реплік — і на «мамо, я записав» з ІНШОЇ вкладки/сесії
// відповідає так, ніби нічого не сталось.
//
// <коли> повторює бакети serializeCookRun (сьогодні/вчора HH:MM, N дн тому),
// плюс хвилинний бакет для свіжого — резолюція тут важливіша, ніж у журналі
// готувань: «40 хв тому» і «вчора» це різні відповіді на «ти вже це зробив?».
function relativeWhen(atMs: number, nowMs: number): string {
  const diffMin = Math.floor((nowMs - atMs) / 60_000);
  if (diffMin < 60) return `${Math.max(1, diffMin)} хв тому`;
  const d = new Date(atMs);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.floor((nowMs - atMs) / 86_400_000);
  return days === 0 ? `сьогодні ${hhmm}` : days === 1 ? `вчора ${hhmm}` : `${days} дн тому`;
}

// Тип по-людськи. profile з усіма ops kind:'note' — «нотатка», не «профіль»:
// той самий поділ, що kitchen-policy.md уже проводить для note проти
// анти/алергій. Решта — пряме дзеркало Card['type'].
function humanCardType(card: Card): string {
  if (card.type === 'profile') {
    if (isProfileFieldCard(card)) {
      return card.onboarding && !card.text.trim() ? `онбординг „${PROFILE_FIELDS[card.field].lead}"` : `записав у „${PROFILE_FIELDS[card.field].lead}"`;
    }
    const ops = (card.ops ?? []) as { kind?: string }[];
    if (ops.length && ops.every((o) => o.kind === 'note')) return 'нотатка';
    return 'профіль';
  }
  const NAMES: Partial<Record<Card['type'], string>> = {
    intake_diff: 'комора', shopping: 'список', event: 'подія',
    cook_photo: 'готування', recipe: 'рецепт',
  };
  return NAMES[card.type] ?? card.type;
}

// Назви з картки — ті самі поля, що summarizeCard (services/api/chat-history.ts)
// читає для тієї ж мети (показати, ЩО саме картка несе). Не імпортується
// напряму: chat-history.ts живе в services/api, а домен нижче за шаром і
// залежати від api не може — тому тут власна, легша версія: лише назви,
// без op-дієслів, з кепом на 3 (там кепу немає взагалі).
function cardContentNames(card: Card): string[] {
  if (card.type === 'intake_diff') return card.ops.map((o) => o.label).filter(Boolean);
  if (card.type === 'shopping') return card.items.map((i) => i.label).filter(Boolean);
  if (card.type === 'profile') {
    if (isProfileFieldCard(card)) return card.text.trim() ? [card.text.trim()] : [];
    return (card.ops ?? []).map((o) => o.label).filter(Boolean);
  }
  if (card.type === 'event') return card.ops.map((o) => o.title ?? '').filter(Boolean);
  if (card.type === 'recipe') return card.recipe?.t ? [card.recipe.t] : [];
  if (card.type === 'cook_photo') return card.recipe_title ? [card.recipe_title] : [];
  return [];
}

function joinNames(names: string[]): string {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` … ще ${rest}` : '');
}

export function renderRecentActions(cards: PendingCard[], now: Date): string {
  if (!cards.length) return '';
  const nowMs = now.getTime();
  const lines = cards.slice(0, 5).map((pc) => {
    const resolvedMs = Math.max(
      pc.applied_at ? new Date(pc.applied_at).getTime() : -Infinity,
      pc.undone_at ? new Date(pc.undone_at).getTime() : -Infinity,
      pc.dismissed_at ? new Date(pc.dismissed_at).getTime() : -Infinity,
    );
    const result = pc.dismissed_at ? 'відхилено' : pc.undone_at ? 'скасовано' : 'застосовано';
    let type = humanCardType(pc.card);
    let content = joinNames(cardContentNames(pc.card));
    // Картка поля, застосована без тексту — це «Нічого такого» (лише ban).
    if (isProfileFieldCard(pc.card) && pc.applied_at && !pc.card.text.trim()) {
      type = `записав у „${PROFILE_FIELDS[pc.card.field].lead}"`;
      content = 'нічого такого';
    }
    return `• ${relativeWhen(resolvedMs, nowMs)} · ${type}${content ? `: ${content}` : ''} — ${result}`;
  });
  return '\n\n[ОСТАННІ ДІЇ] (поза цією розмовою, 2 дні. Застосоване — вже в даних вище, не записуй знову; '
    + 'відхилене — людина сказала «ні», не повертайся сама; скасоване — у даних нема)\n'
    + lines.join('\n');
}

// Повний блок стану, який іде в системний промпт після composed-промпту.
// Одна функція для прода і для eval — саме тому вона тут, а не в model.ts.
export function buildKitchenContext(ctx: KitchenContext): string {
  const now = ctx.now ?? new Date();
  const cookLog = ctx.recentCookRuns?.length
    ? '\n\n[ОСТАННІ ГОТУВАННЯ]\n'
      + ctx.recentCookRuns.map((r, i) => serializeCookRun(r, now.getTime(), i === 0)).join('\n')
    : '\n\n[ОСТАННІ ГОТУВАННЯ] порожньо — жодного завершеного готування ще немає.';
  const v2 = !!ctx.profileText;
  return (v2 ? serializeProfileText(ctx.profileText!, ctx.profileNotes ?? []) + serializeTraditionsV2(ctx.profile) : serializeProfile(ctx.profile))
    + '\n\n[СЬОГОДНІ] ' + todayLabel(now)
    // Календар іде одразу за датою: він її пояснює. Порожній, якщо нічого не
    // триває — і завжди порожній, поки традиція не розпізнана з побажань.
    + serializeOccasions(now, ctx.profile?.wishes ?? [], undefined, traditionsOf(ctx.profile))
    + serializeHouseholdEvents(ctx.events ?? [], now)
    // UX9-04: чат-модель id партій не вживає НІДЕ — а отримувала uuid першим
    // словом кожного рядка. Шум і токени; вказівники бачить лише recipe_gen
    // (окрема серіалізація в callRecipe, з аліасами p1..pN).
    // UX9-04, «творча бухгалтерія»: модель додавала числа з історії до чисел
    // блока (500 з «купив» + 100 з блока = «600 г»). Рядок-нагадування в
    // самому блоці — той самий механізм, що рятував з алергенами й постом.
    + '\n\n[КОМОРА] (ПОВНИЙ перелік станом на зараз — інших партій не існує. Покупки з розмови ВЖЕ влиті в ці рядки, а готування вже віднято. Протокол на «скільки є X?»: знайди рядок X нижче → назви його число → крапка. Число менше, ніж купували? Так і має бути — різницю зʼїли готування. «~строк≈» — приблизна оцінка від відкриття: згадуй мʼяко — «варто передивитись», точні дні називай лише для «!Nдн». «?рід» — записано родовим словом, конкретний продукт невідомий: коли доходить до страви, доречно спитати ОДНИМ реченням, що це саме — але тільки якщо ти цього ще не питав у цій розмові. «?домисл.N%» — кількість або сама позиція домислена з розбору, не сказана людиною: не подавай її як точний факт («десь», «приблизно»), а коли вона стає важливою для страви чи покупки — уточни одним реченням; без мітки — не сумнівайся, число точне)\n'
    + serializePantry(ctx.pantry, ctx.profile, now.getTime(), ctx.eaters ?? [], fastingActive(now, ctx.profile?.wishes ?? [], undefined, traditionsOf(ctx.profile)), 'none', 120, ctx.products ?? [], ctx.queryText ?? '')
    + serializeShopping(ctx.shopping ?? [])
    + cookLog
    + (v2 ? '' : serializeNotes(ctx.notes ?? [], ctx.notesTruncated))
    + renderRecentActions(ctx.recentActions ?? [], now)
    + serializeEaters(ctx.eaters ?? [])
    + serializeRecentRecipes(ctx.recentRecipes ?? [], ctx.recipesTruncated)
    + serializeRetail(ctx.retailConnected, ctx.retailKarpaty)
    // Режим — ОСТАННІМ: це найлетючіше й найдієвіше, що є в контексті, і
    // читається безпосередньо перед тим, як модель обирає хід.
    + serializeModes(ctx.modes ?? []);
}

// Пул-3, pantry-truth: «творча бухгалтерія» — модель брала «500 г» з живої
// репліки історії замість «100g» з [КОМОРА], і чотири промпт-ітерації
// (правило → шапка-протокол → мітка [ЗАСТОСОВАНО] → таймстемпи) знижували
// частоту, але не прибирали корінь: поки конкурентне число стоїть у діалозі,
// воно інколи перемагає довідку. Прибираємо спокусу механічно: кількості з
// одиницями ЗАПАСУ (вага/обʼєм/штуки/пачки) маскуються в історичних ходах.
// Порції, хвилини, градуси, відсотки жирності — не запас, не чіпаються.
// Поточна репліка юзера цим НЕ обробляється ніколи.
export function maskHistoryQuantities(text: string): string {
  return text
    // словесні кількості: «пів кіла помідорів», «половина літра». Увага:
    // \w у JS не знає кирилиці — відмінкові форми перелічені явно.
    .replace(/(?:пів|половин[аиу]?|чверть)\s*(?:кіло|кіла|кг|кілограм(?:а|и|ів)?|літр(?:а|и|ів)?|пачк(?:а|и|у)?|пачок|упаковк(?:а|и|у)?|упаковок|банк(?:а|и|у)?|банок)(?![а-щьюяіїєґ])/gi, '')
    .replace(
      /\d+(?:[.,]\d+)?\s*(?:кг|кілограм(?:и|ів)?|г|гр|грам(?:и|ів)?|мл|мілілітр(?:и|ів)?|л|літр(?:и|ів)?|шт(?:ук(?:и|а)?)?|пач(?:ок|ки|ка)?|упаков(?:ок|ки|ка)?)(?![а-щьюяіїєґ%])\.?/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

/**
 * Плани людини в контекст — з короткими id, щоб модель могла на них послатись.
 * Саме людини, а не дому: календар не спільний елемент користування.
 *
 * Id вісім символів, не повні uuid: блок динамічний, тобто не кешується, і
 * двадцять подій повними ідентифікаторами коштували б ~700 зайвих символів
 * у КОЖНОМУ виклику. Префікс розгортає сервер (routes/chat.ts) — у межах
 * одного дому збіг практично неможливий, а перевірка все одно є.
 *
 * Закриті й згаслі події не йдуть: «мама привезе цибулю» через місяць — шум,
 * і саме проти нього писався expires_at.
 */
export function serializeHouseholdEvents(events: HouseholdEventRow[], now = new Date()): string {
  const live = events.filter((e) => {
    if (e.done_at) return false;
    if (e.expires_at && new Date(e.expires_at).getTime() < now.getTime()) return false;
    return true;
  });
  if (!live.length) return '';

  const DOW = ['неділі', 'понеділка', 'вівторка', 'середи', 'четверга', 'пʼятниці', 'суботи'];
  const line = (e: HouseholdEventRow): string => {
    const id = e.id.slice(0, 8);
    let when = '';
    if (e.rule.t === 'once') {
      const [, m = '1', d = '1'] = e.rule.at.split('-');
      when = `${Number(d)}.${Number(m)}`;
      if (e.rule.days && e.rule.days > 1) when += ` (${e.rule.days} дн.)`;
    } else if (e.rule.t === 'weekly') {
      when = `що${DOW[e.rule.dow] ?? 'тижня'}`;
    }
    const tail = [e.note, e.servings ? `на ${e.servings}` : null].filter(Boolean).join('; ');
    return `[${id}] ${when}: ${e.title}${tail ? ` — ${tail}` : ''}`;
  };

  return '\n\n[ТВОЇ ПЛАНИ] (те, що людина сама поставила в календар; id у дужках — щоб правити,'
    + ' закривати чи прибирати карткою event. Нагадуй про план, коли він доречний,'
    + ' і не переказуй увесь список без запиту)\n'
    + live.map(line).join('\n');
}
