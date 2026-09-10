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

import { CONTEXT_URGENT_DAYS } from './shelf-thresholds.js';
import { root, meaningfulWords, categoryBreadth} from '@kitchen/catalog';
import type { PantryBatch, ShoppingItemRow, RecipeRow, Recipe, HouseholdEventRow, Card, PendingCard } from './types.js';
import { type HouseholdProduct } from './product.js';
import { fastingActive, isFastingRestricted } from './occasions.js';
import { serializeNow, subscribedTraditions, subscribedRows } from './periods.js';
import { BUILTIN_OCCASIONS, type OccasionRow } from './occasion-data.js';
import { PROFILE_FIELDS, serializeProfileText, emptyProfileText, type ProfileText, type ProfileNote, type VetoRow } from './profile-text.js';
import { pantryVetoRows, effectiveExpiry, daysLeft } from './pantry-view.js';

import { serializeModes, type KitchenMode } from './modes.js';

export interface RecentCookRunSummary {
  title: string;
  rating: number | null;
  verdict: string | null;
  finished_at: string;
}

export interface KitchenContext {
  pantry: PantryBatch[];
  // Раунд 4: сім речень і нотатки — [ПРО ЛЮДИНУ] + [НОТАТКИ]. Без profileText
  // блок іде порожнім (і каже, що це не дозвіл).
  profileText?: ProfileText | null;
  profileNotes?: ProfileNote[];
  // П1: довідник приводів уже КРІЗЬ підписку дому (subscribedRows). Без
  // поля — весь вбудований довідник за дефолтами (сезони так, свята ні).
  occasions?: OccasionRow[];
  // Крок 4б: індекс вето → ⚠-мітки в рядках [КОМОРА].
  vetoIndex?: VetoRow[];
  shopping?: ShoppingItemRow[];
  recentCookRuns?: RecentCookRunSummary[];
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
  recipesTruncated?: boolean;
  // Аудит раунд 3, крок 5: картки, закриті (застосовані/скасовані/відхилені)
  // поза цією розмовою — щоб модель не реконструювала стан дому із власних
  // минулих реплік. repo.listRecentResolved(), вікно й ліміт рахує викликач.
  recentActions?: PendingCard[];
  // Раунд 5, крок К1: карта додатку — лише на ходах, де репліка схожа на
  // питання про додаток (productMapFor у product-question.ts). Іде одразу
  // за [ПРО ЛЮДИНУ]/[НОТАТКИ], перед [КОМОРА]: це довідка, не стан.
  productMap?: string | null;
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

// Комора: id · назва · зона · кількість · стан. Термін догоряння як «!Nдн»,
// щоб модель могла згадати про нього в репліці (бриф §04: інформація — репліка).
//
// QA5-01: алерген позначається ПРЯМО В РЯДКУ ПАРТІЇ, а не окремим правилом —
// правило за пів промпту від даних ігнорувалось. Збіг за коренем, не за
// підрядком: «шоколад з мигдалем».includes('мигдаль') дає false через відмінок.
// QA7-06 (історія): алергії їдців дому теж давали ⚠ у рядку партії — доти,
// доки П5-В5 не прибрав їдців зовсім. Урок лишається чинним для того джерела,
// що лишилось: правило далеко від даних не працює, мітка мусить стояти там,
// куди модель дивиться, — у самому рядку [КОМОРА], а не блоком у кінці.
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
  now = Date.now(),
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
  // Раунд 4, крок 4б: межа власника — veto_index (категорія чи продукт
  // позиції збігається з рядком індексу). Рядки з allergy=true дають ⚠АЛЕРГЕН,
  // решта — ⚠НЕ ЇСТЬ.
  //
  // П5-В5: їдців дому більше немає, тож джерело ⚠ лишилось одне — індекс
  // власника (pantryVetoRows: назва партії + назва позиції каталогу за
  // catalog_key). Мітки в рядках нікуди не діваються — саме заради них
  // знімається заборона; зникає лише приписка « в <імʼя>» і зіставлення
  // алергій їдця з тегами продукту, якому більше нема з чим зіставлятись.
  vetoIndex?: VetoRow[],
): string {
  const prodById = new Map(products.map((pr) => [pr.id, pr]));
  const active = bs.filter((b) => b.state !== 'depleted');

  const scored = active.map((b) => {
    const prod = b.product_id ? prodById.get(b.product_id) : undefined;
    // Індекс: за назвою партії й за позицією каталогу продукту (категорії
    // ієрархії — «стейк рібай» → яловичина → мʼясо).
    // Крок Ф1: той самий збіг, що дає `no` в GET /v1/pantry (pantry-view.ts).
    const vetoHits = vetoIndex?.length ? pantryVetoRows(b, prod?.catalog_key ?? null, vetoIndex) : [];
    const hit: string[] = [];
    for (const r of vetoHits.filter((r) => r.allergy)) if (!hit.includes(r.ref!)) hit.push(r.ref!);
    const noEat = vetoHits.filter((r) => !r.allergy).map((r) => r.ref!);
    const fastHit = fasting && (isFastingRestricted(b.label) || prod?.tags.fasting === true);
    const days = b.expires_at
      ? Math.round((new Date(b.expires_at).getTime() - now) / 86_400_000)
      : null;
    // Приблизний «вжити до»: expires_at немає, партія відкрита, і теги (або
    // сама партія) знають, скільки живе відкрите. НЕ точна дата — «~».
    const shelf = prod?.tags.shelf_open_days ?? b.best_before_opened_days;
    const openApprox = days == null && b.state === 'opened' && b.opened_at && shelf != null
      ? shelf - Math.floor((now - new Date(b.opened_at).getTime()) / 86_400_000)
      : null;
    // Б1: запечатана партія теж дістає приблизний строк — від дати
    // завантаження, зони й каталогу. Досі 245 із 246 позицій ішли в контекст
    // узагалі без позначки часу.
    //
    // Саме приблизний, і це принципово: `state-facts.md` наказує читати
    // «!Nдн» як «саме стільки днів». Розрахунок такої точності не має, і
    // видати його за точний означало б збрехати рівно так, як робив зразок
    // «все свіже» в розборі вкладення.
    const zoneApprox = days == null && openApprox == null
      ? daysLeft(effectiveExpiry(b, prod?.catalog_key ?? null, now), now)
      : null;
    const approxDays = openApprox ?? zoneApprox;
    const ageDays = Math.floor((now - new Date(b.added_at).getTime()) / 86_400_000);
    return {
      b, hit, noEat, fastHit, days, approxDays, ageDays,
      marked: hit.length > 0 || noEat.length > 0 || fastHit,
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

  const rows = shown.map(({ b, hit, noEat, fastHit, days, approxDays, ageDays }) => {
    const shownId = ids === 'uuid' ? b.id : ids === 'none' ? null : (ids.get(b.id) ?? null);
    const parts = [...(shownId ? [shownId] : []), b.label, b.zone];
    if (b.value && b.unit) parts.push(`${b.value}${b.unit}`);
    if (b.state === 'opened') parts.push('вдкр');
    // Вік партії — щоб «свіже» і «лежить другий тиждень» розрізнялись.
    if (ageDays >= 2) parts.push(`дод.${ageDays}дн`);
    // Етап 2a (Р2): сьома доба — третя драбина, і вона тепер названа в
    // shelf-thresholds разом з іншими двома. Число те саме, місце одне.
    if (days != null && days <= CONTEXT_URGENT_DAYS) parts.push(`!${days}дн`);
    // Приблизна оцінка (з тегів продукту) — «~», щоб модель говорила м'яко.
    if (approxDays != null && approxDays <= CONTEXT_URGENT_DAYS) parts.push(`~строк≈${approxDays}дн`);
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
    // Раунд 4 §5: без прапорця алергії — просто не пропонувати, без
    // попереджень і без згадки; на пряму просьбу — дати без коментарів.
    else if (noEat.length) parts.push(`⚠НЕ ЇСТЬ (${noEat.join(', ')}) — сам не пропонуй і не згадуй цю позицію; просять прямо — дай, без попереджень`);
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

// Тип по-людськи. Пряме дзеркало Card['type']: гілка картки профілю пішла
// разом із родиною (П5-В4).
function humanCardType(card: Card): string {
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
    const type = humanCardType(pc.card);
    const content = joinNames(cardContentNames(pc.card));
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
  const profileText = ctx.profileText ?? emptyProfileText('');
  // П1: довідник крізь підписку; традиції — ті, чиї свята увімкнені.
  const rows = ctx.occasions ?? subscribedRows(BUILTIN_OCCASIONS, []);
  const trads = subscribedTraditions(rows);
  return serializeProfileText(profileText, ctx.profileNotes ?? [])
    + (ctx.productMap ? '\n\n' + ctx.productMap.trim() : '')
    + '\n\n[СЬОГОДНІ] ' + todayLabel(now)
    // П1: один блок [ЗАРАЗ] одразу за датою — приводи крізь підписку і
    // записи дому одним списком; порожній, коли нічого не триває.
    + serializeNow(rows, ctx.events ?? [], now)
    // UX9-04: чат-модель id партій не вживає НІДЕ — а отримувала uuid першим
    // словом кожного рядка. Шум і токени; вказівники бачить лише recipe_gen
    // (окрема серіалізація в callRecipe, з аліасами p1..pN).
    // UX9-04, «творча бухгалтерія»: модель додавала числа з історії до чисел
    // блока (500 з «купив» + 100 з блока = «600 г»). Рядок-нагадування в
    // самому блоці — той самий механізм, що рятував з алергенами й постом.
    + '\n\n[КОМОРА] (ПОВНИЙ перелік станом на зараз — інших партій не існує. Покупки з розмови ВЖЕ влиті в ці рядки, а готування вже віднято. Протокол на «скільки є X?»: знайди рядок X нижче → назви його число → крапка. Число менше, ніж купували? Так і має бути — різницю зʼїли готування. «~строк≈» — приблизна оцінка від відкриття: згадуй мʼяко — «варто передивитись», точні дні називай лише для «!Nдн». «?рід» — записано родовим словом, конкретний продукт невідомий: коли доходить до страви, доречно спитати ОДНИМ реченням, що це саме — але тільки якщо ти цього ще не питав у цій розмові. «?домисл.N%» — кількість або сама позиція домислена з розбору, не сказана людиною: не подавай її як точний факт («десь», «приблизно»), а коли вона стає важливою для страви чи покупки — уточни одним реченням; без мітки — не сумнівайся, число точне)\n'
    + serializePantry(ctx.pantry, now.getTime(), fastingActive(now, rows, trads), 'none', 120, ctx.products ?? [], ctx.queryText ?? '', ctx.vetoIndex)
    + serializeShopping(ctx.shopping ?? [])
    + cookLog
    + renderRecentActions(ctx.recentActions ?? [], now)
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

// П1: [ТВОЇ ПЛАНИ] поглинув блок [ЗАРАЗ] (periods.ts, serializeNow) — плани
// дому там разом із приводами довідника, з тими самими короткими id.
