// Раунд 5, крок Н1 (§3): кожна позиція каталогу → рядок бази БЖВ.
//
// Вхід:  data/nutrition/base.csv (§1), scripts/nutrition/aliases.json,
//        packages/catalog/seed.ts (поточний каталог)
// Вихід: packages/catalog/data/nutrition.base.json — { key: { protein, fat, carbs,
//        fiber?, sugars?, sodium_mg?, source, base } } для build-seed.mjs;
//        packages/catalog/seed.ts переписується НА МІСЦІ: nutrition кожної позиції
//        → { protein, fat, carbs, …, source } (оцінка — estimate, звірене — з бази).
//        Текстом, а не перебудовою з data/raw: у комітному seed.ts є позиції й
//        правки поза raw (крем-брускетта, косметичні тоніки, аліас «бланк»), і
//        node build-seed.mjs їх затер би. build-seed.mjs емітить ту саму форму.
//        + JSON-звіт (--report): покриття, 30 випадкових замін «було → стало»,
//        порушення санітарної перевірки (їх у файл не пишемо).
// Рядки бази з source=estimate позицію не міняють: оцінку на оцінку не міняємо.
//
// ЕТАП 4 (22.09), головне про цей конвеєр: матчер бачить назву ПОЗИЦІЇ КАТАЛОГУ
// (CATALOG[i].name), а не назву продукту в домі. Усе, що написано на партії й
// чого нема в каталозі — «…25 %», «…в олії», «суха суміш», «з трюфелем», — у
// ланцюг не потрапляє взагалі. Тому рядок бази, скільки б точним він не був,
// доїжджає лише до тієї позиції каталогу, чия НАЗВА його називає.
//
// Через це частина рядків етапу 4 лежить без роботи, доки етап 3 не поставить
// партіям правильні ключі. Коментарів у base.csv бути не може (парсер читає
// кожен непорожній рядок як запис бази), тому список — тут:
//   Оливки зелені в олії        — Chupadedos сидять на загальному `olives_green`
//   Олія оливкова ароматизована — три партії на `olive_oil_evoo`
//   Желе суха суміш             — чотири партії на `fruit_jelly` (готове желе)
//   Соєвий соус столовий        — три партії на `soy_sauce` (японський shoyu)
//   Джем фруктовий (extra)      — на `jam_mixed`
//   Майонез 30% / 67% / 72%     — у каталозі нема позицій із цими відсотками
//   Томатна паста 30%           — те саме
// Живими одразу стали: Гірчиця, Кетчуп, Оливки чорні каламата, Горошок зелений
// консервований, Горошок зелений мозковий, Ковбаса сировʼялена, Гріссіні,
// Цукор тростинний, Майонез 50%, Томатна паста 25%, Вино безалкогольне (×2) і
// Локшина швидкого приготування (×5 — рядок був, маршруту не було).
// Етап 2 (22.09): нове джерело label:<домен>@<ISO-дата> — застосовується
// нарівні з usda/ciqual (не estimate — правило вище на нього не діє).
// Формат перевіряється (кине помилку збірки на невалідний), і якщо в CSV є
// 11-та колонка (заявлені ккал з етикетки) — звіряється з 4-4-9, >±10% —
// рядок у санітарні порушення, не в каталог.
// Запуск: npx tsx scripts/nutrition/apply-base.ts [--report path.json]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../../packages/catalog/seed.ts';
import { BaseMatcher, type NutritionAliases } from '../../packages/catalog/nutrition-match.ts';
import { isValidLabelSource, type Nutrition } from '../../packages/catalog/nutrition.ts';
import { kcalOf, nutritionIssue } from '../../packages/domain/nutrition.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportArg = process.argv.indexOf('--report');
const REPORT = reportArg > -1 ? process.argv[reportArg + 1]! : join(ROOT, 'data/nutrition/apply-report.json');
const OUT = join(ROOT, 'packages/catalog/data/nutrition.base.json');

const aliases = JSON.parse(readFileSync(join(ROOT, 'scripts/nutrition/aliases.json'), 'utf-8')) as NutritionAliases;
const lines = readFileSync(join(ROOT, 'data/nutrition/base.csv'), 'utf-8').split('\n').slice(1).filter(Boolean);
const num = (s: string | undefined) => (s === undefined || s === '' ? undefined : Number(s));
const base = new Map<string, Nutrition>();
const states = new Map<string, string>();
// Етап 2, п.5: заявлені на етикетці ккал (11-та, необов'язкова колонка) —
// для label:-рядків звіряємо з 4-4-9 (±10%), щоб зловити сміттєвий рядок
// (розвідка Сільпо: тунець Rio Mare заявляв 427 ккал при складі на ~100).
const declaredKcal = new Map<string, number>();
for (const l of lines) {
  const [name, state, protein, fat, carbs, fiber, sugars, sodium, source, alcohol, kcalLabel] = l.split(';');
  // Етап 2, п.4: формат label:<домен>@<ISO-дата> — погана форма НЕ пропускається
  // мовчки (домен/дата обов'язкові — інакше за півроку не видно, що саме
  // перевіряли і коли).
  if (source?.startsWith('label:') && !isValidLabelSource(source)) {
    throw new Error(`data/nutrition/base.csv: невалідне джерело "${source}" у рядку "${name}" — формат label:<домен>@<ISO-дата> (напр. label:veres.ua@2026-09-22)`);
  }
  states.set(name!, state!);
  const n: Nutrition = { protein: num(protein) ?? 0, fat: num(fat) ?? 0, carbs: num(carbs) ?? 0, source: source as Nutrition['source'] };
  if (num(fiber) !== undefined) n.fiber = num(fiber);
  if (num(sugars) !== undefined) n.sugars = num(sugars);
  if (num(sodium) !== undefined) n.sodium_mg = num(sodium);
  if (num(alcohol) !== undefined) n.alcohol = num(alcohol);
  base.set(name!, n);
  if (num(kcalLabel) !== undefined) declaredKcal.set(name!, num(kcalLabel)!);
}

const matcher = new BaseMatcher([...base.keys()], aliases, states);
const out: Record<string, Nutrition & { base: string }> = {};
const stats = { catalog: CATALOG.length, with_nutrition: 0, matched: 0, by_rule: {} as Record<string, number>, usda: 0, ciqual: 0, label: 0, base_estimate_skipped: 0, sanity_violations: [] as { key: string; base: string; issue: string }[], estimate_left: 0 };
const replacements: { key: string; name: string; base: string; rule: string; was: string; now: string }[] = [];

for (const item of CATALOG) {
  if (item.nutrition) stats.with_nutrition++;
  const m = matcher.match(item);
  if (!m) continue;
  const n = base.get(m.base)!;
  if (n.source === 'estimate') { stats.base_estimate_skipped++; continue; }
  const issue = nutritionIssue(n);
  if (issue) { stats.sanity_violations.push({ key: item.key, base: m.base, issue }); continue; }
  // Етап 2, п.5: заявлені ккал (якщо в CSV є значення) проти 4-4-9 — >±10%
  // означає сміттєвий рядок (склад одне, заявлені ккал зовсім інше).
  if (n.source.startsWith('label:')) {
    const declared = declaredKcal.get(m.base);
    if (declared !== undefined) {
      const computed = kcalOf(n);
      const diffPct = Math.abs(computed - declared) / declared * 100;
      if (diffPct > 10) {
        stats.sanity_violations.push({ key: item.key, base: m.base, issue: `заявлено ${declared} ккал, за 4-4-9 ${computed} — розбіжність ${diffPct.toFixed(1)}% > 10%` });
        continue;
      }
    }
  }
  stats.matched++;
  stats.by_rule[m.rule] = (stats.by_rule[m.rule] ?? 0) + 1;
  if (n.source.startsWith('usda:')) stats.usda++;
  else if (n.source.startsWith('label:')) stats.label++;
  else stats.ciqual++;
  out[item.key] = { ...n, base: m.base };
  const old = item.nutrition as unknown as { kcal?: number; p?: number; f?: number; c?: number; protein?: number; fat?: number; carbs?: number } | undefined;
  const was = old
    ? ('protein' in old
      ? `Б${old.protein} Ж${old.fat} В${old.carbs} → ${kcalOf({ protein: old.protein!, fat: old.fat!, carbs: old.carbs! })} ккал`
      : `Б${old.p} Ж${old.f} В${old.c} → ${old.kcal} ккал`)
    : 'без БЖВ';
  replacements.push({ key: item.key, name: item.name, base: m.base, rule: m.rule, was, now: `Б${n.protein} Ж${n.fat} В${n.carbs} → ${kcalOf(n)} ккал (${n.source})` });
}
stats.estimate_left = CATALOG.filter((i) => i.nutrition && !out[i.key]).length;

// 30 випадкових замін — детерміновано (крок по списку), щоб звіт відтворювався.
const step = Math.max(1, Math.floor(replacements.length / 30));
const sample = replacements.filter((_, i) => i % step === 0).slice(0, 30);

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

// ----- seed.ts на місці -----
const SEED = join(ROOT, 'packages/catalog/seed.ts');
// Оцінка генератора з data/raw — щоб позиція, яка перестала збігатися з базою
// (наприклад, після нового стоп-слова), повернулась до своєї оцінки, а не
// лишилась зі звіреними числами під підписом estimate.
const RAW_DIR = join(ROOT, 'packages/catalog/data/raw');
const rawEstimate = new Map<string, Nutrition>();
for (const f of readdirSync(RAW_DIR).filter((x) => x.endsWith('.ndjson'))) {
  for (const line of readFileSync(join(RAW_DIR, f), 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { key?: string; nutrition?: { p?: number; f?: number; c?: number } };
      const n = o.nutrition;
      if (o.key && n && [n.p, n.f, n.c].every((v) => Number.isFinite(v))) {
        rawEstimate.set(o.key, { protein: Math.round(n.p!), fat: Math.round(n.f!), carbs: Math.round(n.c!), source: 'estimate' });
      }
    } catch { /* зіпсований рядок — пропускаємо, збирач його теж не бере */ }
  }
}
const NUTRI_KEYS = ['protein', 'fat', 'carbs', 'fiber', 'sugars', 'sodium_mg', 'alcohol'] as const;
const literal = (n: Nutrition) => {
  const parts = NUTRI_KEYS.filter((k) => n[k] !== undefined).map((k) => `${k}: ${n[k]}`);
  parts.push(`source: '${n.source}'`);
  return `{ ${parts.join(', ')} }`;
};
let seed = readFileSync(SEED, 'utf-8');
let rewritten = 0, sourcedInSeed = 0;
seed = seed.split(/(?=\n  \{\n)/).map((block) => {
  const key = /^\s*key: '([^']+)'/m.exec(block)?.[1];
  // Позиція без БЖВ, але зі звіреним рядком — додаємо поле перед закриттям.
  if (key && out[key] && !/nutrition: \{/.test(block)) {
    const { base: _b, ...n } = out[key]!;
    sourcedInSeed++; rewritten++;
    return block.replace(/\n  \},/, `\n    nutrition: ${literal(n)},\n  },`);
  }
  return block.replace(/nutrition: \{ [^}]*\}/, (lit) => {
    rewritten++;
    const rec = key ? out[key] : undefined;
    if (rec) { sourcedInSeed++; const { base: _b, ...n } = rec; return `nutrition: ${literal(n)}`; }
    const num = (k: string) => Number(new RegExp(`(?:^|[\\s{,])${k}: ([0-9.]+)`).exec(lit)?.[1]);
    // Була звіреною, а тепер не збігається — назад до оцінки генератора.
    if (/source: '(usda|ciqual):/.test(lit) && key && rawEstimate.has(key)) return `nutrition: ${literal(rawEstimate.get(key)!)}`;
    // стара форма {kcal,p,f,c} або вже нова — читаємо обидві
    const n: Nutrition = /\bprotein:/.test(lit)
      ? { protein: num('protein'), fat: num('fat'), carbs: num('carbs'), source: 'estimate' }
      : { protein: num('p'), fat: num('f'), carbs: num('c'), source: 'estimate' };
    for (const k of ['fiber', 'sugars', 'sodium_mg', 'alcohol'] as const) { const v = new RegExp(`\\b${k}: ([0-9.]+)`).exec(lit)?.[1]; if (v !== undefined) n[k] = Number(v); }
    return `nutrition: ${literal(n)}`;
  });
}).join('');
seed = seed.replace(/  nutrition\?: \{ kcal: number; p: number; f: number; c: number \};/, '  nutrition?: Nutrition;');
if (!seed.includes("import type { Nutrition } from './nutrition.js';")) {
  seed = seed.replace('\nexport interface CatalogItem {', `\n// nutrition — БЖВ на 100 г без ккал (рахує kcalOf у домені) з джерелом:
// usda:<fdc_id> / ciqual:<code> — звірені (scripts/nutrition/apply-base.ts, data/nutrition.base.json),
// estimate — оцінка генератора. Див. nutrition.ts.

import type { Nutrition } from './nutrition.js';

export interface CatalogItem {`);
}
writeFileSync(SEED, seed);
console.log(`seed.ts: nutrition rewritten ${rewritten}, with source ${sourcedInSeed}`);
writeFileSync(REPORT, JSON.stringify({ ...stats, sample }, null, 2));
console.log(`catalog ${stats.catalog} · had nutrition ${stats.with_nutrition} · matched ${stats.matched} (usda ${stats.usda}, ciqual ${stats.ciqual}) · rules ${JSON.stringify(stats.by_rule)} · base estimate skipped ${stats.base_estimate_skipped} · sanity violations ${stats.sanity_violations.length} · estimate left ${stats.estimate_left} · without nutrition ${stats.catalog - stats.with_nutrition - CATALOG.filter((i) => !i.nutrition && out[i.key]).length}`);
console.log(`→ ${OUT}\n→ ${REPORT}`);
