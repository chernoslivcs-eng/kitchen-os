import './env.js';                      // MUST BE FIRST — заселяє process.env (ANTHROPIC_API_KEY etc.)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFixtures, type Fixture } from './fixtures/index.js';
import { resolve as resolveInvariant, type Verdict } from './invariants.js';
import { loadPrompt } from '@kitchen/prompts';
import { runOne, type RunResult } from './model-client.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(HERE, 'snapshots');

interface FixtureRun {
  fixture: Fixture;
  result: RunResult;
  verdicts: Record<string, Verdict>;
  allPassed: boolean;
}

interface Snapshot {
  promptVersion: string;
  createdAt: string;
  runs: {
    id: string;
    call: string;
    invariants: Record<string, { pass: boolean; detail?: string }>;
    error?: string;
    usage?: { input: number; output: number };
  }[];
}

function loadPrevious(): Snapshot | null {
  const path = join(SNAP_DIR, 'baseline.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveSnapshot(snap: Snapshot, name: 'baseline' | 'latest') {
  if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
  writeFileSync(join(SNAP_DIR, `${name}.json`), JSON.stringify(snap, null, 2), 'utf-8');
}

function toSnapshot(prompt: string, runs: FixtureRun[]): Snapshot {
  return {
    promptVersion: prompt,
    createdAt: new Date().toISOString(),
    runs: runs.map((r) => ({
      id: r.fixture.id,
      call: r.fixture.call,
      invariants: Object.fromEntries(
        Object.entries(r.verdicts).map(([k, v]) => [k, { pass: v.pass, detail: v.detail }]),
      ),
      error: r.result.error,
      usage: r.result.usage,
    })),
  };
}

function diffSnapshots(prev: Snapshot | null, curr: Snapshot): string[] {
  const lines: string[] = [];
  if (!prev) {
    lines.push('(немає попереднього снапшоту — це буде baseline)');
    return lines;
  }
  if (prev.promptVersion !== curr.promptVersion) {
    lines.push(`Версія промпту: ${prev.promptVersion} → ${curr.promptVersion}`);
  }
  const prevById = new Map(prev.runs.map((r) => [r.id, r]));
  for (const now of curr.runs) {
    const before = prevById.get(now.id);
    if (!before) {
      lines.push(`+ ${now.id} (нова фікстура)`);
      continue;
    }
    for (const [name, v] of Object.entries(now.invariants)) {
      const was = before.invariants[name];
      if (!was) {
        lines.push(`  ${now.id} · +${name} ${v.pass ? '✓' : '✗'}`);
      } else if (was.pass !== v.pass) {
        lines.push(`  ${now.id} · ${name}: ${was.pass ? '✓' : '✗'} → ${v.pass ? '✓' : '✗'}`);
      }
    }
    for (const [name] of Object.entries(before.invariants)) {
      if (!(name in now.invariants)) {
        lines.push(`  ${now.id} · −${name} (більше не перевіряється)`);
      }
    }
  }
  return lines;
}

async function main() {
  const diffOnly = process.argv.includes('--diff-only');
  const promoteBaseline = process.argv.includes('--baseline');
  const version = process.env.PROMPT_VERSION;
  const prompt = loadPrompt(version);

  console.log(`Prompt version: ${prompt.version}`);
  console.log(`Model: fast=${process.env.MODEL_FAST ?? 'claude-haiku-4-5-20251001'} smart=${process.env.MODEL_SMART ?? 'claude-sonnet-5'}`);
  console.log('');

  const fixtures = loadFixtures();
  const runs: FixtureRun[] = [];

  for (const fx of fixtures) {
    if (fx.skip) {
      console.log(`SKIP  ${fx.id}  — ${fx.skip}`);
      runs.push({
        fixture: fx,
        result: {
          raw: '',
          call: fx.call as any,
          model: '',
          promptVersion: prompt.version,
          latencyMs: 0,
          error: `SKIPPED: ${fx.skip}`,
        },
        verdicts: {},
        allPassed: true,
      });
      continue;
    }

    process.stdout.write(`RUN   ${fx.id}  ... `);
    const result = await runOne(fx, prompt);

    const verdicts: Record<string, Verdict> = {};
    if (result.error) {
      process.stdout.write(`${result.error}\n`);
    } else {
      for (const inv of fx.invariants) {
        verdicts[inv] = resolveInvariant(inv)(result, fx);
      }
      const passed = Object.values(verdicts).every((v) => v.pass);
      process.stdout.write(passed ? 'PASS\n' : 'FAIL\n');
    }
    const allPassed = Object.values(verdicts).every((v) => v.pass);
    runs.push({ fixture: fx, result, verdicts, allPassed });

    for (const [name, v] of Object.entries(verdicts)) {
      if (!v.pass) console.log(`      ✗ ${name}  ${v.detail ?? ''}`);
      else if (v.detail) console.log(`      ✓ ${name}  ${v.detail}`);
    }
  }

  const snap = toSnapshot(prompt.version, runs);
  saveSnapshot(snap, 'latest');
  if (promoteBaseline) {
    saveSnapshot(snap, 'baseline');
    console.log('\n(записано як baseline)');
  }

  const prev = loadPrevious();
  const diff = diffSnapshots(prev, snap);
  console.log('\n=== ДІФ до baseline ===');
  if (diff.length === 0) console.log('  (без змін)');
  for (const l of diff) console.log(l);

  const anyFail = runs.some((r) => !r.allPassed && !r.result.error?.startsWith('SKIPPED'));
  if (!diffOnly && anyFail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
