#!/usr/bin/env node
// Сироти в CSS-модулях: класи в apps/web/src/**/*.module.css, на які немає
// посилання з коду (аудит 0913, Етап 3). Гейт: exit 1, якщо сироти є.
//
//   node scripts/css-orphans.mjs            # звіт + exit 1 при сиротах
//   node scripts/css-orphans.mjs --json     # машинний вивід
//
// Що рахується посиланням (доказ, що клас живий):
//   · літерал у файлі-імпортері модуля: styles['x'], styles.x, `${styles.x}`,
//     будь-який ідентифікатор-обʼєкт (s['x'], css.x …) — регексом по ключу;
//   · шаблонний ключ [`prefix-${…}`] у файлі-імпортері — живими вважаються
//     ВСІ класи модуля з префіксом prefix- (родини tone-/dot-/t-/ev-/…);
//   · composes: x у самому модулі;
//   · :global(.x) у модулі — не клас модуля, пропускаємо;
//   · тест із селектором class*="x" — доказ вжитку (клас видно в DOM).
// Клас, що трапляється ще десь у src як голий рядок ('x' / "x"), але не в
// імпортері, — «не доведено»: лишаємо і показуємо окремо.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname, 'apps/web/src');
const JSON_OUT = process.argv.includes('--json');

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, acc) : acc.push(p);
  }
  return acc;
}
const files = walk(ROOT);
const modules = files.filter((f) => f.endsWith('.module.css'));
const code = files.filter((f) => /\.(tsx?|mjs)$/.test(f)).map((f) => ({ f, src: fs.readFileSync(f, 'utf8') }));
const tests = code.filter((c) => /\.test\.tsx?$/.test(c.f));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

const report = [];
let total = 0, orphanCount = 0, unproven = 0;
for (const m of modules) {
  const raw = fs.readFileSync(m, 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const globals = new Set([...css.matchAll(/:global\(\s*[^)]*?\.([A-Za-z_][\w-]*)/g)].map((x) => x[1]));
  const classes = [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => x[1]))].filter((c) => !/^\d/.test(c) && !globals.has(c));
  const composed = new Set([...css.matchAll(/composes:\s*([^;]+);/g)].flatMap((x) => x[1].split(/\s+/)));
  const base = path.basename(m);
  const importers = code.filter((c) => c.src.includes(`/${base}'`) || c.src.includes(`./${base}'`) || c.src.includes(`${base}"`));
  const prefixes = new Set(importers.flatMap((c) => [...c.src.matchAll(/\[`([A-Za-z][\w-]*-)\$\{/g)].map((x) => x[1])));
  const orphans = [], maybe = [];
  for (const cls of classes) {
    total++;
    const lit = new RegExp(`(\\.${esc(cls)}\\b|['"\`]${esc(cls)}['"\`])`);
    const inImporter = importers.some((c) => lit.test(c.src));
    const byPrefix = [...prefixes].some((p) => cls.startsWith(p));
    const inTest = tests.some((c) => c.src.includes(`class*="${cls}"`) || c.src.includes(`class*="_${cls}_`) || c.src.includes(`class*="_${cls}"`));
    if (inImporter || byPrefix || composed.has(cls) || inTest) continue;
    const elsewhere = code.filter((c) => !importers.includes(c) && new RegExp(`['"\`]${esc(cls)}['"\`]`).test(c.src)).map((c) => path.relative(ROOT, c.f));
    if (elsewhere.length) { maybe.push({ cls, elsewhere }); unproven++; }
    else { orphans.push(cls); orphanCount++; }
  }
  report.push({ module: path.relative(ROOT, m), classes: classes.length, importers: importers.map((c) => path.relative(ROOT, c.f)), prefixes: [...prefixes], orphans, unproven: maybe });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ modules: modules.length, classes: total, orphans: orphanCount, unproven, report }, null, 1));
} else {
  for (const r of report) {
    if (!r.importers.length) console.log(`!! без імпортера: ${r.module}`);
    if (r.orphans.length) console.log(`${r.module} (${r.classes} класів, ${r.orphans.length} сиріт)\n  ${r.orphans.join(' ')}`);
    for (const u of r.unproven) console.log(`  ? ${r.module} .${u.cls} — рядок є в ${u.elsewhere.join(', ')} (не доведено)`);
  }
  console.log(`\nмодулів: ${modules.length} · класів: ${total} · сиріт: ${orphanCount} · не доведено: ${unproven}`);
}
process.exit(orphanCount ? 1 : 0);
