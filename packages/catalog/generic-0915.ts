// Власник 15.09: загальні записи для родових слів. Одне джерело для seed.ts
// (блок CATALOG_GENERIC), тестів і GENERIC-0915.md. Код резолвера не чіпається:
// слово стає точним аліасом свого загального запису; уточнення («кефір 1%»)
// і далі беруть точний запис, бо exact б'є anchored. priority −1 — за рівного
// збігу конкретний варіант сильніший.
export interface GenericEntry {
  word: string;
  key: string;
  name: string;
  /** Типовий варіант, з якого взято категорії, зону, алергени й нутрієнти (оцінка). */
  typical: string;
  typicalDesc: string;
  aliases: string[];
  /** Спірне — на звірку власника. */
  note: string;
}

export const GENERIC_0915: readonly GenericEntry[] = [
  { word: 'кефір', key: 'gen_kefir', name: 'Кефір', typical: 'dairy_kefir_25', typicalDesc: 'кефір 2,5%', aliases: ['кефір', 'кефіру', 'кефіром', 'кефірчик'], note: '' },
  { word: 'сметана', key: 'gen_sour_cream', name: 'Сметана', typical: 'dairy_sour_cream_15', typicalDesc: 'сметана 15%', aliases: ['сметана', 'сметани', 'сметаною', 'сметанка'], note: '' },
  { word: 'йогурт', key: 'gen_yogurt', name: 'Йогурт', typical: 'yog_natural', typicalDesc: 'йогурт натуральний', aliases: ['йогурт', 'йогурту', 'йогуртом', 'йогурти'], note: '' },
  { word: 'масло', key: 'gen_butter', name: 'Масло', typical: 'butter', typicalDesc: 'масло вершкове', aliases: ['масло', 'масла', 'маслом'], note: 'спірне: «масло» = вершкове; олія — окремо' },
  { word: 'хліб', key: 'gen_bread', name: 'Хліб', typical: 'bread_wheat_white', typicalDesc: 'хліб пшеничний білий', aliases: ['хліб', 'хліба', 'хлібом', 'хлібина', 'буханка'], note: '' },
  { word: 'рис', key: 'gen_rice', name: 'Рис', typical: 'grain_rice_long', typicalDesc: 'рис довгозернистий', aliases: ['рис', 'рису', 'рисом'], note: '' },
  { word: 'гречка', key: 'gen_buckwheat', name: 'Гречка', typical: 'grain_buckwheat_kernel', typicalDesc: 'гречка ядриця', aliases: ['гречка', 'гречки', 'гречкою', 'гречана крупа'], note: '' },
  { word: 'олія', key: 'gen_oil', name: 'Олія', typical: 'sunflower_oil', typicalDesc: 'олія соняшникова', aliases: ['олія', 'олії', 'олією', 'олійка'], note: '' },
  { word: 'ковбаса', key: 'gen_sausage', name: 'Ковбаса', typical: 'saus_boiled_likarska', typicalDesc: 'ковбаса варена (Лікарська)', aliases: ['ковбаса', 'ковбаси', 'ковбасою', 'ковбаска', 'ковбаски'], note: '' },
  { word: 'помідори', key: 'gen_tomatoes', name: 'Помідори', typical: 'veg_tomato_plum', typicalDesc: 'помідори звичайні (сливка, свіжі)', aliases: ['помідори', 'помідор', 'помідорів', 'помідорами', 'томати', 'томат', 'томатів'], note: 'спірне: свіжі помідори, не пелаті' },
  { word: 'риба', key: 'gen_fish', name: 'Риба', typical: 'fish_hake', typicalDesc: 'біла риба сира без виду (хек)', aliases: ['риба', 'риби', 'рибу', 'рибою'], note: 'спірне: вид не відомий — беремо хек (морозилка)' },
  { word: 'сир', key: 'gen_cheese', name: 'Сир', typical: 'cheese_hard_generic', typicalDesc: 'сир твердий', aliases: ['сир', 'сиру', 'сиром', 'сирок твердий'], note: 'спірне: сир = твердий; творог окремо' },
  { word: 'творог', key: 'gen_curd', name: 'Творог', typical: 'cheese_curd_9', typicalDesc: 'сир кисломолочний 9%', aliases: ['творог', 'творогу', 'творогом', 'домашній сир', 'сир домашній'], note: 'спірне: творог/сир домашній → кисломолочний' },
  { word: 'вершки', key: 'gen_cream', name: 'Вершки', typical: 'cream_20', typicalDesc: 'вершки 20%', aliases: ['вершки', 'вершків', 'вершками'], note: '' },
  { word: 'індичка', key: 'gen_turkey', name: 'Індичка', typical: 'turkey_fillet', typicalDesc: 'філе індички', aliases: ['індичка', 'індички', 'індичкою', 'індиче'], note: '' },
  { word: 'свинина', key: 'gen_pork', name: 'Свинина', typical: 'pork_neck', typicalDesc: 'свиняча шия', aliases: ['свинина', 'свинини', 'свининою'], note: '' },
  { word: 'яловичина', key: 'gen_beef', name: 'Яловичина', typical: 'beef_stroganoff_cut', typicalDesc: 'яловичина (свіже мʼясо, холодильник)', aliases: ['яловичина', 'яловичини', 'яловичиною'], note: 'спірне: не тушкована консерва' },
  { word: 'телятина', key: 'gen_veal', name: 'Телятина', typical: 'beef_veal_tenderloin', typicalDesc: 'телятина вирізка', aliases: ['телятина', 'телятиною'], note: '' },
  { word: 'печінка', key: 'gen_liver', name: 'Печінка', typical: 'offal_chicken_liver', typicalDesc: 'печінка куряча', aliases: ['печінка', 'печінки', 'печінкою'], note: 'спірне: куряча vs яловича' },
  { word: 'крила', key: 'gen_chicken_wings', name: 'Крила курячі', typical: 'chicken_wing', typicalDesc: 'куряче крило', aliases: ['крила', 'крильця', 'крил', 'курячі крила', 'крила курячі'], note: '' },
  { word: 'стегна', key: 'gen_chicken_thighs', name: 'Стегна курячі', typical: 'chicken_thigh', typicalDesc: 'куряче стегно', aliases: ['стегна', 'стегно', 'стегон', 'курячі стегна', 'стегна курячі', 'стегенця'], note: '' },
  { word: 'тунець', key: 'gen_tuna', name: 'Тунець', typical: 'tuna_canned', typicalDesc: 'тунець консервований', aliases: ['тунець', 'тунцем'], note: '' },
  { word: 'оселедець', key: 'gen_herring', name: 'Оселедець', typical: 'fish_herring_marinated', typicalDesc: 'оселедець (маринований, холодильник)', aliases: ['оселедець', 'оселедцем', 'оселедці'], note: 'спірне: маринований vs свіжоморожений' },
  { word: 'креветки', key: 'gen_shrimp', name: 'Креветки', typical: 'shrimp_vannamei', typicalDesc: 'креветки vannamei', aliases: ['креветки', 'креветок', 'креветками', 'креветка'], note: '' },
  { word: 'перець', key: 'gen_bell_pepper', name: 'Перець', typical: 'veg_bell_pepper_red', typicalDesc: 'перець солодкий червоний', aliases: ['перець', 'перці', 'перцем', 'болгарський перець', 'перець болгарський'], note: 'спірне: «перець» = солодкий овоч, не чорний мелений' },
  { word: 'салат', key: 'gen_lettuce', name: 'Салат', typical: 'veg_lettuce_iceberg', typicalDesc: 'салат айсберг', aliases: ['салат', 'салату', 'салатом', 'салат листовий'], note: 'спірне: листовий салат, не готова страва' },
  { word: 'апельсини', key: 'gen_oranges', name: 'Апельсини', typical: 'orange', typicalDesc: 'апельсин', aliases: ['апельсини', 'апельсинів', 'апельсинами'], note: '' },
  { word: 'макарони', key: 'gen_pasta', name: 'Макарони', typical: 'pasta_penne', typicalDesc: 'пенне', aliases: ['макарони', 'макаронів', 'макаронами', 'паста'], note: 'спірне: «паста» = макарони' },
  { word: 'кава', key: 'gen_coffee', name: 'Кава', typical: 'coffee_beans_arabica', typicalDesc: 'кава в зернах арабіка', aliases: ['кава', 'кави', 'кавою'], note: '' },
  { word: 'вода', key: 'gen_water', name: 'Вода', typical: 'water_still', typicalDesc: 'вода питна негазована', aliases: ['вода', 'води', 'водою', 'питна вода', 'вода питна'], note: '' },
  { word: 'сік', key: 'gen_juice', name: 'Сік', typical: 'juice_orange', typicalDesc: 'сік апельсиновий', aliases: ['сік', 'соку', 'соком', 'соки'], note: 'спірне: апельсиновий vs яблучний' },
  { word: 'пиво', key: 'gen_beer', name: 'Пиво', typical: 'alc_beer_lager_pale', typicalDesc: 'пиво світле лагер', aliases: ['пиво', 'пива', 'пивом'], note: '' },
  { word: 'вино', key: 'gen_wine', name: 'Вино', typical: 'alc_wine_red_dry', typicalDesc: 'вино червоне сухе', aliases: ['вино', 'вина', 'вином'], note: 'спірне: червоне vs біле' },
  { word: 'квасоля', key: 'gen_beans', name: 'Квасоля', typical: 'white_beans_dry', typicalDesc: 'квасоля біла суха', aliases: ['квасоля', 'квасолі', 'квасолею'], note: '' },
  { word: 'горіхи', key: 'gen_nuts', name: 'Горіхи', typical: 'nut_walnut', typicalDesc: 'горіх волоський', aliases: ['горіхи', 'горіх', 'горіхів', 'горіхами'], note: '' },
  { word: 'оливки', key: 'gen_olives', name: 'Оливки', typical: 'olives_green', typicalDesc: 'оливки зелені', aliases: ['оливки', 'оливок', 'оливками', 'маслини'], note: '' },
  { word: 'кукурудза', key: 'gen_corn', name: 'Кукурудза', typical: 'corn_canned', typicalDesc: 'кукурудза консервована солодка', aliases: ['кукурудза', 'кукурудзи', 'кукурудзою'], note: '' },
  { word: 'горошок', key: 'gen_peas', name: 'Горошок', typical: 'green_peas_canned', typicalDesc: 'горошок зелений консервований', aliases: ['горошок', 'горошку', 'горошком'], note: '' },
  { word: 'вареники', key: 'gen_vareniki', name: 'Вареники', typical: 'frz_vareniki_potato', typicalDesc: 'вареники з картоплею', aliases: ['вареники', 'вареників', 'варениками'], note: '' },
  { word: 'морозиво', key: 'gen_ice_cream', name: 'Морозиво', typical: 'frz_ice_cream_plombir', typicalDesc: 'морозиво пломбір', aliases: ['морозиво', 'морозива', 'морозивом'], note: '' },
  { word: 'шоколад', key: 'gen_chocolate', name: 'Шоколад', typical: 'milk_chocolate_bar', typicalDesc: 'шоколад молочний', aliases: ['шоколад', 'шоколаду', 'шоколадом', 'шоколадка'], note: '' },
  { word: 'печиво', key: 'gen_cookies', name: 'Печиво', typical: 'bake_shortbread', typicalDesc: 'печиво пісочне', aliases: ['печиво', 'печива', 'печивом'], note: '' },
  { word: 'чипси', key: 'gen_chips', name: 'Чипси', typical: 'chips_cheese', typicalDesc: 'чипси картопляні', aliases: ['чипси', 'чипсів', 'чипсами'], note: '' },
  { word: 'булочки', key: 'gen_buns', name: 'Булочки', typical: 'bread_kaiser_bun', typicalDesc: 'булочка кайзер', aliases: ['булочки', 'булочка', 'булочок', 'булка', 'булки'], note: '' },
  { word: 'дріжджі', key: 'gen_yeast', name: 'Дріжджі', typical: 'spice_yeast_dry', typicalDesc: 'дріжджі сухі', aliases: ['дріжджі', 'дріжджів', 'дріжджами'], note: '' },
  { word: 'паприка', key: 'gen_paprika', name: 'Паприка', typical: 'spice_paprika_smoked', typicalDesc: 'паприка (спеція)', aliases: ['паприка', 'паприки', 'паприкою'], note: 'спірне: спеція, не свіжий перець' },
  { word: 'салямі', key: 'gen_salami', name: 'Салямі', typical: 'salami_italian_sliced', typicalDesc: 'салямі італійське', aliases: ['салямі'], note: '' },
];
