// 16.09: якість під MODEL_REASONING на складних завданнях — вкладення (усі
// attachment_parse), рецепти (усі recipe_gen), складний чат (великий інтейк,
// трійки, пропозиції з обмеженнями). Ті самі інваріанти, що в pnpm eval, +
// latency/токени/роздуми; для чату — картки по полях. Прогони: без параметра,
// minimal; для вкладень ще low, якщо minimal просів.
// Запуск: cd packages/eval && npx tsx scripts/reasoning-quality.ts
import '../env.js';
import { loadPrompt } from '@kitchen/prompts';
import { extractJson } from '@kitchen/domain';
import { loadFixtures, type Fixture } from '../fixtures/index.js';
import { runOne, PROFILES } from '../model-client.js';
import { resolve as resolveInvariant } from '../invariants.js';

const CHAT_IDS = ['chat-dictation-dup', 'tagger-chat-brand', 'profile-verbatim', 'diet-pescatarian-steak'];
const prompt = loadPrompt();
const all = loadFixtures();
const ALL_GROUPS: Record<string, Fixture[]> = {
  attachment_parse: all.filter((f) => f.call === 'attachment_parse' && !f.skip && f.id !== 'receipt-till-photo'),
  photo: all.filter((f) => f.id === 'receipt-till-photo' && !f.skip),
  lowres: all.filter((f) => f.id === 'receipt-lowres-silpo'),
  recipe_gen: all.filter((f) => f.call === 'recipe_gen' && !f.skip),
  chat: CHAT_IDS.map((id) => all.find((f) => f.id === id)!).filter(Boolean),
};
// GROUPS=photo,recipe_gen LEVELS=base,minimal — підмножина прогону (дефолт: усі, base+minimal).
const wantGroups = (process.env.GROUPS ?? 'attachment_parse,recipe_gen,chat').split(',');
const levels = (process.env.LEVELS ?? 'base,minimal').split(',').map((l) => (l === 'base' ? null : l));
const groups: Record<string, Fixture[]> = Object.fromEntries(wantGroups.map((g) => [g, ALL_GROUPS[g] ?? []]));

interface Row { id: string; ok: number; n: number; failed: string[]; ms: number; out: number; think: number | null; json: boolean; card: string; lines?: string }
function cardSummary(card: unknown): string {
  const c = card as { type?: string; ops?: { label?: string; op?: string }[]; items?: { title?: string; needs?: unknown[] }[] } | null;
  if (!c) return '—';
  if (c.type === 'intake_diff') return `intake_diff ops=${c.ops?.length ?? 0} [${(c.ops ?? []).map((o) => o.label).join('; ')}]`;
  if (c.type === 'proposal') return `proposal items=${c.items?.length ?? 0} [${(c.items ?? []).map((i) => `${i.title}${i.needs?.length ? ` +${i.needs.length}` : ''}`).join('; ')}]`;
  return String(c.type ?? '?');
}
async function pass(level: string | null, fxs: Fixture[]): Promise<Row[]> {
  if (level) process.env.MODEL_REASONING = level; else delete process.env.MODEL_REASONING;
  const rows: Row[] = [];
  for (const fx of fxs) {
    const r = await runOne(fx, prompt);
    const verdicts = r.error ? [] : fx.invariants.map((name) => ({ name, v: resolveInvariant(name)(r as never, fx) }));
    const failed = verdicts.filter((x) => !x.v.pass).map((x) => `${x.name}${x.v.detail ? ` (${String(x.v.detail).slice(0, 70)})` : ''}`);
    let json = false; try { json = !!extractJson(r.raw).parsed; } catch { json = false; }
    // Фото чека: скільки рядків розпізнано проти еталона і скільки еталонних продуктів знайдено.
    const ops = ((r.card as { ops?: { label?: string; product?: string; brand?: string }[] } | null)?.ops ?? []);
    const hits = (fx.expect_products ?? []).filter((p) => ops.some((o) => `${o.label ?? ''} ${o.product ?? ''} ${o.brand ?? ''}`.toLowerCase().includes(p.toLowerCase())));
    const lines = fx.expect_lines ? `рядків ${ops.length}/${fx.expect_lines}, еталонних ${hits.length}/${(fx.expect_products ?? []).length}, брендів ${ops.filter((o) => o.brand).length}` : undefined;
    const row: Row = { id: fx.id, ok: verdicts.length - failed.length, n: fx.invariants.length, failed: r.error ? [`ERR ${r.error.slice(0, 80)}`] : failed, ms: r.latencyMs, out: r.usage?.output ?? 0, think: r.usage?.thinking ?? null, json, card: cardSummary(r.card), lines };
    rows.push(row);
    console.log(`  [${level ?? 'base'}] ${fx.id.padEnd(26)} ${String(row.ok).padStart(2)}/${row.n} ${String(row.ms).padStart(6)}ms out=${String(row.out).padStart(5)} think=${String(row.think ?? '?').padStart(5)} json=${json ? 'ok ' : 'BAD'}${row.failed.length ? ' ✗ ' + row.failed.join(' · ') : ''}`);
    if (fx.call === 'chat') console.log(`         card: ${row.card}`);
    if (row.lines) console.log(`         ${row.lines}`);
    // DUMP=1 — усі ops коротко (label | product | brand | variant | v u | tags), щоб звірити з еталоном очима.
    if (process.env.DUMP) for (const o of ops as any[]) console.log(`           · ${o.label} | ${o.product ?? ''} | ${o.brand ?? ''} | ${o.variant ?? ''} | ${o.v ?? o.value ?? ''} ${o.u ?? o.unit ?? ''} | ${JSON.stringify(o.tags ?? {})}`);
  }
  return rows;
}
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? 0; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function line(call: string, level: string, rows: Row[]): string {
  const green = rows.filter((r) => r.failed.length === 0).length;
  return `| ${call} | ${level} | ${green}/${rows.length} | ${q(rows.map((r) => r.ms), 0.5)} мс (p90 ${q(rows.map((r) => r.ms), 0.9)}) | out Σ ${sum(rows.map((r) => r.out))} · роздуми Σ ${sum(rows.map((r) => r.think ?? 0))} | ${rows.filter((r) => r.json).length}/${rows.length} |`;
}

console.log(`Модель: ${PROFILES().smart}`);
const table: string[] = ['| виклик | рівень | зелених фікстур | latency медіана | токени | JSON |', '|---|---|---|---|---|---|'];
const results: Record<string, Record<string, Row[]>> = {};
for (const [call, fxs] of Object.entries(groups)) {
  console.log(`\n=== ${call} (${fxs.map((f) => f.id).join(', ')}) ===`);
  results[call] = {};
  for (const level of levels) {
    console.log(`--- ${level ?? 'без параметра'} ---`);
    results[call][level ?? 'base'] = await pass(level, fxs);
    table.push(line(call, level ?? 'без параметра', results[call][level ?? 'base']!));
  }
  const g = (rows: Row[]) => rows.filter((r) => r.failed.length === 0).length;
  if (call === 'attachment_parse' && results[call].minimal && results[call].base && g(results[call].minimal!) < g(results[call].base!)) {
    console.log('--- low (minimal просів) ---');
    results[call].low = await pass('low', fxs);
    table.push(line(call, 'low', results[call].low!));
  }
}
console.log('\n' + table.join('\n'));
if (results.chat?.base && results.chat.minimal) {
  console.log('\nКартки чату (base → minimal):');
  for (const [i, r] of results.chat.base.entries()) {
    const m = results.chat.minimal[i]!;
    console.log(`  ${r.id}:\n    base:    ${r.card}\n    minimal: ${m.card}`);
  }
} else if (results.chat) {
  for (const [lvl, rows] of Object.entries(results.chat)) for (const r of rows) console.log(`  [${lvl}] ${r.id}: ${r.card}`);
}
