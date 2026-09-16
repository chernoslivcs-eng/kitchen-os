// 16.09: замір MODEL_REASONING на чаті — 10 реплік із фікстур (5 звичайних,
// 3 з карткою, 2 продуктових питання), два прогони: без параметра і з тим,
// що в MODEL_REASONING_BENCH (дефолт minimal). Для кожної: latency, вихідні
// токени (разом із роздумами), роздуми окремо, чи JSON валідний, тип картки.
// Локально, не прод. Запуск: cd packages/eval && npx tsx scripts/reasoning-bench.ts
import '../env.js';
import { loadPrompt } from '@kitchen/prompts';
import { loadFixtures } from '../fixtures/index.js';
import { runOne, PROFILES } from '../model-client.js';

const IDS = [
  'intent-capture', 'no-vs-meh-cilantro-meh', 'feedback-diagnosis', 'allergy-stated-no-followup', 'cook-chronology',
  'generic-label-ask', 'member-card', 'missing-ingredient',
  'product-calories-where', 'product-silpo-connect',
];
const level = process.env.MODEL_REASONING_BENCH ?? 'minimal';
const prompt = loadPrompt();
const all = loadFixtures();
const fixtures = IDS.map((id) => all.find((f) => f.id === id)!).filter(Boolean);
if (fixtures.length !== IDS.length) throw new Error('не всі фікстури знайдено');

interface Row { id: string; ms: number; out: number; thinking: number | null; json: boolean; card: string; err?: string }
async function pass(label: string, env: string | undefined): Promise<Row[]> {
  if (env) process.env.MODEL_REASONING = env; else delete process.env.MODEL_REASONING;
  const rows: Row[] = [];
  for (const fx of fixtures) {
    const r = await runOne(fx, prompt);
    let json = false; try { const { extractJson } = await import('@kitchen/domain'); json = !!extractJson(r.raw).parsed; } catch { json = false; }
    rows.push({ id: fx.id, ms: r.latencyMs, out: r.usage?.output ?? 0, thinking: r.usage?.thinking ?? null, json, card: r.card ? String((r.card as { type?: string }).type ?? '?') : '—', err: r.error });
    console.log(`  [${label}] ${fx.id.padEnd(28)} ${String(r.latencyMs).padStart(6)}ms out=${String(rows.at(-1)!.out).padStart(5)} think=${String(rows.at(-1)!.thinking ?? '?').padStart(5)} json=${json ? 'ok ' : 'BAD'} card=${rows.at(-1)!.card}${r.error ? ' ERR ' + r.error.slice(0, 80) : ''}`);
  }
  return rows;
}
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? 0; };
const stat = (xs: number[]) => `медіана ${q(xs, 0.5)} · p90 ${q(xs, 0.9)} · макс ${Math.max(...xs)}`;

console.log(`Модель: ${PROFILES().smart}`);
console.log('\n=== без параметра ===');
const a = await pass('base', undefined);
console.log(`\n=== MODEL_REASONING=${level} ===`);
const b = await pass(level, level);

const sum = (rows: Row[], k: 'out' | 'ms') => rows.reduce((s, r) => s + r[k], 0);
const inTok = 0; // вхід у обох прогонах однаковий — беремо з usage нижче
console.log('\n| прогін | latency, мс | output tokens (з роздумами) | роздуми | JSON ok | картки |');
console.log('|---|---|---|---|---|---|');
for (const [label, rows] of [['без параметра', a], [level, b]] as const) {
  console.log(`| ${label} | ${stat(rows.map((r) => r.ms))} | ${stat(rows.map((r) => r.out))} (Σ ${sum(rows, 'out')}) | Σ ${rows.reduce((s, r) => s + (r.thinking ?? 0), 0)} | ${rows.filter((r) => r.json).length}/${rows.length} | ${rows.map((r) => r.card).join(', ')} |`);
}
console.log('\nТип картки збігається: ' + a.map((r, i) => `${r.id}: ${r.card === b[i]!.card ? '✓' : `✗ (${r.card} → ${b[i]!.card})`}`).join('; '));
void inTok;
