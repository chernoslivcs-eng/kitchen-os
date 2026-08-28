import React, { useState, useEffect, useRef, useMemo } from "react";

/* ============================================================
   КУХНЯ — прототип v1
   Замкнена петля: Capture → IntakeDiff → Pantry → Proposal
                   → Recipe → CookRun → Settlement → Pantry
   ============================================================ */

/* ---------- одиниці ---------- */
const U = {
  g: "г", kg: "кг", ml: "мл", l: "л",
  tsp: "ч.л.", tbsp: "ст.л.",
  pcs: "шт", clove: "зубчик", fillet: "філе", brick: "брикет",
  can: "банка", pack: "пачка", bunch: "пучок", slice: "скибка",
  pinch: "дрібка", taste: "до смаку", handful: "жменя",
};
const MASSY = ["g", "ml"];
const fmtQ = (v, u) => {
  if (u === "taste") return "до смаку";
  const n = Math.round(v * 100) / 100;
  return `${n} ${U[u] || u}`;
};
const scale = (v, u, servings, base) => {
  const r = (v * servings) / base;
  if (MASSY.includes(u)) return r > 25 ? Math.round(r / 5) * 5 : Math.round(r);
  if (u === "tsp" || u === "tbsp") return Math.round(r * 4) / 4;
  return Math.round(r * 2) / 2;
};

/* ---------- канонічний каталог (S1, спрощено) ---------- */
const CAT = {
  cambozola: { name: "камбоцола", cat: "сир", openLife: 5 },
  mozzarella: { name: "моцарела", cat: "сир", openLife: 3 },
  parmesan: { name: "пармезан", cat: "сир", openLife: 30 },
  brie: { name: "брі", cat: "сир", openLife: 5 },
  camembert: { name: "камамбер", cat: "сир", openLife: 5 },
  fuet: { name: "фует", cat: "м'ясне", openLife: 14 },
  prosciutto: { name: "прошуто", cat: "м'ясне", openLife: 4 },
  stew: { name: "тушонка", cat: "м'ясне", openLife: 2 },
  perch: { name: "окунь філе", cat: "риба" },
  salmon: { name: "лосось порційний", cat: "риба" },
  lemonJ: { name: "лимонний сік", cat: "фрукт" },
  garlicF: { name: "часник свіжий", cat: "овоч" },
  onionF: { name: "цибуля свіжа", cat: "овоч" },
  herring: { name: "оселедець", cat: "риба", openLife: 3 },
  shrimp: { name: "креветки варені", cat: "риба" },
  mussels: { name: "мідії", cat: "риба" },
  anchovy: { name: "анчоуси", cat: "риба", openLife: 4 },
  spinach: { name: "шпинат морожений", cat: "овоч" },
  potato: { name: "картопля", cat: "овоч" },
  babymix: { name: "бебі мікс", cat: "зелень" },
  tomatoY: { name: "жовтий помідор", cat: "овоч" },
  apple: { name: "зелене яблуко", cat: "фрукт" },
  lemon: { name: "лимон", cat: "фрукт" },
  pickles: { name: "солоні огірки", cat: "овоч", openLife: 20 },
  fettuccine: { name: "фетучіні яєчні", cat: "паста" },
  bucatini: { name: "букатіні", cat: "паста" },
  lentil: { name: "сочевиця зелена", cat: "крупа" },
  mung: { name: "маш", cat: "крупа" },
  pelati: { name: "томати пелаті", cat: "консерва", openLife: 3 },
  olives: { name: "оливки Каламата", cat: "консерва", openLife: 14 },
  capers: { name: "каперси", cat: "консерва", openLife: 30 },
  bruschette: { name: "брускети Maretti", cat: "хліб" },
  cream: { name: "вершки 33%", cat: "молочне", openLife: 4 },
  eggs: { name: "яйця", cat: "молочне" },
  butter: { name: "масло вершкове", cat: "молочне", openLife: 20 },
  oliveoil: { name: "оливкова олія", cat: "олія", staple: true },
  balsamic: { name: "бальзамічний оцет", cat: "олія", staple: true },
  mustard: { name: "гірчиця зерниста", cat: "соус", openLife: 60 },
  pesto: { name: "песто генуезьке", cat: "соус", openLife: 7 },
  honey: { name: "мед", cat: "солодке" },
  garlicD: { name: "часник сушений", cat: "спеція", staple: true },
  onionC: { name: "цибуля карамелізована", cat: "спеція" },
  paprika: { name: "паприка", cat: "спеція", staple: true },
  tomatoS: { name: "томат копчений", cat: "спеція" },
  bay: { name: "лавровий лист", cat: "спеція", staple: true },
  herbs11: { name: "11 трав", cat: "спеція", staple: true },
  pepper: { name: "чорний перець", cat: "спеція", staple: true },
  salt: { name: "сіль", cat: "спеція", staple: true },
  lemonD: { name: "лимон сушений", cat: "спеція" },
};

const ZONES = {
  fridge: "Холодильник",
  freezer: "Морозилка",
  dry: "Комора",
  fresh: "Свіже",
  spices: "Олії та спеції",
  drinks: "Напої",
};

/* ---------- початкова комора: реальний інвентар, оновлення 17.08 ---------- */
let _pid = 0;
const mkItem = (key, label, zone, value, unit, o = {}) => ({
  id: `p${++_pid}`,
  key,
  label,
  zone,
  value,
  unit,
  state: o.op != null ? "opened" : "sealed",
  addedDaysAgo: o.add ?? 20,
  openedDaysAgo: o.op ?? null,
  openLife: o.life ?? null,
  expiresInDays: o.exp ?? null,
  confidence: o.conf ?? 1,
  provenance: o.prov || "receipt",
  staple: !!o.staple,
});

const INITIAL_PANTRY = [
  /* ===== КОМОРА: консерви ===== */
  mkItem(null, "WellDar — квасоля біла", "dry", 410, "g", { add: 70 }),
  mkItem(null, "Верес — горошок зелений", "dry", 420, "g", { add: 70 }),
  mkItem("pelati", "Metro Chef — Pomodori Pelati", "dry", 200, "g", { add: 30, op: 4, life: 4, exp: 1, conf: 0.6, prov: "inference" }),
  mkItem("pelati", "MC — томати чері ж/б", "dry", 800, "g", { add: 10 }),
  mkItem(null, "Metro Chef — кукурудза солодка", "dry", 340, "g", { add: 70 }),
  mkItem(null, "Sacla — Pomodori al forno з оливками", "dry", 290, "g", { add: 40 }),
  mkItem("stew", "Яловичина тушкована", "dry", 338, "g", { add: 60, conf: 0.6 }),
  mkItem(null, "Rio Mare — тунець", "dry", 160, "g", { add: 55 }),
  mkItem(null, "MC — лосось копчений в олії", "dry", 120, "g", { add: 45 }),
  mkItem("capers", "Serpis — каперси в оцті", "dry", 100, "g", { add: 50, op: 22, life: 40 }),
  mkItem("anchovy", "Rizzoli — анчоуси в олії", "dry", 40, "g", { add: 25 }),
  mkItem(null, "Iruela — зелені Chupadedos", "dry", 300, "g", { add: 60 }),
  mkItem("olives", "Iruela — Kalamata", "dry", 120, "g", { add: 60, op: 14, life: 20 }),
  mkItem("olives", "MC — Каламата маринована", "dry", 500, "g", { add: 10 }),
  mkItem(null, "MC — зелені мариновані з кісточкою", "dry", 350, "g", { add: 60 }),

  /* ===== КОМОРА: крупи, паста ===== */
  mkItem("lentil", "Сочевиця зелена", "dry", 300, "g", { add: 75, op: 25, life: 200 }),
  mkItem(null, "Аромікс — квасоля біла суха", "dry", 500, "g", { add: 75 }),
  mkItem(null, "Сквирянка — перлова крупа", "dry", 800, "g", { add: 95 }),
  mkItem("bucatini", "Barilla — Bucatini n.9", "dry", 400, "g", { add: 60 }),
  mkItem(null, "Barilla — Спагетіні n.3", "dry", 1000, "g", { add: 10 }),
  mkItem(null, "Barilla — Фарфалле n.65", "dry", 500, "g", { add: 10 }),
  mkItem(null, "Barilla — Рісоні", "dry", 500, "g", { add: 10 }),
  mkItem("fettuccine", "Barilla — Фетучіні яєчні", "dry", 500, "g", { add: 10 }),
  mkItem(null, "Flower Land — Udon", "dry", 300, "g", { add: 80 }),
  mkItem(null, "JML — локшина (класична / ban mian / Shanxi)", "dry", 3, "pack", { add: 12 }),
  mkItem(null, "Yopokki — Cheese Cup Rapokki", "dry", 1, "pack", { add: 12 }),

  /* ===== КОМОРА: сніданки, солодке ===== */
  mkItem(null, "Doctor Benner — мюслі Cherry Crunchy", "dry", 375, "g", { add: 60, op: 30, life: 90 }),
  mkItem(null, "Metro Chef — кульки з какао", "dry", 500, "g", { add: 60 }),
  mkItem(null, "АХА — вівсяні пластівці", "dry", 450, "g", { add: 10 }),
  mkItem(null, "АХА — гранола тропічні фрукти", "dry", 660, "g", { add: 10 }),
  mkItem(null, "Мрія — желе (апельсин / вишня / ягоди)", "dry", 3, "pcs", { add: 10 }),
  mkItem(null, "Rioba — шоколад сіль-кукурудза", "dry", 360, "g", { add: 10 }),
  mkItem("honey", "Honey Way — мед різнотрав'я", "dry", 250, "g", { add: 30 }),
  mkItem(null, "Helios — джем інжирний", "dry", 300, "g", { add: 30 }),
  mkItem(null, "Zuegg — джем апельсиновий", "dry", 300, "g", { add: 30 }),
  mkItem(null, "Джем журавлина-лимон", "dry", 300, "g", { add: 30 }),
  mkItem(null, "Згущене молоко", "dry", 370, "g", { add: 40 }),
  mkItem(null, "MC — цукор тростинний пресований", "dry", 250, "g", { add: 10, staple: true }),

  /* ===== КОМОРА: готове, снеки ===== */
  mkItem(null, "Street Soup — гороховий крем-суп", "dry", 250, "g", { add: 65 }),
  mkItem(null, "Street Soup — грибний крем-суп", "dry", 5, "pcs", { add: 65 }),
  mkItem(null, "Golden Calf — рисовий папір", "dry", 200, "g", { add: 80 }),
  mkItem(null, "HiPOKKI — Tteokbokki Rose", "dry", 240, "g", { add: 65 }),
  mkItem("bruschette", "Maretti — брускети", "dry", 200, "g", { add: 25 }),
  mkItem(null, "Tao Kae Noi — норі срірача", "dry", 4, "pcs", { add: 55 }),
  mkItem(null, "RYABCHICK — курячі снеки (гауда)", "dry", 76, "g", { add: 30 }),
  mkItem(null, "Lay's — чипси сир", "dry", 130, "g", { add: 10 }),
  mkItem(null, "Fine Life — сухарі панірувальні", "dry", 200, "g", { add: 10 }),

  /* ===== СВІЖЕ ===== */
  mkItem("garlicF", "Часник свіжий", "fresh", 1, "pcs", { add: 14, conf: 0.5, prov: "inference" }),
  mkItem("onionF", "Цибуля свіжа", "fresh", 2, "pcs", { add: 14, conf: 0.5, prov: "inference" }),
  mkItem("potato", "Картопля", "fresh", 900, "g", { add: 14, conf: 0.6 }),
  mkItem("apple", "Яблука зелені", "fresh", 3, "pcs", { add: 12 }),
  mkItem(null, "Грейпфрут (половина)", "fresh", 0.5, "pcs", { add: 6, op: 5, life: 5, exp: 1 }),
  mkItem("pickles", "Солоні огірки", "fresh", 400, "g", { add: 40, op: 12, life: 25 }),
  mkItem(null, "Апельсин", "fresh", 830, "g", { add: 10, exp: 6 }),
  mkItem("tomatoY", "Томат жовтий", "fresh", 666, "g", { add: 10, exp: 2 }),
  mkItem("babymix", "MC — салат бебі мікс митий", "fresh", 250, "g", { add: 10, exp: 1 }),

  /* ===== МОРОЗИЛКА: море ===== */
  mkItem("shrimp", "MC — креветки vannamei 58/66", "freezer", 200, "g", { add: 70, conf: 0.5 }),
  mkItem("shrimp", "MC — креветки 70/90 в панцирі", "freezer", 800, "g", { add: 10 }),
  mkItem("mussels", "Karolina — м'ясо мідій", "freezer", 250, "g", { add: 60, op: 20, life: 30, conf: 0.7 }),
  mkItem("mussels", "Karolina — м'ясо мідій ×2", "freezer", 800, "g", { add: 10 }),
  mkItem(null, "PS — морський коктейль", "freezer", 250, "g", { add: 45, conf: 0.5 }),
  mkItem(null, "Тунець стейки (старі)", "freezer", 1, "pcs", { add: 110 }),
  mkItem(null, "Yapiko — стейки тунця вак.", "freezer", 375, "g", { add: 12, op: 6, life: 60 }),
  mkItem("salmon", "MC — лосось порційний 150 г", "freezer", 4, "pcs", { add: 12, op: 5, life: 60 }),
  mkItem(null, "Сало копчене генеральське", "freezer", 150, "g", { add: 85, conf: 0.6 }),

  /* ===== МОРОЗИЛКА: решта ===== */
  mkItem("spinach", "FL — шпинат порційний", "freezer", 3, "brick", { add: 20, op: 8, life: 90 }),
  mkItem(null, "MC — панкейки картопляні", "freezer", 1100, "g", { add: 15, op: 7, life: 60 }),
  mkItem(null, "Metro Chef — Mexico-Mix", "freezer", 1000, "g", { add: 95 }),
  mkItem(null, "Metro Chef — авокадо половинки", "freezer", 4, "pcs", { add: 95 }),
  mkItem(null, "Зелень морожена (кріп, петрушка, цибуля)", "freezer", 200, "g", { add: 30 }),
  mkItem(null, "Нагетси курячі", "freezer", 400, "g", { add: 100 }),
  mkItem(null, "Котлети бургерні яловичі (старі)", "freezer", 2, "pcs", { add: 120 }),
  mkItem(null, "Глобино — котлети бургерні яловичі", "freezer", 480, "g", { add: 14 }),
  mkItem(null, "Котлети індичі", "freezer", 400, "g", { add: 50 }),
  mkItem(null, "Boston buns", "freezer", 4, "pcs", { add: 40 }),
  mkItem(null, "Чіабата з сиром", "freezer", 340, "g", { add: 8 }),

  /* ===== ХОЛОДИЛЬНИК: молочне ===== */
  mkItem(null, "Вершки 20% (залишок)", "fridge", 80, "ml", { add: 20, op: 9, life: 5, exp: 1, conf: 0.6 }),
  mkItem("cream", "Галичина — вершки 33%", "fridge", 400, "ml", { add: 10, op: 3, life: 5, exp: 4 }),
  mkItem(null, "MC — молоко 2,5%", "fridge", 2000, "ml", { add: 10, exp: 9 }),
  mkItem(null, "Молоко Бурьонка / Простонаше (залишки)", "fridge", 400, "ml", { add: 25, op: 10, life: 5, exp: 1, conf: 0.5 }),
  mkItem(null, "MC — айран", "fridge", 1000, "ml", { add: 10, exp: 8 }),
  mkItem(null, "MC — йогурт питний полуниця-банан", "fridge", 500, "ml", { add: 20, exp: 5 }),
  mkItem("eggs", "MC — яйця курячі С0", "fridge", 7, "pcs", { add: 12, op: 6, life: 25, conf: 0.7 }),
  mkItem("butter", "Масло вершкове", "fridge", 150, "g", { add: 25, op: 12, life: 25 }),

  /* ===== ХОЛОДИЛЬНИК: сири ===== */
  mkItem("parmesan", "MC — Парміджано Реджано ×2", "fridge", 200, "g", { add: 10 }),
  mkItem(null, "Гауда 48%", "fridge", 250, "g", { add: 35, op: 15, life: 25 }),
  {
    ...mkItem("mozzarella", "Моцарела Jager (залишок)", "fridge", 60, "g", { add: 20, op: 4, life: 3, exp: 1, conf: 0.6 }),
    lastBy: "Оксана",
    lastAction: "відкрито",
  },
  mkItem("mozzarella", "Jager — моцарела 45%", "fridge", 250, "g", { add: 10, exp: 12 }),
  mkItem("brie", "Брі", "fridge", 90, "g", { add: 18, exp: 5 }),
  mkItem("camembert", "MC — камамбер ×2", "fridge", 240, "g", { add: 10, exp: 14 }),
  mkItem("cambozola", "Cambozola (початке)", "fridge", 70, "g", { add: 22, op: 6, life: 6, exp: 1, conf: 0.6 }),
  mkItem("cambozola", "Kaserei — камбоцола 70%", "fridge", 167, "g", { add: 14, exp: 9 }),
  mkItem("cambozola", "Kaserei — камбоцола 70%", "fridge", 193, "g", { add: 10, exp: 12 }),
  mkItem(null, "Kavli — сир з креветками", "fridge", 175, "g", { add: 40, op: 20, life: 20 }),

  /* ===== ХОЛОДИЛЬНИК: м'ясне ===== */
  mkItem("prosciutto", "Прошуто крудо", "fridge", 120, "g", { add: 20, op: 5, life: 5, exp: 2, conf: 0.7 }),
  mkItem(null, "Глобино — салямі італійське нарізка", "fridge", 160, "g", { add: 10, exp: 20 }),
  mkItem("fuet", "MC — фует (палка)", "fridge", 180, "g", { add: 8, op: 2, life: 20 }),

  /* ===== ОЛІЇ, СОУСИ, СПЕЦІЇ ===== */
  mkItem("oliveoil", "Monini Delicato — extra virgin", "spices", 500, "ml", { add: 40, op: 40, life: 200, staple: true }),
  mkItem(null, "MC — Extra Virgin with Truffle", "spices", 250, "ml", { add: 60 }),
  mkItem(null, "MC — Basil oil", "spices", 250, "ml", { add: 60 }),
  mkItem(null, "MC — Lemon oil", "spices", 250, "ml", { add: 60 }),
  mkItem(null, "Олейна — соняшникова", "spices", 1800, "ml", { add: 50, staple: true }),
  mkItem("balsamic", "Aceto Balsamico di Modena IGP", "spices", 250, "ml", { add: 60, op: 40, life: 300, staple: true }),
  mkItem("pesto", "Fratelli Mantova — песто генуезьке", "spices", 190, "g", { add: 30 }),
  mkItem(null, "Торчин — часниковий соус", "spices", 200, "g", { add: 40, op: 20, life: 60 }),
  mkItem(null, "Чумак — томатна паста", "spices", 380, "g", { add: 40 }),
  mkItem(null, "J'ELITE — манго-чилі ×2", "spices", 2, "pcs", { add: 30 }),
  mkItem(null, "Шрірача", "spices", 200, "ml", { add: 40, op: 25, life: 90 }),
  mkItem(null, "FL — орегано сушене", "spices", 10, "g", { add: 10, staple: true }),
  mkItem(null, "Мрія — коріандр мелений", "spices", 20, "g", { add: 10, staple: true }),
  mkItem("paprika", "MC — паприка солодка", "spices", 180, "g", { add: 10, staple: true }),
  mkItem(null, "Еко — перець з лимонним ароматом", "spices", 20, "g", { add: 10 }),
  mkItem("mustard", "Верес — гірчиця міцна", "spices", 190, "g", { add: 45, op: 25, life: 90 }),
  mkItem("mustard", "Kühne — гірчиця зерниста", "spices", 200, "g", { add: 25, op: 10, life: 90 }),
  mkItem(null, "Chef Club — яловичий фонд", "spices", 700, "ml", { add: 55, op: 30, life: 60 }),
  mkItem("herbs11", "Банка спецій — 11 овочів / herbs", "spices", 350, "g", { add: 30, staple: true }),
  mkItem("tomatoS", "Банка спецій — томат копчений", "spices", 120, "g", { add: 30 }),
  mkItem("onionC", "Банка спецій — цибуля карамелізована", "spices", 90, "g", { add: 30 }),
  mkItem("lemonD", "Банка спецій — лимон сушений", "spices", 100, "g", { add: 30 }),
  mkItem("bay", "Pripravka — лавровий лист", "spices", 20, "g", { add: 90, staple: true }),
  mkItem("garlicD", "Часник сушений", "spices", 60, "g", { add: 70, staple: true }),
  mkItem("pepper", "Чорний перець", "spices", 50, "g", { add: 80, staple: true }),
  mkItem("salt", "Сіль", "spices", 500, "g", { add: 80, staple: true }),
  mkItem(null, "Kotanyi — карамель-ваніль", "spices", 20, "g", { add: 60 }),

  /* ===== НАПОЇ ===== */
  mkItem(null, "Capeography — Шенін Блан", "drinks", 400, "ml", { add: 8, op: 3, life: 4, exp: 1 }),
  mkItem(null, "Hans Greyl — Совіньйон Блан б/а ×2", "drinks", 2, "pcs", { add: 10 }),
  mkItem("lemonJ", "Sandora — сік лимонний", "drinks", 950, "ml", { add: 10, op: 6, life: 30 }),
  mkItem(null, "Double Dutch — Double Lemon ×3", "drinks", 3, "pcs", { add: 30 }),
  mkItem(null, "Double Dutch — Skinny Tonic ×4", "drinks", 4, "pcs", { add: 30 }),
  mkItem(null, "Fever Tree — тонік огірковий ×2", "drinks", 2, "pcs", { add: 10 }),
  mkItem(null, "Sandora — нектар ананасовий ×4", "drinks", 4, "pcs", { add: 15 }),
  mkItem(null, "Borjomi 0,75 ×6", "drinks", 6, "pcs", { add: 25 }),
  mkItem(null, "Квас Тарас білий ×4", "drinks", 4, "pcs", { add: 15 }),
  mkItem(null, "Дріп-кава (2 коробки)", "drinks", 20, "pcs", { add: 35 }),
  mkItem(null, "Чаї Rioba ×3 + Карпатський + М'ятна свіжість", "drinks", 5, "pcs", { add: 35 }),
];

/* ---------- терміновість ---------- */
function urgency(it) {
  const life = it.openLife;
  if (it.expiresInDays != null && it.expiresInDays <= 1) return { level: 3, why: "сьогодні" };
  if (it.state === "opened" && life && it.openedDaysAgo >= life * 0.7)
    return { level: 3, why: `відкрито ${it.openedDaysAgo} д` };
  if (it.expiresInDays != null && it.expiresInDays <= 3) return { level: 2, why: `${it.expiresInDays} д` };
  if (it.state === "opened" && life && it.openedDaysAgo >= life * 0.4)
    return { level: 2, why: `відкрито ${it.openedDaysAgo} д` };
  if (!it.staple && it.addedDaysAgo >= 45) return { level: 1, why: `лежить ${it.addedDaysAgo} д` };
  return { level: 0, why: null };
}

/* ---------- рецепти ---------- */
const RECIPES = [
  {
    id: "r1",
    title: "Вершкова фетучіні з фуетом і шпинатом",
    nutrition: { kcal: 720, p: 28, f: 38, c: 62 },
    origin: "generated",
    base: 1,
    timeTotal: 20,
    character: "20 хв, одна пательня",
    desc: "Вершковий соус на витопленому жирі фуету, шпинат усередині, хрусткі шкварки зверху. Солоно-копчений акцент проти м'якої пасти.",
    risk: "Фует знімати, щойно краї стали хрусткими: він витоплюється швидко, і ще хвилина на вогні перетворює його на суху стружку. Жир з пательні не зливати — на ньому будується весь соус.",
    ings: [
      { ing: "fettuccine", v: 100, u: "g", role: "critical" },
      { ing: "fuet", v: 60, u: "g", role: "critical", note: "кружальцями ~5 мм" },
      { ing: "spinach", v: 1, u: "brick", role: "critical", note: "відтиснутий" },
      { ing: "cream", v: 45, u: "ml", role: "critical" },
      { ing: "parmesan", v: 20, u: "g", role: "important" },
      { ing: "garlicD", v: 0.5, u: "tsp", role: "important" },
      { ing: "oliveoil", v: 1, u: "tbsp", role: "optional" },
      { ing: "pepper", v: 0.25, u: "tsp", role: "optional" },
    ],
    steps: [
      { title: "Підготовка", content: "Вода на пасту, НЕ солити — фует дасть достатньо солі. Шпинат {2} відтиснути насухо.", timer: 300 },
      { title: "Фует до шкварок", content: "{1} на суху пательню, середній вогонь — витопити до хрустких країв. Жир ЛИШИТИ, він і є база соусу. Половину шкварок відкласти на подачу.", timer: 240 },
      { title: "Паста", content: "{0} у воду. Варити на хвилину менше, ніж пише пачка. Води не зливати всю — лишити пів склянки.", timer: 480 },
      { title: "Соус", content: "У жир від фуету: {5}, потім шпинат, прогріти. Влити {3}, дати загуснути хвилину. Зняти з вогню, вмішати {4}.", timer: 180 },
      { title: "Збірка", content: "Пасту в соус, довести водою від пасти до потрібної густини. {7}. Зверху — відкладені шкварки.", timer: null },
    ],
  },
  {
    id: "r2",
    title: "Букатіні alla puttanesca з мідіями",
    nutrition: { kcal: 610, p: 26, f: 21, c: 78 },
    origin: "saved",
    base: 2,
    timeTotal: 35,
    character: "35 хв, соус пробачає помилки",
    desc: "Солоний, гострий, насичений соус: анчоуси розчиняються в олії до умамі, каперси й оливки дають кислоту. Мідії в кінці, щоб лишились м'якими.",
    risk: "Анчоуси мають розчинитись в олії повністю, до однорідності — інакше в соусі лишаться солоні грудки. Це робиться на малому вогні й займає хвилин п'ять; поспіх тут видно в тарілці.",
    ings: [
      { ing: "bucatini", v: 200, u: "g", role: "critical" },
      { ing: "pelati", v: 200, u: "g", role: "critical" },
      { ing: "anchovy", v: 6, u: "pcs", role: "critical", note: "філе" },
      { ing: "olives", v: 60, u: "g", role: "important" },
      { ing: "capers", v: 2, u: "tbsp", role: "important" },
      { ing: "mussels", v: 200, u: "g", role: "important" },
      { ing: "garlicD", v: 1, u: "tsp", role: "important" },
      { ing: "oliveoil", v: 3, u: "tbsp", role: "critical" },
    ],
    steps: [
      { title: "База", content: "{7} на холодну пательню, {6}, зверху {2}. Малий вогонь — анчоуси мають розтанути в олії повністю, до однорідності.", timer: 300 },
      { title: "Томати", content: "Влити {1}, розім'яти. {3} і {4}. Тушкувати на середньому, поки соус не стане глянцевим.", timer: 720 },
      { title: "Паста", content: "{0} у солону воду. Мінус хвилина від пачки.", timer: 480 },
      { title: "Мідії", content: "{5} у соус на останні хвилини, під кришку. Щойно прогрілись — готово, довше вони гумові.", timer: 180 },
      { title: "Збірка", content: "Пасту в соус, вимішати з водою від пасти. Сиру тут не треба — це правило.", timer: null },
    ],
  },
  {
    id: "r3",
    title: "Сочевиця з копченим томатом і шпинатом",
    nutrition: { kcal: 430, p: 22, f: 14, c: 55 },
    origin: "saved",
    base: 2,
    timeTotal: 45,
    character: "45 хв, майже все саме",
    desc: "Густа, землиста, з копченою ноткою і кислим фінішем від бальзаміку. Ложка стоїть, їсти можна і теплим, і холодним наступного дня.",
    risk: "Не солити, поки сочевиця не стала м'якою. Сіль укріплює оболонку, і підсолена на початку крупа може варитись удвічі довше й лишитись твердою всередині.",
    ings: [
      { ing: "lentil", v: 200, u: "g", role: "critical" },
      { ing: "pelati", v: 200, u: "g", role: "critical" },
      { ing: "spinach", v: 1, u: "brick", role: "important" },
      { ing: "onionC", v: 1, u: "tbsp", role: "important" },
      { ing: "tomatoS", v: 0.5, u: "tsp", role: "important", note: "обережно, дим легко перебиває" },
      { ing: "garlicD", v: 1, u: "tsp", role: "important" },
      { ing: "oliveoil", v: 3, u: "tbsp", role: "critical" },
      { ing: "balsamic", v: 1, u: "tsp", role: "optional" },
      { ing: "salt", v: 0.5, u: "tsp", role: "critical" },
    ],
    steps: [
      { title: "База", content: "{6} розігріти, кинути {3} — вона вже жирна й солодка, дасть глибину. Потім {5}.", timer: 180 },
      { title: "Томати і дим", content: "{1} у пательню, розім'яти. {4} — половину чайної, не більше. Прогріти дві хвилини.", timer: 120 },
      { title: "Сочевиця", content: "{0} + окріп, щоб покривав на два пальці. НЕ солити. Малий вогонь під кришкою.", timer: 1500 },
      { title: "Фініш", content: "Коли сочевиця м'яка — {2}, прогріти. Тепер {8} і {7}. Балзамік у кінці підіймає все.", timer: 240 },
    ],
  },
  {
    id: "r4",
    title: "Лосось seared зі скоринкою + картопля",
    nutrition: { kcal: 590, p: 36, f: 29, c: 42 },
    origin: "generated",
    base: 1,
    timeTotal: 50,
    character: "година, є чому навчитись",
    desc: "Хрустка шкірка, всередині волога рожева серединка, під нею м'яка картопля з маслом і лимоном. Тарілка виглядає ресторанною при мінімумі складників.",
    risk: "Шкірка має бути сухою — волога випаровується замість того, щоб смажити, і скоринки не буде. Витерти рушником і лишити відкритою на десять хвилин. І знімати раніше, ніж здається готовим: риба доходить залишковим теплом.",
    ings: [
      { ing: "salmon", v: 1, u: "pcs", role: "critical" },
      { ing: "potato", v: 300, u: "g", role: "important" },
      { ing: "butter", v: 20, u: "g", role: "important" },
      { ing: "garlicD", v: 0.5, u: "tsp", role: "optional" },
      { ing: "lemonJ", v: 1, u: "tbsp", role: "important" },
      { ing: "oliveoil", v: 1, u: "tbsp", role: "critical" },
      { ing: "salt", v: 0.5, u: "tsp", role: "critical" },
    ],
    steps: [
      { title: "Риба насухо", content: "{0} витерти паперовим рушником з обох боків, особливо шкірку. Посолити шкірку і лишити відкритою — волога має вийти. Це головна умова скоринки.", timer: 600 },
      { title: "Картопля", content: "{1} на четвертинки, у підсолену воду, варити до м'якості. Злити, дати пару вийти.", timer: 900 },
      { title: "Пательня", content: "Суха пательня на сильний вогонь, потім {5}. Чекати серпанку — риба на холодну не кладеться.", timer: 180 },
      { title: "Скоринка", content: "Філе шкіркою вниз, притиснути лопаткою на 20 секунд, щоб не вигнулось. Не чіпати. Край має побіліти на дві третини.", timer: 210 },
      { title: "Перевернути", content: "Перевернути, вимкнути вогонь, {2} і {3} у пательню, полити рибу ложкою. Залишковим теплом дійде. {4} на подачі.", timer: 90 },
    ],
  },
  {
    id: "r5",
    title: "Салат з прошуто, пармезаном і каперсами",
    nutrition: { kcal: 380, p: 19, f: 30, c: 8 },
    origin: "saved",
    base: 1,
    timeTotal: 7,
    character: "7 хвилин, нуль готування",
    desc: "Свіже листя, солоне прошуто, гострий пармезан і кислі каперси. Все тримається на контрасті хрусткого й жирного, їсти одразу.",
    risk: "Заправку вливати перед самою подачею. Олія з кислотою за кілька хвилин витягують воду з листя, і бебі мікс осідає в мокру купку.",
    ings: [
      { ing: "babymix", v: 60, u: "g", role: "critical" },
      { ing: "prosciutto", v: 40, u: "g", role: "critical" },
      { ing: "parmesan", v: 20, u: "g", role: "important" },
      { ing: "tomatoY", v: 1, u: "pcs", role: "important" },
      { ing: "capers", v: 1, u: "tbsp", role: "optional" },
      { ing: "oliveoil", v: 2, u: "tbsp", role: "critical" },
      { ing: "balsamic", v: 1, u: "tsp", role: "important" },
      { ing: "mustard", v: 0.25, u: "tsp", role: "optional" },
    ],
    steps: [
      { title: "Заправка", content: "{5} + {6} + {7} збовтати виделкою до однорідності.", timer: 60 },
      { title: "База", content: "{0} у миску, {3} скибками, {4}. {1} рвати руками, не різати — краї мають бути нерівні.", timer: 120 },
      { title: "Збірка", content: "Полити заправкою, перемішати руками двома рухами. {2} стружкою зверху в останню чергу.", timer: null },
    ],
  },
  {
    id: "r6",
    title: "Брускети з камбоцолою і яблуком",
    nutrition: { kcal: 340, p: 12, f: 18, c: 34 },
    origin: "saved",
    base: 1,
    timeTotal: 5,
    character: "5 хвилин",
    desc: "Гострувато-вершкова камбоцола на хрусткій основі, зверху кисле яблуко і крапля меду. Класичне поєднання солоного, солодкого й різкого.",
    risk: "Камбоцола має бути кімнатної температури — з холодильника вона кришиться замість того, щоб мазатись, і рве основу.",
    ings: [
      { ing: "bruschette", v: 6, u: "pcs", role: "critical" },
      { ing: "cambozola", v: 60, u: "g", role: "critical" },
      { ing: "apple", v: 0.5, u: "pcs", role: "important" },
      { ing: "honey", v: 1, u: "tsp", role: "optional" },
      { ing: "balsamic", v: 0.5, u: "tsp", role: "optional" },
    ],
    steps: [
      { title: "Збірка", content: "{1} розмазати по {0} — сир має бути кімнатний, з холодильника він кришиться. {2} тонкими скибками зверху.", timer: 120 },
      { title: "Фініш", content: "Крапля {3} або {4} на кожну. Не обидва разом — переб'ють сир.", timer: null },
    ],
  },
];

/* Модель ставить у кроки або індекс інгредієнта {0}, або id партії {p3}.
   Підтримуємо обидва, а невідоме прибираємо, щоб у тексті не лишалось сміття. */
function renderStep(content, recipe, servings) {
  return String(content || "")
    .replace(/\{(p?\d+)\}/gi, (_, token) => {
      const t = String(token).toLowerCase();
      let ri = null;
      if (t.startsWith("p")) {
        ri = (recipe.ings || []).find((x) => x.pantryId === t);
        if (!ri) ri = (recipe.ings || []).find((x) => String(x.pantryId).toLowerCase() === t);
      } else {
        ri = (recipe.ings || [])[Number(t)];
      }
      if (!ri) return "";
      const v = scale(ri.v, ri.u, servings, recipe.base);
      return `${fmtQ(v, ri.u)} ${ingName(ri)}`;
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .trim();
}

/* Ідентифікатори — внутрішні. У тексті, який читає людина, їх бути не повинно. */
function stripIds(text, pantry) {
  const raw = String(text || "");
  // назва зазвичай уже стоїть поруч («каперси p10»), тому id просто прибираємо
  const cleaned = raw
    .replace(/\s*\bp\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .trim();
  // але якщо id ніс увесь сенс («додай p10»), фраза розсиплеться — тоді підставляємо назву
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 3 || !/\bp\d+\b/i.test(raw)) return cleaned;
  return raw
    .replace(/\bp(\d+)\b/gi, (m, n) => {
      const hit = (pantry || []).find((x) => x.id === `p${n}`);
      return hit ? compactLabel(hit.label) : "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* Швидкий ввід без моделі: «+ молоко 1 л», «+ фарш 500 г, вершки».
   Той самий контракт IntakeDiff, але нуль викликів — працює й офлайн. */
function parseQuickAdd(text) {
  const raw = String(text || "").replace(/^\s*\+\s*/, "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(
        /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л|шт|пач|уп|зуб|банк|скл)?\.?$/i
      );
      let label = chunk;
      let value = null;
      let unit = "pcs";
      if (m) {
        label = m[1].trim();
        value = parseFloat(String(m[2]).replace(",", "."));
        const u = (m[3] || "").toLowerCase();
        if (u === "кг") {
          value *= 1000;
          unit = "g";
        } else if (u === "г") unit = "g";
        else if (u === "л") {
          value *= 1000;
          unit = "ml";
        } else if (u === "мл") unit = "ml";
        else if (u === "зуб") unit = "clove";
        else if (u === "пач" || u === "уп") unit = "pack";
        else if (u === "банк") unit = "can";
        else unit = "pcs";
      }
      return {
        op: "add",
        label,
        value,
        unit,
        zone: guessZone(label),
        confidence: 1,
        evidence: "user_statement",
      };
    });
}

/* ---------- м'який резолвер: рецепт може посилатись на каталог або просто на назву ---------- */
function ingName(ri) {
  return ri.snapshot || ri.name || (CAT[ri.ing] && CAT[ri.ing].name) || ri.ing || "";
}

/* Три джерела інгредієнта, три різні способи зіставлення:
   pantry   — пряме посилання на партію, перевірка на належність, без здогадок
   catalog  — канонічний ключ (базові рецепти), точний збіг за ключем
   external — назва з кулінарного світу; сюди й лише сюди йде евристика */
function resolveIng(ri, pantryAll) {
  const pantry = (pantryAll || []).filter((p) => p.state !== "depleted");
  if (ri.src === "pantry" && ri.pantryId) {
    const exact = pantry.find((p) => p.id === ri.pantryId);
    if (exact) return exact;
    // партію вже спожито або списано — далі пробуємо ключ і назву
  }
  if (ri.ing) {
    // партія не закріплена — беремо ту, що найшвидше псується
    const byKey = pantry
      .filter((p) => p.key === ri.ing)
      .sort((a, b) => urgency(b).level - urgency(a).level)[0];
    if (byKey) return byKey;
  }
  if (ri.src === "pantry" && !ri.ing) return null;
  return findPantry(ri, pantry);
}
/* службові слова і бренди, які не несуть сенсу продукту */
const NOISE = new Set([
  "metro", "chef", "kaserei", "barilla", "welldar", "aromiks", "fine", "life", "golden", "calf",
  "street", "soup", "double", "dutch", "fever", "tree", "sandora", "honey", "way", "doctor",
  "benner", "rioba", "helios", "zuegg", "karolina", "yapiko", "jager", "kuhne", "veres", "cumak",
  "hlobino", "pripravka", "monini", "olena", "svirianka", "sakla", "rizzoli", "serpis", "iruela",
  "banka", "specii", "abo", "ta", "cvert", "zalisok", "pockate", "opcinno",
]);

/* слабкі слова: родові назви й ознаки. Самі по собі нічого не визначають:
   «кокосове молоко» ≠ «згущене молоко», «рибний соус» ≠ «часниковий соус».
   Пишемо основи українською і проганяємо через ту саму нормалізацію, що й назви. */
const WEAK_STEMS = [
  "молок", "соус", "паст", "олі", "крем", "суп", "бульйон", "сік", "чай", "вод",
  "свіж", "сух", "біл", "зелен", "червон", "жовт", "копчен", "морожен", "заморож",
  "консерв", "маринов", "порційн", "мелен", "солон", "куряч", "овочев", "ялович",
  "сиров", "терт", "готов", "натурал", "класичн", "смажен", "варен", "печен",
];

let _weakFolded = null;
function isWeak(t) {
  if (!_weakFolded) _weakFolded = WEAK_STEMS.map((w) => fold(w));
  return _weakFolded.some((st) => st && t.startsWith(st));
}

function tokens(str) {
  return fold(str)
    .split(" ")
    .map((t) => t.replace(/[0-9%]/g, ""))
    .filter((t) => t.length >= 3 && !NOISE.has(t));
}

/* збіг двох слів: спільний префікс від 4 літер або одна одруківка на довгих */
function wordMatch(a, b) {
  if (a === b) return a.length;
  const min = Math.min(a.length, b.length);
  if (min >= 4 && (a.startsWith(b) || b.startsWith(a))) return min;
  if (min >= 6 && editDist(a, b, 1) <= 1) return min - 1;
  return 0;
}

function findPantry(ri, pantry) {
  if (ri.ing) {
    const byKey = pantry.find((p) => p.key === ri.ing);
    if (byKey) return byKey;
  }
  const want = tokens(ingName(ri));
  if (!want.length) return null;

  let best = null;
  let bestScore = 0;
  pantry.forEach((p) => {
    const has = tokens(p.label);
    let score = 0;
    let hits = 0;
    let strongHit = null;
    want.forEach((w) => {
      let local = 0;
      has.forEach((h) => {
        const m = wordMatch(w, h);
        if (m > local) local = m;
      });
      if (local > 0) {
        hits++;
        score += isWeak(w) ? 1 : local;
        if (!isWeak(w) && (!strongHit || w.length > strongHit.length)) strongHit = w;
      }
    });

    // один збіг зараховуємо лише якщо слово сильне і достатньо характерне
    if (hits === 1 && !strongHit) return;
    if (hits === 1 && strongHit && strongHit.length < 5) {
      const exact = has.some((h) => h === strongHit);
      if (!exact) return;
    }
    if (!hits) return;

    const finalScore = score + hits * 2 - has.length * 0.5;
    if (finalScore > bestScore) {
      bestScore = finalScore;
      best = p;
    }
  });
  return best;
}

/* ---------- matching ---------- */
function matchRecipe(recipe, pantry, servings) {
  const missing = [], rescues = [];
  let ready = true;
  recipe.ings.forEach((ri) => {
    const have = resolveIng(ri, pantry);
    if (!have) {
      missing.push(ri);
      if (ri.role === "critical") ready = false;
    } else {
      const u = urgency(have);
      if (u.level >= 2) rescues.push(have);
    }
  });
  const status = ready ? (missing.length === 0 ? "ready" : "near") : "far";
  return { status, missing, rescues };
}

/* комора з ідентифікаторами — модель показує пальцем, а не називає */
const DORMANT_DAYS = 60;   // після цього продукт іде в промпт згорнутим
const DEPLETED_KEEP_DAYS = 7; // скільки закінчене лежить у кошику, перш ніж зникнути

function pantryRef(pantry) {
  const live = pantry.filter((p) => p.state !== "depleted");
  const base = live.filter((p) => p.staple);
  const dormant = live.filter((p) => !p.staple && p.addedDaysAgo >= DORMANT_DAYS && urgency(p).level < 2);
  const rest = live.filter((p) => !base.includes(p) && !dormant.includes(p));
  const lines = rest.map((p) => {
    const u = urgency(p);
    const m = [ZONE_CODE[p.zone] || "d", fmtQ(p.value, p.unit).replace(/\s/g, "")];
    if (p.state === "opened") m.push("вдкр");
    if (u.level >= 2) m.push("~" + String(u.why).replace(/\s/g, ""));
    return `${p.id} ${compactLabel(p.label)} ${m.join(" ")}`;
  });
  if (dormant.length)
    lines.push(
      `лежить давно, деталі за потреби: ${dormant
        .map((p) => `${p.id} ${compactLabel(p.label)}`)
        .join(", ")}`
    );
  if (base.length)
    lines.push(
      `базове — є завжди, id за потреби: ${base.map((p) => `${p.id} ${compactLabel(p.label)}`).join(", ")}`
    );
  return `формат: id назва зона кількість [вдкр] [~скільки лишилось] · зони: d комора, f холодильник, z морозилка, s свіже, p спеції, n напої\n${lines.join(
    "\n"
  )}`;
}

function pantryDigest(pantry) {
  const byZone = {};
  pantry.filter((p) => p.state !== "depleted").forEach((p) => {
    const u = urgency(p);
    const mark = u.level >= 2 ? `(!${u.why})` : p.state === "opened" ? "(відкр.)" : "";
    (byZone[p.zone] = byZone[p.zone] || []).push(`${p.label}${mark}`);
  });
  return Object.entries(byZone)
    .map(([z, arr]) => `${ZONES[z]}: ${arr.join(", ")}`)
    .join("\n");
}


/* ============================================================
   ПОШУК ПО КОМОРІ — каскад із ранньою зупинкою
   fold → префікс → входження → семантична група → розкладка
   → нечіткий збіг → (за запитом) модель
   ============================================================ */

/* фонетичний скелет: кирилиця і латиниця зводяться до спільного вигляду */
const FOLD = {
  а:"a", б:"b", в:"v", г:"h", ґ:"g", д:"d", е:"e", є:"e", ж:"z", з:"z",
  и:"i", і:"i", ї:"i", й:"i", к:"k", л:"l", м:"m", н:"n", о:"o", п:"p",
  р:"r", с:"s", т:"t", у:"u", ф:"f", х:"h", ц:"k", ч:"c", ш:"s", щ:"s",
  ь:"", ю:"u", я:"a", "'":"", "’":"", ы:"i", э:"e", ъ:"",
  c:"k", q:"k", x:"k", y:"i", w:"v", g:"h",
};
function fold(str) {
  const out = [];
  for (const ch of String(str || "").toLowerCase()) {
    const m = FOLD[ch] !== undefined ? FOLD[ch] : /[a-z0-9]/.test(ch) ? ch : " ";
    if (m === " ") {
      if (out[out.length - 1] !== " ") out.push(" ");
    } else if (m && out[out.length - 1] !== m) {
      out.push(m);
    } else if (m && out[out.length - 1] === m) {
      /* подвоєння прибираємо: cannellini → kaneli */
    }
  }
  return out.join("").trim();
}

/* забув перемкнути розкладку */
const KB_LAT = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const KB_CYR = "йцукенгшщзхїфівапролджєячсмитьбю.";
function relayout(str) {
  return String(str || "")
    .toLowerCase()
    .split("")
    .map((ch) => {
      const i = KB_LAT.indexOf(ch);
      return i >= 0 ? KB_CYR[i] : ch;
    })
    .join("");
}

/* груба морфологія: відкидаємо українські закінчення */
function stem(w) {
  return String(w || "").replace(/(ами|ями|ові|ого|ому|ах|ях|ів|ам|ям|ою|ею|и|і|ї|а|я|у|ю|е|о)$/u, "");
}

/* відстань редагування з ранньою відсічкою */
function editDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let best = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      if (prev[j] < best) best = prev[j];
    }
    if (best > max) return max + 1;
  }
  return prev[b.length];
}

/* семантичні групи — те, чого не дає жоден алгоритм, дає розмітка */
const GROUPS = [
  { name: "хлібне", q: ["хліб", "булк", "випічк", "bread", "тост"], pat: ["чіабат", "boston", "брускет", "сухар", "maretti", "buns"] },
  { name: "сири", q: ["сир", "cheese"], pat: ["камбоцол", "cambozola", "kaserei", "моцарел", "парміджано", "пармезан", "гауда 48", "брі", "камамбер", "jager"] },
  { name: "молочне", q: ["молочн", "dairy"], pat: ["молок", "вершк", "йогурт", "айран", "масло вершк", "згущ", "яйц"] },
  { name: "риба і море", q: ["риб", "море", "морепродукт", "fish", "seafood"], pat: ["креветк", "мідій", "тунц", "тунець", "лосось", "анчоус", "окун", "оселедец", "морський коктейль", "kavli"] },
  { name: "м'ясне", q: ["м'ясо", "мясо", "meat", "ковбас"], pat: ["салямі", "фует", "прошут", "тушкован", "котлет", "нагетс", "сало", "ryabchick"] },
  { name: "паста і локшина", q: ["паста", "макарон", "локшин", "pasta", "noodle"], pat: ["спагет", "букатін", "фарфал", "фетучін", "рісоні", "udon", "jml", "yopokki", "barilla"] },
  { name: "крупи і бобові", q: ["круп", "боб", "каш", "зернов"], pat: ["сочевиц", "квасол", "перлов", "маш", "вівсян", "гранол", "мюслі", "рис"] },
  { name: "овочі", q: ["овоч", "зелен", "салат", "veg"], pat: ["картопл", "цибул", "часник", "томат", "помідор", "горошок", "кукурудз", "огірк", "mexico", "шпинат", "авокадо", "бебі мікс"] },
  { name: "фрукти", q: ["фрукт", "цитрус", "fruit"], pat: ["яблук", "апельсин", "грейпфрут", "лимон"] },
  { name: "спеції", q: ["специ", "спеці", "припра", "spice"], pat: ["перець", "сіль", "паприк", "орегано", "коріандр", "лавров", "часник сушен", "herbs", "11 овоч", "томат копчен", "kotanyi"] },
  { name: "олії та оцти", q: ["олі", "масло", "оцет", "oil"], pat: ["monini", "олейна", "бальзам", "truffle", "basil oil", "lemon oil", "extra virgin"] },
  { name: "соуси", q: ["соус", "sauce"], pat: ["песто", "гірчиц", "шрірача", "томатна паст", "манго-чилі", "торчин", "j'elite"] },
  { name: "гостре", q: ["гостр", "чилі", "spicy"], pat: ["шрірача", "чилі", "паприк", "срірач"] },
  { name: "солодке", q: ["солодк", "десерт", "sweet"], pat: ["цукор", "мед", "джем", "шоколад", "желе", "згущ", "гранол", "кульки з какао", "мюслі"] },
  { name: "напої", q: ["напо", "пити", "drink"], pat: ["borjomi", "квас", "сік", "нектар", "тонік", "блан", "кава", "чай", "айран", "double dutch", "fever"] },
  { name: "консерви", q: ["консерв", "банк", "can"], pat: ["pelati", "оливк", "каламата", "каперс", "анчоус", "кукурудз", "горошок", "тунець", "тушкован", "sacla", "welldar"] },
  { name: "алкоголь", q: ["вино", "алкогол", "wine"], pat: ["блан", "capeography", "hans greyl"] },
];

const ZONE_WORDS = {
  fridge: ["холодильник", "фрідж"],
  freezer: ["морозилк", "заморозк", "морожен"],
  dry: ["комор", "сух", "шаф"],
  fresh: ["свіж", "овоч"],
  spices: ["спец", "олі", "соус"],
  drinks: ["напо"],
};

function searchPantry(rawQuery, pantry) {
  const q0 = String(rawQuery || "").trim().toLowerCase();
  if (!q0) return { items: pantry, via: null };

  /* 0. терміновість як запит */
  if (/псу|термін|вибува|горить|викин|пропада/.test(q0))
    return { items: pantry.filter((p) => urgency(p).level >= 2), via: "те, що на вибуванні" };
  if (/відкрит|початк/.test(q0))
    return { items: pantry.filter((p) => p.state === "opened"), via: "відкриті упаковки" };
  if (/забут|лежить|давно/.test(q0))
    return { items: pantry.filter((p) => urgency(p).level === 1), via: "давно лежить" };

  /* 0b. зона */
  for (const [z, words] of Object.entries(ZONE_WORDS)) {
    if (words.some((w) => q0.includes(w))) {
      const hit = pantry.filter((p) => p.zone === z);
      if (hit.length) return { items: hit, via: `зона: ${ZONES[z]}` };
    }
  }

  const variants = [q0, relayout(q0)].filter((v, i, a) => a.indexOf(v) === i);

  /* 1-2. префікс і входження */
  let literal = [];
  let viaLayout = false;
  for (const v of variants) {
    const fv = fold(v);
    if (!fv) continue;
    const scored = [];
    pantry.forEach((p) => {
      const fl = fold(p.label);
      if (!fl.includes(fv)) return;
      const pref = fl.split(" ").some((w) => w.startsWith(fv));
      scored.push({ p, rank: pref ? 0 : 1 });
    });
    if (scored.length) {
      literal = scored.sort((a, b) => a.rank - b.rank).map((x) => x.p);
      viaLayout = v !== q0;
      break;
    }
  }

  /* 3. семантична група — не витісняється буквальним збігом, а доповнює його */
  const stemmed = stem(q0);
  let group = null;
  for (const g of GROUPS) {
    const asked = g.q.some((w) => q0.startsWith(w) || (stemmed.length >= 2 && w.startsWith(stemmed)));
    if (!asked) continue;
    const hit = pantry.filter((p) => {
      const l = p.label.toLowerCase();
      return g.pat.some((w) => l.includes(w));
    });
    if (hit.length) {
      group = { name: g.name, hit };
      break;
    }
  }

  if (literal.length && group) {
    const seen = new Set(literal.map((p) => p.id));
    const merged = literal.concat(group.hit.filter((p) => !seen.has(p.id)));
    return { items: merged, via: `категорія: ${group.name}` };
  }
  if (literal.length) return { items: literal, via: viaLayout ? "виправив розкладку" : null };
  if (group) return { items: group.hit, via: `категорія: ${group.name}` };

  /* 4. нечіткий збіг — на помилки набору */
  const fq = fold(q0);
  if (fq.length < 4) return { items: [], via: null };
  const max = fq.length <= 5 ? 1 : fq.length <= 8 ? 2 : 3;
  const fuzzy = [];
  pantry.forEach((p) => {
    const words = fold(p.label).split(" ").filter(Boolean);
    let best = 99;
    words.forEach((w) => {
      const d = editDist(fq, w.slice(0, Math.max(fq.length, 3)), max);
      if (d < best) best = d;
    });
    if (best <= max) fuzzy.push({ p, d: best });
  });
  if (fuzzy.length)
    return { items: fuzzy.sort((a, b) => a.d - b.d).map((x) => x.p), via: "приблизний збіг" };

  return { items: [], via: null };
}

/* Збережений рецепт живе довше за партію продукту, тому при збереженні
   посилання на конкретні партії замінюються на канонічний ключ і назву. */
function freezeRecipe(recipe) {
  return {
    ...recipe,
    id: `sav${Date.now()}${Math.floor(Math.random() * 1000)}`,
    origin: "saved",
    savedAt: Date.now(),
    ings: recipe.ings.map((ri) => {
      if (ri.src !== "pantry") return ri;
      const { pantryId, snapshot, ...rest } = ri;
      return { ...rest, src: ri.ing ? "catalog" : "external", name: snapshot || ri.name };
    }),
  };
}

/* «Майже можу»: чим замінити те, чого бракує, з того, що лежить на тій самій полиці */
function groupOf(label) {
  const l = String(label || "").toLowerCase();
  const g = GROUPS.find((gr) => gr.pat.some((w) => l.includes(w)));
  return g ? g.name : null;
}
function suggestAlt(ri, pantry, usedIds) {
  const g = groupOf(ingName(ri));
  if (!g) return [];
  return pantry
    .filter((p) => !usedIds.has(p.id) && groupOf(p.label) === g)
    .slice(0, 2);
}

/* ============================================================
   ПРОФІЛІ МОДЕЛЕЙ
   Виклики різні за складністю, тому й моделі мають бути різні.
   Пісочниця артефактів дозволяє лише одну модель — тому тут
   профіль резолвиться в неї, а намір фіксується окремо й іде в лог.
   ============================================================ */
const ARTIFACT_RUNTIME = true;
const SANDBOX_MODEL = "claude-sonnet-4-6";

const MODEL_PROFILES = {
  // механічна робота: класифікація, парсинг, добір кроків, пошук
  fast: { intended: "claude-haiku-4-5", maxOut: 1000 },
  // судження: пропозиції вечері, повний рецепт, розбір чужого тексту
  smart: { intended: "claude-sonnet-5", maxOut: 1000 },
};

const callStats = { byProfile: {} };

function modelFor(profileId) {
  const p = MODEL_PROFILES[profileId] || MODEL_PROFILES.smart;
  const sent = ARTIFACT_RUNTIME ? SANDBOX_MODEL : p.intended;
  const st = callStats.byProfile[profileId] || { calls: 0, intended: p.intended, sent };
  st.calls++;
  callStats.byProfile[profileId] = st;
  return { model: sent, max_tokens: p.maxOut };
}

/* Комора для промпту ≠ комора для інтерфейсу.
   Бренд потрібен людині, а не моделі: вона готує не з «Metro Chef», а з пелаті.
   Назву для показу прототип бере з комори за id, тож тут її можна різати. */
function compactLabel(label) {
  return String(label || "")
    .replace(/^[^—]{1,24}— /, "")
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*×\d+/g, "")
    .trim();
}

const ZONE_CODE = { dry: "d", fridge: "f", freezer: "z", fresh: "s", spices: "p", drinks: "n" };

/* Інвентар тримаємо за винятками. Базове є у всіх — перелічувати його в промпті
   означає платити токенами за нуль інформації. Значення має тільки нетипове й відсутнє. */
const EQUIP_BASE = ["пательня", "каструля", "сотейник", "духовка", "плита", "ніж", "дошка", "друшляк", "миска", "терка"];
const EQUIP_EXTRA = [
  "блендер", "занурювальний блендер", "міксер", "кухонний комбайн", "кухонні ваги", "термометр",
  "чавунна пательня", "вок", "казан", "гриль", "мангал", "аерогриль", "фритюрниця", "мультиварка",
  "пароварка", "су-від", "фондюшниця", "м'ясорубка", "мандоліна", "хлібопічка", "мікрохвильовка",
];

/* ============================================================
   ЗНАЙОМСТВО
   Не анкета. Анкету на десять питань закривають, не дійшовши до
   середини, а відповіді в ній однаково неточні. Тому перший крок —
   дія, яка одразу дає користь: наповнити комору. Решта питань
   виникає з приводу, а не заздалегідь.
   ============================================================ */
const ONBOARDING = {
  1: `ЗНАЙОМСТВО, ЕТАП 1: КОМОРА. Ти нічого не знаєш про цю людину, крім імені, і на кухні порожньо.

Твоє єдине завдання зараз — щоб у коморі зʼявилось хоч щось. Прохання вже прозвучало.

- НЕ став питань про алергії, дім, традиції, обладнання чи смаки. Питання до порожньої кухні не мають сенсу, а анкету на вході закривають
- НЕ пропонуй готувати. Ще нема з чого
- Прийшов чек, фото чи перелік — розбери й поверни card = intake_diff. У reply одне-два речення: що бачиш, без переліку
- Якщо в чеку видно контекст (пікнік, гості, дитяче) — назви його одним реченням, це показує, що ти дивишся уважно
- Якщо людина натомість розповідає про себе — запиши (card = profile) і поверни до комори`,

  2: `ЗНАЙОМСТВО, ЕТАП 2: ЛЮДИНА. Комора наповнена, питання вже поставлене: обмеження, дім, календар.

- Записуй усе почуте: алергії, дієта, нелюбе → card = profile. «Дружина веганка» → kind "member". «Постуємо», «щопʼятниці риба» → kind "tradition" або "date"
- «Нічого немає», «сам, без обмежень» → нічого не записуй і більше не питай
- АЛЕРГІЯ — виняток: спитай, де проходить межа, перш ніж записувати
- Після запису ОДРАЗУ переходь до страви: 2-3 варіанти з того, що в коморі. Це момент, заради якого людина лишиться
- Якщо з комори готувати нічого (самі напої, побутове, закупка на пікнік) — скажи прямо й запропонуй докупити мінімум під одну страву`,
};

/* ============================================================
   ДІМ І УЧАСНИКИ
   Шериться не акаунт, а окремі сутності. Спільне за природою —
   комора, обладнання, список, календар. Особисте — обмеження,
   досвід, журнал, розмови. Асистент за замовчуванням готує для
   власника; чужі обмеження підключаються, лише коли їх назвали.
   ============================================================ */
const DEMO_HOUSEHOLD = [
  { id: "me", name: "Пилип", owner: true },
  {
    id: "ok",
    name: "Оксана",
    owner: false,
    allergies: [],
    wishes: ["веганство", "люблю печені овочі, нут і тахіні"],
    antipatterns: ["не їм мʼяса, риби, яєць і молочного", "не люблю гриби"],
    diet: "веганство",
  },
];

const freshHousehold = (name) => [{ id: "me", name: name || "Я", owner: true }];

/* Кого годуємо саме зараз. Порожньо = тільки власник. */
function audienceProfiles(audience, profile, household) {
  const out = [{ id: "me", name: "ти", profile }];
  (audience || []).forEach((id) => {
    const m = (household || []).find((h) => h.id === id && !h.owner);
    if (m) out.push({ id, name: m.name, profile: m });
  });
  return out;
}

/* Об'єднання обмежень: алергени й дієти складаються, симпатії перетинаються. */
function audienceBlock(audience, profile, household) {
  if (!audience || !audience.length) return "";
  const people = audienceProfiles(audience, profile, household);
  if (people.length < 2) return "";
  const lines = people.map((p) => {
    const bits = [];
    if ((p.profile.allergies || []).length) bits.push(`алергія: ${p.profile.allergies.join(", ")}`);
    if ((p.profile.wishes || []).length) bits.push(p.profile.wishes.join("; "));
    if ((p.profile.antipatterns || []).length) bits.push(p.profile.antipatterns.join("; "));
    return `· ${p.name} — ${bits.length ? bits.join("; ") : "без обмежень"}`;
  });
  return `\n\nГОТУЄМО НЕ ЛИШЕ ДЛЯ ВЛАСНИКА. Сьогодні за столом:\n${lines.join("\n")}

Правила на цей випадок:
- дієта когось із присутніх — жорстке обмеження: страва або підходить усім, або має версію для кожного
- алерген присутнього познач із іменем того, кого він стосується
- нелюбе просто обходь
- якщо перетин обмежень майже порожній, НЕ кажи «варіантів немає». Запропонуй модульну страву: спільна база, різні доповнення — одна каструля сочевиці, комусь із фетою, комусь без. Так реально готують у домах зі змішаними обмеженнями`;
}

/* Демо-профіль: зібраний із того, що видно в чатах, плюс явно названі обмеження.
   Алергени виписані конкретними назвами, бо збіг іде за назвою — родове слово
   «морепродукти» не зловило б «Karolina — м'ясо мідій». Риба сюди не входить. */
const EMPTY_PROFILE = { allergies: [], wishes: [], antipatterns: [], equip: {} };

const DEMO_PROFILE = {
  name: "Пилип",
  allergies: ["морепродукти", "мідії", "креветки", "молюски", "морський коктейль", "кальмар", "устриці", "гребінці", "краб"],
  wishes: [
    "постуємо, свята православні",
    "щопʼятниці намагаємось робити рибу",
    "у серпні тесть привозить домашні помідори",
    "люблю свіжі томати, салати й зелень",
    "люблю блакитні сири й солоно-умамі — анчоуси, каперси, оливки",
    "ціную контраст текстур у страві",
  ],
  antipatterns: ["не люблю кінзу"],
  equip: { "гриль": "has" },
};

/* Обмеження мають три різні природи, і плутати їх дорого:
   allergy — медичне, позначається завжди й скрізь
   exclude — принципова відмова (релігія, етика, здоровʼя): не пропонується ніколи,
             на прямий запит попереджається, але не блокується
   avoid   — смак: обходиться мовчки, порушується без питань */
const DIET_PRESETS = [
  "вегетаріанство",
  "веганство",
  "халяль",
  "кошер",
  "без глютену",
  "без лактози",
  "пескетаріанство",
  "без червоного мʼяса",
  "кето",
  "низький FODMAP",
];

const CALENDARS = [
  { id: "orthodox", label: "православний" },
  { id: "catholic", label: "католицький" },
  { id: "other", label: "інший" },
  { id: "none", label: "без свят" },
];

/* Блок обмежень має абсолютний пріоритет, тому йде окремо і першим. */
/* Профіль — три блоки, кожен працює по-різному:
   allergies    — конкретні назви, бо їх шукає збіг по коморі
   wishes       — куди тягнути: традиції, свята, наміри, смаки. Вільний текст
   antipatterns — від чого відштовхуватись. Сила читається з формулювання */
function profileBlock(profileArg) {
  const profile = profileArg || {};
  const who = profile.name ? `Тебе звати ${profile.name}. ` : "";
  const equip = profile.equip || {};
  const parts = [];
  const hasExtra = Object.keys(equip).filter((k) => equip[k] === "has");
  const lacks = Object.keys(equip).filter((k) => equip[k] === "lacks");

  if ((profile.allergies || []).length)
    parts.push(
      `АЛЕРГЕНИ: ${profile.allergies.join(", ")}. Не пропонуй їх сам. Але людина готує не лише собі — якщо просить прямо або готує для когось іншого, страву дай і назви алерген вголос. Ніколи не приховуй і не підмішуй тихо.`
    );
  if ((profile.wishes || []).length)
    parts.push(
      `ПОБАЖАННЯ — куди тягнути. Традиції, свята, наміри, смаки; написано самою людиною, тлумач вільно й звіряй із сьогоднішньою датою:\n${profile.wishes
        .map((w) => `· ${w}`)
        .join("\n")}`
    );
  if ((profile.antipatterns || []).length)
    parts.push(
      `АНТИПАТЕРНИ — від чого відштовхуватись:\n${profile.antipatterns.map((a) => `· ${a}`).join("\n")}\nСилу читай із формулювання. «Не їм свинину» — принципова відмова: не пропонуй ніколи й не став як заміну, на прямий запит дай, але назви це вголос. «Не люблю кінзу» — смак: обходь мовчки, на запит дай без заперечень.`
    );
  if (hasExtra.length) parts.push(`Є нетипове обладнання: ${hasExtra.join(", ")}`);
  if (lacks.length) parts.push(`НЕМАЄ обладнання: ${lacks.join(", ")}`);

  if (!parts.length && !who) return "";
  return `\n\nПРО ЦЮ КУХНЮ І ЦЮ ЛЮДИНУ:\n${who}${parts.join("\n")}`;
}


/* Позначка, не фільтр: показуємо все, але помічене лишається поміченим. */
function flagIngredient(ri, profile, audience, household) {
  const name = fold(ingName(ri));
  const hit = (list) =>
    (list || []).find((x) => {
      const f = fold(x);
      if (f.length < 3) return false;
      return name.includes(f) || f.includes(name);
    });

  /* Власник — завжди. Інші — лише коли їх назвали адресатами. */
  const people = [{ name: null, p: profile || {} }];
  (audience || []).forEach((id) => {
    const m = (household || []).find((h) => h.id === id && !h.owner);
    if (m) people.push({ name: m.name, p: m });
  });

  for (const person of people) {
    const allergen = hit(person.p.allergies);
    if (allergen) return { kind: "allergen", label: allergen, who: person.name };
  }
  for (const person of people) {
    /* Антипатерни — фрази, не назви. Ловимо продукт усередині фрази,
       а силу визначаємо з формулювання: «не їм» жорсткіше за «не люблю». */
    for (const line of person.p.antipatterns || []) {
      const f = fold(line);
      const STOP = /^(ne|im|piu|ne im|pohidn|lubl|nelubl|dize|prinsipovo|ta|abo|i)$/;
      const words = f.split(" ").filter((w) => w.length >= 4 && !STOP.test(w) && !isWeak(w));
      /* Українські закінчення: «кінзу» має знайти «кінза». Порівнюємо корені —
         спільний префікс без останніх двох літер, але не коротший за чотири. */
      const stem = (w) => w.slice(0, Math.max(4, w.length - 2));
      const has = name.split(" ").filter(Boolean);
      const touched = words.some((w) =>
        has.some((h) => {
          if (h.length < 3 || w.length < 3) return false;
          return h.startsWith(stem(w)) || w.startsWith(stem(h));
        })
      );
      if (!touched) continue;
      // «не їм», «не пʼю» — принципова відмова; «не люблю» — смак
      const soft = /lubl/.test(f);
      return { kind: soft ? "avoid" : "exclude", label: line, who: person.name };
    }
  }
  return null;
}

/* ============================================================
   ПУБЛІКАЦІЯ СТРАВИ
   Фото тарілки саме по собі — ще одне фото тарілки. Цінність дає
   контекст, якого немає в жодного фуд-застосунку: рецепт прив'язаний
   до реальної комори. Тому публікується не «дивіться яка тарілка»,
   а «зібрав із того, що було» — з чесними числами.
   ============================================================ */
function cookStreak(history) {
  const days = new Set((history || []).map((h) => dayKey(h.at)));
  let n = 0;
  const d = new Date();
  for (;;) {
    if (days.has(dayKey(d.getTime()))) n++;
    else if (n > 0 || dayKey(d.getTime()) !== dayKey(Date.now())) break;
    d.setDate(d.getDate() - 1);
    if (n > 60) break;
  }
  return n;
}

function shareStats(recipe, pantryAtCook, history) {
  const total = recipe.ings.length;
  const fromPantry = recipe.ings.filter((ri) => resolveIng(ri, pantryAtCook)).length;
  const rescued = recipe.ings
    .map((ri) => resolveIng(ri, pantryAtCook))
    .filter((p) => p && urgency(p).level >= 2).length;
  return { total, fromPantry, rescued, streak: cookStreak(history) };
}

/* ============================================================
   ІНТЕГРАЦІЯ З МЕРЕЖЕЮ (мок)
   Контракт списаний з офіційного MCP «Сільпо»: пошук товарів пакетом,
   кошик, історія офлайн-чеків, харчові обмеження з профілю.
   Тут це моки — справжнє підключення потребує OAuth і серверного
   зберігання токена, тобто бекенду. Але форма даних і сценарії ті самі.
   ============================================================ */
const RETAIL = { id: "silpo", name: "Сільпо", server: "https://mcp.silpo.ua/mcp" };

/* silpo_find_products_batch → каталог із цінами й наявністю */
const RETAIL_CATALOG = [
  { id: "sk1", name: "Фарш яловичо-свинячий охолоджений", unit: "кг", price: 289, stock: true, tags: ["фарш"] },
  { id: "sk2", name: "Рис Arborio для різото Riso Gallo", unit: "500 г", price: 189, stock: true, tags: ["рис", "арборіо"] },
  { id: "sk3", name: "Гриби білі сушені", unit: "50 г", price: 245, stock: false, tags: ["гриби", "білі"] },
  { id: "sk4", name: "Печериці свіжі", unit: "400 г", price: 79, stock: true, tags: ["гриби", "печериц"] },
  { id: "sk5", name: "Бульйон курячий Chef Club", unit: "700 мл", price: 165, stock: true, tags: ["бульйон", "курячий"] },
  { id: "sk6", name: "Кумин мелений Kotanyi", unit: "20 г", price: 49, stock: true, tags: ["кумин", "зіра"] },
  { id: "sk7", name: "Кокосове молоко Aroy-D", unit: "400 мл", price: 119, stock: true, tags: ["кокосове", "молоко"] },
  { id: "sk8", name: "Паста каррі зелена Thai Dancer", unit: "50 г", price: 89, stock: true, tags: ["каррі", "паста"] },
  { id: "sk9", name: "Кімчі капуста квашена по-корейськи", unit: "300 г", price: 159, stock: true, tags: ["кімчі"] },
  { id: "sk10", name: "Базилік свіжий у горщику", unit: "1 шт", price: 65, stock: true, tags: ["базилік"] },
  { id: "sk11", name: "Баклажани", unit: "кг", price: 52, stock: true, tags: ["баклажан"] },
  { id: "sk12", name: "Перець солодкий червоний", unit: "кг", price: 74, stock: true, tags: ["перець", "солодкий"] },
  { id: "sk13", name: "Томати на гілці", unit: "кг", price: 89, stock: true, tags: ["томат", "помідор"] },
  { id: "sk14", name: "Кавун", unit: "кг", price: 18, stock: true, tags: ["кавун"] },
  { id: "sk15", name: "Сир Фета Dodoni", unit: "200 г", price: 189, stock: true, tags: ["фета"] },
  { id: "sk16", name: "Лосось філе охолоджене", unit: "кг", price: 1290, stock: true, tags: ["лосось"] },
  { id: "sk17", name: "Молоко 2,5% Премія", unit: "900 мл", price: 45, stock: true, tags: ["молоко"] },
  { id: "sk18", name: "Хліб пшеничний бездріжджовий", unit: "400 г", price: 59, stock: true, tags: ["хліб"] },
  { id: "sk19", name: "Пекоріно Романо", unit: "150 г", price: 279, stock: false, tags: ["пекоріно", "романо"] },
  { id: "sk20", name: "Папір туалетний Zewa 8 рулонів", unit: "8 шт", price: 189, stock: true, tags: ["папір", "туалетний"] },
];

function retailFindBatch(labels) {
  return (labels || []).map((label) => {
    const want = tokens(label);
    let best = null;
    let score = 0;
    RETAIL_CATALOG.forEach((p) => {
      const hay = tokens([p.name, ...(p.tags || [])].join(" "));
      let sc = 0;
      want.forEach((w) => {
        hay.forEach((h) => {
          const m = wordMatch(w, h);
          if (m > 0) sc += isWeak(w) ? 1 : m;
        });
      });
      if (sc > score) {
        score = sc;
        best = p;
      }
    });
    if (!best || score < 4) return { label, product: null, alternatives: [] };
    const alts = best.stock
      ? []
      : RETAIL_CATALOG.filter(
          (p) => p.id !== best.id && p.stock && (p.tags || []).some((t) => (best.tags || []).includes(t))
        ).slice(0, 2);
    return { label, product: best, alternatives: alts };
  });
}

/* silpo_get_my_offline_orders → чеки з фізичних магазинів */
const RETAIL_RECEIPTS = [
  {
    id: "r1",
    at: Date.now() - 2 * 86400000,
    shop: "Сільпо, Дніпровська набережна 33",
    total: 842,
    bonus: 24,
    lines: [
      { name: "Томати на гілці", v: 640, u: "g", price: 57, zone: "fresh" },
      { name: "Базилік свіжий", v: 1, u: "pcs", price: 65, zone: "fresh" },
      { name: "Моцарела Jager 45%", v: 250, u: "g", price: 119, zone: "fridge" },
      { name: "Молоко 2,5% Премія", v: 900, u: "ml", price: 45, zone: "fridge" },
      { name: "Хліб пшеничний бездріжджовий", v: 400, u: "g", price: 59, zone: "dry" },
      { name: "Кавун", v: 4200, u: "g", price: 76, zone: "fresh" },
    ],
  },
  {
    id: "r2",
    at: Date.now() - 6 * 86400000,
    shop: "Сільпо, Драгоманова 2",
    total: 1156,
    bonus: 31,
    lines: [
      { name: "Лосось філе охолоджене", v: 420, u: "g", price: 542, zone: "fridge" },
      { name: "Вершки 33% Галичина", v: 500, u: "ml", price: 129, zone: "fridge" },
      { name: "Папір туалетний Zewa", v: 8, u: "pcs", price: 189, zone: "dry" },
      { name: "Баклажани", v: 700, u: "g", price: 36, zone: "fresh" },
    ],
  },
];

function retailPullReceipts(days = 7) {
  const since = Date.now() - days * 86400000;
  const fresh = RETAIL_RECEIPTS.filter((r) => r.at >= since);
  const ops = [];
  fresh.forEach((r) =>
    r.lines.forEach((l) =>
      ops.push({
        op: "add",
        label: l.name,
        value: l.v,
        unit: l.u,
        zone: l.zone || guessZone(l.name),
        confidence: 1,
        evidence: "receipt_line",
      })
    )
  );
  return { receipts: fresh, ops };
}

/* silpo_get_my_food_restrictions → обмеження з профілю мережі */
const RETAIL_RESTRICTIONS = { allergies: ["морепродукти"], avoid: ["кінза"], diet: "none" };

/* ============================================================
   ПРИВОДИ
   Третє джерело ініціативи після «псується» і «забуте»: календар.
   Сезон, традиція, свято. Дає системі привід заговорити першою —
   але тільки словами в розмові, не окремим блоком в інтерфейсі.
   ============================================================ */
const OCCASIONS = [
  {
    id: "veg-peak",
    type: "season",
    title: "пік овочевого сезону",
    from: "07-15",
    to: "09-20",
    meaning:
      "Томати, перець, баклажани, кабачки зараз найдешевші й найсмачніші за рік. Це вікно на два місяці — узимку такого смаку не буде.",
    buy: ["баклажани", "солодкий перець", "томати на гілці", "кабачки", "свіжий базилік"],
    seeds: ["печені овочі з часником", "капоната", "аджапсандалі", "томатний салат із базиліком"],
  },
  {
    id: "melon",
    type: "season",
    title: "кавуни й дині",
    from: "08-01",
    to: "09-15",
    meaning: "Короткий сезон. Диня добре йде з прошуто, кавун — із фетою й м'ятою.",
    buy: ["кавун", "диня", "фета", "м'ята"],
    seeds: ["диня з прошуто", "кавун з фетою і м'ятою"],
  },
  {
    id: "mushroom",
    type: "season",
    title: "сезон білих грибів",
    from: "09-01",
    to: "10-31",
    meaning: "Свіжі білі бувають кілька тижнів на рік. Найкраще розкриваються в різото, жульєні й простій сметанній підливі.",
    buy: ["білі гриби", "рис арборіо", "вершки"],
    seeds: ["різото з білими", "гриби в сметані", "грибний крем-суп"],
  },
  {
    id: "pumpkin",
    type: "season",
    title: "гарбузи й коренеплоди",
    from: "10-01",
    to: "11-30",
    meaning: "Гарбуз, буряк, пастернак. Все, що добре запікається довго й повільно.",
    buy: ["гарбуз", "пастернак", "буряк"],
    seeds: ["запечений гарбуз із фетою", "гарбузовий суп", "печений буряк із горіхами"],
  },
  {
    id: "xmas-eve",
    type: "tradition",
    title: "Святвечір",
    from: "12-20",
    to: "12-24",
    meaning: "Дванадцять пісних страв. Кутя, узвар, пісні вареники, риба, гриби.",
    buy: ["пшениця", "мак", "сухофрукти", "мед", "гриби сушені"],
    seeds: ["кутя", "узвар", "вареники з капустою", "оселедець під шубою"],
  },
  {
    id: "spas",
    type: "tradition",
    title: "Яблучний Спас",
    from: "08-17",
    to: "08-21",
    meaning: "Початок яблучного сезону. Печені яблука, шарлотки, яблука до м'яса й сирів.",
    buy: ["яблука", "мед", "кориця"],
    seeds: ["печені яблука з медом", "шарлотка", "яблука до блакитного сиру"],
  },
];

/* Рухомі свята рахуються від Великодня, а Великдень залежить від традиції.
   Тому вони не лежать у каталозі з фіксованими датами, а обчислюються. */
function easterDate(year, tradition) {
  if (tradition === "catholic") {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  // олександрійська пасхалія, переведена в григоріанський календар
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(year, month - 1, day);
  julian.setDate(julian.getDate() + 13);
  return julian;
}

function movableOccasions(date, tradition) {
  if (!tradition || tradition === "none") return [];
  const e = easterDate(date.getFullYear(), tradition);
  const shift = (days) => {
    const d = new Date(e);
    d.setDate(d.getDate() + days);
    return d;
  };
  const inRange = (from, to) => date >= from && date <= to;
  const out = [];
  if (inRange(shift(-55), shift(-49)))
    out.push({
      id: "maslyana",
      type: "tradition",
      title: "Масниця",
      meaning: "Тиждень перед постом. Млинці, налисники, вершкове й сирне — усе, що потім не можна.",
      buy: ["сметана", "кисломолочний сир", "масло"],
    });
  if (inRange(shift(-48), shift(-1)))
    out.push({
      id: "lent",
      type: "tradition",
      title: "Великий піст",
      meaning:
        "Без мʼяса, молочного і яєць. У традиції це не обмеження, а привід зайти в бобові, гриби й крупи глибше, ніж зазвичай.",
      buy: ["нут", "сочевиця", "гриби", "тахіні", "кокосове молоко"],
    });
  if (inRange(shift(0), shift(2)))
    out.push({
      id: "easter",
      type: "tradition",
      title: "Великдень",
      meaning: "Паска, крашанки, шинка, сирна паска. Після посту — навпаки, все найситніше.",
      buy: ["сир кисломолочний", "яйця", "шинка"],
    });
  return out;
}

/* Традиція виводиться з побажань, а не з окремого поля: людина пише «постуємо»
   або «дотримуюсь халяль», система розпізнає й бере дати з таблиці. */
function traditionsFrom(wishes) {
  const t = fold((wishes || []).join(" "));
  const out = [];
  if (/post|velikden|pasha|pravoslav|kutia|sviatvecir/.test(t)) out.push("orthodox");
  if (/katolic/.test(t)) out.push("catholic");
  if (/halal|ramadan|islam|musulman|kurban|ураза|uraza/.test(t)) out.push("islamic");
  if (/koser|kasrut|pesah|sabat|iudei|evrei/.test(t)) out.push("jewish");
  return out;
}

/* Місячні дати рахуються наближено: ісламський рік ≈ 354.367 дня.
   Фактичний початок залежить від спостереження молодика, тому подаємо як орієнтир. */
const ISLAMIC_ANCHORS = [
  { id: "ramadan", title: "початок Рамадану", base: Date.UTC(2026, 1, 18) },
  { id: "eid-fitr", title: "Ід аль-Фітр", base: Date.UTC(2026, 2, 20) },
  { id: "eid-adha", title: "Курбан-байрам", base: Date.UTC(2026, 4, 27) },
];
const LUNAR_YEAR = 354.367 * 86400000;

const JEWISH_ANCHORS = [
  { id: "pesach", title: "Песах", base: Date.UTC(2026, 3, 2) },
  { id: "rosh", title: "Рош га-Шана", base: Date.UTC(2026, 8, 12) },
];

const pad2 = (n) => String(n).padStart(2, "0");

function activeOccasions(date = new Date(), tradition = "orthodox") {
  const md = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const fixed = OCCASIONS.filter((o) =>
    o.from <= o.to ? md >= o.from && md <= o.to : md >= o.from || md <= o.to
  );
  return [...movableOccasions(date, tradition), ...fixed];
}

/* Що попереду. Горизонт — рік, бо далі дані однаково застаріють разом із застосунком. */
function upcomingEvents(from = new Date(), wishes = [], days = 365) {
  const now = from.getTime();
  const until = now + days * 86400000;
  const out = [];
  const push = (at, title, kind, approx) => {
    if (at > now && at <= until) out.push({ at, title, kind, approx });
  };
  const yearOf = (md, y) => {
    const [m, d] = md.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };

  const y = from.getFullYear();
  [y, y + 1].forEach((year) => {
    OCCASIONS.forEach((o) => {
      const start = yearOf(o.from, year);
      const end = yearOf(o.to, year);
      push(start, `${o.title} — починається`, "season");
      push(end, `${o.title} — останні дні`, "season");
    });
  });

  const trads = traditionsFrom(wishes);
  [y, y + 1].forEach((year) => {
    if (trads.includes("orthodox") || trads.includes("catholic")) {
      const trad = trads.includes("catholic") ? "catholic" : "orthodox";
      const e = easterDate(year, trad).getTime();
      push(e - 55 * 86400000, "починається Масниця", "tradition");
      push(e - 48 * 86400000, "починається Великий піст", "tradition");
      push(e, "Великдень", "tradition");
    }
  });
  if (trads.includes("islamic"))
    ISLAMIC_ANCHORS.forEach((a) => {
      for (let k = 0; k < 2; k++) push(a.base + k * LUNAR_YEAR, a.title, "tradition", true);
    });
  if (trads.includes("jewish"))
    JEWISH_ANCHORS.forEach((a) => {
      for (let k = 0; k < 2; k++) push(a.base + k * 365.25 * 86400000, a.title, "tradition", true);
    });

  return out.sort((a, b) => a.at - b.at);
}

function whenLabel(at, now = Date.now()) {
  const d = Math.round((at - now) / 86400000);
  if (d <= 0) return "сьогодні";
  if (d === 1) return "завтра";
  if (d < 7) return `за ${d} дні`;
  if (d < 14) return "за тиждень";
  if (d < 45) return `${Math.round(d / 7)} тижні`;
  return new Date(at).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
}

function occasionBlock(date = new Date(), wishes = []) {
  const days = ["неділя", "понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота"];
  const months = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
  const head = `Сьогодні ${date.getDate()} ${months[date.getMonth()]}, ${days[date.getDay()]}.`;

  const trads = traditionsFrom(wishes);
  const act = activeOccasions(date, trads.includes("catholic") ? "catholic" : trads.includes("orthodox") ? "orthodox" : "none");
  const soon = upcomingEvents(date, wishes, 21).slice(0, 4);

  const parts = [head];
  if (act.length)
    parts.push(
      `Зараз: ${act.map((o) => `${o.title} — ${o.meaning}${o.buy?.length ? ` Варто докупити: ${o.buy.join(", ")}.` : ""}`).join("\n")}`
    );
  if (soon.length)
    parts.push(
      `Попереду: ${soon.map((e) => `${whenLabel(e.at, date.getTime())} — ${e.title}${e.approx ? " (орієнтовно)" : ""}`).join("; ")}`
    );

  if (parts.length === 1) return `\n\nСЬОГОДНІ:\n${head}`;
  return `\n\nСЬОГОДНІ:\n${parts.join("\n")}\nЦе привід, а не обовʼязок: згадай його лише коли доречно, одним реченням усередині відповіді. Сезон, що закінчується, — сильніший привід за сезон, що триває. Не починай кожну розмову з календаря.`;
}


  /* Перша репліка дня — короткий звіт по стану кулінарних справ.
   Не блок в інтерфейсі, а звичайне повідомлення: його можна прогорнути. */
function buildBrief(pantryNow, intentsNow, shoppingNow, wishes) {
  const parts = [];
  const live = (pantryNow || []).filter((p) => p.state !== "depleted");

  /* Називаємо дві-три конкретні позиції, а не рахуємо всі підряд.
     Лічильник «горить 11» знецінює сам себе: якщо горить усе, не горить нічого. */
  const soon = live
    .filter((p) => urgency(p).level >= 3)
    .sort((a, b) => (a.expiresInDays ?? 9) - (b.expiresInDays ?? 9))
    .slice(0, 3);

  if (soon.length === 1) parts.push(`З відкритого першим варто з'їсти ${compactLabel(soon[0].label)}.`);
  else if (soon.length > 1)
    parts.push(
      `Найближчим часом варто з'їсти ${soon.map((p) => compactLabel(p.label)).slice(0, 2).join(" і ")}.`
    );

  const ready = (intentsNow || []).filter((i) => i.ready);
  if (ready.length) parts.push(`Ти хотів «${ready[0].title}» — тепер для цього все є.`);

  const trads = traditionsFrom(wishes || []);
  const act = activeOccasions(
    new Date(),
    trads.includes("catholic") ? "catholic" : trads.includes("orthodox") ? "orthodox" : "none"
  );
  if (act.length) parts.push(`Зараз ${act.map((o) => o.title).join(" і ")}.`);
  const ahead = upcomingEvents(new Date(), wishes || [], 14).slice(0, 2);
  if (ahead.length)
    parts.push(`Попереду: ${ahead.map((e) => `${whenLabel(e.at)} — ${e.title}`).join("; ")}.`);

  if (!parts.length) parts.push("Комора в нормі, нічого термінового.");

  return parts.join(" ") + " Кажи, чого хочеться.";
}

/* ============================================================
   СЕСІЇ
   Журнал зберігає зроблене. Сесія зберігає обговорене — разом із тим,
   що так і не приготували. Саме там живуть наміри: «колись хотів
   лосося на шпинатній подушці». Це не пам'ять моделі, а сховище,
   у якому вона шукає на запит.
   ============================================================ */
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
const dayLabel = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return "Сьогодні";
  if (d === 1) return "Вчора";
  return new Date(ts).toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
};

/* Демо-історія: десять розмов за три тижні. Частина страв дійшла до
   готування (вони в журналі), частина лишилась задумом — саме на них
   тримається механіка «ти це хотів, зараз є все». */
const D1 = 86400000;
const ago = (d) => Date.now() - d * D1;

const mk = (id, d, msgs) => ({ id, at: ago(d), day: dayKey(ago(d)), messages: msgs, title: sessionTitle(msgs) });
const u = (text) => ({ id: `u${Math.random()}`, role: "user", text });
const a = (text, card = null) => ({ id: `a${Math.random()}`, role: "assistant", text, card });
const rec = (title, ings, base = 2) => ({
  type: "recipe",
  recipe: {
    id: `demo${Math.random()}`,
    title,
    origin: "generated",
    base,
    character: "",
    ings: ings.map((n) => ({ src: "external", name: n, v: 1, u: "pcs", role: "important" })),
    steps: [{ id: "s0", title: "Готування", content: "демо-запис", timer: null }],
  },
});

const DEMO_SESSIONS = [
  mk("d1", 20, [
    u("хочу щось із лососем, але не банальне"),
    a("Лосось у тебе порційний, морожений. Найцікавіше — на шпинатній подушці у вершках: шпинат теж є, і він давно лежить."),
    a("", rec("Лосось на шпинатній подушці", ["лосось порційний", "шпинат", "вершки 33%", "часник свіжий", "лимонний сік"])),
    u("клас, зроблю на вихідних"),
    a("Записав. Лосось розморозиться за ніч у холодильнику — постав напередодні."),
  ]),
  mk("d2", 18, [
    u("що зробити з мідіями поки не пропали"),
    a("Путанеска. Мідії йдуть в останні хвилини, соус тримається на анчоусах і каперсах — усе це в тебе відкрите."),
    a("", rec("Путанеска з мідіями", ["букатіні", "пелаті", "анчоуси", "каперси", "оливки", "мідії"])),
  ]),
  mk("d3", 16, [
    u("камбоцола закінчилась, і моцарела теж"),
    a("Зафіксував обидві.", {
      type: "intake_diff",
      ops: [
        { op: "deplete", label: "Cambozola (початке)", confidence: 1, evidence: "user_statement" },
        { op: "deplete", label: "Моцарела Jager (залишок)", confidence: 1, evidence: "user_statement" },
      ],
    }),
  ]),
  mk("d4", 14, [
    u("щось швидке, зовсім немає сил"),
    a("Тоді нічого не вмикаємо.", {
      type: "proposal",
      items: [
        { title: "Салат з прошуто, пармезаном і каперсами", character: "7 хвилин, нуль готування", pitch: "Бебі мікс горить сьогодні", rescues: ["MC — салат бебі мікс митий"] },
        { title: "Брускети з камбоцолою і яблуком", character: "5 хвилин", pitch: "Закуска рівня «нічого не робити»" },
      ],
    }),
  ]),
  mk("d5", 12, [
    u("а різото зможемо?"),
    a("Зможемо, але рису арборіо в тебе немає — звичайний тут не спрацює, він не віддає крохмаль.", {
      type: "proposal",
      items: [
        {
          title: "Різото з білими грибами",
          character: "40 хв, треба стояти і помішувати",
          pitch: "Пармезан і масло вже є, лишилось докупити небагато",
          needs: ["рис арборіо", "гриби білі", "курячий бульйон"],
        },
      ],
    }),
    u("ок, колись потім"),
    a("Хай лежить. Нагадаю, коли докупиш рис."),
  ]),
  mk("d6", 10, [
    u("Рецепт: борщ\nбуряк 2 шт, картопля 4, капуста 300 г, томатна паста 2 ст.л, часник\nБуряк натерти й притушкувати з томатом окремо. Картопля в бульйон, через 10 хв капуста. Наприкінці буряк і часник, дати настоятись годину."),
    a("Ось як я це зрозумів. Перевір, що я домислив, перш ніж зберігати."),
    a("«Борщ» збережено в обране.", rec("Борщ", ["буряк", "картопля", "капуста", "томатна паста", "часник свіжий"], 4)),
  ]),
  mk("d7", 8, [
    u("ти знаєш що таке плескавиця?"),
    a("Балканська котлета: жирний яловичо-свинячий фарш, широка й тонка, класично на грилі. З начинкою всередині це вже пуњена плескавиця."),
    u("давай з начинкою, з того що є"),
    a("Камбоцола найлогічніша — вона тане ідеально. Але фаршу в тебе немає, це доведеться купити.", 
      rec("Пуњена плескавиця з камбоцолою", ["фарш яловичо-свинячий", "камбоцола", "цибуля свіжа", "паприка"])),
  ]),
  mk("d8", 6, [
    u("дістань шпинат, хай відходить"),
    a("Тоді фетучіні з фуетом: фует дасть жир для соусу, шпинат піде туди ж."),
    a("", rec("Вершкова фетучіні з фуетом і шпинатом", ["фетучіні яєчні", "фует", "шпинат", "вершки 33%", "пармезан"], 1)),
    u("вийшло добре, але фует трохи пересушив"),
    a("Записав: знімати, щойно краї хрусткі."),
  ]),
  mk("d9", 4, [
    u("що в мене псується?"),
    a("Сім позицій. Найтерміновіші — прошуто п'ятий день, гауда п'ятнадцятий і залишок вершків 20%. Бебі мікс теж сьогодні."),
  ]),
  mk("d10", 2, [
    u("щось, що не треба стерегти"),
    a("Сочевиця: закинув і забув на двадцять п'ять хвилин."),
    a("", rec("Сочевиця з копченим томатом і шпинатом", ["сочевиця зелена", "пелаті", "шпинат", "цибуля карамелізована"])),
    u("солити в кінці, я пам'ятаю"),
    a("Саме так, інакше лишиться твердою."),
  ]),
];

const DEMO_COOKLOG = [
  { id: "c1", title: "Путанеска з мідіями", at: ago(18), rating: 3, verdict: "анчоуси лишились грудками — розчиняти довше", servings: 2, ings: ["букатіні", "пелаті", "анчоуси", "мідії"] },
  { id: "c2", title: "Салат з прошуто, пармезаном і каперсами", at: ago(14), rating: 4, verdict: null, servings: 1, ings: ["бебі мікс", "прошуто", "пармезан"] },
  { id: "c3", title: "Вершкова фетучіні з фуетом і шпинатом", at: ago(6), rating: 5, verdict: "фует знімати, щойно краї хрусткі", servings: 1, ings: ["фетучіні", "фует", "шпинат", "вершки"] },
  { id: "c4", title: "Сочевиця з копченим томатом і шпинатом", at: ago(2), rating: 5, verdict: "солити тільки в кінці", servings: 2, ings: ["сочевиця", "пелаті", "шпинат"] },
];

const DEMO_MEMORY = [
  { id: "n1", text: "фует знімати, щойно краї хрусткі — інакше сухий", recipe: "Вершкова фетучіні", at: ago(6), pinned: true },
  { id: "n2", text: "анчоуси розчиняти на малому вогні, не поспішати", recipe: "Путанеска", at: ago(18), pinned: false },
  { id: "n3", text: "сочевицю солити тільки в кінці", recipe: "Сочевиця", at: ago(2), pinned: false },
];

function sessionTitle(messages) {
  const firstUser = (messages || []).find((m) => m.role === "user" && m.text);
  if (firstUser) return firstUser.text.replace(/\s+/g, " ").slice(0, 46);
  const prop = (messages || []).find((m) => m.card && m.card.type === "proposal");
  if (prop && prop.card.items && prop.card.items[0])
    return String(prop.card.items[0].title || "Розмова").slice(0, 46);
  return "Нова розмова";
}

/* Наміри виводяться з сесій, а не зберігаються окремо:
   усе, що пропонувалось або показувалось рецептом, але не потрапило в журнал. */
function extractIntents(sessions, cookLog) {
  const done = new Set((cookLog || []).map((c) => String(c.title || "").toLowerCase()));
  const out = new Map();
  (sessions || []).forEach((sess) => {
    (sess.messages || []).forEach((m) => {
      const c = m.card;
      if (!c) return;
      const push = (title, ings, needs) => {
        const key = String(title || "").toLowerCase().trim();
        if (!key || done.has(key)) return;
        const prev = out.get(key);
        out.set(key, {
          title,
          ings: ings && ings.length ? ings : prev ? prev.ings : [],
          needs: needs && needs.length ? needs : prev ? prev.needs : [],
          at: Math.max(prev ? prev.at : 0, sess.at || 0),
          sessionId: sess.id,
          times: (prev ? prev.times : 0) + 1,
        });
      };
      if (c.type === "proposal")
        (c.items || []).forEach((i) =>
          push(
            i.title || (RECIPES.find((r) => r.id === i.recipeId) || {}).title,
            [],
            (i.needs || []).map((x) => (typeof x === "string" ? x : x && x.label)).filter(Boolean)
          )
        );
      if (c.type === "recipe") {
        const r = c.recipe || RECIPES.find((x) => x.id === c.recipeId);
        if (r) push(r.title, r.ings.map((ri) => ingName(ri)), []);
      }
      if (c.type === "recipe_draft" && c.draft)
        push(c.draft.title, (c.draft.ings || []).map((ri) => ingName(ri)), []);
    });
  });
  return [...out.values()].sort((a, b) => b.at - a.at);
}

/* Намір, для якого тепер усе є — найкращий привід нагадати про себе. */
function readyIntents(intents, pantry) {
  return (intents || [])
    .filter((it) => it.ings.length >= 3)
    .map((it) => {
      const missing = it.ings.filter((n) => !resolveIng({ src: "external", name: n }, pantry));
      return { ...it, missing };
    })
    .filter((it) => it.missing.length === 0);
}

function searchSessions(query, sessions) {
  const q = String(query || "").toLowerCase().trim();
  const all = [...(sessions || [])].sort((a, b) => b.at - a.at);
  if (!q) return { items: all.slice(0, 8), via: "останні розмови" };
  const words = fold(q).split(" ").filter((w) => w.length >= 4);
  if (!words.length) return { items: all.slice(0, 8), via: "останні розмови" };
  const scored = [];
  all.forEach((sess) => {
    const hay = fold(
      (sess.messages || [])
        .map((m) => [m.text, m.card ? cardToText(m.card, m.applied) : ""].join(" "))
        .join(" ")
    );
    const hits = words.filter((w) => hay.includes(w)).length;
    if (hits) scored.push({ sess, hits });
  });
  scored.sort((a, b) => b.hits - a.hits || b.sess.at - a.sess.at);
  return { items: scored.slice(0, 6).map((x) => x.sess), via: scored.length ? "за змістом розмов" : null };
}

/* ============================================================
   ЖУРНАЛ ПРИГОТУВАНЬ
   Історія не живе в промпті: вона росте безмежно. У промпт іде
   короткий зріз, а на запит «що я готував із фуетом» відповідає
   локальний пошук — так само, як по коморі.
   ============================================================ */
const DAY = 86400000;

function relDays(ts) {
  const d = Math.floor((Date.now() - ts) / DAY);
  if (d <= 0) return "сьогодні";
  if (d === 1) return "вчора";
  if (d < 7) return `${d} дн. тому`;
  if (d < 14) return "минулого тижня";
  if (d < 60) return `${Math.round(d / 7)} тиж. тому`;
  return `${Math.round(d / 30)} міс. тому`;
}

/* Три осі, за якими люди справді питають: час, інгредієнт, оцінка. */
function searchCookLog(query, log) {
  const q = String(query || "").toLowerCase().trim();
  const all = [...(log || [])].sort((a, b) => b.at - a.at);
  if (!q) return { items: all.slice(0, 8), via: "останні" };

  const now = Date.now();
  const period =
    /сьогодн/.test(q) ? 1 :
    /вчора/.test(q) ? 1 :
    /тижн|тижден/.test(q) ? (/минул|попередн/.test(q) ? 14 : 7) :
    /місяц/.test(q) ? 31 : null;

  // негатив перевіряємо першим: «не сподобалось» містить «сподоба»
  if (/невдал|не вийшл|погано|не сподоба|не зайшл|гірш/.test(q)) {
    const bad = all.filter((x) => x.rating && x.rating <= 2);
    return { items: bad.slice(0, 8), via: bad.length ? "низькі оцінки" : null };
  }
  if (/найкращ|найсмачн|вдал|сподоба|топ|зайшл/.test(q)) {
    const best = all.filter((x) => (x.rating || 0) >= 4);
    if (best.length) return { items: best.slice(0, 8), via: "найвищі оцінки" };
  }

  const daysAgo = (ts) => Math.floor((now - ts) / DAY);
  let pool = period ? all.filter((x) => daysAgo(x.at) <= period) : all;

  // за назвою або за інгредієнтом — через ту саму нормалізацію, що й скрізь
  const fq = fold(q);
  const words = fq.split(" ").filter((w) => w.length >= 3);
  if (words.length) {
    const hit = pool.filter((x) => {
      const hay = fold([x.title, ...(x.ings || [])].join(" "));
      return words.some((w) => hay.includes(w));
    });
    if (hit.length) return { items: hit.slice(0, 8), via: period ? "за назвою і періодом" : "за назвою чи інгредієнтом" };
  }

  if (period && pool.length)
    return {
      items: pool.slice(0, 8),
      via: period <= 1 ? "вчора й сьогодні" : period <= 7 ? "за тиждень" : period <= 14 ? "за два тижні" : "за місяць",
    };
  return { items: [], via: null };
}

/* Досвід росте безмежно, промпт — ні. Тому в модель іде зріз:
   закріплені нотатки завжди, решта — найсвіжіші, плюс короткий журнал приготувань. */
function memoryBlock(memory, history, intents) {
  const notes = memory || [];
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned).slice(-8);
  const picked = [...pinned, ...rest];
  const parts = [];

  if (picked.length)
    parts.push(
      `ВИСНОВКИ З ПОПЕРЕДНІХ ГОТУВАНЬ (це сказав сам користувач, спирайся на них):\n${picked
        .map((n) => `· ${n.text}${n.recipe ? ` — ${n.recipe}` : ""}`)
        .join("\n")}`
    );

  const all = history || [];
  const recent = all.filter((h) => Date.now() - h.at < 21 * DAY).slice(-10);
  if (recent.length)
    parts.push(
      `Останні три тижні готував: ${recent
        .map((h) => `${h.title}${h.rating ? ` ${h.rating}/5` : ""} — ${relDays(h.at)}`)
        .join("; ")}. Не пропонуй те саме двічі поспіль без причини.`
    );
  if (intents && intents.length)
    parts.push(
      `Задумував, але не готував: ${intents
        .slice(0, 5)
        .map((i) => `${i.title} (${relDays(i.at)}${i.ready ? ", зараз є все" : ""})`)
        .join("; ")}. Якщо для чогось із цього тепер є всі продукти, а розмова про це заходить — згадай сам, одним реченням усередині відповіді. Не роби з цього окремого оголошення і не починай з нього кожну розмову.`
    );
  const loved = all.filter((h) => (h.rating || 0) >= 4).slice(-5);
  if (loved.length)
    parts.push(`Найбільше зайшло: ${loved.map((h) => h.title).join(", ")}.`);
  if (all.length > recent.length)
    parts.push(
      `Загалом у журналі ${all.length} приготувань. Старіше в контекст не входить — якщо користувач питає про давнє, скажи, що зараз подивишся, і не вигадуй назв.`
    );

  if (!parts.length) return "";
  return `\n\nДОСВІД ЦІЄЇ КУХНІ:\n${parts.join("\n\n")}\n\nВисновок користувача важить більше за загальне правило. Якщо він уже знає прийом — не повторюй його як новину; якщо колись помилився — вбудуй застереження прямо в крок рецепта, а не окремою нотацією.`;
}

/* Роль задає не перелік умінь — модель і так усе це вміє, — а те,
   як вона обирає між варіантами і чого не робить. */
const ROLE = `Ти кухар, який стоїть поруч на цій конкретній кухні, а не автор кулінарної колонки. Ти знаєш техніку, а не лише рецепти: розумієш, що дає жир, що дає кислоту, що дає текстуру, і в якому порядку це збирається.

Ти завжди маєш думку. Не перелічуй нейтрально — рекомендуй конкретне і кажи чому.

Про терміновість говори спокійно. Це побутова деталь, а не аварія: «пелаті відкриті — краще сьогодні», а не «горить», «терміново», «пропаде». Не перелічуй усе, що добігає кінця, і не називай кількість — досить однієї-двох конкретних позицій, найближчих за часом. Продукти, що просто давно лежать, згадуй лише коли вони доречні до страви, а не як докір.

Порядок пріоритетів, коли обираєш, що запропонувати:
1. те, що псується або відкрите — його рятуємо першим
2. те, на що в людини зараз є час і сили
3. те, що трохи розширює досвід, а не повторює вчорашнє

Заміни називай прямо і кажи, як зміниться результат: «замість вершків молоко — соус вийде рідший, додай сиру».
Пояснюй причину дії, а не лише дію: «жир лишити, він і є база соусу».
Про походження страви й традицію розповідай тільки коли спитали.

Позначки спрацьовують за назвою продукту, а не за змістом. Тому родове слово «морепродукти» саме по собі не помітить «м'ясо мідій» на полиці. Коли записуєш обмеження — записуй конкретні назви, під якими продукт реально зустрічається.

Людина готує не тільки собі: дружині, батькам, гостям. Тому алергени й нелюбі продукти — це не заборона, а позначка. Сам їх не пропонуй; на прямий запит дай, але назви алерген вголос. Ніколи не подавай його як звичайний інгредієнт і ніколи не приховуй.

Базове обладнання — пательня, каструля, духовка, ніж, дошка — вважай наявним і не питай про нього. Згадуй обладнання лише тоді, коли страва вимагає нетипового: міксера, блендера, вока, термометра, су-віда. Якщо такого в людини немає — не пропонуй страву, або одразу дай спосіб обійтись без нього.

Не лишай людину в глухому куті. Репліка, яка закінчується констатацією — «записав», «розібрав чек», «зрозумів» — це тупик: людина не знає, що робити далі. Закінчуй питанням або пропозицією дії: «Зробимо щось із цього зараз?», «Докупити чогось?», «Показати варіанти на вечерю?». Це не стосується випадків, коли людина сама щойно завершила справу.

Не роби так: без передмов і підсумків, без похвали користувачу, без «чудовий вибір», без переказу очевидного, без вибачень. Пиши як людина на кухні — короткими фразами по суті.`;

/* ---------- кухні: рамка генерації, а не фільтр ---------- */
const CUISINES = [
  { id: "any", label: "будь-яка", frame: "" },
  {
    id: "ua",
    label: "українська",
    frame:
      "Українська домашня кухня. Жирова база — смалець, олія, вершкове масло, сметана. Кислота — квашене, оцет, кисле молоко. Смакові якорі: цибуля, часник, кріп, лавровий лист, чорний перець, копчене. Техніки: тушкування, запікання, засмажка, вареники й налисники. Уникай італійських і азійських прийомів.",
  },
  {
    id: "it",
    label: "італійська",
    frame:
      "Італійська кухня. Жирова база — оливкова олія, вершкове масло на півночі. Кислота — томат, лимон, вино. Якорі: часник, базилік, орегано, пармезан, анчоуси, каперси. Техніки: соффрітто, емульсія з водою від пасти, різото з поступовим бульйоном. Мінімум інгредієнтів, максимум техніки.",
  },
  {
    id: "asia",
    label: "азійська",
    frame:
      "Східноазійська кухня. Жирова база — нейтральна олія, кунжутна в кінці. Кислота — рисовий оцет, лайм. Солоність — соєвий соус, рибний соус, місо. Якорі: імбир, часник, зелена цибуля, чилі, кунжут. Техніки: сильний вогонь і швидке обсмажування, приготування на парі, локшина й бульйон. Порядок: спершу ароматика, потім білок, соус у кінці.",
  },
  {
    id: "mx",
    label: "мексиканська",
    frame:
      "Мексиканська кухня. Жирова база — олія, смалець. Кислота — лайм, томат. Якорі: чилі, кумин, орегано, коріандр, цибуля, часник, кукурудза, квасоля. Техніки: обсмажування спецій до аромату, сальса свіжа й смажена, тортильї. Кислота й свіжа зелень завжди в кінці.",
  },
  {
    id: "me",
    label: "близькосхідна",
    frame:
      "Близькосхідна й левантійська кухня. Жирова база — оливкова олія, тахіні, йогурт. Кислота — лимон, сумах, гранат. Якорі: кумин, коріандр, кориця в м'ясному, м'ята, петрушка, часник, нут. Техніки: маринування в йогурті, повільне тушкування, мезе й дипи, запікання овочів до вуглинок.",
  },
  {
    id: "fr",
    label: "французька",
    frame:
      "Французька кухня. Жирова база — вершкове масло, вершки. Кислота — вино, оцет, лимон. Якорі: цибуля-шалот, часник, чебрець, лавровий лист, естрагон, діжонська гірчиця. Техніки: деглазування, редукція, емульсія з маслом, повільне тушкування. Соус важливіший за все.",
  },
];
const cuisineFrame = (id) => {
  const c = CUISINES.find((x) => x.id === id);
  return c && c.frame ? `\n\nРАМКА КУХНІ (обов'язкова):\n${c.frame}` : "";
};

/* ---------- список покупок ---------- */
const ZONE_GUESS = [
  ["freezer", ["морожен", "заморож", "креветк", "мідій", "котлет", "нагетс", "панкейк", "філе", "стейк", "лосось", "тунец"]],
  ["fridge", ["сир", "молок", "вершк", "йогурт", "яйц", "масло", "прошут", "салямі", "фует", "моцарел", "камбоцол", "камамбер", "брі", "гауда", "пармезан", "айран", "сметан", "пекорін", "романо", "чедер", "фета", "горгонзол", "рікот", "маскарпоне"]],
  ["fresh", ["помідор", "томат", "салат", "яблук", "апельсин", "картопл", "цибул", "часник", "огірк", "лимон", "зелен", "петрушк", "кріп", "авокадо", "перець солод", "банан", "гриб", "базилік", "рукол", "м'ят", "кінз", "селер", "моркв", "буряк", "капуст", "редис"]],
  ["spices", ["олі", "оцет", "соус", "перець", "сіль", "паприк", "гірчиц", "песто", "спец", "приправ", "фонд"]],
  ["drinks", ["вод", "сік", "вино", "тонік", "квас", "кава", "чай", "нектар", "пив"]],
];
function guessZone(label) {
  const l = String(label || "").toLowerCase();
  for (const [z, words] of ZONE_GUESS) if (words.some((w) => l.includes(w))) return z;
  return "dry";
}

let _sid = 0;
function shopItem(label, reason, extra = {}) {
  return {
    id: `s${++_sid}`,
    label,
    reason,
    value: extra.value ?? null,
    unit: extra.unit ?? null,
    ing: extra.ing ?? null,
    zone: extra.zone || guessZone(label),
    checked: false,
  };
}

/* ============================================================
   ЛОКАЛЬНИЙ РУШІЙ (fallback, коли API недоступний)
   ============================================================ */
function localEngine(text, pantry) {
  const t = text.toLowerCase();

  if (/купив|придбав|взяв|приніс|чек|доклад/.test(t)) {
    return {
      reply: "Розібрав. Перевір, перш ніж я запишу — те, що внизу, я вгадав, а не побачив.",
      card: {
        type: "intake_diff",
        ops: [
          { op: "add", label: "Фарш яловичий", value: 500, unit: "g", zone: "fridge", confidence: 0.95, evidence: "user_statement" },
          { op: "add", label: "Моцарела", value: 125, unit: "g", zone: "fridge", confidence: 0.9, evidence: "user_statement" },
          { op: "add", label: "Цибуля свіжа", value: 2, unit: "pcs", zone: "fresh", confidence: 0.55, evidence: "inference" },
        ],
      },
    };
  }
  if (/закінч|нема|скінч|доїв|випив/.test(t)) {
    const found = pantry.find((p) => t.includes(p.label.split(" ")[0].toLowerCase()));
    return {
      reply: found ? "Зафіксував." : "Не зрозумів, що саме закінчилось. Назви точніше?",
      card: found
        ? { type: "intake_diff", ops: [{ op: "deplete", label: found.label, pantryId: found.id, confidence: 1, evidence: "user_statement" }] }
        : null,
    };
  }
  if (/додай|купи|список покуп|занеси|запиши|треба взяти/.test(t)) {
    let raw = text;
    const cut = raw.toLowerCase().lastIndexOf("покупок");
    if (cut >= 0) raw = raw.slice(cut + "покупок".length);
    else raw = raw.replace(/^.*?(додай|купи\w*|запиши|занеси)\s*/i, "");
    raw = raw.replace(/^[\s:,-]*(в|у|до)\s+/i, "").replace(/^[\s:,-]+/, "");
    const items = raw
      .split(/\s*[,;]\s*|\s+та\s+|\s+і\s+|\s+й\s+/)
      .map((x) => x.trim().replace(/^[-–—•]\s*/, ""))
      .filter((x) => x.length > 1);
    if (items.length)
      return {
        reply: `Додав ${items.length} у список.`,
        card: { type: "shopping", items: items.map((l) => ({ label: l, note: "з розмови" })) },
      };
  }
  if (/що.*готув|що.*їс|вечер|обід|голод|запропон/.test(t)) {
    const scored = RECIPES.map((r) => ({ r, m: matchRecipe(r, pantry, r.base) }))
      .filter((x) => x.m.status !== "far")
      .sort((a, b) => b.m.rescues.length - a.m.rescues.length)
      .slice(0, 3);
    return {
      reply: "Три варіанти вечора. Різні не за смаком, а за тим, скільки в тебе сил.",
      card: { type: "proposal", items: scored.map((x) => ({ recipeId: x.r.id, rescues: x.m.rescues.map((p) => p.label) })) },
    };
  }
  if (/сезон|свято|піст|привід|що зараз|традиц/.test(t)) {
    const act = activeOccasions();
    return {
      reply: act.length
        ? `Зараз ${act.map((o) => o.title).join(", ")}. ${act[0].meaning}`
        : "Зараз нічого особливого в календарі немає.",
      card: null,
    };
  }
  if (/рятув|псу|вибува|викин|пропад/.test(t)) {
    const urgent = pantry.filter((p) => urgency(p).level >= 2);
    return {
      reply: urgent.length
        ? `Найближчим часом варто з'їсти ${urgent.slice(0, 3).map((p) => p.label).join(", ")}.`
        : "Нічого термінового. Рідкісний момент.",
      card: null,
    };
  }
  return {
    reply:
      "Локальний режим, без моделі — я вмію тільки прості команди. Спробуй: «що сьогодні приготувати», «купив фарш і моцарелу», «камбоцола закінчилась», «що псується», «додай у список X, Y».",
    card: null,
  };
}

/* ============================================================
   LLM
   ============================================================ */
const SYS = (digest, shopping, cuisine, profile, memory, history, intents, audience, onboarding, household) => `${ROLE}${onboarding && ONBOARDING[onboarding] ? `\n\n${ONBOARDING[onboarding]}` : ""}${profileBlock(profile)}${audienceBlock(audience, profile, household)}${occasionBlock(new Date(), profile && profile.wishes)}${memoryBlock(memory, history, intents)}

Ти працюєш усередині застосунку, де ведеш комору І список покупок. Відповідай українською, коротко.

КОМОРА КОРИСТУВАЧА:
${digest}

Позначка (!...) означає, що продукт треба з'їсти найближчим часом.

СПИСОК ПОКУПОК ЗАРАЗ:
${shopping && shopping.length ? shopping.join(", ") : "порожній"}

Поверни ВИКЛЮЧНО JSON без markdown-огорожі:
{"reply":"текст 1-3 речення","card":null | CARD}

CARD варіанти:
{"type":"intake_diff","ops":[{"op":"add|deplete|open|rename|correct","label":"назва","to":"нова назва для rename","value":число,"unit":"g|ml|pcs|pack","zone":"fridge|freezer|dry|fresh|spices","confidence":0..1,"evidence":"user_statement|inference"}]}
{"type":"proposal","items":[{"title":"назва страви","desc":"САМА СТРАВА: 1-2 речення про смак, текстуру, відчуття","why":"коротка причина, чому пропонуєш саме зараз — тільки якщо неочевидна","character":"скільки часу і скільки зусиль","rescues":["що з комори рятує"],"needs":["чого бракує — точна назва продукту"]}]}
{"type":"shopping","items":[{"op":"add|remove","label":"назва позиції","note":"коротка причина","v":500,"u":"g"}]}
{"type":"profile","ops":[{"op":"add|remove","kind":"allergy|wish|anti|equip|note|member","label":"значення","has":true,"recipe":"назва страви","rating":4,"diet":"веганство","wishes":["веганство"],"antipatterns":["не їм мʼяса"],"allergies":[]}]}

Правила:
- Якщо користувач повідомляє про покупку чи зміну стану — card = intake_diff.
- Комору можна не тільки поповнювати, а й ВИПРАВЛЯТИ. «Перейменуй крем-брусок на крем-брюле» → {"op":"rename","label":"крем-брусок","to":"Крем-брюле Pont"}. «Там не 200 а 400 грамів» → {"op":"correct","label":"назва","value":400,"unit":"g"}. «Переклади оливки в холодильник» → {"op":"correct","label":"оливки","zone":"fridge"}
- Усе, що ти ДОМИСЛИВ і не бачив прямо, познач evidence:"inference" і confidence нижче 0.7. Ніколи не вигадуй продукти мовчки.
- Якщо питає, що готувати — card = proposal, 2-3 варіанти, різні за зусиллям.
- "desc" — це опис СТРАВИ, а не пояснення твого вибору. Пиши, яка вона на смак і на текстуру, з чим подається, що в ній головне: «густий томатний соус, моцарела тягнеться, паста тримає форму». НІКОЛИ не пиши сюди «рятує пелаті», «ти це задумував», «вершки сьогодні» — це не опис страви, і користувач бачить це в іншому місці
- "why" — саме для такого: «задумував минулого тижня», «вершки треба з'їсти сьогодні». Одна коротка фраза, і тільки коли причина справді неочевидна. Якщо страва обрана просто бо смачна — не пиши why взагалі
- ТЕМА РОЗМОВИ ТРИМАЄТЬСЯ. Якщо ви вже обговорювали конкретну страву, всі наступні «дай рецепт», «давай зробимо», «покажи» стосуються САМЕ ЇЇ. Не підміняй її новими пропозиціями під комору — це найгрубіша помилка, яку ти можеш тут зробити. Якщо не впевнений, про яку страву мова, спитай одним реченням, а не вгадуй.
- «Дай рецепт», «давай робити», «покажи як» — це НІКОЛИ не shopping. Навіть якщо перед тим ви говорили про докупівлю.
- Коли страва вже визначена в розмові, поверни proposal з ОДНИМ елементом — цією стравою. Кнопка під ним відкриє повний рецепт.
- card = shopping ТІЛЬКИ тоді, коли розмова саме про покупки: «додай у список», «що купити», «треба взяти», «збираюсь у магазин». Тоді додавай УСЕ, що назвали, включно з нехарчовим (побутова хімія, папір) і готовими напоями; виправляй очевидні одруківки.
- НІКОЛИ не відмовляй у страві через те, що продукту немає в коморі. Якщо користувач назвав інгредієнт, якого нема, — все одно дай proposal із 2-3 стравами НАВКОЛО ЦЬОГО інгредієнта, а в полі needs перелічи, що для цього треба докупити. Відсутність продукту — деталь, а не перешкода.
- Не пиши «цього немає, тому не вийде» і не пропонуй натомість щось інше, поки тебе не попросили. Спершу дай те, про що просили.
- Список при цьому не чіпай: користувач докладе потрібне сам одним дотиком.
- Списком керуєш повністю: «прибери фарш зі списку» → {"op":"remove","label":"фарш"}. «Постав два літри молока» → {"op":"add","label":"молоко","v":2,"u":"l"}
- Список покупок — твоя функція. Ніколи не кажи, що не ведеш список.
- Досвідом теж керуєш: «забудь про фует» → {"op":"remove","kind":"note","label":"фует"}. «Це важливо, запамʼятай назавжди» → {"op":"add","kind":"note","label":"…","pin":true}
- ПРОФІЛЬ — ТРИ БЛОКИ, і кожен працює по-різному:
  · "allergy" — медична реакція, КОНКРЕТНИМИ назвами продуктів: «арахіс», «арахісова паста», «молюски». Їх шукає збіг по коморі, тому загальні слова тут не працюють
  · "wish" — куди тягнути: традиції, свята, наміри, плани, смаки. Вільною фразою, як сказала людина: «дотримуюсь халяль», «постуємо», «щопʼятниці риба», «мама привезе мішок цибулі — тиждень готуємо з нею», «люблю блакитні сири»
  · "anti" — від чого відштовхуватись, теж фразою: «не їм свинину й похідні», «не пʼю алкоголь», «не люблю кінзу». Силу не кодуй — вона читається з формулювання
- Дієта, релігія й календар НЕ мають окремих полів. «Я веган» → wish «веганство» + anti «не їм мʼяса, риби, яєць і молочного». «Ісламські свята, не їм свинину» → wish «дотримуюсь халяль, ісламські свята» + anti «не їм свинину й похідні — сало, бекон, шинку, желатин». Дати свят я порахую сам, розпізнавши традицію з фрази
- Релігія зазвичай дає кілька записів. Не вигадуй за людину, що саме вона виключає — спитай одним реченням
- Видалення так само: «прибери кінзу» → {"op":"remove","kind":"anti","label":"кінза"}. «Більше не постуємо» → {"op":"remove","kind":"wish","label":"пост"}
- Учасники дому: «зі мною живе Оксана, вона веганка» → {"op":"add","kind":"member","label":"Оксана","diet":"vegan"}. «Оксана більше з нами не живе» → {"op":"remove","kind":"member","label":"Оксана"}. Обмеження учасника кладуться в його ж запис, а не в профіль власника
- "op" за замовчуванням "add" — можна не писати
- Якщо людина розповідає, ЯК ВИЙШЛА приготована страва («вийшло сухувато», «фует пересушив», «дуже смачно») — card = profile з kind:"note". У label запиши висновок так, щоб він був корисним наступного разу: не «було сухо», а «фует знімати, щойно краї хрусткі». Якщо прозвучала оцінка — постав rating 1-5. Не перепитуй, просто запропонуй запам'ятати.
- Якщо людина повідомляє про своє обладнання («в мене нема міксера», «купив аерогриль») чи про нелюбий продукт — card = profile. Не перепитуй, просто запропонуй запам'ятати.
- АЛЕРГІЯ — виняток: перш ніж записувати, спитай одним реченням, де проходить межа, і поясни коротко, що позначка шукає збіг за назвою продукту. Родові назви майже завжди неоднозначні:
  · морепродукти — молюски й ракоподібні; риба зазвичай не входить
  · горіхи — арахіс ботанічно бобова, а не горіх; кеш'ю й фісташки часто поводяться інакше за волоські
  · глютен — питання вівса й перехресного забруднення
  · лактоза — витримані сири її майже не містять, тож «без лактози» не те саме, що «без молочного»
  · цитрусові — сік і цедра можуть відрізнятись
- Після відповіді записуй НЕ одну родову назву, а стільки конкретних, скільки треба, щоб позначка спрацювала: окремим op на кожну.
- Далі перевір комору: якщо там лежить продукт, що підпадає під алерген за змістом, але не збігається назвою, назви його прямо і запропонуй додати окремо.
- Якщо позиція вже є в коморі, а користувач просить її купити — все одно додай, а в reply одним реченням зазнач, що вона є і скільки. Вирішує користувач, не ти.
- Інакше card = null.${cuisineFrame(cuisine)}`;

function cardToText(card, applied) {
  if (!card) return "";
  if (card.type === "proposal")
    return `[я запропонував: ${(card.items || [])
      .map((i) => `${i.title || (RECIPES.find((r) => r.id === i.recipeId) || {}).title || "?"}${i.character ? " — " + i.character : ""}`)
      .join("; ")}]`;
  if (card.type === "recipe") {
    const r = card.recipe || RECIPES.find((x) => x.id === card.recipeId);
    if (!r) return "[я показав рецепт]";
    return `[я показав рецепт «${r.title}»: ${r.ings.map((ri) => ingName(ri)).join(", ")}; ${r.steps.length} кроків]`;
  }
  if (card.type === "intake_diff")
    return `[я запропонував зміни комори: ${(card.ops || [])
      .map((o) => `${o.op === "deplete" ? "закінчилось " : ""}${o.label}`)
      .join(", ")}${applied ? ` — користувач підтвердив ${applied}` : " — ще не підтверджено"}]`;
  if (card.type === "shopping") {
    const names = card.labels && card.labels.length ? card.labels.join(", ") : `${(card.ids || []).length} позицій`;
    return `[я додав у список покупок: ${names}${
      card.dup && card.dup.length ? `; вже було там: ${card.dup.join(", ")}` : ""
    }]`;
  }
  if (card.type === "cook_done") return "[я запропонував показати, що вийшло]";
  if (card.type === "share")
    return `[я підготував публікацію страви «${(card.post && card.post.recipe && card.post.recipe.title) || ""}»]`;
  if (card.type === "sessions")
    return `[я показав попередні розмови${
      (card.intents || []).length ? `; задуми: ${card.intents.map((i) => i.title).join(", ")}` : ""
    }]`;
  if (card.type === "cook_log")
    return `[я показав журнал: ${(card.items || [])
      .map((i) => `${i.title}${i.rating ? ` ${i.rating}/5` : ""}`)
      .join(", ") || "нічого не знайшлось"}]`;
  if (card.type === "recipe_draft")
    return `[я показав чернетку рецепта «${card.draft && card.draft.title}» на підтвердження]`;
  if (card.type === "profile")
    return `[я запропонував записати в профіль: ${(card.ops || [])
      .map((o) => o.label)
      .join(", ")}]`;
  return "";
}

function buildMessages(history) {
  // тільки непорожні репліки, діалог мусить починатись з user,
  // ролі не можуть іти двома підряд — API це відхиляє
  const clean = history
    .map((m) => {
      const extra = cardToText(m.card, m.applied);
      const shot =
        !m.text && ((m.images && m.images.length) || (m.files && m.files.length))
          ? "[надіслав вкладення]"
          : "";
      const text = [m.text, shot, extra].filter(Boolean).join(" ").trim();
      return { role: m.role, text };
    })
    .filter((m) => m.text.length > 0);
  const firstUser = clean.findIndex((m) => m.role === "user");
  if (firstUser < 0) return [];
  const seq = clean.slice(firstUser).slice(-16);
  const out = [];
  seq.forEach((m) => {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.text;
    else out.push({ role: m.role, content: m.text });
  });
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function callLLM(history, digest, shoppingLabels, cuisine, profile, memory, cookHistory, intentsForPrompt, audience, onboarding, household) {
  const msgs = buildMessages(history);
  if (!msgs.length) throw new Error("порожня історія");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelFor("fast"),
      system: SYS(digest, shoppingLabels, cuisine, profile, memory, cookHistory, intentsForPrompt, audience, onboarding, household),
      messages: msgs,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message || "";
    } catch (e) {}
    throw new Error(`HTTP ${res.status}${detail ? " · " + detail.slice(0, 120) : ""}`);
  }
  const data = await res.json();
  const raw = data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const stripped = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(stripped);
  } catch (e) {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (e2) {}
    }
    // модель відповіла текстом, а не JSON — це не привід глушити живий режим
    return { reply: stripped || "…", card: null };
  }
}

const RECIPE_SYS = (ref, cuisine, profile, memory, history, audience) => `${ROLE}${profileBlock(profile)}${audienceBlock(audience, profile)}${occasionBlock(new Date(), profile && profile.wishes)}${memoryBlock(memory, history)}

Склади ПОВНИЙ рецепт під конкретну комору користувача.

КОМОРА КОРИСТУВАЧА — формат «id | назва | стан»:
${ref}

Поверни ВИКЛЮЧНО JSON без markdown. Ключі КОРОТКІ, саме такі:
{"t":"назва","sv":1,"tm":25,"ch":"скільки часу і зусиль, 3-5 слів","nu":{"kcal":540,"p":28,"f":22,"c":55},"d":"1-2 речення про смак і текстуру самої страви","nu":{"kcal":540,"p":28,"f":22,"c":55},"rk":"ПРИМІТКА: ключова помилка, якої треба уникнути, і чому саме вона псує страву. 1-3 речення, конкретно про техніку, а не загальні поради","op":["варіант, який людина може захотіти — заміна, спрощення, інший акцент"],"ing":[…],"st":[{"t":"назва кроку","c":"дія; кількості вставляй плейсхолдером {0},{1} за індексом інгредієнта","s":240}]}

Кожен інгредієнт — РІВНО одна з двох форм:
· продукт Є в коморі → {"p":"p12","v":60,"u":"g","r":"critical","nt":"опційно"}
· продукту НЕМА в коморі → {"n":"рис арборіо","v":160,"u":"g","r":"critical"}

ЦЕ НАЙВАЖЛИВІШЕ:
- якщо продукт є у списку вище — вкажи його id у "p" і НЕ пиши "n". Копіюй id точно, символ у символ
- якщо продукту нема — вкажи "n" з назвою і НЕ вигадуй id
- ніколи не став обидва поля разом
- id (p12) використовуй ТІЛЬКИ у полі "p". У тексті кроків, у "rk", "ch", "d", "op" пиши звичайні назви — цей текст читає людина, і «додай p10» для неї безглузде
- у кроках кількості вставляй плейсхолдером за ІНДЕКСОМ інгредієнта в масиві: {0}, {1}, {2} — не через id
- коли підходять кілька позицій (кілька сирів, кілька пачок) — обери одну, найдоречнішу, і віддай перевагу відкритій або терміновій

Правила:
- unit тільки з: g, ml, tsp, tbsp, pcs, clove, brick, can, pack, pinch
- "nu" — груба оцінка на ОДНУ порцію: ккал, білки, жири, вуглеводи в грамах. Рахуй за складом і кількостями, округлюй до десятків для ккал і до цілих для решти. Це орієнтир, а не точність — не намагайся вгадати до одиниць
- "rk" — те, на чому ця страва найчастіше псується, і механіка помилки: «не місити довго — фарш уже має структуру, зайве вимішування дасть гумову текстуру». Не пиши банальностей на кшталт «стежте за вогнем»
- "op" — до 3 варіантів саме для цієї страви й цієї комори, кожен до 60 символів
- максимум 9 інгредієнтів і 6 кроків. Крок — ОДНЕ коротке речення, до 90 символів. "nt" пиши тільки коли справді потрібно, "rk" — до 80 символів. Стислість критична: довга відповідь обірветься на півслові й пропаде
- timerSeconds лише там, де реально треба чекати; інакше не додавай поле
- комора — це довідка, а не обмеження. Страва має лишитись тією, про яку домовились: не міняй її суть, головний інгредієнт і назву
- інгредієнти, названі в завданні, вписуй ОБОВ'ЯЗКОВО, навіть якщо їх немає в коморі — через "n", роль critical. Не підміняй їх тим, що є під рукою
- заміна допустима лише для другорядного, і тоді в "nt" напиши, що саме замінено
- жодного тексту поза JSON${cuisineFrame(cuisine)}`;

/* ============================================================
   UI ПРИМІТИВИ
   ============================================================ */
const Chip = ({ children, tone = "neutral" }) => {
  const tones = {
    neutral: "border-stone-300 text-stone-500",
    warn: "border-amber-400 text-amber-700",
    hot: "border-red-300 text-red-600",
    good: "border-emerald-300 text-emerald-700",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tones[tone]}`}>{children}</span>;
};

/* ============================================================
   КАРТКИ ЧАТУ
   ============================================================ */
function IntakeDiffCard({ ops, onApply, applied, shotId, onRefine, onUndo }) {
  const [checked, setChecked] = useState(() => ops.map((o) => (o.confidence ?? 1) >= 0.7));
  if (applied)
    return (
      <div className="mt-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 flex items-center gap-3">
        <div className="text-[11px] text-emerald-700 flex-1">Записано в комору · {applied} позицій</div>
        {onUndo && (
          <button onClick={onUndo} className="text-[11px] text-stone-500">
            скасувати
          </button>
        )}
      </div>
    );
  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">Зміни комори</div>
      {ops.map((o, i) => {
        const low = (o.confidence ?? 1) < 0.7;
        return (
          <button
            key={i}
            onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
            className="w-full flex items-start gap-3 py-2 text-left border-b border-stone-300 last:border-0"
          >
            <span
              className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                checked[i] ? "bg-amber-500 border-amber-500 text-white" : "border-stone-400 text-transparent"
              }`}
            >
              ✓
            </span>
            <span className="flex-1">
              <span className="text-[13px] text-stone-900">
                {o.op === "deplete" ? "Закінчилось: " : o.op === "open" ? "Відкрито: " : ""}
                {o.label}
              </span>
              {o.value != null && <span className="text-[13px] text-stone-600"> · {fmtQ(o.value, o.unit)}</span>}
              {low && (
                <span className="block mt-1">
                  <Chip tone="warn">домислено · {Math.round((o.confidence ?? 0) * 100)}%</Chip>
                </span>
              )}
            </span>
          </button>
        );
      })}
      <button
        onClick={() => onApply(ops.filter((_, i) => checked[i]))}
        className="mt-3 w-full py-2.5 rounded-full bg-stone-900 text-white text-[13px] font-medium"
      >
        Записати {checked.filter(Boolean).length}
      </button>
      {onRefine && (
        <button
          onClick={() => onRefine({ title: "Знімок", shotId })}
          className="mt-2 w-full py-2 rounded-full border border-stone-300 text-[12px] text-stone-600"
        >
          розібрати ще раз з уточненням
        </button>
      )}
    </div>
  );
}

function SessionsCard({ items, intents, via, pantry, onOpen, onAsk }) {
  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
      {intents && intents.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">Ти це задумував</div>
          {intents.map((it, i) => {
            const missing = (it.ings || []).filter((n) => !resolveIng({ src: "external", name: n }, pantry));
            return (
              <div key={i} className="py-2 border-b border-stone-200 last:border-0">
                <div className="text-[14px] text-stone-900 leading-snug">{it.title}</div>
                <div className="text-[11px] text-stone-400 mt-0.5">
                  {relDays(it.at)}
                  {it.times > 1 ? ` · заходило ${it.times}×` : ""}
                </div>
                {it.ings && it.ings.length > 0 && (
                  <div className="text-[11px] text-stone-500 mt-1">
                    {missing.length === 0 ? (
                      <span className="text-emerald-700">зараз є все потрібне</span>
                    ) : (
                      <>бракує: {missing.join(", ")}</>
                    )}
                  </div>
                )}
                <button
                  onClick={() => onAsk(it.title)}
                  className="mt-2 text-[11px] px-3 py-1 rounded-full bg-stone-900 text-white"
                >
                  повернутись до цього
                </button>
              </div>
            );
          })}
        </>
      )}

      {items && items.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mt-3 mb-2">
            Розмови {via ? `· ${via}` : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {items.map((sess) => (
              <button
                key={sess.id}
                onClick={() => onOpen(sess.id)}
                className="text-[11px] px-2.5 py-1 rounded-full border border-stone-300 text-stone-600 max-w-full truncate"
              >
                {sess.title} · {relDays(sess.at)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CookDoneCard({ onPhoto, busy }) {
  const ref = useRef(null);
  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (f) onPhoto(f);
        }}
      />
      <button
        onClick={() => ref.current && ref.current.click()}
        disabled={busy}
        className="w-full py-2.5 rounded-full border border-stone-300 text-[13px] text-stone-700 disabled:opacity-40"
      >
        {busy ? "готую…" : "Показати, що вийшло"}
      </button>
      <div className="text-[11px] text-stone-400 mt-2 text-center leading-relaxed">
        Або просто напиши, як вийшло — запамʼятаю на наступний раз
      </div>
    </div>
  );
}

function ShareCard({ post, onCopy, copied }) {
  const { recipe, photo, stats, verdict } = post;
  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white overflow-hidden">
      <div className="relative bg-stone-900">
        {photo ? (
          <img src={photo} alt="Страва" className="w-full block" />
        ) : (
          <div className="w-full h-40 flex items-center justify-center text-[13px] text-stone-400">
            без фото
          </div>
        )}

        <div className="absolute left-0 right-0 bottom-0 p-3">
          <div className="text-[15px] text-white leading-snug">{recipe.title}</div>
          <div className="text-[11px] text-white/70 mt-1">
            {stats.fromPantry} з {stats.total} — з того, що було вдома
            {stats.rescued > 0 ? ` · врятовано ${stats.rescued}` : ""}
          </div>
        </div>

        <div className="absolute top-2 right-2 text-[10px] uppercase tracking-widest text-white/60">
          кухня
        </div>
      </div>

      <div className="p-3">
        <div className="text-[12px] text-stone-600 leading-relaxed">
          {recipe.ings.map((ri) => ingName(ri)).slice(0, 6).join(" · ")}
        </div>
        {verdict ? (
          <div className="text-[12px] text-stone-500 mt-2 leading-relaxed">«{verdict}»</div>
        ) : null}
        {stats.streak > 1 && (
          <div className="text-[11px] text-amber-700 mt-2">
            {stats.streak} день поспіль вдома
          </div>
        )}
        <button
          onClick={onCopy}
          className="mt-3 w-full py-2 rounded-full border border-stone-300 text-[12px] text-stone-600"
        >
          {copied ? "скопійовано" : "скопіювати підпис"}
        </button>
        <div className="text-[10px] text-stone-400 mt-2 leading-relaxed">
          У застосунку тут системний share sheet і зображення з оверлеєм. Тут — текст для вставки.
        </div>
      </div>
    </div>
  );
}

function CartCard({ rows, onOpen }) {
  const found = rows.filter((r) => r.product && r.product.stock);
  const out = rows.filter((r) => r.product && !r.product.stock);
  const miss = rows.filter((r) => !r.product);
  const sum = found.reduce((a, r) => a + r.product.price, 0);

  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-widest text-stone-500 flex-1">
          Кошик · {RETAIL.name}
        </div>
        <div className="text-[11px] text-stone-400">{found.length} з {rows.length}</div>
      </div>

      {found.map((r, i) => (
        <div key={i} className="flex items-baseline gap-2 py-1.5 border-b border-stone-200 last:border-0">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-stone-900 truncate">{r.product.name}</div>
            <div className="text-[11px] text-stone-400">
              {r.product.unit} · зі списку: {r.label}
            </div>
          </div>
          <span className="text-[13px] text-stone-700 shrink-0">{r.product.price} ₴</span>
        </div>
      ))}

      {out.map((r, i) => (
        <div key={`o${i}`} className="py-1.5 border-b border-stone-200 last:border-0">
          <div className="text-[13px] text-stone-500">
            {r.product.name} — <span className="text-amber-700">немає в наявності</span>
          </div>
          {r.alternatives.length > 0 && (
            <div className="text-[11px] text-stone-500 mt-0.5">
              заміна: {r.alternatives.map((a) => `${a.name} · ${a.price} ₴`).join(" або ")}
            </div>
          )}
        </div>
      ))}

      {miss.length > 0 && (
        <div className="mt-2 text-[11px] text-stone-500">
          Не знайшлось у каталозі: {miss.map((r) => r.label).join(", ")}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <div className="text-[13px] text-stone-900 flex-1">≈{sum} ₴</div>
        <button
          onClick={onOpen}
          className="px-4 py-2 rounded-full bg-stone-900 text-white text-[12px] font-medium"
        >
          Відкрити оформлення
        </button>
      </div>
      <div className="text-[10px] text-stone-400 mt-2 leading-relaxed">
        Демонстрація контракту: у продукті це виклики MCP-сервера мережі, тут — локальні дані.
      </div>
    </div>
  );
}

function CookLogCard({ items, via, onOpen, onCook }) {
  if (!items.length)
    return (
      <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
        <div className="text-[13px] text-stone-600">У журналі такого не знайшлось.</div>
      </div>
    );
  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-widest text-stone-500 flex-1">Готував раніше</div>
        {via && <div className="text-[10px] text-stone-400">{via}</div>}
      </div>
      {items.map((it) => (
        <div key={it.id || it.at} className="py-2 border-b border-stone-200 last:border-0">
          <div className="flex items-baseline gap-2">
            <div className="text-[14px] text-stone-900 flex-1 leading-snug">{it.title}</div>
            {it.rating && <span className="text-[11px] text-amber-700">{it.rating}/5</span>}
            <span className="text-[11px] text-stone-400">{relDays(it.at)}</span>
          </div>
          {it.verdict && (
            <div className="text-[12px] text-stone-500 mt-0.5 leading-relaxed">«{it.verdict}»</div>
          )}
          {it.ings && it.ings.length > 0 && (
            <div className="text-[11px] text-stone-400 mt-0.5">{it.ings.slice(0, 6).join(", ")}</div>
          )}
          {it.recipe && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onOpen(it.recipe)}
                className="text-[11px] px-3 py-1 rounded-full border border-stone-300 text-stone-600"
              >
                показати рецепт
              </button>
              <button
                onClick={() => onCook(it.recipe, it.servings || it.recipe.base)}
                className="text-[11px] px-3 py-1 rounded-full bg-stone-900 text-white"
              >
                приготувати знову
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ShoppingCard({ ids, dup, shopping, pantry, onRemove, onQty, onOpen, onCopy }) {
  const items = ids.map((id) => shopping.find((x) => x.id === id)).filter(Boolean);
  const gone = ids.length - items.length;

  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-widest text-stone-500">Список покупок</div>
        <div className="ml-auto text-[10px] text-stone-400">
          {items.length} {items.length === 1 ? "позиція" : "позицій"}
        </div>
      </div>

      {items.map((it) => {
        const have = resolveIng({ ing: it.ing, name: it.label }, pantry);
        const u = have ? urgency(have) : null;
        return (
          <div key={it.id} className="flex items-start gap-2 py-2 border-b border-stone-200 last:border-0">
            <div className="flex-1 min-w-0">
              <div className={`text-[13px] ${it.checked ? "text-stone-400 line-through" : "text-stone-900"}`}>
                {it.label}
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {it.reason}
                {have && (
                  <span className="text-amber-700">
                    {" · "}вже є: {fmtQ(have.value, have.unit)}
                    {u && u.why ? `, ${u.why}` : ""}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onQty(it.id, -1)}
                className="w-6 h-6 rounded-full border border-stone-300 text-stone-500 leading-none"
              >
                −
              </button>
              <span className="text-[12px] text-stone-700 w-12 text-center tabular-nums">
                {it.value != null ? fmtQ(it.value, it.unit || "pcs") : "1 шт"}
              </span>
              <button
                onClick={() => onQty(it.id, 1)}
                className="w-6 h-6 rounded-full border border-stone-300 text-stone-500 leading-none"
              >
                +
              </button>
              <button onClick={() => onRemove(it.id)} className="text-stone-400 text-lg leading-none px-1">
                ×
              </button>
            </div>
          </div>
        );
      })}

      {dup && dup.length > 0 && (
        <div className="mt-2 text-[11px] text-stone-500">
          Вже було в списку: {dup.join(", ")} — не дублював.
        </div>
      )}
      {gone > 0 && (
        <div className="mt-2 text-[11px] text-stone-500">
          {gone} позицій уже прибрано зі списку.
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={onOpen}
          className="flex-1 py-2 rounded-full bg-stone-900 text-white text-[12px] font-medium"
        >
          Відкрити список
        </button>
        <button onClick={onCopy} className="px-4 py-2 rounded-full border border-stone-300 text-[12px] text-stone-700">
          скопіювати
        </button>
      </div>
    </div>
  );
}

function ProposalCard({ items, onPick, onBuild, building, pantry = [], shopping = [], onRefine }) {
  return (
    <div className="mt-2 space-y-2">
      {items.map((it, i) => {
        const r = it.recipeId ? RECIPES.find((x) => x.id === it.recipeId) : null;
        const title = r ? r.title : it.title;
        const character = r ? r.character : it.character;
        const desc = r ? r.risk : it.desc || it.pitch;
        const why = it.why;

        const needs = (it.needs || [])
          .map((x) => (typeof x === "string" ? x : x && x.label))
          .filter(Boolean);
        const rescueCount = r
          ? matchRecipe(r, pantry, r.base).rescues.length
          : (it.rescues || []).length;

        const state = needs.length
          ? `бракує ${needs.length}: ${needs.slice(0, 2).join(", ")}`
          : rescueCount
          ? `усе є · рятує ${rescueCount}`
          : "усе є";

        return (
          <div key={i} className="rounded-2xl border border-stone-300 bg-white p-4">
            <div className="text-[15px] text-stone-900 leading-snug">{title}</div>
            {desc && <div className="text-[13px] text-stone-700 mt-1.5 leading-relaxed">{desc}</div>}
            {why && <div className="text-[12px] text-stone-500 mt-1 leading-relaxed">{why}</div>}

            <div className="flex items-baseline gap-2 mt-2 text-[11px]">
              {character && <span className="text-amber-700">{character}</span>}
              <span className={needs.length ? "text-stone-500" : "text-emerald-700"}>{state}</span>
            </div>

            <div className="flex gap-2 mt-3">
              <button
                disabled={building === title}
                onClick={() => (r ? onPick(r) : onBuild(it))}
                className="flex-1 py-2.5 rounded-full bg-stone-900 text-white text-[13px] font-medium disabled:opacity-40"
              >
                {building === title ? "збираю…" : r ? "Показати рецепт" : "Взяти в роботу"}
              </button>
              <button
                onClick={() => onRefine && onRefine({ title, sourceItem: it })}
                className="px-4 py-2.5 rounded-full border border-stone-300 text-[12px] text-stone-600"
              >
                уточнити
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecipeCard({
  recipe,
  pantry,
  shopping = [],
  profile = {},
  audience = [],
  note,
  onCook,
  onStock,
  onStockOne,
  onSave,
  onRefine,
  isSaved,
}) {
  const [servings, setServings] = useState(recipe.base);
  const m = matchRecipe(recipe, pantry, servings);
  const flags = recipe.ings.map((ri) => flagIngredient(ri, profile, audience)).filter(Boolean);
  const allerg = flags.filter((f) => f.kind === "allergen");
  const rest = m.missing.filter(
    (ri) => !shopping.some((x) => x.label.toLowerCase().trim() === ingName(ri).toLowerCase().trim())
  );

  return (
    <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-4">
      {note && (
        <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">{note}</div>
      )}

      <div className="text-[16px] text-stone-900 leading-snug">{recipe.title}</div>
      <div className="text-[11px] text-stone-500 mt-1">
        {recipe.ings.length} інгредієнтів
        {recipe.timeTotal ? ` · ${recipe.timeTotal} хв` : ""}
      </div>
      {recipe.nutrition && recipe.nutrition.kcal ? (
        <div className="text-[11px] text-stone-400 mt-0.5">
          ≈{Math.round(recipe.nutrition.kcal)} ккал на порцію · Б {Math.round(recipe.nutrition.p || 0)} · Ж{" "}
          {Math.round(recipe.nutrition.f || 0)} · В {Math.round(recipe.nutrition.c || 0)}
        </div>
      ) : null}

      {recipe.desc && (
        <div className="text-[13px] text-stone-700 mt-2 leading-relaxed">{recipe.desc}</div>
      )}

      {allerg.length > 0 && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-2.5 text-[12px] text-red-700 leading-relaxed">
          {[...new Set(allerg.map((f) => `${f.label}${f.who ? ` — алергія ${f.who}` : ""}`))].join("; ")}
          {allerg.some((f) => !f.who) ? " — це у твоєму списку алергенів." : "."}
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <span className="text-[10px] uppercase tracking-widest text-stone-500">Інгредієнти</span>
        <div className="flex items-center gap-3 border border-stone-300 rounded-full px-3 py-1">
          <button onClick={() => setServings((v) => Math.max(1, v - 1))} className="text-stone-500 leading-none">−</button>
          <span className="text-[12px] w-8 text-center">{servings} порц.</span>
          <button onClick={() => setServings((v) => Math.min(8, v + 1))} className="text-stone-500 leading-none">+</button>
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {recipe.ings.map((ri, i) => {
          const have = resolveIng(ri, pantry);
          const inList = shopping.some(
            (x) => x.label.toLowerCase().trim() === ingName(ri).toLowerCase().trim()
          );
          const flag = flagIngredient(ri, profile, audience);
          return (
            <div key={i} className="flex items-baseline flex-wrap gap-x-2 gap-y-1 text-[13px]">
              <span className={have ? "text-stone-800" : "text-stone-500"}>
                {fmtQ(scale(ri.v, ri.u, servings, recipe.base), ri.u)} {ingName(ri)}
              </span>
              {ri.note && <span className="text-[11px] text-stone-500">{ri.note}</span>}
              {flag && flag.kind === "allergen" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 whitespace-nowrap">
                  алерген{flag.who ? ` · ${flag.who}` : ""}
                </span>
              )}
              {flag && flag.kind === "exclude" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-400 text-amber-700 whitespace-nowrap">
                  не їси{flag.who ? ` · ${flag.who}` : ""}
                </span>
              )}
              {flag && flag.kind === "avoid" && (
                <span className="text-[10px] text-stone-400 whitespace-nowrap">не любиш</span>
              )}
              {!have &&
                (inList ? (
                  <span className="text-[11px] text-emerald-700 whitespace-nowrap">у списку</span>
                ) : (
                  <button
                    onClick={() => onStockOne && onStockOne(ri, recipe)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${
                      ri.role === "critical" ? "border-red-300 text-red-600" : "border-stone-300 text-stone-500"
                    }`}
                  >
                    нема · купити
                  </button>
                ))}
            </div>
          );
        })}
      </div>

      {rest.length > 0 && onStock && (
        <button
          onClick={() => onStock(recipe)}
          className="mt-3 w-full py-2 rounded-full border border-stone-300 text-[12px] text-stone-600"
        >
          Докласти всі {rest.length} у список
        </button>
      )}

      {recipe.risk && recipe.risk !== "немає" && (
        <div className="mt-3 rounded-xl bg-stone-100 p-3">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">Примітка</div>
          <div className="text-[12px] text-stone-600 leading-relaxed">{recipe.risk}</div>
        </div>
      )}

      {recipe.options?.length > 0 && onRefine && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {recipe.options.map((o, i) => (
            <button
              key={i}
              onClick={() => onRefine({ title: recipe.title, sourceItem: recipe.sourceItem, recipe }, o)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-stone-300 text-stone-600 text-left"
            >
              {o}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => onCook(recipe, servings)}
        className="mt-4 w-full py-3.5 rounded-full bg-stone-900 text-white text-[15px] font-medium"
      >
        Почати готувати
      </button>

      <div className="flex justify-center gap-6 mt-2.5 text-[12px] text-stone-500">
        {onSave && !isSaved && <button onClick={() => onSave(recipe)}>зберегти</button>}
        {isSaved && <span className="text-emerald-700">в обраному</span>}
        {onRefine && (
          <button onClick={() => onRefine({ title: recipe.title, sourceItem: recipe.sourceItem, recipe })}>
            уточнити
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   COOK MODE
   ============================================================ */
function CookMode({ recipe, servings, step0 = 0, onClose, onMinimize, onStep, onFinish }) {
  const [i, setI] = useState(step0);
  const [phase, setPhase] = useState("steps"); // steps | settle
  useEffect(() => {
    if (onStep) onStep(i);
  }, [i]);
  const step = recipe.steps[i];

  const render = (content) => renderStep(content, recipe, servings);

  /* таймер */
  const [left, setLeft] = useState(step?.timer ?? 0);
  const [run, setRun] = useState(false);
  useEffect(() => {
    setLeft(recipe.steps[i]?.timer ?? 0);
    setRun(false);
  }, [i, recipe.id]);
  useEffect(() => {
    if (!run || left <= 0) return;
    const t = setInterval(() => setLeft((v) => (v <= 1 ? (setRun(false), 0) : v - 1)), 1000);
    return () => clearInterval(t);
  }, [run, left]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  if (phase === "settle")
    return <Settlement recipe={recipe} servings={servings} onDone={(ops) => onFinish(ops, null)} />;

  return (
    <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-4">
        <div className="text-[13px] text-stone-700 flex-1 truncate">{recipe.title}</div>
        {onMinimize && (
          <button onClick={onMinimize} className="text-stone-500 text-[12px] px-2">
            згорнути
          </button>
        )}
        <button onClick={onClose} className="text-stone-400 text-xl leading-none px-2">×</button>
      </div>
      <div className="flex gap-1 px-4 mt-3">
        {recipe.steps.map((_, j) => (
          <div key={j} className={`h-0.5 flex-1 rounded-full ${j <= i ? "bg-stone-900" : "bg-stone-200"}`} />
        ))}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-7 text-center">
        <h2 className="font-serif text-4xl text-stone-900 leading-tight">{step.title}</h2>
        <p className="mt-6 text-[15px] text-stone-700 leading-relaxed">{render(step.content)}</p>

        {step.timer && (
          <>
            <div className="mt-10 font-serif text-6xl text-stone-900 tabular-nums">
              {left > 0 || run ? `${mm}:${ss}` : "готово"}
            </div>
            <button
              onClick={() => setRun((r) => !r)}
              className="mt-8 w-16 h-16 rounded-full bg-stone-900 text-white flex items-center justify-center text-2xl"
            >
              {run ? "❚❚" : "▶"}
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-6 pb-8">
        <button
          onClick={() => setI((v) => Math.max(0, v - 1))}
          disabled={i === 0}
          className="w-11 h-11 rounded-full border border-stone-300 text-stone-600 disabled:opacity-20"
        >
          ‹
        </button>
        <span className="text-[12px] text-stone-500">{i + 1} of {recipe.steps.length}</span>
        {i < recipe.steps.length - 1 ? (
          <button onClick={() => setI((v) => v + 1)} className="w-11 h-11 rounded-full border border-stone-300 text-stone-700">
            ›
          </button>
        ) : (
          <button
            onClick={() => setPhase("settle")}
            className="px-5 h-11 rounded-full bg-stone-900 text-white text-[13px] font-medium"
          >
            Готово
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- SETTLEMENT: замикання циклу ---------- */
function Settlement({ recipe, servings, onDone }) {
  const ops = useMemo(
    () =>
      recipe.ings.map((ri) => ({
        ri,
        label: ingName(ri),
        value: scale(ri.v, ri.u, servings, recipe.base),
        unit: ri.u,
        vague: ["tsp", "tbsp", "pinch", "taste"].includes(ri.u),
      })),
    [recipe, servings]
  );
  const [checked, setChecked] = useState(() => ops.map((o) => !o.vague));

  return (
    <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col">
      <div className="px-6 pt-14">
        <div className="text-[10px] uppercase tracking-widest text-amber-600">Списання</div>
        <h2 className="font-serif text-3xl text-stone-900 mt-2 leading-tight">Що пішло з комори</h2>
        <p className="text-[12px] text-stone-500 mt-2 leading-relaxed">
          Приблизно — і це нормально. Зніми позначку з того, чого насправді не витратив.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 mt-5">
        {ops.map((o, i) => (
          <button
            key={i}
            onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
            className="w-full flex items-center gap-3 py-3 border-b border-stone-200 text-left"
          >
            <span
              className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                checked[i] ? "bg-amber-500 border-amber-500 text-white" : "border-stone-300 text-transparent"
              }`}
            >
              ✓
            </span>
            <span className="flex-1 text-[14px] text-stone-800">{o.label}</span>
            <span className="text-[13px] text-stone-500">{fmtQ(o.value, o.unit)}</span>
            {o.vague && <Chip>на око</Chip>}
          </button>
        ))}
      </div>
      <div className="p-6">
        <button
          onClick={() => onDone(ops.filter((_, i) => checked[i]))}
          className="w-full py-3.5 rounded-full bg-stone-900 text-white text-[15px] font-medium"
        >
          Списати
        </button>
      </div>
    </div>
  );
}

/* ---------- VERDICT: пам'ять ---------- */
/* ============================================================
   ЕКРАНИ
   ============================================================ */
function ChatView({ messages, onSend, busy, mode, err, pantry, shopping, profile = {}, audience = [], onAudience, household = [], shop, onPhotos, onDishPhoto, scanning, onUndo, onRegisterFix, onOpenSession, onApply, onApplyProfile, onPick, onBuild, building, importing, onConfirmDraft, onCook, onStock, onStockOne, onSave, onRefine, onRefineTarget, saved = [], cuisine, onCuisine, onNeed, onCopyLog }) {
  const [input, setInput] = useState("");
  /* Уточнення не відкриває власне поле: воно підставляє префікс у головне
     і тримає машинну прив'язку доти, доки цей префікс лишається в тексті.
     Стер префікс — прив'язка знята, як зі скасованою цитатою. */
  const [bind, setBind] = useState(null);
  const [voiceNote, setVoiceNote] = useState(null);
  const [queue, setQueue] = useState([]);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  /* Знімок спершу стає вкладенням біля поля, а не одразу йде в модель:
     так можна докласти ще один і написати, що саме на них. */
  async function addToQueue(file) {
    if (!file) return;
    const isImg = (file.type || "").startsWith("image/");
    let thumb = null;
    if (isImg) {
      try {
        const t = await shrinkImage(file, 200);
        thumb = `data:${t.media};base64,${t.data}`;
      } catch (e) {}
    }
    setQueue((q) => [
      ...q,
      { id: `q${Date.now()}${q.length}`, file, thumb, name: file.name || "файл" },
    ]);
    if (inputRef.current && inputRef.current.focus) inputRef.current.focus();
  }

  /* Зображення можна вставити з буфера (Ctrl+V у полі або будь-де в чаті)
     і перетягнути у вікно. Обидва шляхи ведуть у той самий розбір. */
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    function onPaste(e) {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            addToQueue(f);
            return;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f =
      (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) ||
      (e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items[0] && e.dataTransfer.items[0].getAsFile());
    if (f) addToQueue(f);
  }

  /* Голос зафіксований як точка входу, але в пісочниці не працює:
     iframe не дає мікрофона, а транскрипція потребує окремого сервісу. */
  function tryVoice() {
    const ok =
      typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    setVoiceNote(
      ok
        ? "Мікрофон є, але транскрипції тут немає — у застосунку сюди стане запис і розпізнавання мовлення."
        : "Мікрофон недоступний усередині пісочниці. У застосунку це найзручніший спосіб наповнювати комору: кажеш, поки розкладаєш пакети."
    );
    setTimeout(() => setVoiceNote(null), 7000);
  }
  const endRef = useRef(null);

  useEffect(() => {
    if (onRegisterFix) onRegisterFix((p) => startRefine({ title: p.label, fixItem: p }, ""));
  }, [onRegisterFix]);

  function startRefine(target, preset) {
    const prefix = `${target.title} — `;
    setBind({ ...target, prefix });
    setInput(prefix + (preset || ""));
    if (inputRef.current && inputRef.current.focus) inputRef.current.focus();
  }

  function submit() {
    const text = input.trim();

    if (queue.length) {
      const files = queue.map((q) => q.file);
      setQueue([]);
      setInput("");
      setBind(null);
      if (onPhotos) onPhotos(files, text || null);
      return;
    }

    if (!text) return;
    const linked = bind && input.startsWith(bind.prefix);
    if (linked) {
      const note = text.slice(bind.prefix.length).trim();
      if (note) {
        onRefineTarget(bind, note);
        setInput("");
        setBind(null);
        return;
      }
    }
    onSend(text);
    setInput("");
    setBind(null);
  }
  useEffect(() => {
    if (endRef.current && endRef.current.scrollIntoView) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, busy]);

  const quick = [
    { l: "Що сьогодні приготувати?", v: "Що сьогодні приготувати?" },
    { l: "🧾 Чек", v: "Ось чек із магазину: купив фарш яловичий 500 г, моцарелу і пачку вершків" },
    { l: "Що з'їсти першим?", v: "Що варто з'їсти найближчим часом?" },
    {
      l: "+ рецепт",
      v: "Рецепт: Шакшука\n4 яйця, 400 г томатів пелаті, 1 цибуля, 2 зубчики часнику, 1 ч.л. паприки, 1 ч.л. кумину, оливкова олія\nЦибулю обсмажити до м'якості, додати часник і спеції, прогріти. Влити томати, розім'яти, тушкувати 15 хвилин до густоти. Зробити заглибини, вбити яйця, накрити і тримати до схоплення білка.",
    },
  ];

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-2 z-10 rounded-2xl border-2 border-dashed border-stone-400 bg-stone-50/90 flex items-center justify-center pointer-events-none">
          <span className="text-[14px] text-stone-600">Кинь сюди фото, PDF або текстовий файл</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m) => (
          <div key={m.id}>
            {m.role === "user" ? (
              <div className="flex justify-end">
                {m.files && m.files.length ? (
                  <div className="max-w-[75%] flex flex-col items-end gap-1.5">
                    {m.files.map((n, i) => (
                      <div
                        key={i}
                        className={`bg-stone-100 border border-stone-300 rounded-xl px-3 py-2 text-[12px] text-stone-700 ${
                          m.pending ? "opacity-60" : ""
                        }`}
                      >
                        📄 {n}
                      </div>
                    ))}
                    {m.images && m.images.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        {m.images.map((src, i) => (
                          <img key={i} src={src} alt="Вкладення" className="rounded-xl border border-stone-200" style={{ width: 108 }} />
                        ))}
                      </div>
                    )}
                    {m.text ? (
                      <div className="bg-stone-200 rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] text-stone-900">
                        {m.text}
                      </div>
                    ) : null}
                  </div>
                ) : m.images && m.images.length ? (
                  <div className="max-w-[75%]">
                    <div className={`flex gap-1.5 flex-wrap justify-end ${m.pending ? "opacity-60" : ""}`}>
                      {m.images.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt="Надісланий знімок"
                          className="rounded-xl border border-stone-200"
                          style={{ width: m.images.length > 1 ? 108 : 200 }}
                        />
                      ))}
                    </div>
                    {m.text ? (
                      <div className="mt-1.5 bg-stone-200 rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] text-stone-900">
                        {m.text}
                      </div>
                    ) : null}
                  </div>
                ) : m.pending ? (
                  <div className="w-40 h-28 rounded-2xl rounded-br-md bg-stone-200 flex items-center justify-center text-[12px] text-stone-500">
                    завантажую…
                  </div>
                ) : (
                  <div className="max-w-[85%] bg-stone-200 rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] text-stone-900">
                    {m.text}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="text-[15px] text-stone-800 leading-relaxed whitespace-pre-wrap">{m.text}</div>
                {m.card?.type === "intake_diff" && (
                  <IntakeDiffCard
                    ops={m.card.ops}
                    applied={m.applied}
                    shotId={m.card.shotId}
                    onRefine={m.card.shotId ? startRefine : null}
                    onUndo={m.applied && !m.undone ? onUndo : null}
                    onApply={(ops) => onApply(m.id, ops)}
                  />
                )}
                {m.card?.type === "sessions" && (
                  <SessionsCard
                    items={m.card.items}
                    intents={m.card.intents}
                    via={m.card.via}
                    pantry={pantry}
                    onOpen={onOpenSession}
                    onAsk={(title) => onSend(`Давай повернемось до цього: ${title}. Дай рецепт.`)}
                  />
                )}
                {m.card?.type === "cook_done" && <CookDoneCard onPhoto={onDishPhoto} busy={scanning} />}
                {m.card?.type === "share" && (
                  <ShareCard
                    post={m.card.post}
                    copied={m.copied}
                    onCopy={() => onCopyShare(m.id, m.card.post)}
                  />
                )}
                {m.card?.type === "cart" && (
                  <CartCard
                    rows={m.card.rows}
                    onOpen={() =>
                      onSend(
                        "Оформлення в пісочниці недоступне — потрібен OAuth і серверне зберігання токена."
                      )
                    }
                  />
                )}
                {m.card?.type === "cook_log" && (
                  <CookLogCard
                    items={m.card.items}
                    via={m.card.via}
                    onOpen={onPick}
                    onCook={onCook}
                  />
                )}
                {m.card?.type === "profile" && (
                  <div className="mt-2 rounded-2xl border border-stone-300 bg-white p-3">
                    <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">
                      {(m.card.ops || []).some((o) => o.kind === "member")
                        ? "Запам'ятати про твій дім"
                        : "Запам'ятати про твою кухню"}
                    </div>
                    {(m.card.ops || []).map((o, i) => {
                      const rm = o.op === "remove";
                      const what =
                        o.kind === "member"
                          ? `${o.label}${o.diet ? ` · ${o.diet}` : ""}`
                          : o.kind === "equip"
                          ? `${o.has === false ? "немає" : "є"}: ${o.label}`
                          : o.kind === "allergy"
                          ? `алергія: ${o.label}`
                          : o.kind === "note"
                          ? `запамʼятати: ${o.label}`
                          : o.kind === "wish"
                          ? `побажання: ${o.label}`
                          : `антипатерн: ${o.label}`;
                      return (
                        <div key={i} className="text-[13px] text-stone-800 py-1">
                          {rm ? <span className="text-stone-400">прибрати — </span> : null}
                          {what}
                        </div>
                      );
                    })}
                    {m.applied ? (
                      <div className="text-[11px] text-emerald-700 mt-2">Записав</div>
                    ) : (
                      <button
                        onClick={() => onApplyProfile(m.id, m.card.ops || [])}
                        className="mt-2 w-full py-2 rounded-full bg-stone-900 text-white text-[12px] font-medium"
                      >
                        Запам'ятати
                      </button>
                    )}
                  </div>
                )}
                {m.card?.type === "recipe_draft" && (
                  <RecipeCard
                    recipe={m.card.draft}
                    note="Як я це зрозумів"
                    pantry={pantry}
                    shopping={shopping}
                    profile={profile}
                    audience={audience}
                    audience={audience}
                    onCook={onCook}
                    onStock={onStock}
                    onStockOne={onStockOne}
                    onSave={() => onConfirmDraft(m.id, m.card.draft)}
                    onRefine={startRefine}
                  />
                )}
                {m.card?.type === "shopping" && (
                  <ShoppingCard
                    ids={m.card.ids || []}
                    dup={m.card.dup}
                    shopping={shopping}
                    pantry={pantry}
                    onRemove={shop.remove}
                    onQty={shop.qty}
                    onOpen={shop.open}
                    onCopy={shop.copy}
                  />
                )}
                {m.card?.type === "proposal" && (
                  <ProposalCard
                    items={m.card.items}
                    onPick={onPick}
                    onBuild={onBuild}
                    building={building}
                    pantry={pantry}
                    shopping={shopping}
                    onRefine={startRefine}
                  />
                )}
                {m.card?.type === "recipe" && (
                  <RecipeCard
                    recipe={m.card.recipe || RECIPES.find((r) => r.id === m.card.recipeId)}
                    pantry={pantry}
                    shopping={shopping}
                    profile={profile}
                    onCook={onCook}
                    onStock={onStock}
                    onStockOne={onStockOne}
                    onSave={onSave}
                    onRefine={startRefine}
                    isSaved={saved.some(
                      (x) => x.title === (m.card.recipe || RECIPES.find((r) => r.id === m.card.recipeId) || {}).title
                    )}
                  />
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-[14px] text-stone-400">думає…</div>}
        <div ref={endRef} />
      </div>

      <div className="px-3 pb-2 flex gap-2 overflow-x-auto items-center">
        <span className="text-[10px] text-stone-400 shrink-0">для кого</span>
        <button
          onClick={() => onAudience([])}
          className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full border ${
            !audience.length ? "border-stone-900 text-stone-900" : "border-stone-300 text-stone-500"
          }`}
        >
          тільки я
        </button>
        {(household || []).filter((h) => !h.owner).map((h) => (
          <button
            key={h.id}
            onClick={() =>
              onAudience(audience.includes(h.id) ? audience.filter((x) => x !== h.id) : [...audience, h.id])
            }
            className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full border ${
              audience.includes(h.id) ? "border-stone-900 text-stone-900" : "border-stone-300 text-stone-500"
            }`}
          >
            + {h.name}
          </button>
        ))}
      </div>

      <div className="px-3 pb-2 flex gap-2 overflow-x-auto items-center">
        <span className="text-[10px] text-stone-400 shrink-0">кухня</span>
        {CUISINES.map((c) => (
          <button
            key={c.id}
            onClick={() => onCuisine(c.id)}
            className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full border ${
              cuisine === c.id ? "border-stone-900 text-stone-900" : "border-stone-300 text-stone-500"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-2 flex gap-2 overflow-x-auto">
        {quick.map((q, i) => (
          <button
            key={i}
            onClick={() => onSend(q.v)}
            className="shrink-0 text-[12px] px-3 py-1.5 rounded-full border border-stone-300 text-stone-600"
          >
            {q.l}
          </button>
        ))}
      </div>

      {queue.length > 0 && (
        <div className="px-3 pb-2 flex gap-2 overflow-x-auto items-center">
          {queue.map((q) => (
            <div key={q.id} className="relative shrink-0">
              {q.thumb ? (
                <img
                  src={q.thumb}
                  alt="Вкладення"
                  className="w-16 h-16 object-cover rounded-xl border border-stone-300"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl border border-stone-300 bg-stone-50 flex flex-col items-center justify-center px-1">
                  <span className="text-[16px] text-stone-400">📄</span>
                  <span className="text-[9px] text-stone-500 truncate w-full text-center">{q.name}</span>
                </div>
              )}
              <button
                onClick={() => setQueue((list) => list.filter((x) => x.id !== q.id))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-900 text-white text-[11px] leading-none"
                aria-label="Прибрати"
              >
                ×
              </button>
            </div>
          ))}
          <span className="text-[11px] text-stone-500 shrink-0">
            {queue.length === 1 ? "1 вкладення" : `${queue.length} вкладення`} · опиши, якщо треба
          </span>
        </div>
      )}

      {voiceNote && (
        <div className="mx-3 mb-2 rounded-xl border border-stone-300 bg-white p-2.5 text-[12px] text-stone-600 leading-relaxed">
          {voiceNote}
        </div>
      )}

      {bind && input.startsWith(bind.prefix) && (
        <div className="px-3 pb-1.5 flex items-center gap-2">
          <span className="text-[11px] text-stone-500 truncate">
            {bind.shotId ? "уточнюєш знімок" : `уточнюєш: ${bind.title}`}
          </span>
          <button
            onClick={() => {
              setBind(null);
              setInput("");
            }}
            className="text-[11px] text-stone-400"
          >
            скасувати
          </button>
        </div>
      )}

      <div className="px-3 pb-3 flex items-center gap-2">
        <button
          onClick={() => fileRef.current && fileRef.current.click()}
          disabled={scanning}
          className="w-11 h-11 rounded-full border border-stone-300 text-stone-500 text-[16px] shrink-0 disabled:opacity-40"
          aria-label="Додати фото"
        >
          {scanning ? "…" : "🖼"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,.pdf,.txt,.md,.csv"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const fs = Array.from(e.target.files || []);
            e.target.value = "";
            fs.forEach((f) => addToQueue(f));
          }}
        />
        <button
          onClick={tryVoice}
          className="w-11 h-11 rounded-full border border-stone-300 text-stone-500 text-[15px] shrink-0"
          aria-label="Надиктувати"
        >
          🎙
        </button>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={
            queue.length
              ? "що у вкладеннях? можна не писати"
              : bind && bind.shotId
              ? "що я неправильно побачив?"
              : bind
              ? "що змінити?"
              : scanning
              ? "розбираю знімок…"
              : "Напиши або встав фото…"
          }
          className="flex-1 bg-white border border-stone-300 rounded-full px-4 py-3 text-[14px] text-stone-900 placeholder-stone-400 outline-none"
        />
        <button
          onClick={submit}
          disabled={scanning || (!input.trim() && !queue.length)}
          className="w-11 h-11 rounded-full bg-stone-900 text-white text-lg shrink-0 disabled:opacity-30"
        >
          ↑
        </button>
      </div>
      <div className="text-center text-[10px] text-stone-300 pb-2">
        {mode === "llm" ? "живий режим" : "локальний режим — модель недоступна"}
      </div>
    </div>
  );
}

function PantryView({ pantry, onDeplete, onOpen, onRestore, onPurge, onPullReceipts, onQuickAdd, onFix, onGoChat }) {
  const [zone, setZone] = useState("all");
  const [q, setQ] = useState("");
  const [ai, setAi] = useState(null);
  const [asking, setAsking] = useState(false);

  async function askModel() {
    setAsking(true);
    try {
      const r = await askPantryLLM(q, pantry);
      setAi({ items: r.items, via: r.note || "за змістом запиту" });
    } catch (e) {
      setAi({ items: [], via: `модель не відповіла: ${String(e && e.message).slice(0, 60)}` });
    }
    setAsking(false);
  }
  const live = pantry.filter((p) => p.state !== "depleted");
  const depleted = pantry.filter((p) => p.state === "depleted");
  const sorted = [...live].sort(
    (a, b) => urgency(b).level - urgency(a).level || (a.label > b.label ? 1 : -1)
  );
  const byZone = zone === "all" ? sorted : sorted.filter((p) => p.zone === zone);
  const found = searchPantry(q, byZone);
  const list = ai ? ai.items : found.items;
  const urgent = sorted.filter((p) => urgency(p).level >= 2);

  return (
    <div className="h-full overflow-y-auto">
      {depleted.length > 0 && (
        <div className="mx-4 mt-4 rounded-2xl border border-stone-300 bg-white p-3">
          <div className="flex items-baseline gap-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 flex-1">Закінчилось</div>
            <button onClick={onPurge} className="text-[10px] text-stone-400">прибрати остаточно</button>
          </div>
          <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
            Тиждень лежить тут: у пропозиції не потрапляє, але можна повернути, якщо помилився.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {depleted.map((p) => (
              <button
                key={p.id}
                onClick={() => onRestore(p.id)}
                className="text-[11px] px-2.5 py-1 rounded-full border border-stone-300 text-stone-400 line-through"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {urgent.length > 0 && (
        <div className="mx-4 mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-[10px] uppercase tracking-widest text-amber-700 mb-2">Ближче до кінця</div>
          <div className="flex flex-wrap gap-1.5">
            {urgent.map((p) => (
              <Chip key={p.id} tone={urgency(p).level >= 3 ? "hot" : "warn"}>
                {p.label} · {urgency(p).why}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {onPullReceipts && (
        <div className="px-4 pt-3">
          <button
            onClick={onPullReceipts}
            className="w-full py-2 rounded-full border border-stone-300 text-[12px] text-stone-600"
          >
            Підтягнути чеки з {RETAIL.name}
          </button>
        </div>
      )}

      {pantry.filter((p) => p.state !== "depleted").length === 0 && (
        <div className="mx-4 mt-4 rounded-2xl border border-stone-300 bg-white p-4">
          <div className="text-[15px] text-stone-900">Комора порожня</div>
          <div className="text-[13px] text-stone-600 mt-1.5 leading-relaxed">
            Наповнити можна чотирма способами, і жоден не вимагає вводити все підряд.
          </div>
          <div className="text-[13px] text-stone-600 mt-3 leading-relaxed">
            · сфотографувати полицю чи холодильник<br />
            · кинути чек — фото або PDF<br />
            · перелічити текстом у чаті<br />
            · записати сюди: «+ молоко 1 л, хліб»
          </div>
          <button
            onClick={() => onGoChat && onGoChat()}
            className="mt-3 w-full py-2.5 rounded-full bg-stone-900 text-white text-[13px] font-medium"
          >
            Почати з чату
          </button>
        </div>
      )}

      <div className="px-4 pt-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAi(null);
          }}
          placeholder="Знайти або записати: «+ молоко 1 л»"
          className="w-full bg-white border border-stone-300 rounded-full px-4 py-2 text-[13px] text-stone-900 placeholder-stone-400 outline-none"
        />
        {q.trim() && (
          <div className="flex items-center gap-2 mt-2 px-1">
            <span className="text-[11px] text-stone-500">
              {list.length} {list.length === 1 ? "позиція" : "позицій"}
              {(ai ? ai.via : found.via) ? ` · ${ai ? ai.via : found.via}` : ""}
            </span>
            {!ai && list.length === 0 && (
              <button
                onClick={askModel}
                disabled={asking}
                className="ml-auto text-[11px] px-3 py-1 rounded-full border border-stone-300 text-stone-600 disabled:opacity-40"
              >
                {asking ? "питаю…" : "спитати модель"}
              </button>
            )}
          </div>
        )}
        {q.trim() && list.length === 0 && ai && (
          <div className="mt-2 text-[12px] text-stone-500 px-1">
            Не знайшлось. Можливо, цього просто немає — тоді варто додати в список покупок.
          </div>
        )}
      </div>

      <div className="flex gap-2 px-4 py-3 overflow-x-auto">
        {[["all", "Усе"], ...Object.entries(ZONES)].map(([k, v]) => (
          <button
            key={k}
            onClick={() => setZone(k)}
            className={`shrink-0 text-[12px] px-3 py-1.5 rounded-full border ${
              zone === k ? "border-stone-900 text-stone-900" : "border-stone-300 text-stone-500"
            }`}
          >
            {v}
            <span className="text-stone-400 ml-1">
              {k === "all" ? pantry.length : pantry.filter((p) => p.zone === k).length}
            </span>
          </button>
        ))}
      </div>

      <div className="px-4 pb-24">
        {list.map((p) => {
          const u = urgency(p);
          return (
            <div key={p.id} className="flex items-center gap-3 py-3 border-b border-stone-200">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${u.level >= 3 ? "bg-red-500" : u.level === 2 ? "bg-amber-500" : u.level === 1 ? "bg-stone-300" : "bg-transparent"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-stone-900 truncate">{p.label}</div>
                <div className="text-[11px] text-stone-500 flex items-center gap-2 mt-0.5">
                  <span>{fmtQ(p.value, p.unit)}</span>
                  {p.lastBy && p.lastAction && (
                    <span className="text-stone-400">
                      {p.lastAction}, {p.lastBy}
                    </span>
                  )}
                  {u.why && <span className={u.level >= 3 ? "text-red-600" : "text-amber-600"}>{u.why}</span>}
                  {p.confidence < 0.9 && <span className="text-stone-400">·{Math.round(p.confidence * 100)}%</span>}
                </div>
              </div>
              {onFix && (
                <button
                  onClick={() => onFix(p)}
                  className="text-[11px] text-stone-500 px-2 py-1 border border-stone-300 rounded-full"
                >
                  виправити
                </button>
              )}
              {p.state === "sealed" && (
                <button onClick={() => onOpen(p.id)} className="text-[11px] text-stone-500 px-2 py-1 border border-stone-300 rounded-full">
                  відкрив
                </button>
              )}
              <button onClick={() => onDeplete(p.id)} className="text-[11px] text-stone-500 px-2 py-1 border border-stone-300 rounded-full">
                нема
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecipesView({ pantry, shopping, saved, profile = {}, history = [], onCook, onStock, onStockOne, onSave, onRefine, onUnsave, onImportOpen, memory }) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);

  const cooked = history || [];
  const fromLog = cooked
    .filter((c) => c.recipe)
    .filter((c, i, arr) => arr.findIndex((x) => x.title === c.title) === i)
    .map((c) => c.recipe);
  const all = [...saved, ...fromLog.filter((r) => !saved.some((s2) => s2.title === r.title)), ...RECIPES];
  const scored = all.map((r) => {
    const m = matchRecipe(r, pantry, r.base);
    const usedIds = new Set(
      r.ings.map((ri) => resolveIng(ri, pantry)).filter(Boolean).map((p) => p.id)
    );
    const alts = m.missing.map((ri) => ({ ri, alt: suggestAlt(ri, pantry, usedIds) }));
    return { r, m, alts, hasAlt: alts.some((a) => a.alt.length > 0) };
  });

  const list = scored
    .filter((x) => {
      if (filter === "ready") return x.m.status === "ready";
      if (filter === "near") return x.m.status !== "ready" && (x.m.status === "near" || x.hasAlt);
      if (filter === "saved") return saved.some((s2) => s2.id === x.r.id);
      if (filter === "cooked") return cooked.some((c) => c.title === x.r.title);
      return true;
    })
    .sort((a, b) => {
      const rank = (x) => (x.m.status === "ready" ? 0 : x.m.status === "near" ? 1 : 2);
      return rank(a) - rank(b) || b.m.rescues.length - a.m.rescues.length;
    });

  const tabs = [
    ["all", `Усі ${all.length}`],
    ["ready", `Можу зараз ${scored.filter((x) => x.m.status === "ready").length}`],
    ["near", "Майже"],
    ["saved", `Обране ${saved.length}`],
    ["cooked", `Готував ${cooked.length}`],
  ];

  return (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="flex items-center gap-2 pt-3">
        <div className="text-[10px] uppercase tracking-widest text-stone-500 flex-1">Рецепти</div>
        <button
          onClick={onImportOpen}
          className="text-[12px] px-3 py-1.5 rounded-full border border-stone-900 text-stone-900"
        >
          + свій рецепт
        </button>
      </div>

      <div className="flex gap-2 py-3 overflow-x-auto">
        {tabs.map(([k, v]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`shrink-0 text-[12px] px-3 py-1.5 rounded-full border ${
              filter === k ? "border-stone-900 text-stone-900" : "border-stone-300 text-stone-500"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {memory.length > 0 && filter === "all" && (
        <div className="mb-4 rounded-2xl border border-stone-300 bg-white p-3">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">Пам'ять</div>
          {memory.map((n, i) => (
            <div key={i} className="text-[12px] text-stone-600 leading-relaxed py-1">
              «{n.text}» <span className="text-stone-400">— {n.recipe}</span>
            </div>
          ))}
        </div>
      )}

      {!list.length && (
        <div className="py-10 text-center text-[13px] text-stone-500 leading-relaxed">
          {filter === "saved"
            ? "В обраному порожньо. Зберігай рецепти з чату — вони лишаться тут незалежно від того, що зараз у коморі."
            : "Нічого не підійшло під цей фільтр."}
        </div>
      )}

      {list.map(({ r, m, alts }) => {
        const isSaved = saved.some((x) => x.id === r.id);
        const withAlt = alts.filter((a) => a.alt.length > 0);
        return (
          <div key={r.id} className="border-b border-stone-200 py-4">
            <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full text-left">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="text-[15px] text-stone-900 leading-snug">
                    {r.title}
                    {isSaved && <span className="text-[11px] text-emerald-700"> · обране</span>}
                    {(() => {
                      const c = cooked.filter((x) => x.title === r.title);
                      if (!c.length) return null;
                      const last = c[c.length - 1];
                      return (
                        <span className="text-[11px] text-stone-400">
                          {" "}· готував {c.length > 1 ? `${c.length}× ` : ""}
                          {relDays(last.at)}
                          {last.rating ? `, ${last.rating}/5` : ""}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-[11px] text-amber-700 mt-1">{r.character}</div>
                </div>
                <Chip tone={m.status === "ready" ? "good" : m.status === "near" ? "warn" : "neutral"}>
                  {m.status === "ready" ? "готово" : m.status === "near" ? `−${m.missing.length}` : "далеко"}
                </Chip>
                {isSaved && (
                  <>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShare && onShare(r);
                      }}
                      className="text-[11px] text-stone-400 px-1"
                    >
                      поділитись
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnsave(r.id);
                      }}
                      className="text-stone-400 text-lg leading-none px-1 -mt-1"
                    >
                      ×
                    </span>
                  </>
                )}
              </div>

              {m.rescues.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.rescues.map((p) => (
                    <Chip key={p.id} tone="warn">рятує {p.label}</Chip>
                  ))}
                </div>
              )}

              {withAlt.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {withAlt.map((a, i) => (
                    <div key={i} className="text-[11px] text-stone-500">
                      замість <span className="text-stone-700">{ingName(a.ri)}</span> є:{" "}
                      {a.alt.map((p) => p.label).join(", ")}
                    </div>
                  ))}
                </div>
              )}
            </button>

            {open === r.id && (
              <>
                <RecipeCard
                  recipe={r}
                  pantry={pantry}
                  shopping={shopping}
                  profile={profile}
                  onCook={onCook}
                  onStock={onStock}
                  onStockOne={onStockOne}
                  onSave={onSave}
                  onRefine={onRefine}
                  isSaved={isSaved}
                />

              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* модель обривається на ліміті токенів — дорізаємо до останнього цілого елемента і закриваємо дужки */
function repairJSON(text) {
  let t = String(text).trim();
  const cut = t.lastIndexOf("}");
  if (cut < 0) return null;
  t = t.slice(0, cut + 1);
  let depthCurly = 0;
  let depthSquare = 0;
  let inStr = false;
  let esc = false;
  for (const ch of t) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depthCurly++;
    else if (ch === "}") depthCurly--;
    else if (ch === "[") depthSquare++;
    else if (ch === "]") depthSquare--;
  }
  if (inStr) return null;
  let tail = "";
  while (depthSquare > 0 || depthCurly > 0) {
    // закриваємо в тому порядку, в якому дужки відкривались: масив завжди всередині обʼєкта
    if (depthSquare > 0) {
      tail += "]";
      depthSquare--;
    } else {
      tail += "}";
      depthCurly--;
    }
  }
  try {
    return JSON.parse(t + tail);
  } catch (e) {
    return null;
  }
}

async function callRecipeLLM(item, pantry, cuisine, profile, memory, cookHistory, audience) {
  const needs = (item.needs || [])
    .map((x) => (typeof x === "string" ? x : x && x.label))
    .filter(Boolean);
  const brief = [
    `Страва: ${item.title}.`,
    item.pitch || "",
    item.character || "",
    needs.length
      ? `ОБОВ'ЯЗКОВО використай ці інгредієнти, навіть якщо їх немає в коморі: ${needs.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelFor("smart"),
      system: RECIPE_SYS(pantryRef(pantry), cuisine, profile, memory, cookHistory, audience),
      messages: [{ role: "user", content: brief }],
    }),
  });
  if (!res.ok) {
    let d = "";
    try {
      const j = await res.json();
      d = (j && j.error && j.error.message) || "";
    } catch (e) {}
    throw new Error(`HTTP ${res.status}${d ? " · " + d.slice(0, 120) : ""}`);
  }
  const data = await res.json();
  const raw = data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const stripped = raw.replace(/```json|```/g, "").trim();
  let j = null;
  try {
    j = JSON.parse(stripped);
  } catch (e) {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        j = JSON.parse(m[0]);
      } catch (e2) {}
    }
    if (!j) j = repairJSON(stripped);
  }
  if (!j) throw new Error("модель відповіла не рецептом");
  const truncated = data.stop_reason === "max_tokens";
  const keyOf = (name) => {
    const n = String(name || "").toLowerCase();
    const hit = Object.keys(CAT).find((k) => n.includes(CAT[k].name.split(" ")[0]));
    return hit || null;
  };
  const byId = new Map(pantry.map((p) => [p.id, p]));
  const stats = { byRef: 0, byName: 0, badRef: 0 };
  const rawIngs = j.ing || j.ingredients || [];
  const rawSteps = j.st || j.steps || [];
  return {
    id: `gen${Date.now()}`,
    title: j.t || j.title || item.title,
    origin: "generated",
    base: j.sv || j.servingsBase || 1,
    timeTotal: j.tm || j.timeTotal || null,
    character: stripIds(j.ch || j.character || item.character || "", pantry),
    desc: stripIds(j.d || j.desc || item.desc || "", pantry),
    nutrition: j.nu && typeof j.nu === "object" ? j.nu : null,
    risk: stripIds(j.rk || j.risk || "", pantry),
    options: (j.op || []).filter((x) => typeof x === "string").map((x) => stripIds(x, pantry)).slice(0, 3),
    sourceItem: item,
    truncated,
    stats,
    ings: rawIngs
      .map((x) => {
        const unit = x.u || x.unit;
        const common = {
          v: Number(x.v != null ? x.v : x.value) || 1,
          u: U[unit] ? unit : "pcs",
          role: x.r || x.role || "important",
          note: x.nt || x.note || undefined,
        };
        if (x.p) {
          const hit = byId.get(String(x.p).trim());
          if (hit) {
            stats.byRef++;
            // знімок назви: рецепт живе довше за партію продукту
            return { ...common, src: "pantry", pantryId: hit.id, snapshot: hit.label, ing: hit.key };
          }
          stats.badRef++;
        }
        const name = x.n || x.name;
        if (!name) return null;
        stats.byName++;
        return { ...common, src: "external", name, ing: keyOf(name) };
      })
      .filter(Boolean),
    steps: rawSteps
      .map((x, i) => {
        const content = x.c || x.content;
        if (!content) return null;
        return {
          id: `s${i}`,
          title: x.t || x.title || `Крок ${i + 1}`,
          content,
          timer: x.s || x.timerSeconds || null,
        };
      })
      .filter(Boolean),
  };
}

/* Фото полиці або чека. Модель бачить зображення напряму, тому окремого
   OCR не потрібно — але знімок із телефона треба стиснути, інакше base64
   роздує запит у кілька мегабайт. */
async function shrinkImage(file, maxSide = 1400) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("не вдалось прочитати файл"));
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("не зображення"));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/jpeg", 0.8);
    return { data: out.split(",")[1], media: "image/jpeg" };
  } catch (e) {
    const comma = dataUrl.indexOf(",");
    return { data: dataUrl.slice(comma + 1), media: dataUrl.slice(5, dataUrl.indexOf(";")) };
  }
}

/* Вкладення бувають трьох типів, і кожен іде в модель по-своєму:
   зображення блоком image, PDF блоком document, текст — просто текстом. */
async function readAttachment(file) {
  const name = file.name || "файл";
  const type = file.type || "";
  if (type.startsWith("image/")) {
    const img = await shrinkImage(file);
    return { kind: "image", name, media: img.media, data: img.data };
  }
  if (type === "application/pdf" || /\.pdf$/i.test(name)) {
    const data = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = () => rej(new Error("не вдалось прочитати PDF"));
      r.readAsDataURL(file);
    });
    return { kind: "pdf", name, media: "application/pdf", data };
  }
  const text = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("не вдалось прочитати файл"));
    r.readAsText(file);
  });
  return { kind: "text", name, text: text.slice(0, 12000) };
}

function attachmentBlocks(list) {
  const out = [];
  (list || []).forEach((a) => {
    if (a.kind === "image")
      out.push({ type: "image", source: { type: "base64", media_type: a.media, data: a.data } });
    else if (a.kind === "pdf")
      out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    else out.push({ type: "text", text: `Файл «${a.name}»:\n${a.text}` });
  });
  return out;
}

async function callAttachmentLLM(attachments, pantry, hint, cuisine, profile) {
  const list = attachments || [];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelFor("fast"),
      temperature: 0,
      system: `Ти розбираєш вкладення для кухонного застосунку: фото, чеки, PDF, текстові файли. Спершу визнач, що це.

КОМОРА КОРИСТУВАЧА — формат «id | назва | стан», щоб не дублювати наявне:
${pantryRef(pantry)}

Поверни ВИКЛЮЧНО JSON. Дві гілки, заповнюй ОДНУ з них:

· продукти (чек, полиця, холодильник, фото покупок):
{"kind":"receipt|shelf","note":"одне речення, що ти побачив","ops":[{"op":"add","label":"назва","v":400,"u":"g","zone":"dry|fridge|freezer|fresh|spices|drinks","conf":0.9,"ev":"receipt_line|package_label|visual_guess"}]}

· рецепт (сторінка книжки, PDF рецепта, текстовий файл зі стравою):
{"kind":"recipe","note":"одне речення","recipe":{"t":"назва","sv":2,"tm":30,"ch":"скільки часу і зусиль","d":"1-2 речення про смак і текстуру","rk":"ключова помилка і чому","nu":{"kcal":540,"p":28,"f":22,"c":55},"ing":[{"p":"p12","v":60,"u":"g","r":"critical"} АБО {"n":"назва","v":160,"u":"g","r":"critical"}],"st":[{"t":"крок","c":"дія з плейсхолдерами {0},{1}","s":240}]}}

· готова страва на тарілці (не полиця, не чек, не рецепт):
{"kind":"dish","note":"одне речення про те, що на тарілці"}

· інше: {"kind":"other","note":"що це"}

Правила для продуктів:
- ЧЕК: бери рядки товарів, розгортай скорочення в людські назви («СИР КАМБОЦ.70% 193Г» → «камбоцола 70%», 193, g). Нехарчові теж додавай. Ціни й підсумки ігноруй
- ПОЛИЦЯ: перелічуй те, що впевнено видно, ev:"visual_guess", conf нижче 0.7
- у "note" не просто констатуй, що бачив: додай наступний крок — «є з чого зробити вечерю, показати варіанти?» або «зі свіжого майже нічого, докупимо?»
- Не вгадуй сорт, якщо не впевнений: «томат» краще за помилкове «кумато»
- Якщо не розрізняєш схожі плоди — обери ймовірніший, conf нижче 0.6 і згадай сумнів у "note"
- Вагу оцінюй за розміром відносно посуду поруч; при сумніві conf нижче 0.6
- максимум 25 позицій

Правила для рецепта:
- інгредієнт, що Є в коморі, вказуй через "p" з id; чого немає — через "n" з назвою. Ніколи обидва разом
- у кроках кількості через плейсхолдер за індексом: {0}, {1}. Фігурні дужки — тільки інгредієнт, час пиши словами
- перекажи кроки своїми словами, стисло, не копіюй авторський текст
- максимум 9 інгредієнтів і 6 кроків, крок до 90 символів

Якщо на фото готова страва — kind:"dish". Не намагайся розібрати її на продукти: людина показує результат, а не комору.

Кілька вкладень — це одна закупка або один документ: зведи в один результат, не дублюй позиції. Жодного тексту поза JSON.${cuisineFrame(cuisine)}`,
      messages: [
        {
          role: "user",
          content: [
            ...attachmentBlocks(list),
            {
              type: "text",
              text: hint
                ? `Користувач уточнює: ${hint}\nВін бачив вкладення на власні очі — його слово важливіше за те, що тобі здалося.`
                : list.length > 1
                ? `${list.length} вкладення. Зведи в один результат.`
                : "Що це?",
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    let d = "";
    try {
      const j = await res.json();
      d = (j && j.error && j.error.message) || "";
    } catch (e) {}
    throw new Error(`HTTP ${res.status}${d ? " · " + d.slice(0, 100) : ""}`);
  }
  const data = await res.json();
  const raw = data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").replace(/```json|```/g, "").trim();
  let j = null;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    j = repairJSON(raw);
  }
  if (!j) throw new Error("не вдалось розібрати відповідь");

  const byId = new Map(pantry.map((x) => [x.id, x]));
  const keyOf = (name) => {
    const n = String(name || "").toLowerCase();
    return Object.keys(CAT).find((k) => n.includes(CAT[k].name.split(" ")[0])) || null;
  };

  let recipe = null;
  if (j.recipe && (j.recipe.ing || []).length) {
    const rr = j.recipe;
    recipe = {
      id: `att${Date.now()}`,
      title: rr.t || "Рецепт із вкладення",
      origin: "imported",
      base: rr.sv || 2,
      timeTotal: rr.tm || null,
      character: stripIds(rr.ch || "", pantry),
      desc: stripIds(rr.d || "", pantry),
      risk: stripIds(rr.rk || "", pantry),
      nutrition: rr.nu && typeof rr.nu === "object" ? rr.nu : null,
      options: [],
      ings: (rr.ing || [])
        .map((x) => {
          const unit = x.u;
          const common = {
            v: Number(x.v) || 1,
            u: U[unit] ? unit : "pcs",
            role: x.r || "important",
            note: x.nt || undefined,
          };
          if (x.p) {
            const hit = byId.get(String(x.p).trim());
            if (hit) return { ...common, src: "pantry", pantryId: hit.id, snapshot: hit.label, ing: hit.key };
          }
          if (!x.n) return null;
          return { ...common, src: "external", name: x.n, ing: keyOf(x.n) };
        })
        .filter(Boolean),
      steps: (rr.st || [])
        .map((x, i) => (x.c ? { id: `s${i}`, title: x.t || `Крок ${i + 1}`, content: x.c, timer: x.s || null } : null))
        .filter(Boolean),
    };
  }

  return {
    kind: j.kind || "other",
    note: j.note || "",
    recipe,
    ops: (j.ops || [])
      .filter((o) => o && o.label)
      .map((o) => ({
        op: o.op || "add",
        label: String(o.label).trim(),
        value: Number(o.v != null ? o.v : o.value) || null,
        unit: U[o.u] ? o.u : "pcs",
        zone: o.zone || guessZone(o.label),
        confidence: typeof o.conf === "number" ? o.conf : 0.8,
        evidence: o.ev || "visual_guess",
      })),
  };
}

/* Імпорт рецепта: джерело → чернетка → прив'язка до комори.
   Той самий контракт, що й генерація: те, що є в коморі, приходить посиланням. */
async function callImportLLM(text, pantry, cuisine, profile) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelFor("smart"),
      system: `${ROLE}${profileBlock(profile)}

Розбери довільний текст рецепта у структуру. Не вигадуй те, чого в тексті немає: якщо часу чи кількості не вказано — постав розумну оцінку і познач це в "nt".

КОМОРА КОРИСТУВАЧА — формат «id | назва | стан»:
${pantryRef(pantry)}

Поверни ВИКЛЮЧНО JSON:
{"t":"назва","sv":2,"tm":30,"ch":"скільки часу і зусиль, 3-5 слів","rk":"ПРИМІТКА: ключова помилка, якої треба уникнути в цій страві, і чому. 1-3 речення про техніку","op":["варіант, який користувач може захотіти — заміна, спрощення, інша техніка"],"ing":[…],"st":[{"t":"крок","c":"дія з плейсхолдерами {0},{1}","s":240}]}

Кожен інгредієнт — рівно одна з форм:
· є в коморі → {"p":"p12","v":60,"u":"g","r":"critical"}
· немає в коморі → {"n":"назва","v":160,"u":"g","r":"critical"}

Правила:
- "op" — до 3 варіантів, які має сенс запропонувати саме для цього тексту й цієї комори. Кожен до 60 символів
- перекажи кроки СВОЇМИ словами, стисло, не копіюй авторський текст
- unit тільки з: g, ml, tsp, tbsp, pcs, clove, brick, can, pack, pinch
- максимум 9 інгредієнтів і 6 кроків, крок до 90 символів
- жодного тексту поза JSON${cuisineFrame(cuisine)}`,
      messages: [{ role: "user", content: text.slice(0, 4000) }],
    }),
  });
  if (!res.ok) {
    let d = "";
    try {
      const j = await res.json();
      d = (j && j.error && j.error.message) || "";
    } catch (e) {}
    throw new Error(`HTTP ${res.status}${d ? " · " + d.slice(0, 100) : ""}`);
  }
  const data = await res.json();
  const raw = data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").replace(/```json|```/g, "").trim();
  let j = null;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    j = repairJSON(raw);
  }
  if (!j) throw new Error("не вдалось розібрати відповідь");

  const byId = new Map(pantry.map((x) => [x.id, x]));
  const keyOf = (name) => {
    const n = String(name || "").toLowerCase();
    return Object.keys(CAT).find((k) => n.includes(CAT[k].name.split(" ")[0])) || null;
  };
  const stats = { byRef: 0, byName: 0, badRef: 0 };
  const ings = (j.ing || j.ingredients || [])
    .map((x) => {
      const unit = x.u || x.unit;
      const common = {
        v: Number(x.v != null ? x.v : x.value) || 1,
        u: U[unit] ? unit : "pcs",
        role: x.r || x.role || "important",
        note: x.nt || x.note || undefined,
      };
      if (x.p) {
        const hit = byId.get(String(x.p).trim());
        if (hit) {
          stats.byRef++;
          return { ...common, src: "pantry", pantryId: hit.id, snapshot: hit.label, ing: hit.key };
        }
        stats.badRef++;
      }
      const name = x.n || x.name;
      if (!name) return null;
      stats.byName++;
      return { ...common, src: "external", name, ing: keyOf(name) };
    })
    .filter(Boolean);

  const steps = (j.st || j.steps || [])
    .map((x, i) => {
      const content = x.c || x.content;
      if (!content) return null;
      return { id: `s${i}`, title: x.t || x.title || `Крок ${i + 1}`, content, timer: x.s || x.timerSeconds || null };
    })
    .filter(Boolean);

  if (!ings.length) throw new Error("інгредієнтів не знайшлось");

  return {
    id: `imp${Date.now()}`,
    title: j.t || j.title || "Імпортований рецепт",
    options: (j.op || []).filter((x) => typeof x === "string").map((x) => stripIds(x, pantry)).slice(0, 3),
    origin: "imported",
    base: j.sv || j.servingsBase || 2,
    timeTotal: j.tm || j.timeTotal || null,
    character: j.ch || j.character || "",
    nutrition: j.nu && typeof j.nu === "object" ? j.nu : null,
    risk: j.rk || j.risk || "",
    stats,
    ings,
    steps,
  };
}

/* якщо кроки зрізало лімітом — добираємо їх окремим викликом */
async function callStepsLLM(recipe) {
  const list = recipe.ings.map((ri, i) => `{${i}} ${ingName(ri)}`).join(", ");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelFor("fast"),
      system: `Поверни ВИКЛЮЧНО JSON: {"st":[{"t":"назва кроку","c":"одне коротке речення, кількості через плейсхолдери {0},{1}","s":240}]}. Максимум 6 кроків, кожен до 90 символів. "s" — секунди, тільки де реально треба чекати. Жодного тексту поза JSON.`,
      messages: [
        { role: "user", content: `Страва: ${recipe.title}. Інгредієнти за індексами: ${list}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const raw = data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").replace(/```json|```/g, "").trim();
  let j = null;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    j = repairJSON(raw);
  }
  if (!j || !(j.st || j.steps)) throw new Error("кроки не зібрались");
  return (j.st || j.steps)
    .map((x, i) => {
      const content = x.c || x.content;
      if (!content) return null;
      return { id: `s${i}`, title: x.t || x.title || `Крок ${i + 1}`, content, timer: x.s || x.timerSeconds || null };
    })
    .filter(Boolean);
}

async function askPantryLLM(query, pantry) {
  const list = pantry.map((p) => p.label).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelFor("fast"),
      system: `Нижче список позицій комори, по одній на рядок. Користувач шукає щось описом, з помилкою або за змістом. Поверни ВИКЛЮЧНО JSON: {"matches":["точні рядки зі списку"],"note":"одне коротке речення, як ти зрозумів запит"}. Якщо нічого не підходить — matches порожній.\n\nКОМОРА:\n${list}`,
      messages: [{ role: "user", content: query }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const raw = data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").replace(/```json|```/g, "").trim();
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("модель відповіла не списком");
    j = JSON.parse(m[0]);
  }
  const set = new Set((j.matches || []).map((x) => String(x).toLowerCase().trim()));
  return { items: pantry.filter((p) => set.has(p.label.toLowerCase().trim())), note: j.note || "" };
}

function ShoppingView({ items, onToggle, onMove, onRemove, onClear, onCart }) {
  const [open, setOpen] = useState(null);

  if (!items.length)
    return (
      <div className="h-full flex flex-col items-center justify-center px-10 text-center">
        <div className="text-[15px] text-stone-800">Список порожній</div>
        <p className="text-[12px] text-stone-500 mt-2 leading-relaxed">
          Сюди саме падає те, чого бракує до обраної страви, і те, що закінчилось після готування.
          Просити окремо не треба.
        </p>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="flex items-center justify-between py-3">
        <span className="text-[11px] text-stone-500">
          {items.length} позицій · {items.filter((i) => i.checked).length} куплено
        </span>
        <button onClick={onClear} className="text-[11px] text-stone-500 px-3 py-1 rounded-full border border-stone-300">
          очистити куплені
        </button>
      </div>

      {onCart && (
        <button
          onClick={onCart}
          className="w-full py-2.5 mb-3 rounded-full bg-stone-900 text-white text-[13px] font-medium"
        >
          Зібрати кошик у {RETAIL.name}
        </button>
      )}

      {items.map((it) => (
        <div key={it.id} className="border-b border-stone-200 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onToggle(it.id)}
              className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center text-[11px] ${
                it.checked ? "bg-stone-900 border-stone-900 text-white" : "border-stone-400 text-transparent"
              }`}
            >
              ✓
            </button>
            <div className="flex-1 min-w-0">
              <div className={`text-[14px] ${it.checked ? "text-stone-400 line-through" : "text-stone-900"}`}>
                {it.label}
                {it.value != null && <span className="text-stone-500"> · {fmtQ(it.value, it.unit || "pcs")}</span>}
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {it.reason}
                {it.by ? ` · ${it.by}` : ""}
              </div>
            </div>
            <button
              onClick={() => setOpen(open === it.id ? null : it.id)}
              className="text-[11px] px-3 py-1 rounded-full border border-stone-300 text-stone-600"
            >
              купив
            </button>
          </div>

          {open === it.id && (
            <div className="mt-3 ml-8 rounded-xl border border-stone-300 bg-white p-3">
              <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2">Куди покласти</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ZONES).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => onMove(it.id, { zone: k })}
                    className={`text-[12px] px-3 py-1.5 rounded-full border ${
                      it.zone === k ? "border-stone-900 text-stone-900" : "border-stone-300 text-stone-500"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                onClick={() => onRemove(it.id)}
                className="mt-3 text-[11px] text-stone-400"
              >
                прибрати зі списку без додавання
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ImportSheet({ onClose, onImport, busy, error }) {
  const [text, setText] = useState("");
  const looksLikeUrl = /^https?:\/\//i.test(text.trim());
  const isYT = /youtube\.com|youtu\.be/i.test(text);

  return (
    <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div className="text-[13px] text-stone-800 flex-1">Свій рецепт</div>
        <button onClick={onClose} className="text-stone-500 text-xl leading-none px-2">×</button>
      </div>

      <div className="px-4">
        <p className="text-[12px] text-stone-500 leading-relaxed">
          Встав текст рецепта в будь-якому вигляді — з нотаток, з месенджера, переписаний з книжки.
          Я розберу його на інгредієнти й кроки і прив'яжу до твоєї комори.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Наприклад:\n\nБорщ\nбуряк 2 шт, картопля 4, капуста чверть качана, томатна паста 2 ложки, часник\nБуряк натерти й притушкувати з томатом. Картоплю у киплячий бульйон, через 10 хв капусту. Наприкінці буряк і часник. Дати настоятись годину."}
        rows={10}
        className="flex-1 m-4 p-3 bg-white border border-stone-300 rounded-xl text-[13px] text-stone-800 placeholder-stone-400 outline-none resize-none leading-relaxed"
      />

      {looksLikeUrl && (
        <div className="mx-4 mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-[12px] text-amber-800 leading-relaxed">
            {isYT
              ? "Це посилання на відео. У пісочниці я не можу його відкрити, а в продукті з відео читались би опис під ним і субтитри — рецепт із опису виходить добрий, з автоматичних субтитрів зазвичай лише чернетка без грамів."
              : "Це посилання. У пісочниці браузер не пустить мене на чужий домен. У продукті сторінка бралась би через власний бекенд, і в половини кулінарних сайтів рецепт лежить готовою розміткою — без жодної моделі."}
          </div>
          <div className="text-[12px] text-amber-800 mt-2">Поки що встав сам текст рецепта.</div>
        </div>
      )}

      {error && <div className="mx-4 mb-2 text-[12px] text-red-600">{error}</div>}

      <div className="p-4 pt-0">
        <button
          onClick={() => onImport(text)}
          disabled={busy || text.trim().length < 20 || looksLikeUrl}
          className="w-full py-3.5 rounded-full bg-stone-900 text-white text-[15px] font-medium disabled:opacity-30"
        >
          {busy ? "розбираю…" : "Розібрати і зберегти"}
        </button>
      </div>
    </div>
  );
}

function TagInput({ items, onAdd, onRemove, placeholder, tone }) {
  const [v, setV] = useState("");
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((x, i) => (
          <span
            key={i}
            className={`text-[12px] px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${
              tone === "hot" ? "border-red-300 text-red-700 bg-red-50" : "border-stone-300 text-stone-700"
            }`}
          >
            {x}
            <button onClick={() => onRemove(i)} className="opacity-50">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) {
              onAdd(v.trim());
              setV("");
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-white border border-stone-300 rounded-full px-3 py-2 text-[13px] text-stone-800 placeholder-stone-400 outline-none"
        />
        <button
          onClick={() => {
            if (v.trim()) {
              onAdd(v.trim());
              setV("");
            }
          }}
          className="px-4 rounded-full border border-stone-300 text-[13px] text-stone-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

function LineList({ items, onAdd, onRemove, placeholder }) {
  const [v, setV] = useState("");
  return (
    <div>
      {items.map((x, i) => (
        <div key={i} className="flex items-start gap-2 py-1.5 border-b border-stone-200">
          <span className="text-stone-300 text-[13px] leading-relaxed">·</span>
          <span className="flex-1 text-[14px] text-stone-800 leading-relaxed">{x}</span>
          <button onClick={() => onRemove(i)} className="text-stone-300 text-lg leading-none px-1">×</button>
        </div>
      ))}
      <div className="flex gap-2 mt-2">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) {
              onAdd(v.trim());
              setV("");
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-white border border-stone-300 rounded-xl px-3 py-2 text-[13px] text-stone-800 placeholder-stone-400 outline-none"
        />
        <button
          onClick={() => {
            if (v.trim()) {
              onAdd(v.trim());
              setV("");
            }
          }}
          className="px-4 rounded-xl border border-stone-300 text-[13px] text-stone-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

function ProfileSheet({ profile, setProfile, memory = [], history = [], memoryOps, household = [], onPullRestrictions, onInvite, onStartFresh, onLogout, onClose }) {
  const equip = profile.equip || {};
  const cycle = (name) => {
    const cur = equip[name] || "unknown";
    const next = cur === "unknown" ? "has" : cur === "has" ? "lacks" : "unknown";
    setProfile({ ...profile, equip: { ...equip, [name]: next } });
  };
  const shown = [...EQUIP_EXTRA, ...Object.keys(equip).filter((k) => !EQUIP_EXTRA.includes(k))];

  return (
    <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 shrink-0">
        <div className="text-[13px] text-stone-800 flex-1">Кухня і я</div>
        <button onClick={onClose} className="text-stone-500 text-xl leading-none px-2">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">Дім</div>
          <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
            Спільне: комора, обладнання, список покупок, календар. Особисте: обмеження, досвід,
            журнал, розмови. Сесії не шеряться ніколи.
          </p>
          {(household || []).map((h) => (
            <div key={h.id} className="flex items-center gap-3 py-2 border-b border-stone-200">
              <span className="w-7 h-7 rounded-full bg-stone-200 text-stone-600 text-[12px] flex items-center justify-center shrink-0">
                {h.name[0]}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-stone-800">{h.name}</div>
                <div className="text-[11px] text-stone-400">
                  {h.owner ? "власник" : "учасник · бачить спільне"}
                </div>
              </div>
              {!h.owner && h.diet && (
                <span className="text-[11px] text-stone-400">
                  {h.diet}
                </span>
              )}
            </div>
          ))}
          {(household || []).filter((h) => !h.owner).length === 0 && (
            <div className="text-[12px] text-stone-400 py-2">
              Поки що ти сам. Скажи в чаті «зі мною живе Оксана, вона веганка» — я запишу.
            </div>
          )}
          <button
            onClick={() => onInvite && onInvite()}
            className="mt-3 w-full py-2 rounded-full border border-stone-300 text-[12px] text-stone-600"
          >
            запросити до комори
          </button>
        </div>

        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest text-red-700 mb-1.5">Алергії</div>
          <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
            Єдиний блок, де потрібні конкретні назви — їх шукає збіг по коморі, а не судження.
            Помічаються червоним усюди, але не блокуються: ти готуєш не тільки собі.
          </p>
          <TagInput
            tone="hot"
            items={profile.allergies || []}
            placeholder="арахіс, молюски, глютен…"
            onAdd={(x) => setProfile({ ...profile, allergies: [...(profile.allergies || []), x] })}
            onRemove={(i) =>
              setProfile({ ...profile, allergies: (profile.allergies || []).filter((_, j) => j !== i) })
            }
          />
        </div>

        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">Побажання</div>
          <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
            Куди тягнути. Традиції, свята, сезонні наміри, плани, смаки. Пиши як завгодно:
            «дотримуюсь халяль», «щопʼятниці риба», «мама привезе мішок цибулі — тиждень готуємо з нею»,
            «люблю блакитні сири».
          </p>
          <LineList
            items={profile.wishes || []}
            placeholder="дотримуюсь халяль"
            onAdd={(x) => setProfile({ ...profile, wishes: [...(profile.wishes || []), x] })}
            onRemove={(i) => setProfile({ ...profile, wishes: (profile.wishes || []).filter((_, j) => j !== i) })}
          />
          {traditionsFrom(profile.wishes || []).length > 0 && (
            <div className="mt-2 text-[11px] text-stone-500">
              Розпізнав календар: {traditionsFrom(profile.wishes || []).join(", ")} — рухомі свята рахую сам.
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">Антипатерни</div>
          <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
            Від чого відштовхуватись. Силу читаю з формулювання: «не їм свинину» — принципова відмова,
            «не люблю кінзу» — смак.
          </p>
          <LineList
            items={profile.antipatterns || []}
            placeholder="не їм свинину й похідні"
            onAdd={(x) => setProfile({ ...profile, antipatterns: [...(profile.antipatterns || []), x] })}
            onRemove={(i) =>
              setProfile({ ...profile, antipatterns: (profile.antipatterns || []).filter((_, j) => j !== i) })
            }
          />
        </div>

        <div className="mt-6">
          <div className="flex items-baseline gap-2 mb-1.5">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 flex-1">Попереду</div>
            <span className="text-[10px] text-stone-400">рік уперед</span>
          </div>
          {upcomingEvents(new Date(), profile.wishes || [], 365).slice(0, 8).map((e, i) => (
            <div key={i} className="flex gap-3 py-1 text-[13px]">
              <span className="text-stone-400 w-20 shrink-0">{whenLabel(e.at)}</span>
              <span className="text-stone-700">
                {e.title}
                {e.approx ? <span className="text-stone-400"> — орієнтовно</span> : null}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">Досвід</div>
          <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
            Висновки після готування. Закріплені йдуть у кожну розмову, решта — вісім найсвіжіших.
          </p>
          {memory.length === 0 && (
            <div className="text-[12px] text-stone-400 mb-2">Порожньо. Заповнюється з розмови після готування.</div>
          )}
          {memory.map((n) => (
            <div key={n.id} className="flex items-start gap-2 py-2 border-b border-stone-200">
              <button
                onClick={() => memoryOps.pin(n.id)}
                className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${
                  n.pinned ? "border-amber-400 text-amber-700 bg-amber-50" : "border-stone-300 text-stone-400"
                }`}
              >
                {n.pinned ? "закріплено" : "закріпити"}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-stone-800 leading-relaxed">{n.text}</div>
                {n.recipe && <div className="text-[11px] text-stone-400 mt-0.5">{n.recipe}</div>}
              </div>
              <button onClick={() => memoryOps.remove(n.id)} className="text-stone-400 text-lg leading-none px-1">
                ×
              </button>
            </div>
          ))}
        </div>

        {onPullRestrictions && (
          <div className="mt-6">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5">Мережа</div>
            <button
              onClick={onPullRestrictions}
              className="text-[12px] px-3 py-1.5 rounded-full border border-stone-300 text-stone-600"
            >
              взяти обмеження з {RETAIL.name}
            </button>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => setProfile(DEMO_PROFILE)}
            className="text-[12px] px-3 py-1.5 rounded-full border border-stone-300 text-stone-600"
          >
            демо-профіль
          </button>
          <button
            onClick={() => setProfile(EMPTY_PROFILE)}
            className="text-[12px] px-3 py-1.5 rounded-full border border-stone-300 text-stone-400"
          >
            очистити
          </button>
          {onStartFresh && (
            <button
              onClick={onStartFresh}
              className="text-[12px] px-3 py-1.5 rounded-full border border-stone-300 text-stone-400"
            >
              почати з нуля
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              className="text-[12px] px-3 py-1.5 rounded-full border border-stone-300 text-stone-600"
            >
              вийти
            </button>
          )}
        </div>
        <p className="text-[11px] text-stone-400 mt-2 leading-relaxed">
          «Почати з нуля» стирає все й запускає знайомство — так, як його побачить нова людина.
        </p>
      </div>
    </div>
  );
}

function NavDrawer({ sessions, activeId, onPick, onNew, onDelete, tab, onTab, counts, occasions = [], onProfile, onClose }) {
  const nav = [
    ["chat", "Чат"],
    ["pantry", `Комора ${counts.pantry}`],
    ["recipes", `Рецепти ${counts.recipes}`],
    ["shop", `Список${counts.shop ? " " + counts.shop : ""}`],
  ];
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="w-[300px] max-w-[85%] bg-white h-full flex flex-col border-r border-stone-200">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2">
          <div className="text-[13px] tracking-widest uppercase text-stone-600 flex-1">Кухня</div>
          <button onClick={onClose} className="text-stone-400 text-xl leading-none px-2">×</button>
        </div>

        <div className="px-3 pb-3 flex flex-col gap-1">
          {nav.map(([k, v]) => (
            <button
              key={k}
              onClick={() => {
                onTab(k);
                onClose();
              }}
              className={`text-left text-[14px] px-3 py-2 rounded-xl ${
                tab === k ? "bg-stone-100 text-stone-900" : "text-stone-600"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {occasions && occasions.length > 0 && (
          <div className="mx-3 mb-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5">
            <div className="text-[10px] uppercase tracking-widest text-amber-800">Зараз</div>
            <div className="text-[12px] text-amber-900 leading-snug mt-0.5">
              {occasions.map((o) => o.title).join(" · ")}
            </div>
          </div>
        )}

        <div className="px-3 pb-2">
          <button
            onClick={onNew}
            className="w-full py-2 rounded-full bg-stone-900 text-white text-[13px] font-medium"
          >
            + нова розмова
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {(() => {
            const groups = [];
            [...sessions]
              .sort((x, y) => y.at - x.at)
              .forEach((sess) => {
                const k = sess.day || dayKey(sess.at);
                const g = groups.find((x) => x.key === k);
                if (g) g.items.push(sess);
                else groups.push({ key: k, at: sess.at, items: [sess] });
              });
            return groups.map((g) => (
              <div key={g.key} className="mb-1">
                <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-widest text-stone-400">
                  {dayLabel(g.at)}
                </div>
                {g.items.map((sess) => (
                  <div
                    key={sess.id}
                    className={`flex items-center gap-1 rounded-xl px-2 ${
                      sess.id === activeId ? "bg-stone-100" : ""
                    }`}
                  >
                    <button
                      onClick={() => {
                        onPick(sess.id);
                        onClose();
                      }}
                      className="flex-1 text-left py-2 min-w-0"
                    >
                      <div className="text-[13px] text-stone-800 truncate">{sess.title}</div>
                    </button>
                    {sessions.length > 1 && (
                      <button onClick={() => onDelete(sess.id)} className="text-stone-300 text-base px-1">
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>

        <div className="border-t border-stone-200 p-3">
          <button
            onClick={() => {
              onProfile();
              onClose();
            }}
            className="w-full flex items-center gap-3 text-left px-2 py-2 rounded-xl"
          >
            <span className="w-8 h-8 rounded-full bg-stone-200 text-stone-600 text-[13px] flex items-center justify-center shrink-0">
              П
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] text-stone-800">Кухня і я</span>
              <span className="block text-[11px] text-stone-400 truncate">профіль, обмеження, досвід</span>
            </span>
          </button>
        </div>
      </div>
      <div className="flex-1 bg-stone-900/20" onClick={onClose} />
    </div>
  );
}

function LoginScreen({ onEnter }) {
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col justify-center px-8">
      <div className="max-w-[360px] w-full mx-auto">
        <div className="text-[13px] tracking-widest uppercase text-stone-500">Кухня</div>
        <h2 className="font-serif text-3xl text-stone-900 mt-2 leading-tight">Хто на кухні?</h2>
        <p className="text-[12px] text-stone-500 mt-3 leading-relaxed">
          Демо: два входи. Один — готова кухня з коморою, історією та профілем. Другий — порожня,
          такою її бачить нова людина.
        </p>

        <button
          onClick={() => onEnter("demo")}
          className="mt-6 w-full py-3.5 rounded-2xl bg-stone-900 text-white text-left px-4"
        >
          <div className="text-[15px] font-medium">Пилип</div>
          <div className="text-[12px] text-white/60 mt-0.5">
            135 позицій, 10 розмов, журнал, алергія на морепродукти
          </div>
        </button>

        <div className="mt-3 rounded-2xl border border-stone-300 p-4">
          <div className="text-[15px] text-stone-900">Нова людина</div>
          <div className="text-[12px] text-stone-500 mt-0.5 leading-relaxed">
            Порожня комора й порожній профіль. Асистент проведе знайомство.
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onEnter("fresh", name.trim() || "Гість")}
            placeholder="як тебе звати?"
            className="mt-3 w-full bg-white border border-stone-300 rounded-full px-4 py-2.5 text-[14px] text-stone-900 placeholder-stone-400 outline-none"
          />
          <button
            onClick={() => onEnter("fresh", name.trim() || "Гість")}
            className="mt-2 w-full py-2.5 rounded-full border border-stone-900 text-[13px] text-stone-900"
          >
            Почати з нуля
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- перехоплювач помилок ---------- */
class Boundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { err: null, info: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    this.setState({ err, info });
  }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    return (
      <div className="p-4 text-[11px] text-red-700 font-mono break-words">
        <div className="text-[13px] text-red-600 mb-2">Впало: {String(e && e.message)}</div>
        <pre className="whitespace-pre-wrap text-stone-500 text-[10px]">
          {String((e && e.stack) || "").slice(0, 1200)}
        </pre>
        <pre className="whitespace-pre-wrap text-stone-400 text-[10px] mt-2">
          {String((this.state.info && this.state.info.componentStack) || "").slice(0, 800)}
        </pre>
        <button
          onClick={() => this.setState({ err: null, info: null })}
          className="mt-3 px-3 py-1.5 rounded-full border border-stone-300 text-stone-700"
        >
          спробувати ще раз
        </button>
      </div>
    );
  }
}

/* ============================================================
   APP
   ============================================================ */
export default function App() {
  const [tab, setTab] = useState("chat");
  const [pantry, setPantry] = useState(INITIAL_PANTRY);
  const [memory, setMemory] = useState(DEMO_MEMORY);
  const [cookHistory, setCookHistory] = useState(DEMO_COOKLOG);
  const [consumption, setConsumption] = useState({});
  const [shopping, setShopping] = useState([
    { ...shopItem("Нут", "для хумусу", { zone: "dry" }), by: "Оксана" },
  ]);
  const [log, setLog] = useState(null);

  function addShopping(list) {
    if (!list.length) return { fresh: [], dup: [] };
    const have = new Set(shopping.map((x) => x.label.toLowerCase().trim()));
    const seen = new Set();
    const fresh = [];
    const dup = [];
    list.forEach((x) => {
      const k = x.label.toLowerCase().trim();
      if (have.has(k) || seen.has(k)) dup.push(x.label);
      else {
        seen.add(k);
        fresh.push(x);
      }
    });
    if (fresh.length) setShopping((prev) => [...prev, ...fresh]);
    return { fresh, dup };
  }

  const shopOps = {
    remove: (id) => setShopping((prev) => prev.filter((x) => x.id !== id)),
    qty: (id, delta) =>
      setShopping((prev) =>
        prev.map((x) => {
          if (x.id !== id) return x;
          const unit = x.unit || "pcs";
          const step = unit === "g" || unit === "ml" ? 50 : unit === "tsp" || unit === "tbsp" ? 1 : 1;
          const base = x.value == null ? 1 : x.value;
          return { ...x, unit, value: Math.max(step, base + delta * step) };
        })
      ),
    open: () => setTab("shop"),
    copy: () => {
      const txt = shopping.map((x) => `- ${x.label}${x.value != null ? ` — ${x.value} ${x.unit || "шт"}` : ""}`).join("\n");
      try {
        const r = navigator.clipboard && navigator.clipboard.writeText(txt);
        if (r && r.catch) r.catch(() => {});
      } catch (e) {}
      setLog(txt);
    },
  };

  function moveToPantry(id, opts) {
    setShopping((prev) => {
      const it = prev.find((x) => x.id === id);
      if (it)
        setPantry((pp) => [
          ...pp,
          {
            id: `p${++_pid}`,
            key: it.ing,
            label: it.label,
            zone: opts.zone || it.zone,
            value: it.value ?? 1,
            unit: it.unit || "pcs",
            state: "sealed",
            addedDaysAgo: 0,
            openedDaysAgo: null,
            openLife: null,
            expiresInDays: null,
            confidence: 0.9,
            provenance: "shopping_list",
            staple: false,
          },
        ]);
      return prev.filter((x) => x.id !== id);
    });
  }
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("llm");
  const [err, setErr] = useState(null);
  const [building, setBuilding] = useState(null);
  const [stats, setStats] = useState(null);
  const [saved, setSaved] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [cuisine, setCuisine] = useState("any");
  const [profile, setProfile] = useState(DEMO_PROFILE);
  const [audience, setAudience] = useState([]);
  /* 0 — вимкнено · 1 — чекаємо комору · 2 — комора є, чекаємо відповідь про людину */
  const [onboarding, setOnboarding] = useState(0);
  const [user, setUser] = useState(null);
  const [household, setHousehold] = useState(DEMO_HOUSEHOLD);



  function enter(kind, name) {
    if (kind === "fresh") {
      const who = name || "Гість";
      setUser({ id: "fresh", name: who });
      setHousehold(freshHousehold(who));
      startFresh(who);
      return;
    }
    setUser({ id: "demo", name: "Пилип" });
    setHousehold(DEMO_HOUSEHOLD);
  }

  function logout() {
    setUser(null);
    setShowProfile(false);
    setShowNav(false);
    setTab("chat");
  }
  const [showProfile, setShowProfile] = useState(false);
  const [cook, setCook] = useState(null);
  const [sessions, setSessions] = useState(() => {
    const intents0 = extractIntents(DEMO_SESSIONS, DEMO_COOKLOG).map((it) => ({
      ...it,
      ready: readyIntents([it], INITIAL_PANTRY).length > 0,
    }));
    const brief = {
      id: "m0",
      role: "assistant",
      text: buildBrief(INITIAL_PANTRY, intents0, [], DEMO_PROFILE.wishes),
      card: null,
    };
    return [
      { id: "today", title: "Нова розмова", at: Date.now(), day: dayKey(Date.now()), messages: [brief] },
      ...DEMO_SESSIONS,
    ];
  });
  const [activeId, setActiveId] = useState("today");
  const [showNav, setShowNav] = useState(false);

  const active = sessions.find((x) => x.id === activeId) || sessions[0];
  const messages = active ? active.messages : [];

  function setMessages(updater) {
    setSessions((prev) =>
      prev.map((sess) => {
        if (sess.id !== activeId) return sess;
        const next = typeof updater === "function" ? updater(sess.messages) : updater;
        return { ...sess, messages: next, title: sessionTitle(next), at: sess.at };
      })
    );
  }

  function newSession() {
    const id = `s${Date.now()}`;
    const brief = {
      id: "m0",
      role: "assistant",
      text: buildBrief(pantry, promptIntents, shopping, profile.wishes),
      card: null,
    };
    setSessions((prev) => [
      { id, title: "Нова розмова", at: Date.now(), day: dayKey(Date.now()), messages: [brief] },
      ...prev,
    ]);
    setActiveId(id);
    setTab("chat");
    setShowNav(false);
  }

  const intents = useMemo(() => extractIntents(sessions, cookHistory), [sessions, cookHistory]);
  const ready = useMemo(() => readyIntents(intents, pantry), [intents, pantry]);
  const promptIntents = useMemo(
    () =>
      intents.slice(0, 5).map((it) => ({ ...it, ready: ready.some((r) => r.title === it.title) })),
    [intents, ready]
  );

  const digest = useMemo(() => pantryDigest(pantry), [pantry]);

  /* День — природна межа розмови: новий день починається з чистої сесії.
     Це і продуктово правильно (вчорашній контекст рідко потрібен),
     і дешевше: тред не росте безмежно. */
  // тиждень минув — закінчене йде з комори остаточно
  useEffect(() => {
    const cutoff = Date.now() - DEPLETED_KEEP_DAYS * 86400000;
    setPantry((prev) => {
      const stale = prev.filter((x) => x.state === "depleted" && (x.depletedAt || 0) < cutoff);
      return stale.length ? prev.filter((x) => !stale.includes(x)) : prev;
    });
  }, []);

  /* Довгий текст із кількостями і діями — це рецепт, а не репліка.
     Ловимо локально: дешевше й надійніше, ніж покладатись на класифікацію моделлю. */
  /* «дай рецепт» після розмови про страву — найчастіший випадок втрати нитки.
     Ловимо локально й нагадуємо моделі тему явно. */
  function recipeAsk(t) {
    return /^\s*(дай|давай|покажи|зроби|хочу)\s*(рецепт|його|цю страву|як готувати)?\s*$|^\s*рецепт\s*$|дай рецепт|покажи рецепт|давай робити|як це готувати/i.test(t);
  }

  /* «що я готував», «я вже це робив?», «те, що з фуетом» — питання до журналу,
     а не до моделі. Відповідає локальний пошук, модель не викликається взагалі. */
  /* «я колись хотів», «ми обговорювали» — питання до сесій, не до журналу. */
  function asksAboutSessions(t) {
    return /колись хотів|хотіла|ми обговорювали|ми говорили|згадай розмову|про що ми|десь бачив|ти пропонував|ми планували|збирався зготувати|хотів зготувати|хотів приготувати/i.test(
      t
    );
  }

  function asksAboutPast(t) {
    return /що я готував|що готував|вже готував|вже робив|що робив|готував раніше|з історії|нагадай що|як називал|та штука|що вийшло найкращ|що було смачн|повтори те/i.test(
      t
    );
  }

  function looksLikeRecipe(t) {
    if (/^(додай рецепт|збережи рецепт|запиши рецепт|ось рецепт|рецепт:)/i.test(t.trim())) return true;
    if (t.length < 120) return false;
    const qty = (t.match(/\d+\s*(г|мл|кг|л|ст\.?\s?л|ч\.?\s?л|шт|зубч|склян)/gi) || []).length;
    const verbs = (t.match(/наріз|обсмаж|тушк|варит|запік|додай|додат|змішат|збит|викласт|посолит|прогрі|залит|витоп/gi) || []).length;
    const lines = t.split(/\n/).length;
    return (qty >= 3 && verbs >= 2) || (qty >= 4 && lines >= 3);
  }

  async function send(text) {
    const um = { id: `u${Date.now()}`, role: "user", text };
    const hist = [...messages, um];
    setMessages(hist);
    // відповів на питання про себе — знайомство завершене
    if (onboarding === 2) setOnboarding(0);

    if (asksAboutSessions(text)) {
      const r = searchSessions(text, sessions);
      const cand = intents.filter((it) => {
        const w = fold(text).split(" ").filter((x) => x.length >= 4);
        const hay = fold([it.title, ...(it.ings || [])].join(" "));
        return w.some((x) => hay.includes(x));
      });
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: cand.length
            ? `Знайшов у розмовах. ${cand[0].title} — ${relDays(cand[0].at)}.`
            : r.items.length
            ? "Ось розмови, де це згадувалось."
            : "У попередніх розмовах такого не знайшов.",
          card: { type: "sessions", items: r.items, intents: cand.slice(0, 4), via: r.via },
        },
      ]);
      return;
    }

    if (asksAboutPast(text)) {
      const r = searchCookLog(text, cookHistory);
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: r.items.length
            ? `Знайшов ${r.items.length} у журналі.`
            : cookHistory.length
            ? "Такого в журналі немає."
            : "Журнал поки порожній — він заповнюється після готування.",
          card: { type: "cook_log", items: r.items, via: r.via },
        },
      ]);
      return;
    }

    if (recipeAsk(text)) {
      // тема могла випасти з вікна — піднімаємо її з треду і кажемо прямо
      const topic = [...messages]
        .reverse()
        .slice(0, 12)
        .find((m) => m.role === "assistant" && m.card && (m.card.type === "proposal" || m.card.type === "recipe"));
      const hintFrom = topic
        ? cardToText(topic.card, topic.applied)
        : [...messages].reverse().slice(0, 6).map((m) => m.text).filter(Boolean)[0] || "";
      if (hintFrom) {
        const um2 = {
          id: `u${Date.now()}`,
          role: "user",
          text: `${text}\n\n(мова про страву, яку ми щойно обговорювали в цій розмові — саме її, не нові варіанти)`,
        };
        setMessages([...messages, um2]);
        setBusy(true);
        let out2;
        try {
          out2 = await callLLM([...messages, um2], digest, shopping.map((x) => x.label), cuisine, profile, memory, cookHistory, promptIntents, audience, onboarding, household);
          setMode("llm");
          setErr(null);
        } catch (e) {
          setMode("local");
          setErr(String(e && e.message).slice(0, 160));
          out2 = localEngine(text, pantry);
        }
        setBusy(false);
        setMessages((m) => [
          ...m.slice(0, -1),
          um,
          { id: `a${Date.now()}`, role: "assistant", text: out2.reply, card: out2.card || null },
        ]);
        return;
      }
    }

    if (looksLikeRecipe(text)) {
      const clean = text.replace(/^(додай рецепт|збережи рецепт|запиши рецепт|ось рецепт|рецепт)[:\s-]*/i, "");
      await importRecipe(clean);
      return;
    }

    setBusy(true);
    let out;
    try {
      out = await callLLM(hist, digest, shopping.map((x) => x.label), cuisine, profile, memory, cookHistory, promptIntents, audience, onboarding, household);
      setMode("llm");
      setErr(null);
    } catch (e) {
      setMode("local");
      setErr(String(e && e.message).slice(0, 160));
      out = localEngine(text, pantry);
    }
    setBusy(false);

    const card = out.card || null;
    if (card && card.type === "profile") {
      const ops = Array.isArray(card.ops) ? card.ops : [];
      setMessages((m) => [
        ...m,
        { id: `a${Date.now()}`, role: "assistant", text: out.reply, card: { type: "profile", ops } },
      ]);
      return;
    }
    if (card && card.type === "shopping") {
      const parsed = (Array.isArray(card.items) ? card.items : [])
        .map((x) => (typeof x === "string" ? { label: x, note: "" } : x || {}))
        .filter((x) => x.label);

      const toRemove = parsed.filter((x) => x.op === "remove");
      const toAdd = parsed.filter((x) => x.op !== "remove");

      if (toRemove.length)
        setShopping((prev) =>
          prev.filter((it) => !toRemove.some((r) => fold(it.label).includes(fold(r.label))))
        );

      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: out.reply,
          card: null,
        },
      ]);
      if (toAdd.length)
        pushShopping(
          toAdd.map((x) =>
            shopItem(x.label, x.note || "з розмови", { value: x.v || null, unit: x.u || null })
          )
        );
      return;
    }
    setMessages((m) => [...m, { id: `a${Date.now()}`, role: "assistant", text: out.reply, card }]);
  }

  function applyDiff(msgId, ops) {
    setPantry((prev) => {
      let next = [...prev];
      ops.forEach((o) => {
        if (o.op === "deplete") {
          const p = next.find((x) => x.id === o.pantryId || x.label === o.label);
          if (p) {
            next = next.map((x) =>
              x.id === p.id ? { ...x, state: "depleted", depletedAt: Date.now(), value: 0 } : x
            );
            addShopping([shopItem(p.label, "закінчилось", { ing: p.key, zone: p.zone })]);
          }
        } else if (o.op === "open") {
          next = next.map((x) => (x.label === o.label ? { ...x, state: "opened", openedDaysAgo: 0 } : x));
        } else {
          const key = Object.keys(CAT).find((k) => CAT[k].name === (o.label || "").toLowerCase()) || null;
          const exist = key && next.find((x) => x.key === key);
          if (exist) {
            next = next.map((x) => (x.id === exist.id ? { ...x, value: x.value + (o.value || 0), addedDaysAgo: 0 } : x));
          } else {
            next = [
              ...next,
              {
                id: `p${++_pid}`,
                key: key,
                label: o.label,
                zone: o.zone || "fridge",
                value: o.value ?? 1,
                unit: o.unit || "pcs",
                state: "sealed",
                addedDaysAgo: 0,
                openedDaysAgo: null,
                expiresInDays: null,
                confidence: o.confidence ?? 1,
                provenance: o.evidence || "user_statement",
                staple: false,
                openLife: null,
              },
            ];
          }
        }
      });
      return next;
    });
    setMessages((m) => {
      const marked = m.map((x) => (x.id === msgId ? { ...x, applied: ops.length } : x));
      const live = pantry.filter((p) => p.state !== "depleted").length + ops.length;
      if (onboarding !== 1 || live < 5) return marked;
      setOnboarding(2);
      return [
        ...marked,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text:
            "Комора є. Тепер коротко про тебе, щоб я не пропонував дурниць: чи є алергії або те, чого не їси? Готуєш собі чи ще на когось? І чи є щось у календарі — піст, свята, дати, які варто памʼятати.",
          card: null,
        },
      ];
    });
  }

  function copyLog() {
    try {
      const txt = buildLog();
      try {
        const r = navigator.clipboard && navigator.clipboard.writeText(txt);
        if (r && r.catch) r.catch(() => {});
      } catch (e) {}
      setLog(txt);
    } catch (e) {
      setLog(`не вдалось зібрати лог: ${String(e && e.message)}\n\n${String((e && e.stack) || "").slice(0, 800)}`);
    }
  }

  function buildLog() {
    const tok = (x) => Math.round(String(x || "").length / 2.6);
    const live = pantry.filter((p) => p.state !== "depleted");
    const apiMsgs = buildMessages(messages);
    const sys = SYS(
      digest,
      shopping.map((x) => x.label),
      cuisine,
      profile,
      memory,
      cookHistory,
      promptIntents,
      audience,
      onboarding,
      household
    );

    /* Динамічна частина промпту — те, що змінюється від стану. Статичні правила
       й роль у лог не йдуть: вони незмінні й лише заважають читати. */
    const dyn = [
      profileBlock(profile),
      audienceBlock(audience, profile, household),
      occasionBlock(new Date(), profile.wishes),
      memoryBlock(memory, cookHistory, promptIntents),
      `\n\nКОМОРА:\n${digest}`,
    ]
      .filter(Boolean)
      .join("");

    const short = (t, n = 160) => {
      const one = String(t || "").replace(/\s+/g, " ").trim();
      return one.length > n ? one.slice(0, n) + "…" : one;
    };

    return [
      `# лог · ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
      `${user ? user.name : "?"} · ${
        onboarding === 1 ? "ЗНАЙОМСТВО · етап 1 (комора)" : onboarding === 2 ? "ЗНАЙОМСТВО · етап 2 (людина)" : "звичайний режим"
      } · ${mode}${
        err ? ` · ПОМИЛКА: ${err}` : ""
      }`,
      "",
      "## стан",
      `комора ${live.length} (закінчених ${pantry.length - live.length}) · список ${shopping.length} · обране ${saved.length}`,
      `памʼять ${memory.length} · журнал ${cookHistory.length} · задумів ${promptIntents.length}`,
      `дім: ${household.map((h) => h.name + (h.owner ? "*" : "")).join(", ")} · готуємо для: ${
        audience.length ? audience.join(", ") : "власника"
      }`,
      `алергії [${(profile.allergies || []).join(", ")}]`,
      `побажання: ${(profile.wishes || []).join(" · ") || "—"}`,
      `антипатерни: ${(profile.antipatterns || []).join(" · ") || "—"}`,
      `кухня ${cuisine} · обладнання ${JSON.stringify(profile.equip || {})} · календар ${
        traditionsFrom(profile.wishes || []).join(", ") || "не розпізнано"
      }`,
      `попереду: ${upcomingEvents(new Date(), profile.wishes || [], 30)
        .slice(0, 4)
        .map((e) => `${whenLabel(e.at)} ${e.title}`)
        .join(" · ") || "—"}`,
      "",
      "## сесія",
      `${sessions.length} розмов · активна «${active ? active.title : "?"}» · ${messages.length} реплік`,
      ...messages.map((m) => {
        const who = m.role === "user" ? "→" : "←";
        const card = m.card ? ` [${m.card.type}${m.applied ? ` ✓${m.applied}` : ""}]` : "";
        const att = m.images && m.images.length ? ` [${m.images.length} фото]` : "";
        return `${who} ${short(m.text) || "(без тексту)"}${card}${att}`;
      }),
      "",
      "## що пішло в API",
      `${apiMsgs.length} реплік · системний промпт ${tok(sys)} ток., з них динаміка ${tok(dyn)}`,
      ...apiMsgs.map((m) => `${m.role === "user" ? "→" : "←"} ${short(m.content, 220)}`),
      "",
      "## динамічна частина промпту",
      dyn.trim(),
      "",
      "## технічне",
      ARTIFACT_RUNTIME ? `пісочниця: всі профілі → ${SANDBOX_MODEL}` : "продакшн",
      ...Object.entries(callStats.byProfile).map(([k, v]) => `  ${k}: ${v.calls} викл. · намір ${v.intended}`),
      stats
        ? `зіставлення «${stats.title}»: посиланням ${stats.byRef} · назвою ${stats.byName} · биті id ${stats.badRef}`
        : "рецептів не генерували",
    ].join("\n");
  }

  function pushShopping(list) {
    const { fresh, dup } = addShopping(list);
    if (!fresh.length) {
      // нічого нового — картку не малюємо, щоб не засмічувати тред
      if (dup.length)
        setMessages((m) => [
          ...m,
          {
            id: `a${Date.now()}`,
            role: "assistant",
            text: `${dup.join(", ")} — вже в списку.`,
            card: null,
          },
        ]);
      return;
    }
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last && last.card && last.card.type === "shopping") {
        const merged = {
          ...last,
          card: {
            type: "shopping",
            ids: [...(last.card.ids || []), ...fresh.map((f) => f.id)],
            labels: [...(last.card.labels || []), ...fresh.map((f) => f.label)],
            dup: [...(last.card.dup || []), ...dup],
          },
        };
        return [...m.slice(0, -1), merged];
      }
      return [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: "",
          card: { type: "shopping", ids: fresh.map((f) => f.id), labels: fresh.map((f) => f.label), dup },
        },
      ];
    });
  }

  /* Імпорт ніколи не зберігає одразу: спершу чернетка на підтвердження. */
  const [scanning, setScanning] = useState(false);
  const shots = useRef({});
  /* Остання приготована страва: до неї прив'яжеться відгук або фото з чату. */
  const lastCooked = useRef(null);
  const undoRef = useRef(null);
  const loaded = useRef(false);

  /* Стан переживає перезавантаження. Сесії й комора — головне, що шкода втрачати;
     знімки не зберігаємо, вони важкі й одноразові. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await window.storage.get("kitchen:v1");
        if (!alive || !r || !r.value) return;
        const d = JSON.parse(r.value);
        if (d.pantry) setPantry(d.pantry);
        if (d.profile) setProfile(d.profile);
        if (d.household) setHousehold(d.household);
        if (d.shopping) setShopping(d.shopping);
        if (d.memory) setMemory(d.memory);
        if (d.cookHistory) setCookHistory(d.cookHistory);
        if (d.saved) setSaved(d.saved);
        if (d.sessions && d.sessions.length) {
          setSessions(d.sessions);
          setActiveId(d.activeId || d.sessions[0].id);
        }
        if (d.user) setUser(d.user);
        if (typeof d.onboarding === "number") setOnboarding(d.onboarding);
      } catch (e) {
        /* нема збереженого — працюємо з демо */
      } finally {
        loaded.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current || !user) return;
    const id = setTimeout(() => {
      const light = sessions.map((sess) => ({
        ...sess,
        messages: sess.messages.map(({ images, ...rest }) => rest),
      }));
      window.storage
        .set(
          "kitchen:v1",
          JSON.stringify({
            pantry,
            profile,
            household,
            shopping,
            memory,
            cookHistory,
            saved,
            sessions: light,
            activeId,
            user,
            onboarding,
          })
        )
        .catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [pantry, profile, household, shopping, memory, cookHistory, saved, sessions, activeId, user, onboarding]);
  const startFixRef = useRef(null);

  /* Найдорожча дія має шлях назад: знімок комори й списку перед застосуванням. */
  function undoLast() {
    const u = undoRef.current;
    if (!u) return;
    setPantry(u.pantry);
    setShopping(u.shopping);
    undoRef.current = null;
    setMessages((m) => [
      ...m.map((x) => (x.id === u.msgId ? { ...x, applied: 0, undone: true } : x)),
      {
        id: `a${Date.now()}`,
        role: "assistant",
        text: "Скасував. Комора й список повернулись, як були.",
        card: null,
      },
    ]);
  }

  /* Знімки не розбираються по одному: спершу вони збираються біля поля вводу,
     потім ідуть у модель разом із текстом — одним викликом, як вкладення в чаті. */
  async function scanPhotos(files, hint, reuseId) {
    const list = files || [];
    if (!list.length && !reuseId) return;
    setScanning(true);
    const shotId = reuseId || `u${Date.now()}`;

    try {
      let atts;
      if (reuseId) {
        atts = shots.current[reuseId];
        if (!atts || !atts.length) throw new Error("вкладення загубились, завантаж ще раз");
      } else {
        atts = await Promise.all(list.map((f) => readAttachment(f)));
        shots.current[shotId] = atts;
        const thumbs = await Promise.all(
          list.map(async (f) =>
            (f.type || "").startsWith("image/")
              ? { img: await shrinkImage(f, 360) }
              : { name: f.name || "файл" }
          )
        );
        setMessages((m) => [
          ...m,
          {
            id: shotId,
            role: "user",
            text: hint || "",
            images: thumbs.filter((t) => t.img).map((t) => `data:${t.img.media};base64,${t.img.data}`),
            files: thumbs.filter((t) => !t.img).map((t) => t.name),
            pending: true,
          },
        ]);
      }

      const r = await callAttachmentLLM(atts, pantry, hint, cuisine, profile);
      setMode("llm");
      setErr(null);

      if (r.kind === "dish") {
        const base = lastCooked.current;
        const stats = base ? shareStats(base, pantry, cookHistory) : null;
        setMessages((m) => [
          ...m.map((x) => (x.id === shotId ? { ...x, pending: false } : x)),
          base && stats
            ? {
                id: `a${Date.now()}`,
                role: "assistant",
                text: r.note || "Гарно вийшло.",
                card: {
                  type: "share",
                  post: { recipe: base, photo: shots.current[shotId] ? `data:${atts[0].media};base64,${atts[0].data}` : null, stats, verdict: hint || null },
                },
              }
            : {
                id: `a${Date.now()}`,
                role: "assistant",
                text: `${r.note || "Гарно вийшло."} Але я не знаю, з чого це — розкажи, і зможу зробити картку для публікації.`,
                card: null,
              },
        ]);
        setScanning(false);
        return;
      }

      if (r.kind === "recipe" && r.recipe) {
        setMessages((m) => [
          ...m.map((x) => (x.id === shotId ? { ...x, pending: false } : x)),
          {
            id: `a${Date.now()}`,
            role: "assistant",
            text: r.note || "Ось як я це зрозумів.",
            card: { type: "recipe_draft", draft: r.recipe },
          },
        ]);
        setScanning(false);
        return;
      }

      const kindWord = r.kind === "receipt" ? "чек" : r.kind === "shelf" ? "полицю" : "вкладення";
      setMessages((m) => [
        ...m.map((x) => (x.id === shotId ? { ...x, pending: false } : x)),
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: r.ops.length
            ? `Розібрав ${kindWord}: ${r.ops.length} позицій. ${r.note}${
                onboarding === 1 ? " Підтвердь — і далі буде простіше." : ""
              }`
            : `${r.note || "Не розібрав, що це."}`,
          card: r.ops.length ? { type: "intake_diff", ops: r.ops, shotId } : null,
        },
      ]);
    } catch (e) {
      setMode("local");
      setErr(String(e && e.message).slice(0, 160));
      setMessages((m) => [
        ...m.map((x) => (x.id === shotId ? { ...x, pending: false } : x)),
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: `Не вдалось розібрати: ${String(e && e.message).slice(0, 120)}`,
          card: null,
        },
      ]);
    }
    setScanning(false);
  }

  async function importRecipe(text, refinement) {
    setImporting(true);
    setImportErr(null);
    const source = refinement ? `${text}\n\nУточнення від користувача: ${refinement}` : text;
    try {
      const recipe = await callImportLLM(source, pantry, cuisine, profile);
      recipe.sourceText = text;
      setStats({ ...recipe.stats, title: recipe.title });
      setShowImport(false);
      setTab("chat");
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: refinement ? "Переробив." : "Ось як я це зрозумів. Перевір, що я домислив, перш ніж зберігати.",
          card: { type: "recipe_draft", draft: recipe },
        },
      ]);
    } catch (e) {
      setImportErr(String(e && e.message).slice(0, 160));
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: `Не зміг розібрати: ${String(e && e.message).slice(0, 120)}`,
          card: null,
        },
      ]);
    }
    setImporting(false);
  }

  function confirmDraft(msgId, draft) {
    const frozen = freezeRecipe(draft);
    frozen.origin = "imported";
    setSaved((prev) => [frozen, ...prev]);
    setMessages((m) =>
      m.map((x) =>
        x.id === msgId
          ? { ...x, text: `«${draft.title}» збережено в обране.`, card: { type: "recipe", recipe: frozen } }
          : x
      )
    );
  }

  function applyProfile(msgId, ops) {
    const members = ops.filter((o) => o.kind === "member");
    if (members.length)
      setHousehold((prev) => {
        let next = [...prev];
        members.forEach((o) => {
          const f = fold(o.label || "");
          if (o.op === "remove") {
            next = next.filter((h) => h.owner || !fold(h.name).includes(f));
            return;
          }
          if (!o.label || next.some((h) => fold(h.name) === fold(o.label))) return;
          next.push({
            id: `m${Date.now()}${next.length}`,
            name: o.label,
            owner: false,
            diet: o.diet || "",
            allergies: o.allergies || [],
            wishes: o.wishes || (o.diet ? [o.diet] : []),
            antipatterns: o.antipatterns || o.avoid || [],
          });
        });
        return next;
      });

    const dropNotes = ops.filter((o) => o.kind === "note" && o.op === "remove");
    if (dropNotes.length)
      setMemory((m) =>
        m.filter((n) => !dropNotes.some((d) => fold(n.text).includes(fold(d.label || ""))))
      );

    const notes = ops.filter((o) => o.kind === "note" && o.op !== "remove");
    if (notes.length) {
      const title = notes[0].recipe || (lastCooked.current && lastCooked.current.title) || null;
      setMemory((m) => [
        ...m,
        ...notes.map((o, i) => ({
          id: `n${Date.now()}${i}`,
          text: o.label,
          recipe: o.recipe || title,
          rating: o.rating || null,
          at: Date.now(),
          pinned: !!o.pin,
        })),
      ]);
      if (notes[0].rating || title)
        setCookHistory((h) => {
          const idx = [...h].reverse().findIndex((x) => x.title === title);
          if (idx < 0) return h;
          const real = h.length - 1 - idx;
          return h.map((x, i) =>
            i === real ? { ...x, rating: notes[0].rating || x.rating, verdict: notes[0].label } : x
          );
        });
    }
    setProfile((prev) => {
      const next = { ...prev, equip: { ...prev.equip } };
      const FIELD = { allergy: "allergies", wish: "wishes", anti: "antipatterns" };

      ops.forEach((o) => {
        const remove = o.op === "remove";
        const field = FIELD[o.kind];

        if (field) {
          const list = next[field] || [];
          if (remove) {
            const f = fold(o.label || "");
            next[field] = list.filter((x) => !f || !fold(x).includes(f));
          } else if (o.label && !list.includes(o.label)) {
            next[field] = [...list, o.label];
          }
          return;
        }

        if (o.kind === "equip") {
          if (remove) delete next.equip[o.label];
          else next.equip[o.label] = o.has === false ? "lacks" : "has";
          return;
        }


      });
      return next;
    });
    setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, applied: ops.length } : x)));
  }

  const memoryOps = {
    add: (text) =>
      setMemory((m) => [...m, { id: `n${Date.now()}`, text, recipe: null, at: Date.now(), pinned: false }]),
    pin: (id) => setMemory((m) => m.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n))),
    remove: (id) => setMemory((m) => m.filter((n) => n.id !== id)),
    clearHistory: () => setCookHistory([]),
  };

  /* Закінчене не зникає одразу: тиждень лежить у кошику.
     Це дає скасувати помилку і зберігає історію споживання для передбачення покупок. */
  function depleteItem(id) {
    setPantry((prev) =>
      prev.map((x) =>
        x.id === id
          ? { ...x, state: "depleted", depletedAt: Date.now(), value: 0, lastBy: "Пилип", lastAction: "закінчилось" }
          : x
      )
    );
    const it = pantry.find((x) => x.id === id);
    if (it) {
      addShopping([shopItem(it.label, "закінчилось у коморі", { ing: it.key, zone: it.zone })]);
      setConsumption((c) => {
        const key = (it.key || it.label).toLowerCase();
        const prev = c[key] || { label: it.label, times: 0, last: null };
        return { ...c, [key]: { ...prev, times: prev.times + 1, last: Date.now() } };
      });
    }
  }

  function restoreItem(id) {
    setPantry((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, state: "opened", depletedAt: null, value: x.value || 1 } : x
      )
    );
  }

  function purgeDepleted() {
    setPantry((prev) => prev.filter((x) => x.state !== "depleted"));
  }

  /* Три сценарії з MCP мережі: список → кошик, чеки → комора,
     обмеження профілю → наш профіль. */
  function buildCart() {
    if (!shopping.length) return;
    const rows = retailFindBatch(shopping.map((x) => x.label));
    const found = rows.filter((r) => r.product && r.product.stock).length;
    setTab("chat");
    setMessages((m) => [
      ...m,
      {
        id: `a${Date.now()}`,
        role: "assistant",
        text: `Зібрав кошик у ${RETAIL.name}: знайшов ${found} з ${rows.length}.`,
        card: { type: "cart", rows },
      },
    ]);
  }

  /* Швидкий запис без моделі — той самий контракт, нуль викликів. */
  function quickAdd(ops) {
    if (!ops.length) return;
    setTab("chat");
    const id = `a${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id, role: "assistant", text: `Записую ${ops.length} без виклику моделі.`, card: { type: "intake_diff", ops } },
    ]);
  }

  /* Фото після готування не залежить від класифікації: контекст уже відомий,
     тому воно одразу стає публікацією, а не здогадкою про полицю. */
  async function dishPhoto(file) {
    const base = lastCooked.current;
    if (!file || !base) return;
    setScanning(true);
    try {
      const thumb = await shrinkImage(file, 900);
      const stats = shareStats(base, pantry, cookHistory);
      setMessages((m) => [
        ...m,
        {
          id: `sh${Date.now()}`,
          role: "assistant",
          text: "Готово до публікації.",
          card: {
            type: "share",
            post: { recipe: base, photo: `data:${thumb.media};base64,${thumb.data}`, stats, verdict: null },
          },
        },
      ]);
    } catch (e) {
      setErr(String(e && e.message).slice(0, 120));
    }
    setScanning(false);
  }

  /* Виправлення позиції веде в чат тим самим префіксом, що й уточнення страви. */
  function fixItem(p) {
    setTab("chat");
    setTimeout(() => startFixRef.current && startFixRef.current(p), 0);
  }

  function pullReceipts() {
    const r = retailPullReceipts(7);
    setTab("chat");
    if (!r.ops.length) {
      setMessages((m) => [
        ...m,
        { id: `a${Date.now()}`, role: "assistant", text: "Нових чеків за тиждень немає.", card: null },
      ]);
      return;
    }
    const shops = [...new Set(r.receipts.map((x) => x.shop.split(",")[0]))].join(", ");
    setMessages((m) => [
      ...m,
      {
        id: `a${Date.now()}`,
        role: "assistant",
        text: `${r.receipts.length} чеки з ${shops} за тиждень: ${r.ops.length} позицій. Дані прийшли структуровано, тому впевненість повна.`,
        card: { type: "intake_diff", ops: r.ops },
      },
    ]);
  }

  function invite() {
    const link = `https://kitchen.app/join/${Math.random().toString(36).slice(2, 10)}`;
    try {
      const r = navigator.clipboard && navigator.clipboard.writeText(link);
      if (r && r.catch) r.catch(() => {});
    } catch (e) {}
    setShowProfile(false);
    setTab("chat");
    setMessages((m) => [
      ...m,
      {
        id: `a${Date.now()}`,
        role: "assistant",
        text: `Посилання на комору скопійовано: ${link}\n\nХто перейде — бачитиме комору, обладнання, список покупок і календар. Свої обмеження, досвід і розмови матиме окремі. Твої сесії не побачить ніколи.`,
        card: null,
      },
    ]);
  }

  function shareRecipe(recipe) {
    const txt = [
      recipe.title,
      recipe.desc || "",
      "",
      recipe.ings.map((ri) => `${fmtQ(ri.v, ri.u)} ${ingName(ri)}`).join("\n"),
      "",
      recipe.steps
        .map((st, i) => `${i + 1}. ${st.title} — ${renderStep(st.content, recipe, recipe.base)}`)
        .join("\n"),
      recipe.risk ? `\n${recipe.risk}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const r = navigator.clipboard && navigator.clipboard.writeText(txt);
      if (r && r.catch) r.catch(() => {});
    } catch (e) {}
    setTab("chat");
    setMessages((m) => [
      ...m,
      {
        id: `a${Date.now()}`,
        role: "assistant",
        text: `«${recipe.title}» скопійовано текстом. У застосунку це буде посилання: хто відкриє — одразу побачить, чого з цього бракує в його власній коморі.`,
        card: null,
      },
    ]);
  }

  function startFresh(who) {
    try {
      window.storage.delete("kitchen:v1").catch(() => {});
    } catch (e) {}
    setPantry([]);
    setProfile({ ...EMPTY_PROFILE, name: who || (user && user.name) || null });
    setMemory([]);
    setCookHistory([]);
    setShopping([]);
    setSaved([]);
    setAudience([]);
    setOnboarding(1);
    const id = `s${Date.now()}`;
    setSessions([
      {
        id,
        title: "Знайомство",
        at: Date.now(),
        day: dayKey(Date.now()),
        messages: [
          {
            id: "m0",
            role: "assistant",
            text: `${who ? who + ", п" : "П"}ривіт. Я веду твою комору й готую разом із тобою — але поки що не знаю, що в тебе на кухні.\n\nПокажи: сфотографуй полицю чи холодильник, кинь чек, або просто перелічи текстом. Досить пʼяти-десяти позицій — повний інвентар не потрібен, решту доберемо по ходу.`,
            card: null,
          },
        ],
      },
    ]);
    setActiveId(id);
    setShowProfile(false);
    setTab("chat");
  }

  function pullRestrictions() {
    setProfile((p) => ({
      ...p,
      allergies: [...new Set([...(p.allergies || []), ...RETAIL_RESTRICTIONS.allergies])],
      antipatterns: [
        ...new Set([...(p.antipatterns || []), ...RETAIL_RESTRICTIONS.avoid.map((x) => `не люблю ${x}`)]),
      ],
    }));
  }

  function saveRecipe(recipe) {
    const frozen = freezeRecipe(recipe);
    setSaved((prev) =>
      prev.some((x) => x.title === frozen.title) ? prev : [frozen, ...prev]
    );
  }

  function unsaveRecipe(id) {
    setSaved((prev) => prev.filter((x) => x.id !== id));
  }

  function pickRecipe(recipe) {
    setMessages((m) => [
      ...m,
      { id: `a${Date.now()}`, role: "assistant", text: "", card: { type: "recipe", recipe } },
    ]);
  }

  function needsFor(recipe) {
    const m = matchRecipe(recipe, pantry, recipe.base);
    return m.missing.map((ri) =>
      shopItem(ingName(ri), `бракує до страви «${recipe.title}»`, { ing: ri.ing, value: ri.v, unit: ri.u })
    );
  }

  function stockUp(recipe) {
    const need = needsFor(recipe);
    if (need.length) addShopping(need);
  }

  function needOne(label, dish) {
    addShopping([shopItem(label, dish ? `докупити до страви «${dish}»` : "докупити")]);
  }

  function stockOne(ri, recipe) {
    addShopping([
      shopItem(ingName(ri), `бракує до страви «${recipe.title}»`, { ing: ri.ing, value: ri.v, unit: ri.u }),
    ]);
  }

  /* Уточнення працює однаково для згенерованого й імпортованого:
     той самий намір плюс правка, повторна генерація, картка заміщується. */
  /* Одна точка входу для будь-якого уточнення: страва з пропозиції,
     готовий рецепт або чернетка імпорту. Прив'язка приходить із поля вводу. */
  async function refineTarget(target, note) {
    if (target.shotId) {
      await scanPhotos(null, note, target.shotId);
      return;
    }
    if (target.draft) {
      await importRecipe(target.draft.sourceText || target.draft.title, note);
      return;
    }
    await refineRecipe(target.recipe || { title: target.title, sourceItem: target.sourceItem }, note);
  }

  async function refineRecipe(recipe, note) {
    const item = recipe.sourceItem || { title: recipe.title, character: recipe.character };
    setBuilding(recipe.title);
    try {
      const next = await callRecipeLLM(
        { ...item, pitch: `${item.pitch || ""} Правка від користувача: ${note}`.trim() },
        pantry,
        cuisine,
        profile,
        memory,
        cookHistory,
        audience
      );
      if (!next.ings.length) throw new Error("не зібралось");
      if (!next.steps.length) next.steps = await callStepsLLM(next);
      setStats({ ...next.stats, title: next.title });
      setMessages((m) => [
        ...m,
        { id: `a${Date.now()}`, role: "assistant", text: `Переробив: ${note}`, card: { type: "recipe", recipe: next } },
      ]);
    } catch (e) {
      setErr(String(e && e.message).slice(0, 160));
      setMessages((m) => [
        ...m,
        { id: `a${Date.now()}`, role: "assistant", text: `Не вдалось переробити: ${String(e && e.message).slice(0, 100)}`, card: null },
      ]);
    }
    setBuilding(null);
  }

  async function buildRecipe(item) {
    setBuilding(item.title);
    try {
      const recipe = await callRecipeLLM(item, pantry, cuisine, profile, memory, cookHistory, audience);
      if (!recipe.ings.length) throw new Error("інгредієнти не зібрались");
      if (!recipe.steps.length) {
        // кроки зрізало лімітом відповіді — добираємо другим викликом
        recipe.steps = await callStepsLLM(recipe);
      }
      if (!recipe.steps.length) throw new Error("кроки не зібрались");
      setStats({ ...recipe.stats, title: recipe.title });
      setMessages((m) => [
        ...m,
        { id: `a${Date.now()}`, role: "assistant", text: "", card: { type: "recipe", recipe } },
      ]);
      setMode("llm");
      setErr(null);
    } catch (e) {
      setErr(String(e && e.message).slice(0, 160));
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: `Не зміг зібрати рецепт: ${String(e && e.message).slice(0, 120)}. Спробуй ще раз або опиши страву в чаті.`,
          card: null,
        },
      ]);
    }
    setBuilding(null);
  }

  function startCook(recipe, servings) {
    setCook({ recipe, servings });
  }

  function finishCook(ops, verdict) {
    setPantry((prev) => {
      let next = [...prev];
      ops.forEach((o) => {
        const p = resolveIng(o.ri, next);
        if (!p) return;
        if (p.unit === o.unit) {
          const v = p.value - o.value;
          if (v <= 0) {
            next = next.map((x) =>
              x.id === p.id
                ? { ...x, state: "depleted", depletedAt: Date.now(), value: 0, lastBy: "Пилип", lastAction: "списано з приготування" }
                : x
            );
            addShopping([shopItem(p.label, "закінчилось після готування", { ing: p.key, zone: p.zone })]);
          } else {
            next = next.map((x) =>
              x.id === p.id
                ? { ...x, value: v, state: "opened", openedDaysAgo: 0, confidence: Math.min(x.confidence, 0.85), lastBy: "Пилип", lastAction: "списано з приготування" }
                : x
            );
          }
        } else {
          next = next.map((x) => (x.id === p.id ? { ...x, state: "opened", openedDaysAgo: 0, confidence: Math.min(x.confidence, 0.7) } : x));
        }
      });
      return next;
    });
    const title = cook.recipe.title;

    lastCooked.current = cook.recipe;
    setCookHistory((h) => [
      ...h,
      {
        id: `c${Date.now()}`,
        title,
        at: Date.now(),
        rating: null,
        verdict: null,
        servings: cook.servings,
        ings: cook.recipe.ings.map((ri) => ingName(ri)),
        recipe: freezeRecipe(cook.recipe),
      },
    ]);
    setCook(null);
    setTab("chat");
    setMessages((m) => [
      ...m,
      {
        id: `a${Date.now()}`,
        role: "assistant",
        text: `Списав ${ops.length} позицій після «${title}». Комора оновлена.`,
        card: { type: "cook_done" },
      },
    ]);
  }

  if (!user) return <LoginScreen onEnter={enter} />;

  return (
    <div className="w-full min-h-screen bg-stone-50 text-stone-900 flex justify-center">
      <div className="w-full max-w-[440px] flex flex-col h-screen border-x border-stone-200">
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <button
            onClick={() => setShowNav(true)}
            className="text-[16px] leading-none text-stone-600 px-1"
          >
            ☰
          </button>
          <div className="text-[13px] tracking-widest uppercase text-stone-600 truncate max-w-[40%]">
            {tab === "chat" ? active && active.title : { pantry: "Комора", recipes: "Рецепти", shop: "Список" }[tab]}
          </div>
          <div className="text-[10px] text-stone-400 ml-auto">
            {pantry.length} позицій{shopping.length > 0 && ` · список: ${shopping.length}`}
          </div>
          <button
            onClick={() => setShowProfile(true)}
            className="text-[11px] px-3 py-1 rounded-full border border-stone-300 text-stone-600"
          >
            я
          </button>
          <button
            onClick={copyLog}
            className="text-[11px] px-3 py-1 rounded-full border border-stone-300 text-stone-600"
          >
            лог
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <Boundary key={tab}>
          {tab === "chat" && (
            <ChatView
              messages={messages}
              onSend={send}
              busy={busy}
              mode={mode}
              err={err}
              pantry={pantry}
              shopping={shopping}
              profile={profile}
              audience={audience}
              onAudience={setAudience}
              household={household}
              shop={shopOps}
              onUndo={undoLast}
              onRegisterFix={(fn) => (startFixRef.current = fn)}
              onPhotos={scanPhotos}
              onDishPhoto={dishPhoto}
              scanning={scanning}
              onOpenSession={(id) => {
                setActiveId(id);
                setTab("chat");
              }}
              onApply={applyDiff}
              onApplyProfile={applyProfile}
              onPick={pickRecipe}
              onBuild={buildRecipe}
              building={building}
              importing={importing}
              onConfirmDraft={confirmDraft}
              onCook={startCook}
              onStock={stockUp}
              onStockOne={stockOne}
              onSave={saveRecipe}
              onRefine={refineRecipe}
              onRefineTarget={refineTarget}
              saved={saved}
              cuisine={cuisine}
              onCuisine={setCuisine}
              onNeed={needOne}
              onCopyLog={copyLog}
            />
          )}
          {tab === "pantry" && (
            <PantryView
              pantry={pantry}
              onDeplete={depleteItem}
              onRestore={restoreItem}
              onPurge={purgeDepleted}
              onPullReceipts={pullReceipts}
              onQuickAdd={quickAdd}
              onFix={fixItem}
              onGoChat={() => setTab("chat")}
              onOpen={(id) => setPantry((p) => p.map((x) => (x.id === id ? { ...x, state: "opened", openedDaysAgo: 0 } : x)))}
            />
          )}
          {tab === "recipes" && (
            <RecipesView
              pantry={pantry}
              shopping={shopping}
              saved={saved}
              profile={profile}
              history={cookHistory}
              onCook={startCook}
              onStock={stockUp}
              onStockOne={stockOne}
              onSave={saveRecipe}
              onRefine={refineRecipe}
              onUnsave={unsaveRecipe}
              onShare={shareRecipe}
              onImportOpen={() => setShowImport(true)}
              memory={memory}
            />
          )}
          {tab === "shop" && (
            <ShoppingView
              items={shopping}
              onToggle={(id) =>
                setShopping((prev) => prev.map((x) => (x.id === id ? { ...x, checked: !x.checked } : x)))
              }
              onMove={moveToPantry}
              onRemove={(id) => setShopping((prev) => prev.filter((x) => x.id !== id))}
              onClear={() => setShopping((prev) => prev.filter((x) => !x.checked))}
              onCart={buildCart}
            />
          )}
          </Boundary>
        </div>

        {tab !== "chat" && (
          <div className="flex border-t border-stone-200 shrink-0">
            <button onClick={() => setTab("chat")} className="flex-1 py-3 text-[12px] text-stone-500">
              ← до розмови
            </button>
          </div>
        )}
      </div>

      {showNav && (
        <NavDrawer
          sessions={sessions}
          activeId={activeId}
          tab={tab}
          counts={{ pantry: pantry.filter((p) => p.state !== "depleted").length, recipes: saved.length + RECIPES.length, shop: shopping.length }}
          occasions={activeOccasions(
            new Date(),
            traditionsFrom(profile.wishes || []).includes("catholic") ? "catholic" : "orthodox"
          )}
          onPick={(id) => {
            setActiveId(id);
            setTab("chat");
          }}
          onNew={newSession}
          onDelete={(id) =>
            setSessions((prev) => {
              const next = prev.filter((x) => x.id !== id);
              if (id === activeId && next.length) setActiveId(next[0].id);
              return next.length ? next : prev;
            })
          }
          onTab={setTab}
          onProfile={() => setShowProfile(true)}
          onClose={() => setShowNav(false)}
        />
      )}

      {showProfile && (
        <ProfileSheet
          profile={profile}
          setProfile={setProfile}
          memory={memory}
          history={cookHistory}
          memoryOps={memoryOps}
          household={household}
          onPullRestrictions={pullRestrictions}
          onInvite={invite}
          onStartFresh={startFresh}
          onLogout={logout}
          onClose={() => setShowProfile(false)}
        />
      )}

      {showImport && (
        <ImportSheet
          onClose={() => setShowImport(false)}
          onImport={importRecipe}
          busy={importing}
          error={importErr}
        />
      )}

      {log !== null && (
        <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col">
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <div className="text-[13px] text-stone-800 flex-1">Лог чату</div>
            <button
              onClick={() => {
                try {
                  const r = navigator.clipboard && navigator.clipboard.writeText(log);
                  if (r && r.catch) r.catch(() => {});
                } catch (e) {}
              }}
              className="text-[12px] px-3 py-1.5 rounded-full bg-stone-900 text-white"
            >
              копіювати
            </button>
            <button onClick={() => setLog(null)} className="text-stone-500 text-xl leading-none px-2">
              ×
            </button>
          </div>
          <textarea
            readOnly
            value={log}
            onFocus={(e) => e.target.select()}
            className="flex-1 m-4 mt-2 p-3 bg-white border border-stone-300 rounded-xl text-[11px] text-stone-700 font-mono outline-none resize-none"
          />
          <div className="px-4 pb-4 text-[11px] text-stone-500">
            Якщо кнопка копіювання не спрацювала — торкнись поля, воно виділиться повністю.
          </div>
        </div>
      )}

      {cook && (
        <CookMode
          recipe={cook.recipe}
          servings={cook.servings}
          step0={cook.step || 0}
          onStep={(i) => setCook((c) => (c ? { ...c, step: i } : c))}
          onMinimize={() => setCook((c) => ({ ...c, minimized: true }))}
          onClose={() => setCook(null)}
          onFinish={finishCook}
        />
      )}
    </div>
  );
}
