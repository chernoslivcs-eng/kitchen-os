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
  MessageCircle, Boxes, BookOpen, ListChecks, Calendar, House, ShoppingCart, Receipt,
  Plus, Mic, ArrowUp, Paperclip, Search, SlidersHorizontal, ArrowUpDown, Check, X,
  Undo2, ChevronRight, ExternalLink, PanelLeftClose, SunMoon, Volume2, User, Menu, ArrowLeft,
  Sprout, Refrigerator, Snowflake, Archive, FlaskConical, Wine,
  Carrot, Apple, Leaf, Wheat, Egg, Milk, Beef, Drumstick, Fish, Shell, Ham, Bean,
  Nut, Cherry, Citrus, Croissant, Candy, Coffee, Droplet,
  Soup, Salad, Pizza, Sandwich, EggFried, Cake, CookingPot, Microwave, FlameKindling,
  ChefHat, Timer, Scale, Utensils, Thermometer, Users, Clock, Ban, Heart, History,
  Flame, Sparkles, Pencil, TriangleAlert, CalendarDays, Recycle,
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
  // «Комора» — `boxes`, а не `refrigerator`: холодильник належить ЗОНІ
  // холодильника, а комора як місце — це склад речей, не прилад.
  'sys.chat':      { glyph: MessageCircle,     label: 'Чат',           family: 'system' },
  'sys.pantry':    { glyph: Boxes,             label: 'Комора',        family: 'system' },
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
  'sys.theme':     { glyph: SunMoon,           label: 'Тема',          family: 'system' },
  'sys.sound':     { glyph: Volume2,           label: 'Звук',          family: 'system' },
  'sys.profile':   { glyph: User,              label: 'Профіль',       family: 'system' },
  'sys.menu':      { glyph: Menu,              label: 'Меню',          family: 'system' },
  'sys.back':      { glyph: ArrowLeft,         label: 'Назад',         family: 'system' },

  // ---- зони комори: четверта сімʼя (Р21) ----
  // `sprout` замість `leaf` — звільняє `leaf` для «Зелень» і «пісне».
  // `flask-conical` замість `flame` — звільняє `flame` для «Горить».
  'zone.fresh':    { glyph: Sprout,        label: 'Свіже',       family: 'zones' },
  'zone.fridge':   { glyph: Refrigerator,  label: 'Холодильник', family: 'zones' },
  'zone.freezer':  { glyph: Snowflake,     label: 'Морозилка',   family: 'zones' },
  'zone.dry':      { glyph: Archive,       label: 'Суха шафа',   family: 'zones' },
  'zone.spices':   { glyph: FlaskConical,  label: 'Спеції',      family: 'zones' },
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
  'cook.done':     { glyph: History,       label: 'Готував',       family: 'cooking' },
  'cook.rescue':   { glyph: Recycle,       label: 'Використає',    family: 'cooking' },

  // ---- живі стани й тривога ----
  'live.burning':  { glyph: Flame,         label: 'Горить',        family: 'live' },
  'live.thinking': { glyph: Sparkles,      label: 'Думаю',         family: 'live' },
  'live.overdue':  { glyph: TriangleAlert, label: 'Прострочено',   family: 'live' },
  'live.season':   { glyph: CalendarDays,  label: 'Сезон',         family: 'live' },
  'live.byHand':   { glyph: Pencil,        label: 'Рукою',         family: 'live' },
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
