// Власник 15.09 (прод, 390 Safari): ряд шести чіпів на порожньому чаті
// скролився і по x, і по y — чіпи обрізані, ряд гуляв між кадрами. Порожній
// чат — викладка з переносом по центру, без overflow (як до #123); ряди
// в стрічці (під довідкою і за «?») — горизонтальний скрол без вертикального.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'Feed.module.css'), 'utf8');
const rule = (sel: string) => css.match(new RegExp(`^\\${sel} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';

describe('чіпи порожнього чату — викладка', () => {
  it('.empty-chips і .empty-chips-m: flex-wrap: wrap, по центру, без overflow', () => {
    for (const sel of ['.empty-chips', '.empty-chips-m']) {
      const r = rule(sel);
      expect(r, sel).toContain('flex-wrap: wrap');
      expect(r, sel).toContain('justify-content: center');
      expect(r, sel).not.toContain('overflow');
    }
  });
  it('.help-followup і .help-row: overflow-x: auto і overflow-y: hidden', () => {
    for (const sel of ['.help-followup', '.help-row']) {
      const r = rule(sel);
      expect(r, sel).toContain('overflow-x: auto');
      expect(r, sel).toContain('overflow-y: hidden');
    }
  });
});
