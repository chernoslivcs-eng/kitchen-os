// Одноразовий матеріалізатор ручного списку алергенів.
//
// ЩО ЦЕ Є І ЧИМ НЕ Є. Це НЕ рантаймова деривація: logic.ts нічого не виводить із
// категорій. Скрипт лише РОЗГОРТАЄ список у явні записи «key → групи + підстава»,
// які лягають у data/allergens.manual.json і далі вшиваються в seed.ts. Кожен запис
// у результаті видно поіменно, кожен можна викреслити рукою.
//
// Категорія тут — інструмент пропозиції, а не авторитет. Авторитет — списки
// EXCLUDE нижче: позиції, які категорія б зачепила, але за складом вони туди не
// належать (безглютенове печиво на мигдалі, кава 3в1 на рослинних вершках, паста
// том ям із брендозалежним складом). Ці списки складені руками, з очима на назві.
//
// Дві сили підстави:
//   'ідентичність'  — алерген і є продукт: сир це молочне, креветка це ракоподібні.
//   'рецептура'     — класична рецептура продукту містить алерген (майонез — яйце,
//                     тірамісу — яйце й молочне). Тут можливе брендове відхилення.
// Усе, що слабше за ці дві, у список не потрапляє: лишається [].

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(DIR, '..', 'seed.ts'), 'utf8');
const items = [];
const re = /\{\s*key: '([^']+)',\s*name: '((?:[^'\\]|\\.)*)',\s*aliases: \[[^\]]*\],\s*categories: \[([^\]]*)\]/g;
let m;
while ((m = re.exec(src))) {
  items.push({
    key: m[1],
    name: m[2].replace(/\\'/g, "'"),
    cats: [...m[3].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]),
  });
}
const added = items.slice(131);
const byKey = new Map(added.map((i) => [i.key, i]));

// --- позиції, які категорія зачепила б помилково (перевірено очима) ---
const EXCLUDE = {
  'молочне': [
    'coffee_3in1', 'coffee_2in1', 'coffee_latte_instant', 'coffee_cappuccino_instant',
    'coffee_3in1_plant', 'sweet_protein_bar', 'sauce_ranch',
  ],
  'ракоподібні': ['paste_tom_yum'],
  'риба': ['spice_furikake'],
  'горіхи': [
    'nut_chestnut',            // каштан не входить у перелік деревних горіхів ЄС
    'alc_amaretto',            // класичний амаретто — на кісточках абрикоса, не на мигдалі
    'sauce_satay', 'choc_bar_snickers', 'sweet_kozinak_peanut', 'sweet_sherbet', // це арахіс, не деревні
  ],
  'яйця': ['sauce_ranch', 'sauce_shawarma', 'sauce_garlic_creamy'],
  'глютен': [],
};

// --- родини: категорія-пропозиція → група + сила підстави ---
const FAMILIES = [
  { group: 'молочне',     cats: ['молочне'] },
  { group: 'риба',        cats: ['риба'] },
  { group: 'молюски',     cats: ['молюски'] },
  { group: 'ракоподібні', cats: ['ракоподібні'] },
  { group: 'горіхи',      cats: ['горіхи'] },
  { group: 'арахіс',      cats: ['арахіс'] },
  { group: 'кунжут',      cats: ['кунжут'] },
  { group: 'соя',         cats: ['соя'] },
  { group: 'яйця',        cats: ['яйця'] },
  { group: 'селера',      cats: ['селера'] },
  { group: 'гірчиця',     cats: ['гірчиця'] },
  { group: 'глютен',      cats: ['пшениця', 'жито', 'ячмінь', 'спельта', 'полба', 'булгур', 'кускус', 'манка'] },
];

// --- те, що категорії не дістали: додано руками ---
const MANUAL_ADD = {
  frz_pelmeni_pork: ['глютен'],
  frz_pelmeni: ['глютен'],
  bake_oat_cookies: ['глютен'],
  baby_biscuits: ['глютен'],
  baby_bagel_rings: ['глютен'],
  bread_crispbread_multigrain: ['глютен'],
  sweet_sherbet: ['арахіс'],
  sauce_satay: ['арахіс'],
  choc_bar_snickers: ['арахіс'],
  sweet_kozinak_peanut: ['арахіс'],
};

// «Рецептура», а не «ідентичність»: композит, де алерген іде з класичного рецепта.
const COMPOSITE_MARKERS = ['соус', 'солодке', 'готове', 'напої', 'дитяче харчування', 'заморожене',
  'снеки', 'випічка', 'торт', 'десерт', 'приправа', 'напівфабрикат', 'алкоголь', 'консерви', 'батончик', 'цукерки'];

const out = {};
for (const it of added) {
  const groups = new Set(MANUAL_ADD[it.key] ?? []);
  for (const fam of FAMILIES) {
    if (!fam.cats.some((c) => it.cats.includes(c))) continue;
    if ((EXCLUDE[fam.group] ?? []).includes(it.key)) continue;
    groups.add(fam.group);
  }
  if (!groups.size) continue;
  const composite = it.cats.some((c) => COMPOSITE_MARKERS.includes(c));
  out[it.key] = {
    groups: [...groups].sort(),
    basis: composite ? 'рецептура' : 'ідентичність',
    name: it.name,
  };
}

const header = {
  _: 'Ручний список алергенів. Кожен запис — явний, поіменний, із підставою. ' +
     'basis=ідентичність: алерген і є продукт (сир → молочне). basis=рецептура: класична ' +
     'рецептура містить алерген, можливе брендове відхилення (майонез → яйця). ' +
     'Порожній allergen_groups у seed.ts означає «не перевірено людиною», а не «алергенів немає». ' +
     'Файл перезбирається node data/build-allergens.mjs, але правки руками в ньому легітимні: ' +
     'скрипт лише розгортає список, авторитет — цей файл.',
};
const final = { ...header, ...Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1))) };
fs.writeFileSync(path.join(DIR, 'allergens.manual.json'), JSON.stringify(final, null, 1));

const stats = {};
for (const v of Object.values(out)) for (const g of v.groups) stats[g] = (stats[g] ?? 0) + 1;
console.log('позицій зі списком:', Object.keys(out).length);
console.log('ідентичність:', Object.values(out).filter((v) => v.basis === 'ідентичність').length,
            '| рецептура:', Object.values(out).filter((v) => v.basis === 'рецептура').length);
console.log(Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(' · '));
const missing = [...Object.keys(MANUAL_ADD)].filter((k) => !byKey.has(k));
if (missing.length) console.log('УВАГА, ключів з MANUAL_ADD немає в каталозі:', missing.join(', '));
