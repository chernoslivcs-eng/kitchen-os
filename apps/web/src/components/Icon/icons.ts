// Словник знаків v3. Чотири сімʼї, не три.
//
// Бандл (ai/project/Kitchen OS - Icons.dc.html) назвав 64 знаки в трьох
// сімʼях: system 24 · products 20 · cooking 20. Але зони комори — четверта
// вісь, і сімейства під неї в бандлі немає: усі шість знаків зон там позичені
// з інших сімей, і чотири з шести конфліктують (Р21). Тому сімей тут чотири.
//
// Правила, які цей файл тримає (перевіряються icons.test.ts):
//   · `flame` — ТІЛЬКИ «Горить». Не гриль, не калорії, не зона Спецій.
//   · `cooking-pot` — дія «Готуємо». `chef-hat` — ТІЛЬКИ тип рецепта.
//     (У бандлі мітки стоять навпаки; правило HANDOFF старше за набір.)
//   · Один знак не несе двох РІЗНИХ значень. Один і той самий зміст на двох
//     осях — не конфлікт: «Напої» як категорія продукту й як зона комори це
//     одне й те саме, тому там знак спільний навмисно.
import {
  MessageCircle, BookOpen, BookMarked, ListChecks, Calendar, House, ShoppingCart, Receipt,
  Plus, Mic, ArrowUp, Paperclip, Search, SlidersHorizontal, ArrowUpDown, Check, X,
  Undo2, ChevronRight, ExternalLink, PanelLeftClose, PanelLeftOpen, SunMoon, Volume2, User, Menu, ArrowLeft, Bookmark, LogIn,
  Refrigerator, Snowflake, Archive, FlaskConical, Wine,
  Carrot, Apple, Leaf, Wheat, Egg, Milk, Beef, Drumstick, Fish, Shell, Ham, Bean,
  Nut, Cherry, Citrus, Croissant, Candy, Coffee, Droplet,
  Soup, Salad, Pizza, Sandwich, EggFried, Cake, CookingPot, Microwave, FlameKindling,
  ChefHat, Timer, Scale, Utensils, Thermometer, Users, Clock, Ban, Heart, RotateCcw, Star, ShoppingBasket, Import,
  Flame, Sparkles, Pencil, TriangleAlert, Sun, Church, Truck, Hourglass, WifiOff, Minus, Square, RotateCw,
  type LucideIcon,
} from 'lucide-react';

export type Family = 'system' | 'zones' | 'products' | 'cooking' | 'live';

export interface IconSpec {
  /** Компонент Lucide. */
  glyph: LucideIcon;
  /** Що цей знак означає. Одне значення на знак — це й перевіряє тест. */
  label: string;
  family: Family;
}

export const ICONS = {
  // ---- система: навігація, дії, місця ----
  // «Комора» — `refrigerator`, як каже бандл (Responsive.dc.html, 12 разів).
  // Тут стояв `boxes` за міркуванням «холодильник належить зоні, а комора —
  // склад речей»: логічно, і все одно не моє. Бандл каже — робиться як у
  // бандлі (межа зони, 11.09). Те, що знак тепер несе два значення — і
  // «Комора» в навігації, і зона «Холодильник», — записано як колізія, яку
  // успадковано з бандла й винесено дизайн-чату, а не приховано.
  'sys.chat':      { glyph: MessageCircle,     label: 'Чат',           family: 'system' },
  'sys.pantry':    { glyph: Refrigerator,      label: 'Комора',        family: 'system' },
  'sys.recipes':   { glyph: BookOpen,          label: 'Рецепти',       family: 'system' },
  'sys.list':      { glyph: ListChecks,        label: 'Список',        family: 'system' },
  'sys.calendar':  { glyph: Calendar,          label: 'Календар',      family: 'system' },
  'sys.home':      { glyph: House,             label: 'Дім зараз',     family: 'system' },
  'sys.cart':      { glyph: ShoppingCart,      label: 'Кошик',         family: 'system' },
  'sys.receipt':   { glyph: Receipt,           label: 'Чек',           family: 'system' },
  'sys.add':       { glyph: Plus,              label: 'Додати',        family: 'system' },
  'sys.voice':     { glyph: Mic,               label: 'Голос',         family: 'system' },
  'sys.send':      { glyph: ArrowUp,           label: 'Надіслати',     family: 'system' },
  'sys.attach':    { glyph: Paperclip,         label: 'Вкласти',       family: 'system' },
  'sys.search':    { glyph: Search,            label: 'Пошук',         family: 'system' },
  'sys.filter':    { glyph: SlidersHorizontal, label: 'Фільтр',        family: 'system' },
  'sys.sort':      { glyph: ArrowUpDown,       label: 'Порядок',       family: 'system' },
  'sys.done':      { glyph: Check,             label: 'Готово',        family: 'system' },
  'sys.close':     { glyph: X,                 label: 'Закрити',       family: 'system' },
  'sys.undo':      { glyph: Undo2,             label: 'Скасувати',     family: 'system' },
  'sys.next':      { glyph: ChevronRight,      label: 'Далі',          family: 'system' },
  'sys.out':       { glyph: ExternalLink,      label: 'Назовні',       family: 'system' },
  'sys.collapse':  { glyph: PanelLeftClose,    label: 'Згорнути',      family: 'system' },
  // Етап 6a: одна кнопка «панель» на всі контейнери (Responsive R1) — open ⇄ close.
  'sys.expand':    { glyph: PanelLeftOpen,     label: 'Розгорнути',    family: 'system' },
  'sys.theme':     { glyph: SunMoon,           label: 'Тема',          family: 'system' },
  // Смуга «вхід · час оновитись» (Errors E2) — log-in, як у бандлі.
  'sys.login':     { glyph: LogIn,             label: 'Увійти',        family: 'system' },
  'sys.sound':     { glyph: Volume2,           label: 'Звук',          family: 'system' },
  'sys.profile':   { glyph: User,              label: 'Профіль',       family: 'system' },
  'sys.menu':      { glyph: Menu,              label: 'Меню',          family: 'system' },
  'sys.back':      { glyph: ArrowLeft,         label: 'Назад',         family: 'system' },
  'sys.later':     { glyph: Bookmark,          label: 'Колись',        family: 'system' },

  // ---- зони комори ----
  // Знаки — ті, що бандл ставить зонам у Screens.dc.html: leaf · refrigerator ·
  // snowflake · archive · wine. Досі тут була МОЯ «четверта сімʼя» (sprout,
  // flask-conical…) — вибір там, де бандл не мовчав, і тому не мій. Відкат
  // 11.09 за межею зони.
  //
  // Що лишилось відкритим, і кому: чи потрібна зонам окрема вісь знаків
  // взагалі, і якщо так — які. Це питання дизайн-чату, не реалізації
  // (QUESTIONS-FOR-DESIGN-CHAT.md). Поки воно відкрите, `leaf` несе два
  // значення (зона «Свіже» і категорія «Зелень»), і тест це називає, а не
  // ховає.
  //
  // Єдиний виняток — «Спеції». Бандл ставить туди `flame`, а правило HANDOFF
  // «flame — тільки Горить» старше за набір (рішення Р21: «Спеції → новий
  // знак»). Знак ще не обраний; `flask-conical` тут — заглушка до відповіді
  // дизайн-чату, і саме так підписана.
  'zone.fresh':    { glyph: Leaf,          label: 'Свіже',       family: 'zones' },
  'zone.fridge':   { glyph: Refrigerator,  label: 'Холодильник', family: 'zones' },
  'zone.freezer':  { glyph: Snowflake,     label: 'Морозилка',   family: 'zones' },
  'zone.dry':      { glyph: Archive,       label: 'Суха шафа',   family: 'zones' },
  'zone.spices':   { glyph: FlaskConical,  label: 'Спеції',      family: 'zones' }, // ЗАГЛУШКА — див. вище
  'zone.drinks':   { glyph: Wine,          label: 'Напої',       family: 'zones' },

  // ---- продукти: категорії каталогу ----
  'prod.veg':      { glyph: Carrot,    label: 'Овочі',          family: 'products' },
  'prod.fruit':    { glyph: Apple,     label: 'Фрукти',         family: 'products' },
  'prod.greens':   { glyph: Leaf,      label: 'Зелень',         family: 'products' },
  'prod.grain':    { glyph: Wheat,     label: 'Крупи, борошно', family: 'products' },
  'prod.egg':      { glyph: Egg,       label: 'Яйця',           family: 'products' },
  'prod.dairy':    { glyph: Milk,      label: 'Молочне',        family: 'products' },
  'prod.meat':     { glyph: Beef,      label: 'Мʼясо',          family: 'products' },
  'prod.poultry':  { glyph: Drumstick, label: 'Птиця',          family: 'products' },
  'prod.fish':     { glyph: Fish,      label: 'Риба',           family: 'products' },
  'prod.seafood':  { glyph: Shell,     label: 'Морепродукти',   family: 'products' },
  'prod.sausage':  { glyph: Ham,       label: 'Ковбаси',        family: 'products' },
  'prod.legume':   { glyph: Bean,      label: 'Бобові',         family: 'products' },
  'prod.nuts':     { glyph: Nut,       label: 'Горіхи',         family: 'products' },
  'prod.berry':    { glyph: Cherry,    label: 'Ягоди',          family: 'products' },
  'prod.citrus':   { glyph: Citrus,    label: 'Цитруси',        family: 'products' },
  'prod.bread':    { glyph: Croissant, label: 'Хліб, випічка',  family: 'products' },
  'prod.sweet':    { glyph: Candy,     label: 'Солодке',        family: 'products' },
  'prod.tea':      { glyph: Coffee,    label: 'Кава, чай',      family: 'products' },
  'prod.oil':      { glyph: Droplet,   label: 'Олія, соуси',    family: 'products' },

  // ---- готування: страви, техніка, кроки ----
  // «Плита» → `flame-kindling` (вогонь під чимось). Окремого «Гриль, вогонь»
  // більше немає: він існував лише щоб дати `flame` друге значення.
  'cook.soup':     { glyph: Soup,          label: 'Суп',           family: 'cooking' },
  'cook.salad':    { glyph: Salad,         label: 'Салат',         family: 'cooking' },
  'cook.dough':    { glyph: Pizza,         label: 'Піца, тісто',   family: 'cooking' },
  'cook.sandwich': { glyph: Sandwich,      label: 'Сендвіч',       family: 'cooking' },
  'cook.breakfast':{ glyph: EggFried,      label: 'Сніданок',      family: 'cooking' },
  'cook.dessert':  { glyph: Cake,          label: 'Десерт',        family: 'cooking' },
  'cook.go':       { glyph: CookingPot,    label: 'Готуємо',       family: 'cooking' },
  'cook.oven':     { glyph: Microwave,     label: 'Духовка, мікро',family: 'cooking' },
  'cook.stove':    { glyph: FlameKindling, label: 'Плита',         family: 'cooking' },
  'cook.type':     { glyph: ChefHat,       label: 'Тип рецепта',   family: 'cooking' },
  'cook.timer':    { glyph: Timer,         label: 'Таймер',        family: 'cooking' },
  'cook.scale':    { glyph: Scale,         label: 'Ваги',          family: 'cooking' },
  'cook.serve':    { glyph: Utensils,      label: 'Подача',        family: 'cooking' },
  'cook.temp':     { glyph: Thermometer,   label: 'Температура',   family: 'cooking' },
  'cook.portions': { glyph: Users,         label: 'Порції',        family: 'cooking' },
  'cook.time':     { glyph: Clock,         label: 'Час',           family: 'cooking' },
  'cook.ban':      { glyph: Ban,           label: 'Не можна',      family: 'cooking' },
  'cook.love':     { glyph: Heart,         label: 'Люблю',         family: 'cooking' },
  // Бібліотека рецептів (Screens D5): «готував 2 рази» і «Знову» в журналі —
  // rotate-ccw, один зміст «повторно»; «бракує: …» — кошик-basket (не cart:
  // cart — кошик мережі). «використає: …» іде під flame: рядок називає те,
  // що горить, — той самий зміст, не другий.
  'cook.done':     { glyph: RotateCcw,     label: 'Готував, знову',family: 'cooking' },
  'cook.missing':  { glyph: ShoppingBasket,label: 'Бракує',        family: 'cooking' },
  'sys.import':    { glyph: Import,        label: 'Записати свій', family: 'system' },
  'cook.rating':   { glyph: Star,          label: 'Оцінка',        family: 'cooking' },

  // ---- живі стани й тривога ----
  'live.burning':  { glyph: Flame,         label: 'Горить',        family: 'live' },
  'live.thinking': { glyph: Sparkles,      label: 'Думаю',         family: 'live' },
  'live.overdue':  { glyph: TriangleAlert, label: 'Прострочено',   family: 'live' },
  // Роди періодів — як у бандлі (Components A2 кікер, Screens D3 чіпи):
  // сезон — sun / бурштин, традиція — church / слива, завіз — truck / шавлія,
  // подія дому — users / шавлія. Рамка дня — без знака (muted).
  'live.season':   { glyph: Sun,           label: 'Сезон',         family: 'live' },
  'live.tradition':{ glyph: Church,        label: 'Свято, піст',   family: 'live' },
  'live.supply':   { glyph: Truck,         label: 'Завіз',         family: 'live' },
  'live.household':{ glyph: Users,         label: 'Подія дому',    family: 'live' },
  'live.byHand':   { glyph: Pencil,        label: 'Рукою',         family: 'live' },
  // Стани дії — рядок над композитором (Components · «Стани дії»). Знаки з
  // бандла, як намальовано: ліміт — пісочний годинник, мережа — wifi-off,
  // «нічого не змінилось» — мінус. «Стоп» — квадрат, знак зупинки.
  'live.limit':    { glyph: Hourglass,     label: 'Ліміт',         family: 'live' },
  'live.offline':  { glyph: WifiOff,       label: 'Немає звʼязку', family: 'live' },
  'live.nothing':  { glyph: Minus,         label: 'Нічого не змінилось', family: 'live' },
  'sys.stop':      { glyph: Square,        label: 'Стоп',          family: 'system' },
  'sys.retry':     { glyph: RotateCw,      label: 'Повторити',     family: 'system' },
  // Джерело події «з каталогу» в «Дім зараз» — book-marked, як у бандлі (Components).
  'sys.tradition': { glyph: BookMarked,    label: 'З каталогу',    family: 'system' },
} as const satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

/** Знаки, за якими правило закріплює РІВНО одне значення (HANDOFF). */
export const RESERVED: { glyph: LucideIcon; only: string }[] = [
  { glyph: Flame, only: 'Горить' },
  { glyph: ChefHat, only: 'Тип рецепта' },
  { glyph: CookingPot, only: 'Готуємо' },
];

/** Один зміст на двох осях — не конфлікт. Тут перелічено навмисні збіги. */
export const SHARED_ON_PURPOSE = ['Напої', 'Морозилка'];

/**
 * Колізії, успадковані з бандла й винесені дизайн-чату. Це НЕ дозвіл — це
 * список того, що тест знає і чекає відповіді. Коли дизайн-чат вирішить,
 * запис звідси зникає, і тест знову падатиме на цьому знаку.
 */
export const PENDING_DESIGN_CHAT: { glyph: LucideIcon; meanings: string[]; question: string }[] = [
  { glyph: Leaf, meanings: ['Свіже', 'Зелень'], question: 'зонам потрібна окрема вісь знаків?' },
  { glyph: Refrigerator, meanings: ['Комора', 'Холодильник'], question: 'навігаційна «Комора» і зона — один знак?' },
  // Бандл ставить users і на «2 порції» (Redesign, Prototype, Screens D1), і на
  // «Мама · чт – нд» / «подія дому» (Screens D3, Redesign). Один знак — два змісти.
  { glyph: Users, meanings: ['Порції', 'Подія дому'], question: 'порції й подія дому — один знак?' },
];
