// Збирач каталогу: 131 стартова позиція (незмінна, першою) + позиції з data/raw/*.ndjson.
// Запуск: node build-seed.mjs           — записує seed.ts
//         node build-seed.mjs --dry     — тільки звіт, нічого не пише
//
// Правила збірки:
//  1. Стартові 131 позиції не редагуються і йдуть першими. Порядок масиву — це
//     неявний пріоритет: у logic.ts за рівного score виграє той, хто раніше в масиві.
//  2. Аліас нової позиції, що точно (після normalize) збігається з аліасом або назвою
//     стартової позиції, ВИДАЛЯЄТЬСЯ з нової. Стартові недоторканні.
//  3. Колізії алісів МІЖ новими позиціями дозволені (рішення власника продукту).
//     Розвʼязуються полем `priority`: власник аліаса отримує priority 10, решта — 0.
//     Власник — той, чия канонічна назва дорівнює аліасу; інакше той, у кого назва
//     найкоротша; за рівності — менший key за алфавітом.
//  4. allergen_groups із генераторів ігнорується і ставиться []. Алергени вносяться
//     окремим ручним списком data/allergens.manual.json (див. allergen-audit.md).

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const RAW = path.join(DIR, 'data', 'raw');
const SEED = path.join(DIR, 'seed.ts');
const DRY = process.argv.includes('--dry');

const ZONES = new Set(['dry', 'fridge', 'freezer', 'fresh', 'spices', 'drinks']);

function normalize(input) {
  return String(input).toLowerCase()
    .replace(/[ʼ'’ʹ`]/g, '')
    .replace(/[—–−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- 1. стартові 131 ----------
// Джерело стартових 131 — незмінна копія довоєнного seed.ts. Так збірка ідемпотентна:
// повторний запуск не сприймає щойно згенерований файл за «стартові».
const PRISTINE = path.join(DIR, 'data', 'seed.original.ts.bak');
const seedSrc = fs.readFileSync(fs.existsSync(PRISTINE) ? PRISTINE : SEED, 'utf8');
const openMark = 'export const CATALOG: CatalogItem[] = [\n';
const openIdx = seedSrc.indexOf(openMark);
const closeIdx = seedSrc.indexOf('\n];\n', openIdx);
if (openIdx < 0 || closeIdx < 0) throw new Error('не знайшов межі масиву CATALOG у seed.ts');

const headerSrc = seedSrc.slice(0, openIdx);          // коментар + interface
const originalsSrc = seedSrc.slice(openIdx + openMark.length, closeIdx + 1); // тіло, дослівно
const tailSrc = seedSrc.slice(closeIdx + '\n];\n'.length);

const origKeys = [...originalsSrc.matchAll(/^\s*key: '([^']+)'/gm)].map((m) => m[1]);
const origAliasTokens = new Set();
for (const m of originalsSrc.matchAll(/^\s*aliases: \[([^\]]*)\]/gm)) {
  for (const a of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) origAliasTokens.add(normalize(a[1].replace(/\\'/g, "'")));
}
for (const m of originalsSrc.matchAll(/^\s*name: '((?:[^'\\]|\\.)*)'/gm)) {
  origAliasTokens.add(normalize(m[1].replace(/\\'/g, "'")));
}

// ---------- 2. нові позиції ----------
const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.ndjson')).sort();
const report = { files: {}, dropped: [], renamedKeys: [], strippedAliases: [], collisions: [] };
const usedKeys = new Set(origKeys);
const items = [];

for (const f of files) {
  const stat = { read: 0, kept: 0, dropped: 0 };
  const lines = fs.readFileSync(path.join(RAW, f), 'utf8').split('\n').filter((l) => l.trim());
  for (const line of lines) {
    stat.read++;
    let o;
    try { o = JSON.parse(line); } catch { stat.dropped++; report.dropped.push([f, 'bad json']); continue; }

    // --- схема ---
    const problems = [];
    if (typeof o.key !== 'string' || !/^[a-z0-9_]+$/.test(o.key)) problems.push('key');
    if (typeof o.name !== 'string' || !o.name.trim()) problems.push('name');
    if (!Array.isArray(o.aliases)) problems.push('aliases');
    if (!Array.isArray(o.categories) || o.categories.length < 2) problems.push('categories');
    if (!ZONES.has(o.zone_default)) problems.push('zone_default');
    if (problems.length) { stat.dropped++; report.dropped.push([f, o.key ?? '?', problems.join(',')]); continue; }

    // --- key ---
    let key = o.key;
    if (usedKeys.has(key)) {
      let n = 2;
      while (usedKeys.has(`${key}_${n}`)) n++;
      report.renamedKeys.push([f, key, `${key}_${n}`]);
      key = `${key}_${n}`;
    }
    usedKeys.add(key);

    // --- аліаси: чистка, дедуп, зняття збігів зі стартовими ---
    const seen = new Set();
    const aliases = [];
    for (const raw of o.aliases) {
      if (typeof raw !== 'string') continue;
      const a = raw.replace(/[­​-‍﻿]/g, '').trim();
      if (a.length < 3) continue;
      const n = normalize(a);
      if (!n || seen.has(n)) continue;
      if (origAliasTokens.has(n)) { report.strippedAliases.push([key, a]); continue; }
      seen.add(n);
      aliases.push(a);
    }
    if (!aliases.length) { stat.dropped++; report.dropped.push([f, key, 'аліаси порожні після чистки']); continue; }

    // --- категорії ---
    const cats = [];
    const seenCat = new Set();
    for (const c of o.categories) {
      if (typeof c !== 'string') continue;
      const cc = c.trim();
      const n = normalize(cc);
      if (!n || seenCat.has(n)) continue;
      seenCat.add(n);
      cats.push(cc);
    }
    if (cats.length < 2) { stat.dropped++; report.dropped.push([f, key, 'мало категорій']); continue; }

    const item = {
      key, name: o.name.trim(), aliases, categories: cats,
      allergen_groups: [],                       // завжди порожньо на цьому етапі
      zone_default: o.zone_default,
      source: f,
    };
    if (Number.isFinite(o.unit_weight) && o.unit_weight > 0) item.unit_weight = Math.round(o.unit_weight);
    if (Number.isFinite(o.density) && o.density > 0) item.density = Number(o.density);
    // Раунд 5, крок Н1: у сирих файлах стара форма {kcal,p,f,c} — оцінка генератора.
    // Ккал не зберігаємо (рахує kcalOf у домені), джерело — estimate; звірені
    // значення накладаються далі з data/nutrition.base.json.
    if (o.nutrition && ['p', 'f', 'c'].every((k) => Number.isFinite(o.nutrition[k]))) {
      item.nutrition = {
        protein: Math.round(o.nutrition.p), fat: Math.round(o.nutrition.f), carbs: Math.round(o.nutrition.c),
        source: 'estimate',
      };
    }
    items.push(item);
    stat.kept++;
  }
  report.files[f] = stat;
}

// ---------- 2b. злиття ручно звірених дублікатів ----------
const mergesPath = path.join(DIR, 'data', 'merges.json');
report.merged = [];
if (fs.existsSync(mergesPath)) {
  const merges = JSON.parse(fs.readFileSync(mergesPath, 'utf8'));
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const [loserKey, winnerKey] of Object.entries(merges)) {
    if (loserKey.startsWith('_')) continue;
    const loser = byKey.get(loserKey), winner = byKey.get(winnerKey);
    if (!loser || !winner) { report.merged.push([loserKey, winnerKey, 'НЕ ЗНАЙДЕНО']); continue; }
    const seenA = new Set(winner.aliases.map(normalize));
    for (const a of loser.aliases) { const n = normalize(a); if (!seenA.has(n)) { seenA.add(n); winner.aliases.push(a); } }
    const seenC = new Set(winner.categories.map(normalize));
    for (const c of loser.categories) { const n = normalize(c); if (!seenC.has(n)) { seenC.add(n); winner.categories.push(c); } }
    if (!winner.nutrition && loser.nutrition) winner.nutrition = loser.nutrition;
    if (!winner.unit_weight && loser.unit_weight) winner.unit_weight = loser.unit_weight;
    if (!winner.density && loser.density) winner.density = loser.density;
    loser._drop = true;
    report.merged.push([loserKey, winnerKey, 'ok']);
  }
  for (let i = items.length - 1; i >= 0; i--) if (items[i]._drop) items.splice(i, 1);
}

// ---------- 3. колізії алісів між новими ----------
const byAlias = new Map();
for (const it of items) for (const a of it.aliases) {
  const n = normalize(a);
  if (!byAlias.has(n)) byAlias.set(n, []);
  byAlias.get(n).push(it);
}
for (const [alias, claimants] of byAlias) {
  if (claimants.length < 2) continue;
  const exact = claimants.filter((c) => normalize(c.name) === alias);
  const pool = exact.length ? exact : claimants;
  pool.sort((a, b) => normalize(a.name).length - normalize(b.name).length || (a.key < b.key ? -1 : 1));
  const owner = pool[0];
  owner.priority = 10;
  report.collisions.push([alias, owner.key, claimants.filter((c) => c !== owner).map((c) => c.key)]);
}

// ---------- 4. ручні алергени ----------
const manualPath = path.join(DIR, 'data', 'allergens.manual.json');
let manual = {};
if (fs.existsSync(manualPath)) {
  manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  for (const it of items) {
    const rec = manual[it.key];
    if (rec && Array.isArray(rec.groups)) it.allergen_groups = rec.groups;
  }
}
const withAllergens = items.filter((i) => i.allergen_groups.length).length;

// ---------- 4б. звірені БЖВ (раунд 5, крок Н1) ----------
// data/nutrition.base.json — результат scripts/nutrition/apply-base.ts: key →
// { protein, fat, carbs, fiber?, sugars?, sodium_mg?, source: 'usda:<id>' | 'ciqual:<code>' }.
// Накладається і на додані, і на стартові 131 (у тих — текстом, нижче).
const basePath = path.join(DIR, 'data', 'nutrition.base.json');
const baseNutrition = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : {};
const NUTRI_KEYS = ['protein', 'fat', 'carbs', 'fiber', 'sugars', 'sodium_mg'];
function nutritionFromBase(rec) {
  const n = {};
  for (const k of NUTRI_KEYS) if (Number.isFinite(rec[k])) n[k] = rec[k];
  n.source = rec.source;
  return n;
}
let sourced = 0;
for (const it of items) {
  const rec = baseNutrition[it.key];
  if (rec) { it.nutrition = nutritionFromBase(rec); sourced++; }
}
function nutritionLiteral(n) {
  const parts = NUTRI_KEYS.filter((k) => n[k] !== undefined).map((k) => `${k}: ${n[k]}`);
  parts.push(`source: '${n.source}'`);
  return `{ ${parts.join(', ')} }`;
}
// Стартові 131 — дослівний текст, тож БЖВ там переписуємо регуляркою:
// стара форма → нова (estimate), а якщо є звірений рядок — його.
const originalsPatched = originalsSrc.split(/(?=\n  \{\n)/).map((block) => {
  const key = /^\s*key: '([^']+)'/m.exec(block)?.[1];
  return block.replace(/nutrition: \{ kcal: [^}]*\}/, (lit) => {
    const rec = key && baseNutrition[key];
    if (rec) { sourced++; return `nutrition: ${nutritionLiteral(nutritionFromBase(rec))}`; }
    const num = (k) => Number(/(?:^|[\s{,])PLACEHOLDER: ([0-9.]+)/.source && new RegExp(`(?:^|[\\s{,])${k}: ([0-9.]+)`).exec(lit)?.[1]);
    return `nutrition: ${nutritionLiteral({ protein: num('p'), fat: num('f'), carbs: num('c'), source: 'estimate' })}`;
  });
}).join('');

// ---------- 5. емісія ----------
function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
function arr(a) { return '[' + a.map(q).join(', ') + ']'; }

function emit(it) {
  const l = ['  {'];
  l.push(`    key: ${q(it.key)},`);
  l.push(`    name: ${q(it.name)},`);
  l.push(`    aliases: ${arr(it.aliases)},`);
  l.push(`    categories: ${arr(it.categories)},`);
  l.push(`    allergen_groups: ${arr(it.allergen_groups)},`);
  l.push(`    zone_default: ${q(it.zone_default)},`);
  if (it.priority) l.push(`    priority: ${it.priority},`);
  if (it.unit_weight) l.push(`    unit_weight: ${it.unit_weight},`);
  if (it.density) l.push(`    density: ${it.density},`);
  if (it.nutrition) l.push(`    nutrition: ${nutritionLiteral(it.nutrition)},`);
  l.push('  },');
  return l.join('\n');
}

const total = origKeys.length + items.length;
const header = `// Каталог інгредієнтів Kitchen OS — ${total} позицій.
//
// Перші ${origKeys.length} — стартові: 16 критеріальних + 115 із живого чеку/комори
// (Metro, 17.08.2026). Вони НЕ редагувалися при розширенні і лишаються першими в
// масиві: у logic.ts за рівного score виграє той, хто раніше, — це тримає три
// критеріальні тести рівно такими, якими вони були.
//
// Решта ${items.length} згенеровані по категоріях і зібрані build-seed.mjs із
// data/raw/*.ndjson. Джерело правди — ті NDJSON-файли; цей seed.ts перезбирається
// командою \`node build-seed.mjs\`. Руками його не правлять.
//
// allergen_groups заповнене ЛИШЕ для позицій із ручного списку
// data/allergens.manual.json (${withAllergens} позицій). Порожній масив тут означає
// «не перевірено людиною», а не «алергенів немає». Механіка алергій працює також
// через categories: itemMatchesAllergen() дивиться і туди (сир → «молочне»,
// креветка → «ракоподібні»), тому чесна таксономія категорій — основне покриття.
// Див. allergen-audit.md.
//
// priority — необовʼязковий тай-брейкер для випадків, коли той самий аліас ведуть
// дві позиції. Використовується лише за рівного score. За замовчуванням 0.
//
// nutrition — БЖВ на 100 г без ккал (рахує kcalOf у домені) з джерелом:
// usda:<fdc_id> / ciqual:<code> — звірені (data/nutrition.base.json, ${sourced} позицій),
// estimate — оцінка генератора. Див. nutrition.ts.

import type { Nutrition } from './nutrition.js';

export interface CatalogItem {
  key: string;
  name: string;                  // канонічна назва для людини
  aliases: string[];             // як зустрічається в чеках і мовленні
  categories: string[];          // ієрархія від конкретного до загального
  allergen_groups: string[];     // «молюски», «горіхи», «глютен», «молочне» ...
  zone_default: 'dry' | 'fridge' | 'freezer' | 'fresh' | 'spices' | 'drinks';
  priority?: number;             // тай-брейкер за рівного score; 0 за замовчуванням
  unit_weight?: number;
  density?: number;
  nutrition?: Nutrition;
}

`;

// Масив ріжеться на частини по 300: на 2341 літералі поспіль tsc падає з TS2590
// («union type too complex»). Тип у рантаймі той самий, це суто компіляторна межа.
const CHUNK = 300;
const parts = [];
const chunks = [];
chunks.push('const CATALOG_0: CatalogItem[] = [\n' + originalsPatched + '];\n');
parts.push('CATALOG_0');
for (let i = 0; i < items.length; i += CHUNK) {
  const n = parts.length;
  chunks.push(`const CATALOG_${n}: CatalogItem[] = [\n` + items.slice(i, i + CHUNK).map(emit).join('\n') + '\n];\n');
  parts.push(`CATALOG_${n}`);
}

const out = header + chunks.join('\n') +
  `\nexport const CATALOG: CatalogItem[] = [\n${parts.map((p) => '  ...' + p).join(',\n')},\n];\n` + tailSrc;

if (!DRY) fs.writeFileSync(SEED, out);

// ---------- звіт ----------
const line = (a, b) => console.log(String(a).padEnd(28), b);
console.log('=== ЗБІРКА КАТАЛОГУ ===');
line('стартових (незмінних)', origKeys.length);
line('нових прийнято', items.length);
line('ВСЬОГО', total);
line('з nutrition', items.filter((i) => i.nutrition).length + ' / ' + items.length);
line('з ручними алергенами', withAllergens);
line('відкинуто', report.dropped.length);
line('перейменовано ключів', report.renamedKeys.length);
line('знято алісів (конфлікт з 131)', report.strippedAliases.length);
line('злито дублікатів', (report.merged||[]).length);
line('колізій алісів між новими', report.collisions.length);
console.log('\n--- по файлах ---');
for (const [f, s] of Object.entries(report.files)) console.log(String(f).padEnd(26), `прийнято ${s.kept}, відкинуто ${s.dropped}`);
if (report.dropped.length) { console.log('\n--- відкинуті ---'); report.dropped.slice(0, 40).forEach((d) => console.log(' ', d.join(' | '))); }
if (report.renamedKeys.length) { console.log('\n--- перейменовані ключі ---'); report.renamedKeys.forEach((d) => console.log(' ', d.join(' -> '))); }
if (report.strippedAliases.length) { console.log('\n--- зняті аліаси (вели в стартові 131) ---'); report.strippedAliases.slice(0, 60).forEach((d) => console.log(' ', d.join(' | '))); }
if (report.collisions.length) { console.log('\n--- колізії алісів (власник / решта) ---'); report.collisions.slice(0, 80).forEach(([a, o, r]) => console.log('  ' + a.padEnd(28), o, '<-', r.join(','))); }
fs.writeFileSync(path.join(DIR, 'data', 'build-report.json'), JSON.stringify(report, null, 1));
