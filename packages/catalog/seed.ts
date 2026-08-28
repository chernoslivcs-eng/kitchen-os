// Стартовий сід каталогу. 16 позицій — щоб пройшли три критеріальні тести
// і було з чим показати механізми алергенів / антипатернів / резолвера.
// Це не 1500 позицій із фінальної версії, це «стільки, скільки достатньо, щоб побачити,
// що каркас працює». Розширення каталогу — окрема задача (паралельні агенти з валідацією).

export interface CatalogItem {
  key: string;
  name: string;                  // канонічна назва для людини
  aliases: string[];             // як зустрічається в чеках і мовленні
  categories: string[];          // ієрархія від конкретного до загального
  allergen_groups: string[];     // «молюски», «горіхи», «глютен», «молочне» ...
  zone_default: 'dry' | 'fridge' | 'freezer' | 'fresh' | 'spices' | 'drinks';
  unit_weight?: number;
  density?: number;
  nutrition?: { kcal: number; p: number; f: number; c: number };
}

export const CATALOG: CatalogItem[] = [
  {
    key: 'mussel_meat',
    name: 'Мʼясо мідій',
    aliases: ['мідії', 'мідії варені', 'мʼясо мідій', 'karolina', 'karolina мʼясо мідій', 'мидии', 'mussel meat'],
    categories: ['мідії', 'молюски', 'морепродукти', 'тваринне'],
    allergen_groups: ['молюски', 'морепродукти'],
    zone_default: 'freezer',
    nutrition: { kcal: 172, p: 24, f: 4, c: 7 },
  },
  {
    key: 'salami_milano_pork',
    name: 'Ковбаса Міланська',
    aliases: ['ковбаса міланська', 'міланська', 'salami milano', 'salame milano', 'мілано'],
    categories: ['ковбаса', 'сирокопчене', 'свинина', 'мʼясо', 'тваринне'],
    allergen_groups: [],
    zone_default: 'fridge',
    nutrition: { kcal: 407, p: 22, f: 34, c: 1 },
  },
  {
    key: 'cilantro_fresh',
    name: 'Кінза свіжа',
    aliases: ['кінза', 'кінзу', 'кінзи', 'кінзою', 'коріандр свіжий', 'coriander', 'cilantro'],
    categories: ['зелень', 'трави', 'свіже'],
    allergen_groups: [],
    zone_default: 'fresh',
  },
  {
    key: 'cambozola_cheese',
    name: 'Камбоцола 70%',
    aliases: ['камбоцола', 'cambozola', 'камбоц', 'сир камбоц'],
    categories: ['сир', 'блакитний сир', 'молочне'],
    allergen_groups: ['молочне'],
    zone_default: 'fridge',
    nutrition: { kcal: 427, p: 15, f: 41, c: 1 },
  },
  {
    key: 'mozzarella_pizza',
    name: 'Моцарела для піци',
    aliases: ['моцарела', 'mozzarella', 'моцарелла'],
    categories: ['сир', 'молочне'],
    allergen_groups: ['молочне'],
    zone_default: 'fridge',
    nutrition: { kcal: 280, p: 22, f: 22, c: 2 },
  },
  {
    key: 'parmesan',
    name: 'Пармезан',
    aliases: ['пармезан', 'parmigiano', 'parmigiano reggiano', 'grana padano'],
    categories: ['сир', 'твердий сир', 'молочне'],
    allergen_groups: ['молочне'],
    zone_default: 'fridge',
    nutrition: { kcal: 392, p: 36, f: 26, c: 3 },
  },
  {
    key: 'pomodori_pelati',
    name: 'Помідори пелаті',
    aliases: ['пелаті', 'pomodori pelati', 'томати очищені', 'помідори в соку'],
    categories: ['томати', 'овочі', 'консерви'],
    allergen_groups: [],
    zone_default: 'dry',
    nutrition: { kcal: 22, p: 1, f: 0, c: 4 },
  },
  {
    key: 'spaghetti_no5',
    name: 'Спагеті №5',
    aliases: ['спагеті', 'спагетті', 'spaghetti', 'паста спагеті', 'паста №5'],
    categories: ['паста', 'борошняне'],
    allergen_groups: ['глютен'],
    zone_default: 'dry',
    nutrition: { kcal: 358, p: 12, f: 2, c: 71 },
  },
  {
    key: 'olive_oil_evoo',
    name: 'Оливкова олія екстра',
    aliases: ['оливкова олія', 'olive oil', 'evoo', 'олія оливкова'],
    categories: ['олія', 'жири'],
    allergen_groups: [],
    zone_default: 'spices',
    density: 0.91,
    nutrition: { kcal: 884, p: 0, f: 100, c: 0 },
  },
  {
    key: 'garlic',
    name: 'Часник',
    aliases: ['часник', 'часнику', 'часником', 'garlic'],
    categories: ['цибулеві', 'овочі', 'свіже'],
    allergen_groups: [],
    zone_default: 'fresh',
  },
  {
    key: 'onion_yellow',
    name: 'Цибуля ріпчаста',
    aliases: ['цибуля', 'цибулю', 'цибуля жовта', 'ріпчаста', 'onion'],
    categories: ['цибулеві', 'овочі', 'свіже'],
    allergen_groups: [],
    zone_default: 'fresh',
  },
  {
    key: 'ground_beef_pork',
    name: 'Яловично-свинячий фарш',
    aliases: ['фарш', 'яловично-свинячий фарш', 'фарш яловичо-свинячий', 'фарш м’ясний'],
    categories: ['фарш', 'свинина', 'яловичина', 'мʼясо', 'тваринне'],
    allergen_groups: [],
    zone_default: 'fridge',
    nutrition: { kcal: 250, p: 17, f: 20, c: 0 },
  },
  {
    key: 'chicken_whole',
    name: 'Курка ціла',
    aliases: ['курка', 'курки', 'курча', 'chicken', 'куряче тушка'],
    categories: ['курка', 'птиця', 'мʼясо', 'тваринне'],
    allergen_groups: [],
    zone_default: 'fridge',
    nutrition: { kcal: 239, p: 27, f: 14, c: 0 },
  },
  {
    key: 'salmon_fresh',
    name: 'Лосось охолоджений',
    aliases: ['лосось', 'лосося', 'salmon', 'сьомга'],
    categories: ['лосось', 'риба', 'тваринне'],
    allergen_groups: ['риба'],
    zone_default: 'fridge',
    nutrition: { kcal: 206, p: 22, f: 13, c: 0 },
  },
  {
    key: 'peanut',
    name: 'Арахіс',
    aliases: ['арахіс', 'арахісу', 'peanut', 'земляний горіх'],
    categories: ['арахіс', 'бобові'],
    allergen_groups: ['арахіс'],
    zone_default: 'dry',
    nutrition: { kcal: 567, p: 26, f: 49, c: 16 },
  },
  {
    key: 'milk_cow_25',
    name: 'Молоко коровʼяче 2.5%',
    aliases: ['молоко', 'молоко 2.5%', 'молоко пастеризоване', 'milk', 'молоко корівʼяче'],
    categories: ['молоко', 'молочне'],
    allergen_groups: ['молочне', 'лактоза'],
    zone_default: 'fridge',
    density: 1.03,
    nutrition: { kcal: 50, p: 3.3, f: 2.5, c: 4.8 },
  },
];

export const BY_KEY = new Map(CATALOG.map((i) => [i.key, i]));
