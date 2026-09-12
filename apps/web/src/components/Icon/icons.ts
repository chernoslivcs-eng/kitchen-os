// Словник знаків v3. Чотири сімʼї, не три.
//
// Бандл (ai/project/Kitchen OS - Icons.dc.html) назвав знаки в трьох сімʼях:
// system · products · cooking, плюс ряд «Дії й стани» (без моушну) і ряд
// «Зони комори» — шість позичених знаків, своєї сімʼї в зон нема (ANSWERS §1).
// У коді зони — окрема сімʼя-вісь, щоб фільтр і хедери адресувались одним
// ключем; знаки в ній ті самі, що в бандлі.
//
// Правила, які цей файл тримає (перевіряються icons.test.ts), за
// ai/project/ANSWERS-FROM-DESIGN-CHAT.md (§1–§13 і пакет A–F, 12.09):
//   · `flame` — ТІЛЬКИ «Горить». Не гриль, не калорії, не зона Спецій,
//     не «Прострочено» (це alert-triangle, danger).
//   · `cooking-pot` — дія «Готуємо». `chef-hat` — ТІЛЬКИ тип рецепта.
//   · Один знак не несе двох РІЗНИХ значень. Один і той самий зміст на двох
//     осях — не конфлікт: «Напої» як категорія продукту й як зона комори це
//     одне й те саме, тому там знак спільний навмисно.
//   · Оператори (plus · minus · x · check · chevron · arrow) — граматика, не
//     значення: їхній зміст несе слово поруч (OPERATORS), у правило не входять.
//   · Єдиний записаний виняток — `refrigerator` (EXCEPTIONS): у рейці означає
//     весь склад, у хедері зони — сам прилад.
//   · `house` — один референт «дім» скрізь: чіп «Дім зараз», картка «Дім»
//     у профілі, кікер «Запрошення в дім». Не виняток — одне значення.
//   · Тема — лише `sun-moon`; `sun` = сезон, `moon` = піст.
import {
  MessageCircle, BookOpen, BookMarked, ListChecks, Calendar, House, ShoppingCart, Receipt,
  Plus, Mic, ArrowUp, Paperclip, Search, SlidersHorizontal, ArrowUpDown, Check, X,
  Undo2, ChevronRight, ChevronDown, ExternalLink, PanelLeftClose, PanelLeftOpen, PanelRightClose, SunMoon, Volume2, User, Menu, ArrowLeft, Bookmark, LogIn,
  Refrigerator, Snowflake, Archive, Amphora, Wine,
  Carrot, Apple, Leaf, LeafyGreen, Wheat, Egg, Milk, Beef, Drumstick, Fish, Shell, Ham, Bean,
  Nut, Cherry, Citrus, Croissant, Candy, Coffee, Droplet,
  Soup, Salad, Pizza, Sandwich, EggFried, Cake, CookingPot, Microwave, FlameKindling,
  ChefHat, Timer, Scale, Utensils, Thermometer, Users, Clock, Ban, Heart, RotateCcw, Star, ShoppingBasket, Import, ListOrdered, BookmarkCheck, Share2, Reply,
  Flame, Sparkles, Pencil, TriangleAlert, Sun, Church, Truck, Hourglass, WifiOff, Minus, Square, RotateCw, Camera, FileText, Moon, ChevronUp,
  Pause, Play,
  type LucideIcon,
} from 'lucide-react';
// 12.09 (ANSWERS A, ряд «Дії й стани» в Icons): нові знаки — окремим рядком.
import { ArrowRight, Equal, EyeOff, ListPlus, Lock, Lightbulb, Mail, Trash2, Ellipsis, StickyNote, CircleDashed } from 'lucide-react';
// Лендінг (блок «landing» у кінці мапи) — окремим рядком, щоб не чіпати імпорт вище.
import { PackageOpen, History, List, Shuffle, ChevronLeft } from 'lucide-react';
// Sent · Invite (Auth.dc.html) — теж окремим рядком.
import { Send, MailCheck, UserRoundX, Image } from 'lucide-react';

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
  // 12.09 (A6): house = дім як обʼєкт, одне значення з auth.household.
  'sys.home':      { glyph: House,             label: 'Дім',           family: 'system' },
  'sys.cart':      { glyph: ShoppingCart,      label: 'Кошик',         family: 'system' },
  'sys.receipt':   { glyph: Receipt,           label: 'Чек',           family: 'system' },
  'sys.add':       { glyph: Plus,              label: 'Додати',        family: 'system' },
  // 6b-5: меню вкладень за «+» у композиторі (Prototype): чек · фото полиці · список текстом.
  'sys.photo':     { glyph: Camera,            label: 'Фото полиці',   family: 'system' },
  'sys.text':      { glyph: FileText,          label: 'Список текстом', family: 'system' },
  // Пакет 2, №24 (Responsive «390 · аркуш джерел»): галерея — `image`.
  'sys.gallery':   { glyph: Image,             label: 'Фото з галереї', family: 'system' },
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
  // Пакет 2, №25 (Redesign 6c: ‹ › місяця в календарі) — пара до sys.next.
  'sys.prev':      { glyph: ChevronLeft,       label: 'Попередній',    family: 'system' },
  // 6b-5: пілюля сесії в шапці чату (Prototype: chevron-down «розкрити розмови»).
  'sys.open':      { glyph: ChevronDown,       label: 'Розкрити',      family: 'system' },
  'sys.opened':    { glyph: ChevronUp,         label: 'Розкрито',      family: 'system' },
  'sys.out':       { glyph: ExternalLink,      label: 'Назовні',       family: 'system' },
  'sys.collapse':  { glyph: PanelLeftClose,    label: 'Згорнути',      family: 'system' },
  // Етап 6a: одна кнопка «панель» на всі контейнери (Responsive R1) — open ⇄ close.
  'sys.expand':    { glyph: PanelLeftOpen,     label: 'Розгорнути',    family: 'system' },
  // 6b-3: закриття правої панелі артефакта — panel-right-close (Prototype),
  // дзеркало до «Згорнути» сайдбара: рамка з поділом з того боку, якого стосується.
  'sys.panelClose': { glyph: PanelRightClose,  label: 'Закрити панель', family: 'system' },
  'sys.theme':     { glyph: SunMoon,           label: 'Тема',          family: 'system' },
  // Смуга «вхід · час оновитись» (Errors E2) — log-in, як у бандлі.
  'sys.login':     { glyph: LogIn,             label: 'Увійти',        family: 'system' },
  'sys.sound':     { glyph: Volume2,           label: 'Звук',          family: 'system' },
  'sys.profile':   { glyph: User,              label: 'Профіль',       family: 'system' },
  'sys.menu':      { glyph: Menu,              label: 'Меню',          family: 'system' },
  'sys.back':      { glyph: ArrowLeft,         label: 'Назад',         family: 'system' },
  // 12.09 (A9): bookmark = зберегти на потім («Колись» на пропозиції, «У рецепти»
  // на сторінці — одна дія, слово за місцем); «сподобалось» — heart (cook.love).
  'sys.later':     { glyph: Bookmark,          label: 'Колись',        family: 'system' },
  // 12.09 (A11, A13): оператори. `minus` у степері — «менше», `arrow-right` —
  // «перейти» (CTA «Далі», «Увійти в Кухню», наслідок «→ у комору»).
  'sys.less':      { glyph: Minus,             label: 'Менше',         family: 'system' },
  'sys.go':        { glyph: ArrowRight,        label: 'Перейти',       family: 'system' },
  // 12.09 (A15–A18): дії й стани з кадрів календаря, профілю, картки позиції.
  'sys.hide':      { glyph: EyeOff,            label: 'Сховати',       family: 'system' },
  'sys.toList':    { glyph: ListPlus,          label: 'У список',      family: 'system' },
  'sys.hint':      { glyph: Lightbulb,         label: 'Підказка',      family: 'system' },
  'sys.mail':      { glyph: Mail,              label: 'Пошта',         family: 'system' },
  'sys.trash':     { glyph: Trash2,            label: 'Викинути',      family: 'system' },
  'sys.more':      { glyph: Ellipsis,          label: 'Ще',            family: 'system' },
  'sys.notes':     { glyph: StickyNote,        label: 'Нотатки',       family: 'system' },

  // ---- зони комори ----
  // Знаки — ті, що бандл ставить зонам (Screens, Icons «Зони комори»): leaf ·
  // refrigerator · snowflake · archive · amphora · wine. Своєї сімʼї в зон
  // нема (ANSWERS §1): зона на екрані ніколи не стоїть без назви в чорнильному
  // хедері. Колізії розведено: Зелень → leafy-green, Спеції → amphora
  // (flame — тільки «Горить»), refrigerator — записаний виняток (EXCEPTIONS).
  'zone.fresh':    { glyph: Leaf,          label: 'Свіже',       family: 'zones' },
  'zone.fridge':   { glyph: Refrigerator,  label: 'Холодильник', family: 'zones' },
  'zone.freezer':  { glyph: Snowflake,     label: 'Морозилка',   family: 'zones' },
  'zone.dry':      { glyph: Archive,       label: 'Суха шафа',   family: 'zones' },
  'zone.spices':   { glyph: Amphora,       label: 'Спеції',      family: 'zones' },
  'zone.drinks':   { glyph: Wine,          label: 'Напої',       family: 'zones' },

  // ---- продукти: категорії каталогу ----
  'prod.veg':      { glyph: Carrot,    label: 'Овочі',          family: 'products' },
  'prod.fruit':    { glyph: Apple,     label: 'Фрукти',         family: 'products' },
  'prod.greens':   { glyph: LeafyGreen, label: 'Зелень',        family: 'products' },
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
  // 12.09 (§6): «2 порції» — без знака, слово несе зміст; users лишається за
  // подією дому (live.household).
  'cook.time':     { glyph: Clock,         label: 'Час',           family: 'cooking' },
  'cook.ban':      { glyph: Ban,           label: 'Не можна',      family: 'cooking' },
  'cook.love':     { glyph: Heart,         label: 'Люблю',         family: 'cooking' },
  // Бібліотека рецептів (Screens D5): «готував 2 рази» і «Знову» в журналі —
  // rotate-ccw, один зміст «повторно»; «бракує: …» — кошик-basket (не cart:
  // cart — кошик мережі). «використає: …» — словом, без знака (§7): знак
  // конкурував би з чіпом «Горить».
  'cook.done':     { glyph: RotateCcw,     label: 'Готував, знову',family: 'cooking' },
  'cook.missing':  { glyph: ShoppingBasket,label: 'Бракує',        family: 'cooking' },
  'sys.import':    { glyph: Import,        label: 'Записати свій', family: 'system' },
  // Рецепт (Screens «Рецепт · 1440», «Чат · збірка»): кроки — list-ordered,
  // збережено — bookmark-check, поділитись — share-2, уточнити — reply.
  'cook.steps':    { glyph: ListOrdered,   label: 'Кроки',         family: 'cooking' },
  'sys.saved':     { glyph: BookmarkCheck, label: 'Збережено',     family: 'system' },
  'sys.share':     { glyph: Share2,        label: 'Поділитись',    family: 'system' },
  'sys.reply':     { glyph: Reply,         label: 'Уточнити',      family: 'system' },
  'cook.rating':   { glyph: Star,          label: 'Оцінка',        family: 'cooking' },

  // ---- живі стани й тривога ----
  'live.burning':  { glyph: Flame,         label: 'Горить',        family: 'live' },
  'live.thinking': { glyph: Sparkles,      label: 'Думаю',         family: 'live' },
  // 12.09 (A10): alert-triangle — лише danger: «Прострочено N», плашка строку
  // на danger-підкладці, «відповідь не прийшла». «Не можна» / алерген — ban plum.
  'live.overdue':  { glyph: TriangleAlert, label: 'Прострочено',   family: 'live' },
  // Роди періодів — як у бандлі (Components A2 кікер, Screens D3 чіпи):
  // сезон — sun / бурштин, традиція — church / слива, завіз — truck / шавлія,
  // подія дому — users / шавлія. Рамка дня — без знака (muted).
  'live.season':   { glyph: Sun,           label: 'Сезон',         family: 'live' },
  'live.tradition':{ glyph: Church,        label: 'Свято, піст',   family: 'live' },
  'live.supply':   { glyph: Truck,         label: 'Завіз',         family: 'live' },
  'live.household':{ glyph: Users,         label: 'Подія дому',    family: 'live' },
  'live.byHand':   { glyph: Pencil,        label: 'Рукою',         family: 'live' },
  // 12.09 (§1): походження «домислено» — circle-dashed: «межа є, але не точна».
  'live.inferred': { glyph: CircleDashed,  label: 'Домислено',     family: 'live' },
  // 12.09 (A15): «обмежую» в картці посту — lock (plum); ban — «не можна».
  'live.restrict': { glyph: Lock,          label: 'Обмежую',       family: 'live' },
  // 6b-5: суворий період у шапці чату (Screens «Чат · збірка»: moon «Піст · до 27 вер»).
  'live.fast':     { glyph: Moon,          label: 'Піст',          family: 'live' },
  // Стани дії — рядок над композитором (Components · «Стани дії»). Знаки з
  // бандла: ліміт (і денний ліміт, E19 — стану в коді нема) — пісочний
  // годинник, мережа — wifi-off, «нічого не змінилось» — equal (12.09, A11:
  // «=» і є «нічого не змінилось»; minus — оператор степера). «Стоп» — квадрат.
  'live.limit':    { glyph: Hourglass,     label: 'Ліміт',         family: 'live' },
  'live.offline':  { glyph: WifiOff,       label: 'Немає звʼязку', family: 'live' },
  'live.nothing':  { glyph: Equal,         label: 'Нічого не змінилось', family: 'live' },
  'sys.stop':      { glyph: Square,        label: 'Стоп',          family: 'system' },
  'sys.retry':     { glyph: RotateCw,      label: 'Повторити',     family: 'system' },
  // Джерело події «з каталогу» в «Дім зараз» — book-marked, як у бандлі (Components).
  'sys.tradition': { glyph: BookMarked,    label: 'З каталогу',    family: 'system' },
  // ---- лендінг (Landing Live) ----
  // Знаки, яких застосунок не мав: три рядки «Kitchen OS вже знає», журнал у
  // фрагменті «Що вміє» і чіп кошика в живій сесії. Блок окремий і в кінці
  // мапи, з префіксом `landing.` — щоб зливатись із feat/icon-motion без
  // конфлікту (motion.ts вичерпно мапить лише `sys.*`).
  // Знаки лендінгу, що ВЖЕ є в словнику з іншим значенням, сюди не потрапили
  // (bookmark = «Колись», alert-triangle = «Прострочено», minus = «Нічого не
  // змінилось») — див. QUESTIONS-FOR-DESIGN-CHAT.md §16 і DEVIATIONS Р41.
  'landing.opened':   { glyph: PackageOpen, label: 'Відкрите',          family: 'system' },
  'landing.leftover': { glyph: History,     label: 'Після вчорашнього', family: 'system' },
  'landing.recent':   { glyph: List,        label: 'Готував нещодавно', family: 'system' },
  'landing.variety':  { glyph: Shuffle,     label: 'Різноманіття',      family: 'system' },
  'landing.toPanel':  { glyph: ChevronLeft, label: 'У панель',          family: 'system' },

  // ---- вхід між листом і продуктом (Auth.dc.html: Перевір пошту · Запрошення) ----
  // house на кікері «Запрошення в дім» — той самий «Дім», що в sys.home (A6).
  'auth.sent':      { glyph: Send,       label: 'Лінк летить',    family: 'system' },
  'auth.delivered': { glyph: MailCheck,  label: 'Лист надіслано', family: 'system' },
  'auth.household': { glyph: House,      label: 'Дім',            family: 'system' },
  'auth.otherUser': { glyph: UserRoundX, label: 'Інший акаунт',   family: 'system' },
  // ── Cook Mode + /share (feat/cook-share-v3, окремий блок у кінці) ──────────
  // Prototype «COOK MODE», Cook and Share «Cook · 768/390»: пауза/старт таймера.
  // Перемикач теми — один тогл sys.theme (sun-moon), 12.09 (A7): sun і moon
  // лишаються за сезоном і постом.
  'cook.pause':    { glyph: Pause,         label: 'Пауза',         family: 'cooking' },
  'cook.play':     { glyph: Play,          label: 'Старт',         family: 'cooking' },
} as const satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

/** Знаки, за якими правило закріплює РІВНО одне значення (HANDOFF; ANSWERS A, 12.09). */
export const RESERVED: { glyph: LucideIcon; only: string }[] = [
  { glyph: Flame, only: 'Горить' },
  { glyph: ChefHat, only: 'Тип рецепта' },
  { glyph: CookingPot, only: 'Готуємо' },
  { glyph: TriangleAlert, only: 'Прострочено' },
  { glyph: Sun, only: 'Сезон' },
  { glyph: Moon, only: 'Піст' },
  { glyph: SunMoon, only: 'Тема' },
  { glyph: House, only: 'Дім' },
  { glyph: Bookmark, only: 'Колись' },
  { glyph: Heart, only: 'Люблю' },
  { glyph: Trash2, only: 'Викинути' },
  { glyph: Equal, only: 'Нічого не змінилось' },
];

/** Один зміст на двох осях — не конфлікт. Тут перелічено навмисні збіги. */
export const SHARED_ON_PURPOSE = ['Напої', 'Морозилка'];

/**
 * Оператори — граматика, не значення (ANSWERS A11–A13, 12.09): зміст несе
 * слово поруч, тому «Менше» в степері й «Закрити» на панелі не рахуються
 * за колізію з чим завгодно. Список закритий: plus · minus · x · check ·
 * chevron-* · arrow-*.
 */
export const OPERATORS: readonly LucideIcon[] = [
  Plus, Minus, X, Check,
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  ArrowUp, ArrowLeft, ArrowRight,
];

/**
 * Записані винятки з правила «один знак — одне значення». Один: `refrigerator`
 * у рейці означає весь склад («Комора»), у хедері зони — сам прилад. Рейка й
 * хедер ніколи не в одному скануванні, а анімація дверцят — уже мова продукту
 * (ANSWERS §1).
 */
export const EXCEPTIONS: { glyph: LucideIcon; meanings: string[]; why: string }[] = [
  { glyph: Refrigerator, meanings: ['Комора', 'Холодильник'], why: 'знак приладу в рейці — весь склад, у хедері зони — сама зона' },
];

/**
 * Колізії, успадковані з бандла й винесені дизайн-чату. Це НЕ дозвіл — це
 * список того, що тест знає і чекає відповіді. Коли дизайн-чат вирішить,
 * запис звідси зникає, і тест знову падатиме на цьому знаку.
 */
export const PENDING_DESIGN_CHAT: { glyph: LucideIcon; meanings: string[]; question: string }[] = [
  // Порожній з 12.09: §1 (leaf → leafy-green, refrigerator — виняток), §6
  // (порції без знака), A6 (house — один референт), A7 (тема — sun-moon),
  // A12 (chevron — оператор). Історія питань — QUESTIONS-FOR-DESIGN-CHAT.md.
];
