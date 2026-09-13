// Аудит 0913 C.6: класи gmark/gmark-ring жили в cards.module.css, який ніхто не
// імпортував, — styles['gmark'] з Feed.module.css був undefined, і знак групи
// («ЩОЙНО ДОДАНО» у списку покупок) не мав ні розміру, ні тла.
//
// DOM тут не допомагає: vitest не обробляє CSS-модулі й віддає проксі, де
// будь-який ключ стає `_ключ_хеш` — клас «є» навіть коли його нема. Тому
// перевіряємо сам файл: кожен літерал styles['x'] / styles.x у cards.tsx і
// Feed.tsx мусить мати правило в Feed.module.css.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = join(__dirname);
const css = readFileSync(join(here, 'Feed.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));

function literalsOf(file: string): string[] {
  const src = readFileSync(join(here, file), 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/\bstyles\[['"]([\w-]+)['"]\]/g)) out.add(m[1]!);
  for (const m of src.matchAll(/\bstyles\.([A-Za-z_]\w*)/g)) out.add(m[1]!);
  return [...out];
}

describe('класи Feed.module.css, на які посилається код', () => {
  it.each(['cards.tsx', 'Feed.tsx'])('%s — кожен літерал styles[…] має правило', (file) => {
    const missing = literalsOf(file).filter((c) => !defined.has(c));
    expect(missing).toEqual([]);
  });

  it('знак групи: gmark і gmark-ring визначені саме тут', () => {
    expect(defined.has('gmark')).toBe(true);
    expect(defined.has('gmark-ring')).toBe(true);
  });
});
