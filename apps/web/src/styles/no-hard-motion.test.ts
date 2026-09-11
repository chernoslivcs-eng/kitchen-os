import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Етап 5 (п.3): reduced-motion закрито токенами — `--dur-*` стають 0 під
// `prefers-reduced-motion: reduce` (tokens.css). Анімація з тривалістю
// числом повз токени цього не чує: спалах 700 мс, пульс 30 с горіли б і в
// людини, яка попросила без руху. Тому правило: кожна `animation:` бере
// тривалість із `var(--dur-*)` — або файл сам вимикає її в блоці `reduce`
// через `animation: none` для того самого селектора. Третього не дано.

const SRC = fileURLToPath(new URL('..', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : cssFiles(p);
    return name.endsWith('.css') ? [p] : [];
  });
}

/** Селектори, для яких блок `reduce` ставить `animation: none`. */
function silencedIn(css: string): Set<string> {
  const out = new Set<string>();
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g;
  for (const m of css.matchAll(re)) {
    for (const rule of m[1]!.matchAll(/([^{}]+)\{[^}]*animation:\s*none/g)) {
      rule[1]!.split(',').forEach((s) => out.add(s.trim()));
    }
  }
  return out;
}

describe('анімації йдуть через токени тривалості', () => {
  it('жодної animation: з числом повз var(--dur-*) без власного вимкнення в reduce', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(SRC)) {
      const css = readFileSync(file, 'utf8');
      const silenced = silencedIn(css);
      // Блоки reduce з перевірки вирізаємо: там `animation: none` і є мета.
      const body = css.replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of body.matchAll(/([^{}]+)\{[^}]*?animation:\s*([^;]+);/g)) {
        const decl = m[2]!;
        if (decl.includes('var(--dur') || decl.trim() === 'none') continue;
        if (!/\d+(\.\d+)?m?s\b/.test(decl)) continue;
        const selectors = m[1]!.split(',').map((s) => s.trim().split(/\s+/).pop()!);
        if (selectors.every((s) => [...silenced].some((q) => q.split(/\s+/).pop() === s))) continue;
        offenders.push(`${relative(SRC, file)}: ${m[1]!.trim()} → animation: ${decl.trim()}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('усі --dur-* токени світлої теми занулені в reduce', () => {
    const css = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
    const declared = [...css.matchAll(/--dur-([a-z]+)\s*:\s*\d+m?s;/g)].map((m) => m[1]!);
    const reduce = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const zeroed = [...reduce.matchAll(/--dur-([a-z]+)\s*:\s*0ms;/g)].map((m) => m[1]!);
    expect(new Set(declared)).toEqual(new Set(zeroed));
  });
});
