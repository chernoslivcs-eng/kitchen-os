import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSIONS_DIR = resolve(HERE, 'versions');

// Тільки те, що справді викликається. `recipe_import` і `pantry_search` тут
// були задекларовані наперед — із маніфестом, профілем моделі й гілкою в
// eval-клієнті, — але маршруту й репозиторію не мали жодного дня. Конфіг,
// який описує неіснуюче, дезінформує того, хто прийде читати код. Повернути,
// коли зʼявиться реалізація.
export type CallName =
  | 'chat'
  | 'recipe_gen'
  | 'attachment_parse';

export interface CallSpec {
  // `profile` — ЄДИНЕ джерело того, яка модель обслуговує виклик. Раніше
  // мапінг дублювався в model.ts і в eval, вони розійшлись, і QA5-12 знайшов
  // маніфест, який казав "fast" там, де код брав smart.
  profile: 'fast' | 'smart';
  compose: string[];
  temperature?: number;
  notes?: string;
}

export interface Manifest {
  version: string;
  notes: string;
  calls: Record<CallName, CallSpec>;
}

export interface LoadedPrompt {
  version: string;
  manifest: Manifest;
  blocks: Record<string, string>;
}

function listVersions(): string[] {
  return readdirSync(VERSIONS_DIR)
    .filter((name: string) => statSync(join(VERSIONS_DIR, name)).isDirectory())
    .sort();
}

export function latestVersion(): string {
  const versions = listVersions();
  const last = versions[versions.length - 1];
  if (!last) throw new Error(`No prompt versions found under ${VERSIONS_DIR}`);
  return last;
}

export function loadPrompt(version: string = latestVersion()): LoadedPrompt {
  const dir = join(VERSIONS_DIR, version);
  const manifestRaw = readFileSync(join(dir, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw) as Manifest;
  if (manifest.version !== version) {
    throw new Error(
      `Manifest version mismatch: folder is ${version}, manifest says ${manifest.version}`,
    );
  }
  const files = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
  const blocks: Record<string, string> = {};
  for (const file of files) {
    const key = file.replace(/\.md$/, '');
    blocks[key] = readFileSync(join(dir, file), 'utf-8');
  }
  for (const [call, spec] of Object.entries(manifest.calls)) {
    for (const req of spec.compose) {
      const k = req.replace(/\?$/, '');
      if (!blocks[k]) {
        throw new Error(`Call ${call} needs block ${k}, missing from ${dir}`);
      }
    }
  }
  return { version, manifest, blocks };
}

export function compose(call: CallName, prompt: LoadedPrompt, opts: {
  stage?: 1 | 2;
} = {}): string {
  const spec = prompt.manifest.calls[call];
  if (!spec) throw new Error(`Unknown call: ${call}`);
  const parts: string[] = [];
  for (const name of spec.compose) {
    if (name.endsWith('?')) {
      const base = name.slice(0, -1);
      if (base === 'onboarding-stage1' && opts.stage !== 1) continue;
      if (base === 'onboarding-stage2' && opts.stage !== 2) continue;
      parts.push(prompt.blocks[base]!);
    } else {
      parts.push(prompt.blocks[name]!);
    }
  }
  return parts.join('\n\n---\n\n');
}
