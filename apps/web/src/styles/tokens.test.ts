import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Токени v3 — контракт, не смак. Тест тримає ТОЧНІ значення з
// ai/project/tokens-v3.md: перейменування шару не має права їх зсунути.
// Той самий рід перевірки, що PROFILE_FIELDS у profile-text.test.ts.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** Значення токена в блоці, позначеному маркером.
 *  Маркер, не селектор: `:root[data-theme='light']` у файлі вже є зі СТАРИМИ
 *  іменами, і пошук за селектором знайшов би саме його. */
function tokenIn(marker: string, name: string): string | null {
  const start = css.indexOf(marker);
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf('}', start));
  const m = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
}

const LIGHT: Record<string, string> = {
  canvas: '#c9ccd0', bg: '#f4f3ef', card: '#ffffff', line: '#f0eee9',
  line2: '#e6e4de', faint: '#c9cbcd', ink: '#1a1c1e', muted: '#6b6f74',
  dim: '#9a9ea3', sage: '#5b7a4f', 'sage-bg': '#e8efe3', amber: '#a67c2e',
  'amber-bg': '#f6ecd6', plum: '#8a5c78', 'plum-bg': '#f1e5ec', danger: '#b5473c',
};

const DARK: Record<string, string> = {
  canvas: '#0c0d0f', bg: '#16181b', card: '#1f2226', line: '#2a2e33',
  line2: '#33383e', faint: '#4a4f55', ink: '#ecebe7', muted: '#a3a7ac',
  dim: '#6f7379', sage: '#93b48b', 'sage-bg': '#26312a', amber: '#d2ad6b',
  'amber-bg': '#332a1c', plum: '#c99ab4', 'plum-bg': '#2f2329', danger: '#d47f74',
};

describe('токени v3', () => {
  it('світла тема — шістнадцять токенів із точними значеннями', () => {
    for (const [name, value] of Object.entries(LIGHT)) {
      expect(tokenIn('/* v3-light */', name), `--${name}`).toBe(value);
    }
  });

  it('темна тема — ті самі імена, свої значення', () => {
    for (const [name, value] of Object.entries(DARK)) {
      expect(tokenIn('/* v3-dark */', name), `--${name}`).toBe(value);
    }
  });

  it('Р18: :root лишається темним — міграція імен не перевертає дефолт', () => {
    expect(css).toMatch(/:root[^{]*\{[^}]*color-scheme:\s*dark/);
  });
});
