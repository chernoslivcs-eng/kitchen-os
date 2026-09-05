// Раунд 5, крок Н1, §1: звірка референсу БЖВ з дампами USDA (перевірка, не пошук).
//
// Вхід:  audit-materials/nutrition-base.csv (665 рядків, ';', UTF-8 з BOM)
//        data/usda/{sr_legacy,foundation}/*/food_nutrient.csv (gitignore)
// Вихід: data/nutrition/base.csv — назва; стан; білки_г; жири_г; вуглеводи_г;
//        клітковина_г; цукри_г; натрій_мг; source (usda:<id> | ciqual:<code> | estimate)
//        + JSON-звіт у stdout-шлях (--report <file>).
//
// Правила: рядок з usda.gov → FDC ID → шість нутрієнтів із дампу; збіг у межах
// 2% — verified; розбіжність — беремо дамп, записуємо обидва; id немає в дампі
// (Branded/FNDDS/новіший Foundation) — unverified, лишаємо як є. CIQUAL не
// звіряємо. Open Food Facts і рядки без джерела — estimate.
// Запуск: npx tsx scripts/nutrition/verify-usda.ts [--report path.json]

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IN = join(ROOT, 'audit-materials/nutrition-base.csv');
const OUT = join(ROOT, 'data/nutrition/base.csv');
const reportArg = process.argv.indexOf('--report');
const REPORT = reportArg > -1 ? process.argv[reportArg + 1]! : join(ROOT, 'data/nutrition/verify-report.json');

// nutrient_id → колонка бази
const NUTRIENTS: Record<string, keyof Values> = { '1003': 'protein', '1004': 'fat', '1005': 'carbs', '1079': 'fiber', '2000': 'sugars', '1093': 'sodium_mg' };
type Values = { protein: number | null; fat: number | null; carbs: number | null; fiber: number | null; sugars: number | null; sodium_mg: number | null };
const COLS: (keyof Values)[] = ['protein', 'fat', 'carbs', 'fiber', 'sugars', 'sodium_mg'];
const TOL = 0.02;          // 2 %
const ABS_FLOOR = 0.1;     // нижче цього різниця — шум округлення (0.05 г)

// Підміни стану «готове» → сирий/сухий запис дампу, знайдений по назві руками.
// Немає в SR Legacy/Foundation — лишається estimate (ньоккі, пангасіус, морський коктейль, коржі).
const RAW_SUBSTITUTES: Record<string, { fdc: string; desc: string; state: string }> = {
  'Басматі': { fdc: '169756', desc: 'Rice, white, long-grain, regular, raw, unenriched', state: 'сухе' },
  'Креветки тигрові': { fdc: '174210', desc: 'Crustaceans, shrimp, mixed species, raw', state: 'сире' },
  'Буженина': { fdc: '167818', desc: 'Pork, fresh, loin, whole, separable lean and fat, raw', state: 'сире' },
  'Арахіс смажений солоний': { fdc: '172430', desc: 'Peanuts, all types, raw', state: 'сире' },
};

function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const raw = readFileSync(IN, 'utf-8').replace(/^﻿/, '');
const [header, ...lines] = parseCsv(raw, ';');
const col = (name: string) => { const i = header!.indexOf(name); if (i < 0) throw new Error(`нема колонки ${name}`); return i; };
const C = {
  name: col('назва'), state: col('стан'), protein: col('білки_г'), fat: col('жири_г'), carbs: col('вуглеводи_г'),
  fiber: col('клітковина_г'), sugars: col('цукри_г'), sodium_mg: col('натрій_мг'), src: col('джерело'), url: col('url'), rec: col('запис_джерела'), verdict: col('вердикт'),
};
const num = (s: string | undefined): number | null => (s === undefined || s.trim() === '' ? null : Number(s.replace(',', '.')));

interface BaseRow { name: string; state: string; values: Values; src: string; url: string; rec: string; verdict: string }
const base: BaseRow[] = lines.filter((l) => l.length > 1 && l[C.name]).map((l) => ({
  name: l[C.name]!.trim(), state: l[C.state]!.trim(),
  values: { protein: num(l[C.protein]), fat: num(l[C.fat]), carbs: num(l[C.carbs]), fiber: num(l[C.fiber]), sugars: num(l[C.sugars]), sodium_mg: num(l[C.sodium_mg]) },
  src: l[C.src]!.trim(), url: l[C.url]!.trim(), rec: l[C.rec]!.trim(), verdict: l[C.verdict]!.trim(),
}));

const fdcOf = (url: string) => /fdc\.nal\.usda\.gov\/food-details\/(\d+)/.exec(url)?.[1] ?? null;
const ciqualOf = (url: string) => /ciqual\.anses\.fr\/#\/aliments\/(\d+)/.exec(url)?.[1] ?? null;

// ----- дампи: лише потрібні fdc_id -----
const wanted = new Set<string>();
for (const r of base) { const id = fdcOf(r.url); if (id) wanted.add(id); }
for (const s of Object.values(RAW_SUBSTITUTES)) wanted.add(s.fdc);

const dumpDirs = ['sr_legacy', 'foundation'].flatMap((d) => {
  const base = join(ROOT, 'data/usda', d);
  return readdirSync(base).filter((x) => !x.endsWith('.zip')).map((x) => join(base, x));
});
const dump = new Map<string, Partial<Values>>();
const descriptions = new Map<string, string>();
for (const dir of dumpDirs) {
  const foodRows = parseCsv(readFileSync(join(dir, 'food.csv'), 'utf-8'), ',');
  for (const r of foodRows.slice(1)) if (wanted.has(r[0]!)) descriptions.set(r[0]!, r[2]!);
  const rl = createInterface({ input: createReadStream(join(dir, 'food_nutrient.csv')) });
  for await (const line of rl) {
    // "id","fdc_id","nutrient_id","amount",... — без лапок усередині значень
    const parts = line.split(',');
    const fdc = parts[1]?.replace(/"/g, ''); const nid = parts[2]?.replace(/"/g, ''); const amount = parts[3]?.replace(/"/g, '');
    if (!fdc || !wanted.has(fdc) || !nid || !(nid in NUTRIENTS)) continue;
    const key = NUTRIENTS[nid]!;
    const cur = dump.get(fdc) ?? {};
    if (cur[key] === undefined && amount !== '') cur[key] = Number(amount);
    dump.set(fdc, cur);
  }
}

// ----- звірка -----
const close = (a: number | null, b: number) => a !== null && (Math.abs(a - b) <= ABS_FLOOR || Math.abs(a - b) <= TOL * Math.abs(b));
const r2 = (x: number) => Math.round(x * 100) / 100;

interface OutRow { name: string; state: string; values: Values; source: string }
const out: OutRow[] = [];
const report = {
  total: base.length, verified: [] as string[], discrepant: [] as { name: string; fdc: string; diffs: { nutrient: string; row: number | null; dump: number }[] }[],
  unverified: [] as { name: string; fdc: string }[], ciqual: 0, estimate: 0, off_as_estimate: 0,
  substituted: [] as { name: string; from: string; to: string; state: string }[], substitute_missing: [] as string[],
  dump_missing_nutrients: [] as { name: string; fdc: string; kept: string[] }[],
};

for (const r of base) {
  const values: Values = { ...r.values };
  let source = 'estimate';
  let state = r.state;
  const isEstimateVerdict = /без джерела/.test(r.verdict);
  const sub = /готове/.test(r.verdict) ? RAW_SUBSTITUTES[r.name] : undefined;
  const fdc = sub?.fdc ?? (isEstimateVerdict ? null : fdcOf(r.url));
  const ciq = isEstimateVerdict ? null : ciqualOf(r.url);

  if (/готове/.test(r.verdict) && !sub) report.substitute_missing.push(r.name);

  if (fdc) {
    const d = dump.get(fdc);
    if (!d) {
      source = `usda:${fdc}`;
      report.unverified.push({ name: r.name, fdc });
    } else {
      source = `usda:${fdc}`;
      if (sub) {
        report.substituted.push({ name: r.name, from: r.rec, to: `${sub.desc} (usda:${sub.fdc})`, state: sub.state });
        state = sub.state;
        for (const k of COLS) values[k] = d[k] !== undefined ? r2(d[k]!) : null;
      } else {
        const diffs: { nutrient: string; row: number | null; dump: number }[] = [];
        const kept: string[] = [];
        for (const k of COLS) {
          const dv = d[k];
          if (dv === undefined) { kept.push(k); continue; }
          if (!close(values[k], dv)) diffs.push({ nutrient: k, row: values[k], dump: r2(dv) });
          values[k] = r2(dv);
        }
        if (kept.length) report.dump_missing_nutrients.push({ name: r.name, fdc, kept });
        if (diffs.length) report.discrepant.push({ name: r.name, fdc, diffs });
        else report.verified.push(r.name);
      }
    }
  } else if (ciq) {
    source = `ciqual:${ciq}`;
    report.ciqual++;
  } else {
    if (/openfoodfacts/.test(r.url)) report.off_as_estimate++;
    report.estimate++;
  }
  out.push({ name: r.name, state, values, source });
}

const fmt = (v: number | null) => (v === null ? '' : String(v));
const csv = ['назва;стан;білки_г;жири_г;вуглеводи_г;клітковина_г;цукри_г;натрій_мг;source',
  ...out.map((o) => [o.name, o.state, fmt(o.values.protein), fmt(o.values.fat), fmt(o.values.carbs), fmt(o.values.fiber), fmt(o.values.sugars), fmt(o.values.sodium_mg), o.source].join(';')),
].join('\n') + '\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, csv);
writeFileSync(REPORT, JSON.stringify({ ...report, verified_count: report.verified.length, discrepant_count: report.discrepant.length, unverified_count: report.unverified.length }, null, 2));
console.log(`rows ${out.length} · verified ${report.verified.length} · discrepant ${report.discrepant.length} · unverified ${report.unverified.length} · ciqual ${report.ciqual} · estimate ${report.estimate} (of them OFF ${report.off_as_estimate}) · substituted ${report.substituted.length}, no raw record: ${report.substitute_missing.join(', ')}`);
console.log(`→ ${OUT}\n→ ${REPORT}`);
