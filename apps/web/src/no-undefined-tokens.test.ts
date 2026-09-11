import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Кожен `var(--x)` у продукті має бути визначений — гейт, не пильність.
 *
 * Переїзд токенів (11.09) ВИДАЛИВ 27 старих імен із tokens.css замість того,
 * щоб лишити їх псевдонімами. Ціна псевдоніма — мовчання: `var(--accent)`
 * працював би вічно, і переїзд ніколи б не закінчився. Ціна видалення —
 * пропущене вживання дає невизначений var(), тобто `transparent` або
 * `inherit`, і око це може не помітити на світлій темі. Тому — тест.
 *
 * Локальні визначення (`--x: …` у тому ж файлі, як у Landing) рахуються:
 * лендінг має власну палітру навмисно (Р17), і це не помилка.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));
const SKIP_DIRS = ['Admin'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.includes(name)) walk(p, out); }
    else if (/\.(css|tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
// Визначення — і `--x: …` у CSS, і `setProperty('--x'` у TSX (ArtifactPanel
// ставить --rail-w на body під час перетягування).
const defined = (s: string) => new Set([
  ...[...s.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
  ...[...s.matchAll(/setProperty\('--([a-z0-9-]+)'/g)].map((m) => m[1]!),
]);

const GLOBAL = new Set<string>();
for (const f of ['styles/tokens.css', 'styles/roles.css']) {
  for (const n of defined(readFileSync(join(SRC, f), 'utf8'))) GLOBAL.add(n);
}

// Старі імена — названі поіменно, щоб падіння читалось як «переїзд не
// закінчено», а не як «якийсь токен».
const OLD = ['bg-body', 'bg-surface', 'bg-surface-2', 'bg-hover', 'border', 'border-strong',
  'fg', 'fg-strong', 'fg-muted', 'fg-dim', 'fg-mono', 'accent', 'accent-strong', 'accent-bg',
  'accent-bg-strong', 'accent-border', 'accent-dim', 'accent-fg-on', 'amber-border', 'plum-border', 'danger-border'];

describe('токени: жодного var() без визначення', () => {
  const missing: string[] = [];
  const old: string[] = [];
  const files = walk(SRC).map((f) => [f, strip(readFileSync(f, 'utf8'))] as const);
  // Два проходи: визначення з УСІХ файлів, потім вживання. Токен може бути
  // визначений в одному файлі, а вжитий в іншому (--rail-w: TSX → CSS).
  const anywhere = new Set(GLOBAL);
  for (const [, s] of files) for (const n of defined(s)) anywhere.add(n);
  for (const [f, s] of files) {
    for (const m of s.matchAll(/var\(--([a-z0-9-]+)/g)) {
      const name = m[1]!;
      const line = s.slice(0, m.index).split('\n').length;
      const where = `${f.slice(SRC.length)}:${line}  --${name}`;
      if (OLD.includes(name)) old.push(where);
      else if (!anywhere.has(name)) missing.push(where);
    }
  }

  it('старі імена (--accent, --fg, --bg-surface, --border…) — жодного', () => {
    expect(old, `переїзд токенів не закінчено:\n  ${old.join('\n  ')}`).toEqual([]);
  });

  it('кожен var(--x) визначений у tokens.css, roles.css або локально', () => {
    expect(missing, `невизначені токени:\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});
