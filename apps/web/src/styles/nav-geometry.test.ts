// fix/empty-proto-sidebar (Р141): рейка 60 ↔ сайдбар 256 (і 64 ↔ 300 на 768) —
// одна геометрія на обидва стани. Власник: «при розгортанні скачуть іконки, є
// відчуття, що зʼявився новий сайдбар». Причина була в CSS: ширина анімується,
// а вміст перемикався миттєво (display none→block, flex-direction column→row,
// центровані 38×38 → рядки). Правило: у розгорнутому стані (.wide / .open)
// жодного display і flex-direction; підписи, назва, список розмов і текст
// профілю — лише opacity/visibility; знаки в обох станах на тому самому x
// (поле рейки + поле рядка = 21 на 1440, 23 на 768).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../components/TabBar/TabBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Правила ≥768: усе після першого @media (min-width: 768px) із фіксованою рейкою.
const desktop = css.slice(css.indexOf('.wrap {\n    --nav-label-delay'));
const rules = [...desktop.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), decls: m[2]! }));

describe('Р141 · рейка ↔ сайдбар без перемикань', () => {
  it('у .wide / .open немає display і flex-direction', () => {
    const expanded = rules.filter((r) => /\.(wide|open)\b/.test(r.sel));
    expect(expanded.length).toBeGreaterThan(10);
    for (const r of expanded) {
      expect(r.decls, `«${r.sel}»`).not.toMatch(/(^|;)\s*display\s*:/);
      expect(r.decls, `«${r.sel}»`).not.toMatch(/flex-direction\s*:/);
    }
  });
  it('підписи завжди в DOM: ховаються opacity/visibility, не display', () => {
    for (const label of ['.brand-name', '.tab > span:nth-child(2)', '.user-text', '.sessions', '.tab-count', '.panel-btn']) {
      const own = rules.filter((r) => r.sel.split(',').some((s) => s.trim().endsWith(label)));
      expect(own.length, `правила для ${label}`).toBeGreaterThan(0);
      for (const r of own) expect(r.decls, `«${r.sel}»`).not.toMatch(/(^|;)\s*display\s*:\s*(none|inline|block|flex)/);
    }
  });
  it('знак цілі стоїть на тому самому x: поле рейки й поле рядка не міняються в .wide/.open', () => {
    const base = rules.find((r) => r.sel === '.wrap' && /--nav-label-delay/.test(r.decls))!;
    expect(base.decls).toMatch(/padding\s*:\s*16px 11px/);
    const tab = rules.find((r) => r.sel === '.tab')!;
    expect(tab.decls).toMatch(/padding\s*:\s*0 10px/);
    expect(tab.decls).toMatch(/justify-content\s*:\s*flex-start/);
    for (const r of rules.filter((r) => /\.(wide|open)\b/.test(r.sel) && /\.(wrap|tab)\b\s*$/.test(r.sel))) {
      expect(r.decls, `«${r.sel}»`).not.toMatch(/(^|;)\s*padding(-left)?\s*:/);
      expect(r.decls, `«${r.sel}»`).not.toMatch(/justify-content\s*:/);
      expect(r.decls, `«${r.sel}»`).not.toMatch(/align-items\s*:/);
    }
  });
  it('нічого не їде по y: висоти, вертикальні поля й gap однакові в обох станах, висота не анімується', () => {
    const GEOM = /(^|;)\s*(height|min-height|max-height|padding|padding-top|padding-bottom|padding-block|gap|row-gap|margin|margin-top|margin-bottom|top|bottom|line-height|font-size|width|min-width|flex|flex-wrap|border-top-width|border-top\b)\s*:/;
    const ROWS = ['.wrap', '.brand', '.brand-btn', '.tab', '.badge', '.foot', '.user', '.user-avatar', '.panel-btn', '.scroll'];
    for (const r of rules.filter((r) => /\.(wide|open)\b/.test(r.sel))) {
      const target = r.sel.split(',').map((s) => s.trim().split(/\s+/).at(-1)!);
      if (!target.some((t) => ROWS.includes(t))) continue;
      // Єдине, що змінюється: ширина .wrap і right бейджа.
      const allowed = r.decls.replace(/(^|;)\s*width\s*:\s*(256|300)px/g, '$1').replace(/(^|;)\s*right\s*:[^;]+/g, '$1');
      expect(allowed, `«${r.sel}»`).not.toMatch(GEOM);
    }
    for (const sel of ['.tab', '.foot .user', '.panel-btn', '.brand-btn', '.wrap']) {
      for (const r of rules.filter((r) => r.sel === sel)) {
        const tr = r.decls.match(/transition\s*:\s*([^;]+)/)?.[1] ?? '';
        expect(tr, `transition у «${sel}»`).not.toMatch(/\b(height|min-height|line-height|padding|gap|top)\b/);
      }
    }
  });
  it('підписи входять із затримкою, виходять першими; список розмов — після ширини', () => {
    const wideLabels = rules.find((r) => r.sel.startsWith('.wide .brand-name'))!;
    expect(wideLabels.decls).toMatch(/opacity var\(--dur-base\) var\(--ease-standard\) var\(--nav-label-delay\)/);
    const wideSessions = rules.find((r) => r.sel === '.wide .sessions')!;
    expect(wideSessions.decls).toMatch(/opacity var\(--dur-base\) var\(--ease-standard\) var\(--dur-slow\)/);
    const collapsed = rules.find((r) => r.sel.startsWith('.brand-name, .tab > span'))!;
    expect(collapsed.decls).toMatch(/opacity var\(--dur-fast\)/);
    expect(collapsed.decls).not.toMatch(/opacity var\(--dur-fast\)[^,;]*\d+ms/);
  });
});
