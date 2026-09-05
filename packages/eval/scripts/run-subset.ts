// Тимчасовий скрипт: прогін довільного підмножини фікстур із чинним манфестом,
// завжди пише повний JSON-знімок (на відміну від runner.ts --only, який
// свідомо його не пише — тут навпаки, знімок і є мета). Додатково: latencyMs,
// raw і residualText (parseModelResponse) — для перевірки чистоти JSON.
// Модель бере з MODEL_SMART/MODEL_FAST у env, як завжди. Не комітити.
import '../env.js';
import { writeFileSync } from 'node:fs';
import { loadPrompt } from '@kitchen/prompts';
import { loadFixtures } from '../fixtures/index.js';
import { runOne } from '../model-client.js';
import { resolve as resolveInvariant } from '../invariants.js';
import { extractJson } from '@kitchen/domain';

const ids = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const outPath = process.argv[3];
if (!ids.length || !outPath) {
  console.error('usage: tsx run-subset.ts <id1,id2,...> <out.json>');
  process.exit(1);
}

const prompt = loadPrompt();
const all = loadFixtures();
const fixtures = ids.map((id) => {
  const fx = all.find((f) => f.id === id);
  if (!fx) throw new Error(`fixture not found: ${id}`);
  return fx;
});

const runs = [];
for (const fx of fixtures) {
  process.stdout.write(`RUN   ${fx.id}  ... `);
  const result = await runOne(fx, prompt);
  const verdicts: Record<string, { pass: boolean; detail?: string }> = {};
  if (!result.error) {
    for (const inv of fx.invariants) verdicts[inv] = resolveInvariant(inv)(result, fx);
  }
  const allPassed = Object.values(verdicts).every((v) => v.pass);
  process.stdout.write(result.error ? `${result.error}\n` : (allPassed ? 'PASS\n' : 'FAIL\n'));
  for (const [name, v] of Object.entries(verdicts)) {
    if (!v.pass) console.log(`      ✗ ${name}  ${v.detail ?? ''}`);
  }
  const residualText = result.raw ? extractJson(result.raw).residualText : '';
  runs.push({
    id: fx.id,
    call: fx.call,
    invariants: verdicts,
    error: result.error,
    promptHash: result.promptHash,
    usage: result.usage,
    reply: result.reply,
    card: result.card,
    note: result.note ?? null,
    latencyMs: result.latencyMs,
    raw: result.raw,
    residualText,
  });
}

writeFileSync(outPath, JSON.stringify({
  promptVersion: prompt.version,
  createdAt: new Date().toISOString(),
  model: process.env.MODEL_SMART ?? '(default)',
  runs,
}, null, 2), 'utf-8');
console.log(`\nwritten: ${outPath}`);
