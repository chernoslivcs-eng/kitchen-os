// Доменні типи. Свідомо на TypeScript, а не на Zod: schema-валідація — окремий шар
// на межі HTTP (services/api). Тут — чиста форма.

import type { ProfileFieldKey, ProfileFieldValue } from './profile-text.js';
import type { Rule, Tradition } from './occasion-rules.js';

export type Zone = 'dry' | 'fridge' | 'freezer' | 'fresh' | 'spices' | 'drinks';
export type Unit = 'g' | 'ml' | 'pcs' | 'pack';
export type BatchState = 'sealed' | 'opened' | 'depleted';
// А1: чому партія зникла з комори. Без цього поля головна метрика продукту
// (AGENT-BRIEF.md:120 — «частка позицій, списаних як зіпсувалось») не рахується
// взагалі: зʼїдене й викинуте лягають в один і той самий `depleted`.
//   eaten   — зʼїли або використали в готуванні
//   spoiled — зіпсувалось; це і є чисельник метрики
//   removed — прибрали з комори цілим (помилка обліку, дубль, віддали)
// `null` — не питали й не знаємо. Це чесний стан, а не дефолт: масовий скрипт
// і чатовий `deplete` причини не знають, і вигадувати її за них не можна.
export type DepletedReason = 'eaten' | 'spoiled' | 'removed';
export const DEPLETED_REASONS: DepletedReason[] = ['eaten', 'spoiled', 'removed'];
export type Provenance = 'receipt_line' | 'package_label' | 'user_statement' | 'visual_guess' | 'inference';

export interface PantryBatch {
  id: string;
  household_id: string;
  catalog_key: string | null;
  label: string;
  zone: Zone;
  value: number | null;
  unit: Unit | null;
  state: BatchState;
  opened_at: string | null;
  expires_at: string | null;
  best_before_opened_days: number | null;
  added_at: string;
  depleted_at: string | null;
  // Необовʼязкове з тієї самої причини, що `product_id`: старі рядки його не
  // мають і бекфілу не буде — ми не знаємо, що з ними сталося.
  depleted_reason?: DepletedReason | null;
  confidence: number;
  provenance: Provenance;
  staple: boolean;
  last_by: string | null;
  last_action: string | null;
  // Черга Д (№2): партія показує на «продукт дому» (трійка product·brand·
  // variant + невидимі теги). Старі партії — null до бекфілу; label лишається
  // самодостатнім фолбеком.
  product_id?: string | null;
}

// ----- Картки з 03-prompts.md -----

export type IntakeOp =
  // Черга Д (№2): add несе трійку product·brand·variant і теги — тегер
  // збирає їх РАЗ при додаванні (той самий виклик парсу). Знайома трійка
  // реюзається з БД, модельні теги тоді ігноруються.
  // batch_id проставляє СЕРВЕР після застосування — це вказівник картки на
  // позицію, яку вона показує. Напрямок саме такий і тільки такий: позиція
  // про картку не знає й знати не мусить («людині, яка вже готує, байдуже,
  // де вона що купила» — власник, 02.09). Тому видалення сесії забирає
  // картку, а позиція лишається жити.
  | { op: 'add'; label: string; value?: number; unit?: Unit; zone?: Zone; confidence?: number; evidence?: string; catalog_key?: string; batch_id?: string;
      product?: string; brand?: string; variant?: string; tags?: import('./product.js').ProductTags;
      // «(початке)» в інвентарі: партія народжується вже відкритою.
      state?: 'sealed' | 'opened' }
  // batch_id і тут — коли той, хто складає операцію, ЗНАЄ позицію. Списання
  // після готування знає: рецепт тримає палець на партії (ing.p). Раніше цей
  // палець перетворювався на назву, а назва шукалась findBatchByLabel — перший
  // збіг без сортування, — і при двох однойменних позиціях списувалась не та.
  // Модель id не бачить і не заповнює: для неї лишається label, як було.
  | { op: 'deplete'; label: string; batch_id?: string }
  | { op: 'open'; label: string; batch_id?: string }
  // `tags` тут не декорація: перейменування — заява «це інший продукт», і
  // теги нового продукту приходять тією самою реплікою («це не мʼясо, а
  // свинина, і вона без лактози»). Схема моделі їх дозволяла завжди.
  | { op: 'rename'; label: string; to: string; batch_id?: string; tags?: import('./product.js').ProductTags }
  // correct може правити й невидимі теги продукту партії («камбоцола без
  // лактози») — мердж, не заміна; редагування тегів існує ТІЛЬКИ цим шляхом.
  // `state` на correct — та сама пара, що на `add`: «сметана вже відкрита»
  // це виправлення стану, а не подія відкриття.
  | { op: 'correct'; label: string; batch_id?: string; value?: number; unit?: Unit; zone?: Zone;
      state?: 'sealed' | 'opened'; tags?: import('./product.js').ProductTags };

// M13: рядок чека, який НЕ став op'ом — сірий «додати руками» (unmatched)
// або згорнутий «не для комори» (nonfood). Живе в source картки, щоб стрічка
// малювала канон М2 і після перезавантаження, не лише з відповіді синку.
export interface ReceiptLeftover {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  image: string | null;
}

export type IntakeSource =
  | {
      kind: 'retail_receipt';
      provider: string;
      shop: string;
      at: string;
      total: number;
      nonfood: ReceiptLeftover[];
      unmatched: ReceiptLeftover[];
    }
  | { kind: 'chat_receipt'; at: string };

// Позиція, яку каталог упізнав як НЕХАРЧОВУ і яка тому не поїхала в комору.
// Окреме поле, а не частина source: вето за категорією не має нічого
// спільного з тим, чек це чи звичайний intake, — дрова не місце в коморі
// незалежно від того, звідки про них дізнались.
export interface NonfoodOp {
  label: string;
  value?: number | null;
  unit?: Unit | null;
}

export interface IntakeCard {
  type: 'intake_diff';
  ops: IntakeOp[];
  // Відсічене вето каталогу. Картка показує це людині окремою групою —
  // мовчазний викид був би гіршим за помилку: людина не дізналась би, що
  // частину покупок продукт свідомо не взяв.
  nonfood?: NonfoodOp[];
  // Джерело-чек. Відсутнє — звичайна intake-картка; apply/undo однакові
  // для всіх трьох випадків, джерело впливає лише на подання.
  //
  // Два роди чеків, і різниця між ними не косметична:
  //   retail_receipt — сервер сам підтягнув чек мережі. Людина нічого не
  //     просила, тому картка ЧЕКАЄ підтвердження, і в неї є розкладка
  //     каталогу на три кошики (у комору / не для комори / не впізнав).
  //   chat_receipt — людина сама показала чек фото чи текстом. Розібрала
  //     модель, розкладки каталогу немає, застосовується одразу (Пул-8 №2:
  //     людина попросила — питання «застосувати?» тут зайве).
  // Спільне в них те, заради чого це поле й розрізняється: обидва — довгий
  // документ на десятки рядків, а не подія. Обидва стають артефактом
  // панелі, обидва адресуються по card_id для правки одного рядка.
  source?: IntakeSource;
}

export interface ProposalCard {
  type: 'proposal';
  items: {
    title: string;
    desc: string;
    why?: string;
    character?: string;
    rescues?: string[];
    needs?: string[];
  }[];
}

export interface ShoppingCard {
  type: 'shopping';
  items: {
    op: 'add' | 'remove';
    label: string;
    note?: string;
    v?: number;
    u?: string;
  }[];
}

// Час, як його називає модель. Дати вона не рахує — переказує сказане людиною
// або відносне, а в дату це перетворює сервер (services/api/src/event-when.ts).
export type EventWhen =
  | { date: string }        // '2026-09-12' — людина назвала дослівно
  | { rel: string }         // '+7d', '+2w', 'today', 'tomorrow'
  | { weekly: number };     // 0=нд … 6=сб

export interface EventCard {
  type: 'event';
  ops: {
    op: 'add' | 'edit' | 'done' | 'remove';
    /** Для edit/done/remove — id з блоку [ТВОЇ ПЛАНИ]. */
    id?: string;
    title?: string;
    kind?: 'meal' | 'supply' | 'constraint' | 'custom' | 'diet';
    when?: EventWhen;
    /** Скільки днів триває: «тиждень готуємо з нею». */
    days?: number;
    note?: string | null;
    servings?: number | null;
    supply?: SupplyLine[];
    /** Проставляє сервер із `when`. Модель це поле не заповнює ніколи. */
    rule?: Rule;
  }[];
}

// Раунд 5, крок П1: період з правилом. Модель віддає мінімум — рід, назву,
// відносний час, правило словами людини; сервер добудовує: для традиції —
// список свят з таблиці (items), для дієти/події дому — дати від [СЬОГОДНІ]
// (resolved). Дати модель не рахує ніде. Підтвердження — «Записати».
export interface PeriodCard {
  type: 'period';
  kind: 'tradition' | 'diet' | 'custom';
  title?: string;
  from?: EventWhen;
  to?: EventWhen;
  /** Тривалість, коли `to` не названо («на тиждень»). */
  days?: number;
  /** Правило людською мовою дослівно: «більше білка, менше вуглеводів». */
  rule_text?: string;
  /** Суворо = «Я не їм» на цей час. За замовчуванням мʼяко. */
  strict?: boolean;
  /** kind=tradition: чий набір свят. */
  tradition?: Tradition;
  /** П2a: масова відписка / повернення сезонів — серія всіх сезонів; all — з якими галочками. */
  set?: 'seasons';
  all?: boolean;
  /** «Не показуй мені кавуни»: id або назва сезону з довідника. */
  unsubscribe?: string;
  servings?: number | null;
  // ── Добудовує сервер ──
  /** tradition/unsubscribe: рядки довідника з датами; галочка = enabled. */
  items?: PeriodItem[];
  /** diet/custom: дати, пораховані сервером. */
  resolved?: { from: string; to: string };
}

export interface PeriodItem {
  occasion_id: string;
  title: string;
  from: string;
  to: string;
  approx?: boolean;
  /** Поточний стан підписки (з рядка або дефолту). */
  enabled: boolean;
  /** Одним словом: піст · докупити · святкова вечеря · сезон. */
  what: string;
  strict: boolean;
}

// П5-В4: родини карток `profile` більше немає. Профіль — сім речень, які
// людина пише сама (PATCH /v1/profile/:key, сторінка Профілю й картка
// `onboarding`); асистент лише каже, у яке поле це вписати. Ops-форма жила
// заради домашніх (їдців), яких прибрала В5.

export interface RecipeIng {
  p?: string;   // id партії з комори — модель показує пальцем
  n?: string;   // назва, коли продукту нема в коморі
  v?: number;
  u?: string;
}

export interface RecipeStep {
  t: string;    // короткий тайтл кроку
  c: string;    // дія з плейсхолдерами {0}, {1} за індексом інгредієнта
  s?: number;   // секунди таймера, якщо крок часовий
}

export interface Recipe {
  t: string;                                      // title
  sv: number;                                     // servings
  tm: number;                                     // total minutes
  ch: string;                                     // характер (час і зусилля)
  d: string;                                      // description
  rk: string;                                     // ключова помилка (не застереження)
  nu?: { kcal: number; p: number; f: number; c: number };
  op?: string[];                                  // варіанти замін
  ing: RecipeIng[];
  st: RecipeStep[];
}

// Картка рецепта з вкладення: людина показала сторінку книжки чи скрін —
// ми показуємо розібраний рецепт і питаємо, чи класти в бібліотеку.
export interface RecipeCard {
  type: 'recipe';
  recipe: Recipe;
}

// Фото готової страви з чату → в журнал, до конкретного готування. Картка,
// а не тихий запис: фото могло бути не тієї страви.
export interface CookPhotoCard {
  type: 'cook_photo';
  run_id: string;
  recipe_title: string;
  attachment_id: string;
}

// Слід рецепта в розмові: «◇ Борщ · Рецепт →». Не дія — застосовувати нічого,
// тому в apply гілки немає і модель цей тип не породжує (немає в CARD_TYPES
// парсера). Компроміс Р-3 з design-audit-2: рецепт живе окремим екраном, але
// більше не зникає з розмови.
// Рішення Пилипа (31.08): рецепт — це хід розмови, а не екран. Повідомлення
// несе ПОВНИЙ рецепт: стрічка рендерить його цілком, F5 тримає, історія
// розмови містить страву, а не посилання на неї.
export interface RecipeLinkCard {
  type: 'recipe_link';
  recipe_id: string;
  title: string;
  recipe?: Recipe;
}

// QA9-02: «поміняй в рецепті багет на батон». Модель НЕ переписує рецепт сама —
// показує пальцем (назва) і передає інструкцію; сервер регенерує рецепт із
// базовим payload і кидає НОВИЙ recipe_link-хід у стрічку. Старе повідомлення
// не редагується — правка це відповідь, а не втручання в минуле (канон Бриф-3:
// «наступна репліка може змінити рецепт»). Ця картка ніколи не доходить до
// клієнта і не має apply-гілки: chat-роут перехоплює її синхронно.
export interface RecipeEditCard {
  type: 'recipe_edit';
  title: string;         // назва рецепта з розмови — по ній шукаємо базовий
  instruction: string;   // що змінити, словами людини
}

// Пул-5 №6: «людина ЯВНО обрала страву і погодилась готувати». Як recipe_edit —
// службовий маркер: до клієнта не доходить, chat-роут перехоплює синхронно і
// сам ганяє генератор. Ліки від «давай → ще одна пропозиція».
export interface CookGoCard {
  type: 'cook_go';
  title: string;         // назва обраної страви — дослівно з пропозиції
}

// M13 зріз 3: картка «Кошик у Сільпо» (канвас М3). НЕ підтверджувальна:
// apply/undo не мають сенсу — кошик уже зібраний у мережі, CTA веде назовні.
// Два імені однієї речі: label — як людина писала в список, product.name —
// «паспортна» назва мережі.
export interface CartCardRow {
  label: string;
  item_id: string | null;
  v: number | null;
  u: string | null;
  // 01.09 картка v2: product_id/company_id/branch_id — щоб степер міг
  // пізніше змінити кількість (cart-update-qty) без повторного пошуку.
  // package_ml — розпізнаний обсяг упаковки (мл), тільки для НЕ вагових
  // товарів, де назва містить впізнаваний об'єм («0,33 л», «500 мл»).
  // null — не вдалось розпізнати (штучний товар без обсягу, чи формат
  // назви незнайомий); тоді товар — кількісне, не обсягове. Разом з `v`/`u`
  // рядка (заявлений обсяг зі списку покупок) дає видиму математику
  // «× 0,33 л ≈ 0,99 л» замість мовчазного «1 шт».
  product: {
    product_id: string; company_id: string; branch_id: string;
    name: string; price: number; weighted: boolean; quantity: number;
    package_ml: number | null;
  } | null;
  // 01.09 рівень 1: інші знайдені варіанти по тому самому пошуку (Сільпо й
  // так їх повертає — раніше просто відкидались). Значення поля залежить
  // від того, чи product заповнений:
  // - product є (хіт) — це ІНФОРМАЦІЙНИЙ перелік («ще є: X, Y»), без тапу:
  //   товар уже поїхав у кошик мережі, а наша інтеграція вміє тільки
  //   addToCart, не видалення — тап-заміна залишила б задвоєння.
  // - product нема (проміс) — це кнопки «замінити» (тап → cart-swap,
  //   alt_index — індекс у цьому масиві); нічого ще не додано в кошик,
  //   тому заміна безпечна.
  alternatives?: {
    product_id: string; company_id: string; branch_id: string;
    name: string; price: number; weighted: boolean; quantity: number;
  }[];
}

export interface CartCard {
  type: 'cart';
  provider: string;
  list_label: string | null;
  rows: CartCardRow[];
  total: number;
  found: number;
  of: number;
  cart_url: string;
}

// M13: «людина явно попросила оформити список через мережу» — той самий
// принцип, що CookGoCard («страва обрана»): модель лише МАРКУЄ намір,
// сервер сам виконує (attemptBuildCart) і підміняє картку на справжній
// CartCard. Без полів — сервер бере активну мережу й поточний список сам.
// items — 01.09: людина назвала конкретні позиції з розмови (напр. з чека),
// яких ще нема в персистованому списку покупок («замов лосось і рис» тоді,
// коли в списку лежить тільки кунжут). Модель вказує лейбли дослівно —
// вільний текст, як shopping.items, а не id (позицій ще нема в базі,
// вказати ідентифікатором нічим). Порожньо/відсутнє — сервер бере активний
// список цілком, як і раніше.
export interface CartGoCard {
  type: 'cart_go';
  items?: string[];
}

// 01.09: «що є в наявності по X» — питання, не замовлення. НЕ cart_go
// (нічого не додається в кошик мережі) і НЕ shopping (нічого не додається
// в список покупок) — людина просто питає, сервер шукає живцем і показує
// реальні варіанти текстом (reply), без жодної картки. Той самий принцип
// маркування наміру, що cart_go/cook_go — query дослівно, сервер робить
// пошук (attemptSearch) і сам будує reply з живих даних.
export interface RetailSearchGoCard {
  type: 'retail_search_go';
  query: string;
}

// Раунд 4, крок 7: картка «Про тебе» — сім панелей в одному повідомленні.
// Стан панелей — з profile_text.status; тут лише пропуски («Пропустити»),
// щоб перезавантаження їх не скидало. Видає сервер, модель її не повертає.
export interface OnboardingCard {
  type: 'onboarding';
  skipped?: ProfileFieldKey[];
}

export type Card = IntakeCard | ProposalCard | ShoppingCard | RecipeCard | CookPhotoCard | RecipeLinkCard | RecipeEditCard | CookGoCard | CartCard | CartGoCard | RetailSearchGoCard | EventCard | PeriodCard | OnboardingCard;

// ----- Стан «на застосуванні» ------

export interface PendingCard {
  id: string;               // = message_id
  message_id: string;
  household_id: string;
  user_id: string;
  card: Card;
  applied_at: string | null;
  applied_ops: number[] | null;  // індекси застосованих ops у card.ops (для intake_diff/profile)
  undo_token: string | null;
  undo_snapshot: UndoSnapshot | null;
  undone_at: string | null;
  // Аудит раунд 3, крок 1: «Ні» на pending-картці. Взаємовиключне з
  // applied_at — dismissCard відмовляє, якщо картка вже застосована
  // (тоді шлях назад — undo, не dismiss).
  dismissed_at: string | null;
}

// Крок Ш1: рівно те, що комора читає з останньої застосованої intake-картки.
// Не PendingCard: `card` і `undo_snapshot` цілком — це мегабайти jsonb, а
// потрібні з них три поля.
export interface LastAppliedIntake {
  applied_at: string;
  /** Джерело картки. Гарантовано об'єкт: картки без нього запит не бере. */
  source: IntakeSource;
  /** undo_snapshot.before.created_batch_ids — партії, створені цією карткою. */
  created_batch_ids: string[];
}

// Знімок ДО застосування: чого досить, щоб відкотити.
// Для intake — попередні партії (при correct/rename/open/deplete) + список створених id (add).
export interface UndoSnapshot {
  kind: 'intake_diff' | 'shopping' | 'profile' | 'recipe' | 'cook_photo' | 'event' | 'period';
  before: {
    created_batch_ids?: string[];       // add: створені партії — видалити при undo
    modified_batches?: PantryBatch[];   // rename/correct/open/deplete: повернути в цей стан
    // M13 01.09: auto-apply shopping зробив undo remove живим шляхом (раніше
    // requires-click ховав цю дірку) — повний рядок, не тільки id: видалений
    // рядок треба ВІДТВОРИТИ, id саме по собі для цього не досить.
    removed_shopping_items?: ShoppingItemRow[];
    added_shopping_ids?: string[];      // shopping add: видалити при undo
    checked_shopping_ids?: string[];    // UX9-27: intake add відмітив куплене — undo знімає галочку
    // П1: підписки до картки period; enabled null — рядка не було (дефолт).
    subscriptions_before?: { occasion_id: string; enabled: boolean | null }[];
    // Раунд 4: картка поля — повернути попереднє значення поля (текст і статус).
    profile_field_before?: { field: ProfileFieldKey; value: ProfileFieldValue };
    added_recipe_ids?: string[];        // recipe: імпортований рецепт при undo видаляється
    photo_before?: { run_id: string; photo_url: string | null };  // cook_photo: повернути як було
    added_event_ids?: string[];         // event add: undo видаляє створене
    // edit/done/remove: повний рядок ДО зміни. Як і з позиціями списку, id
    // самого по собі не досить — видалену подію треба відтворити.
    events_before?: HouseholdEventRow[];
  };
}

export interface SessionRow {
  id: string;
  user_id: string;
  title: string | null;
  day: string;                          // YYYY-MM-DD
  created_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  text: string | null;
  card: Card | null;                     // те, що асистент повернув
  applied: number;                       // скільки ops вже застосовано (0 або applied_ops.length)
  created_at: string;
  // ХТО написав цей текст. Відсутнє = модель (переважна більшість ходів).
  // 'retail_search' — репліку склав СЕРВЕР із живої видачі мережі; наступного
  // ходу модель читає її в історії і без підпису плутає полицю магазину зі
  // станом кухні («у Сільпо є два» → «у тебе є два», живий репро 01.09).
  // Не показується людині — живе тільки в історії, яка їде в модель.
  source?: 'retail_search';
  // Аудит раунд 3, крок 1: похідні поля з card_pending (той самий id —
  // message.id === card_pending.id), приєднуються при listMessages, а не
  // зберігаються на самому рядку message. Джерело істини одне — card_pending;
  // тут лише читання. Відсутнє/null = картка ще live (не undone, не dismissed).
  undone_at?: string | null;
  dismissed_at?: string | null;
  // Пул-9 №2: вкладення, прикріплені до ЦЬОГО повідомлення (attachment.message_id).
  // Приєднуються при listMessages, як undone_at/dismissed_at вище: джерело
  // істини — таблиця attachment. Порожньо = ходів без файлів (переважна більшість).
  attachments?: { id: string; mime: string | null }[];
}

// Крок О1а: подія поведінки або серверний інцидент. Одна таблиця на обидва:
// на стрічці дня вони читаються поруч, і розділяти їх сховищами означало б
// зшивати два списки за часом на кожному відкритті /admin/pulse.
export interface AppEventRow {
  id: string;
  user_id: string;
  household_id: string | null;
  /** Подія продукту («cook_started») або інцидент («incident:example-copy»). */
  name: string;
  /** Лише структурне: номер кроку, назва зрізу, рід вкладення. */
  props: Record<string, unknown>;
  /**
   * Крок А1: пристрій — з конверта пачки, один на всю пачку, а не на подію.
   * Головний сигнал — ширина: саме вона визначає розкладку і саме на ній
   * ламаються речі на кшталт «на телефоні не вводиться текст». Клас
   * порахований із ширини за межами продукту; ua_family — груба довідка.
   *
   * Усі три можуть бути null: стара історія (до цієї міграції) і конверт без
   * пристрою — стара вкладка, яку не перезавантажували.
   */
  viewport_w: number | null;
  device_class: DeviceClass | null;
  ua_family: string | null;
  created_at: string;
}

/** Клас пристрою — з ширини вікна, за межами розкладки продукту (tokens.css). */
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

export interface RecipeRow {
  id: string;
  owner_id: string;
  origin: 'generated' | 'imported' | 'catalog';
  title: string;
  // QA8-01: людина просила «Паста карбонара з фуетом», модель назвала
  // «Карбонара з фуетом» — dedupe генерації шукає за ОБОМА назвами.
  requested_title?: string | null;
  descr: string | null;
  character: string | null;
  risk: string | null;
  base_servings: number;
  time_total: number | null;
  nutrition: unknown;
  payload: unknown;                                    // повний рецепт як JSON (ing, st)
  created_at: string;
  saved_at: string | null;                             // «лишити на потім» — QA-6
  // QA9-08: «прибрати з бібліотеки» для рядка «готував, не зберіг». Рядок
  // не видаляється (журнал тримає recipe_id) — лише зникає зі списку.
  hidden_at?: string | null;
}

// Рецепт у списку: сам рядок + скільки разів готували. Стан ready/near/far
// рахується проти комори через matchRecipe().
export interface RecipeListItem extends RecipeRow {
  cooked_count: number;
  last_cooked_at: string | null;
}

export type CookRunBatchChange =
  | { id: string; op: 'deplete'; prev_state: BatchState; prev_depleted_at: string | null }
  | { id: string; op: 'subtract'; amount: number; prev_state: BatchState; prev_value: number | null; prev_opened_at: string | null };

export interface CookRunChanges {
  batches: CookRunBatchChange[];
}

export interface CookRunRow {
  id: string;
  household_id: string;
  user_id: string;
  recipe_id: string;
  servings: number;
  started_at: string;
  finished_at: string | null;
  rating: number | null;
  verdict: string | null;
  photo_url: string | null;
  changes: CookRunChanges | null;
  undone_at: string | null;
  // Правка №11: сесія, з якої запустили готування — журнал веде назад у розмову.
  session_id?: string | null;
}

export interface CookRunWithRecipe extends CookRunRow {
  recipe: RecipeRow;
}

// M13: підключення мережі (Сільпо перша, не єдина). Токени сюди приходять
// уже зашифрованими (AES-GCM в API-шарі) — домен і БД бачать тільки шифротекст.
// Один рядок на пару (user_id, provider); повторний upsert перезаписує.
// status='disconnected' — мʼяке відключення (тост «Повернути ↩» з дизайн-канону):
// токен ще живий у рядку, undo повертає 'active' без нового OAuth.
export interface RetailConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string;
  status: 'active' | 'disconnected';
  connected_at: string;
  updated_at: string;
  // Водяний знак «чеки → комора»: найновіший createdAt імпортованого чека.
  // Синк бере тільки новіші — повторний виклик не дублює партії.
  last_receipt_at: string | null;
}

export interface ShoppingItemRow {
  id: string;
  household_id: string;
  label: string;
  reason: string | null;
  value: number | null;
  unit: string | null;
  zone: string | null;
  checked: boolean;
  added_by: string | null;
  source: 'user' | 'recipe' | 'model' | 'retail';
  created_at: string;
}

// ----- Облік токенів ----------------------------------------------------

// `alt_filter` жив у `manifest.json` від 01.09, але сюди не доїхав — і саме
// це тримало дірку в обліку: рід викликів, який не можна було назвати в
// типі, неможливо було й записати в `token_usage`. Колонка `call` — вільний
// text без CHECK (міграція 0003), тож розширення типу міграції не потребує.
export type CallName = 'chat' | 'attachment_parse' | 'recipe_gen' | 'alt_filter';
export type ModelProfile = 'fast' | 'smart' | 'stub';
export type CallMode = 'live' | 'stub';

export interface TokenUsageRow {
  id: string;
  user_id: string;
  household_id: string | null;
  call: CallName;
  profile: ModelProfile;
  model: string;
  prompt_version: string;
  mode: CallMode;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  latency_ms: number | null;
  // A3 (OPTIMIZATION_PLAN): хеш і довжина СКОМПОНОВАНОГО стабільного префікса
  // цього виклику. promptVersion лишається людинозчитним; точність — тут.
  // Редагування промпту «на місці» тепер видиме в даних постфактум.
  prompt_hash: string | null;
  prompt_chars: number | null;
  /**
   * Крок А5: токени, ЗАПИСАНІ в кеш (`cache_creation_input_tokens`).
   *
   * Найдорожчий рід вхідних: провайдер бере за них 1,25× ставки входу, тобто
   * в 12,5 раза дорожче за читання з кешу. І саме вони стоять на початку
   * кожної холодної сесії.
   *
   * `null` — не «записів не було», а «тоді ми цього не знали»: до міграції
   * 0032 поле гинуло між model.ts і recordUsage. Нулем його підміняти не
   * можна, інакше старі періоди виглядатимуть дешевшими, ніж були.
   */
  cache_write_tokens: number | null;
  /**
   * Крок А1: до якого ходу належить цей виклик. Досі pulse.ts зшивав ціну з
   * повідомленням здогадкою — найближчий виклик тієї самої людини в межах
   * хвилини, — і вся юніт-економіка стояла на цій здогадці.
   *
   * message_id — повідомлення людини, яке спричинило виклик (усі виклики
   * одного звернення до /v1/chat належать одному й тому ж ходу: і сам чат, і
   * генерація рецепта всередині нього, і повтор після невдачі).
   *
   * Null там, де ходу немає: розбір вкладення до створення повідомлення,
   * генерація рецепта поза чатом, пошук по коморі. Вигадувати прив'язку до
   * «найближчого» повідомлення ми не будемо — порожньо чесніше за здогадку.
   */
  message_id: string | null;
  session_id: string | null;
  created_at: string;
}

// ----- Автентифікація ---------------------------------------------------

export interface AuthChallenge {
  id: string;
  email: string;
  token_hash: string;                // SHA-256(hex) від сирого токена, який їде в листі
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface AuthSession {
  id: string;
  user_id: string;
  cookie_hash: string;               // SHA-256(hex) від сирого cookie-значення
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip: string | null;
  user_agent: string | null;
}

// Активний користувач у контексті запиту — виводиться з cookie в middleware.
export interface UserContext {
  user_id: string;
  household_id: string;              // «активний дім»: перший, до якого приєднаний користувач
  session_id: string;
}

// ----- Запрошення в дім -------------------------------------------------

export type HouseholdRole = 'owner' | 'member';

export interface HouseholdInvite {
  id: string;
  household_id: string;
  invited_by: string;
  email: string;                     // нижній регістр
  role: HouseholdRole;
  token_hash: string;                // SHA-256(hex) від сирого токена
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by: string | null;
  revoked_at: string | null;
}

// ----- Вкладення --------------------------------------------------------

export type AttachmentKind = 'image' | 'pdf' | 'text';

export interface AttachmentRecord {
  id: string;
  message_id: string | null;
  household_id: string;
  user_id: string;
  kind: AttachmentKind;
  url: string;                    // fs://... або s3://... — не HTTP
  content_type: string | null;
  bytes: number | null;
  hint: string | null;
  created_at: string;
}

// ── Календар: подія дому ────────────────────────────────────────────────────
// Друга вісь того самого інвентаря. Комора відповідає на «що в мене є»,
// подія — на «що в мене буде»: партія з терміном спрямована назад («вмирає в
// пʼятницю»), подія — вперед («прийде в пʼятницю»).

/** Що саме прийде із завозом. Число опційне: «мішок цибулі» теж відповідь. */
export interface SupplyLine {
  label: string;
  v?: number | null;
  u?: string | null;
}

/** Спіймане вікно: дім щось приготував, поки подія тривала. */
/**
 * Повний рядок occasion_catalog для адмінки — на відміну від OccasionRow
 * (occasion-data.ts), який бачить лише опубліковане й ніколи не бачить
 * чернетку. Адмінка v0 навмисно вужча за схему: тільки kind='editorial',
 * тільки rule.t='window', tradition і audience не виставляються (NULL —
 * усім). Сезони й свята лишаються кодом: це не контент редакції, а факти
 * календаря, і ризик кривого запису через довільну форму того не вартий.
 */
export interface AdminOccasionRow {
  id: string;
  kind: 'editorial';
  title: string;
  meaning: string;
  rule: Extract<Rule, { t: 'window' }>;
  buy: string[];
  seeds: string[];
  upcoming_title: string | null;
  /** Обовʼязкове: редакційна подія від першого дня видимо підписана. */
  source: string;
  published_at: string | null;
  created_at: string;
}

export interface OccasionCatchRow {
  household_id: string;
  occasion_id: string;
  year: number;
  caught_at: string;
  /** Чим саме спіймали — щоб підсумок казав «грибами», а не «спіймано». */
  by: string | null;
  run_id: string | null;
}

export interface HouseholdEventRow {
  id: string;
  household_id: string;
  //   meal       слот сітки: страва на дату
  //   supply     очікуване надходження — майбутня партія, а не побажання
  //   constraint «у вівторок мало часу»: рамка на день, не план
  //   custom     привід дому: день народження, гості, своє свято
  //   diet       П1: дієта на період («цей місяць білкова»)
  kind: 'meal' | 'supply' | 'constraint' | 'custom' | 'diet';
  title: string;
  note: string | null;
  rule: Rule;
  force: 'hint' | 'restrict';
  restricts: string | null;
  // П1: період з правилом. from/to — 'YYYY-MM-DD' включно (rule once дублює
  // їх для двигуна дат); rule_text — правило дослівно; strict ↔ force
  // 'restrict' (суворо = «Я не їм» на цей час).
  from: string | null;
  to: string | null;
  rule_text: string | null;
  strict: boolean;
  buy: string[];
  recipe_id: string | null;
  servings: number | null;
  supply: SupplyLine[] | null;
  created_by: string | null;
  /** 'chat' — з картки моделі (П1; старі рядки 'model' читаються як 'chat'). */
  source: 'user' | 'chat' | 'model';
  // Згасання: «мама привезе цибулю — тиждень готуємо з нею» через місяць стає
  // шумом. Після expires_at подія не йде в контекст, але рядок лишається —
  // видалення знищило б історію.
  expires_at: string | null;
  done_at: string | null;
  created_at: string;
}
