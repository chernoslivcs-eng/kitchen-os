// fix/ios-scroll-end-padding (13.09): iOS WebKit не додає кінцевий padding
// скрол-контейнера до scrollable overflow — резерв під бар як padding-bottom
// лишав останню картку під баром без змоги догорнути. Правило: у скролерів
// схеми чату padding-bottom = 0 в усіх правилах, а низ і резерв — спейсер
// ::after із height (на ≤767 — з 64px бара).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCROLLERS: Array<[string, string]> = [
  ['pages/Recipes/Recipes.module.css', 'body'],
  ['pages/Pantry/Pantry.module.css', 'body'],
  ['pages/Shopping/Shopping.module.css', 'body'],
  ['pages/CookLog/CookLog.module.css', 'body'],
  ['pages/Recipe/Recipe.module.css', 'body'],
  ['pages/Profile/ProfileV2.module.css', 'main'],
  ['pages/Calendar/Calendar.module.css', 'list'],
  ['pages/Feed/Feed.module.css', 'timeline'],
];

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// Значення shorthand розбиваємо по пробілах лише на нульовій глибині дужок (calc(… env(…))).
const splitTop = (v: string) => { const out: string[] = []; let d = 0, cur = ''; for (const ch of v.trim()) { if (ch === '(') d++; if (ch === ')') d--; if (/\s/.test(ch) && d === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
const bottomOf = (shorthand: string) => { const v = splitTop(shorthand); return v.length === 1 ? v[0]! : v.length === 2 ? v[0]! : v[2]!; };

describe('низ скролерів — спейсер ::after, не padding-bottom', () => {
  for (const [file, cls] of SCROLLERS) {
    it(`${file} .${cls}`, () => {
      const css = strip(readFileSync(resolve(__dirname, '..', file), 'utf8'));
      // усі правила самого скролера (з будь-яким префіксом, без ::after)
      const rules = [...css.matchAll(new RegExp(`(^|[\\s,{}])((?:[.\\w-]+\\s+)*\\.${cls})\\s*\\{([^{}]*)\\}`, 'g'))]
        .filter((m) => !m[2]!.includes('::'));
      expect(rules.length, 'правила скролера знайдено').toBeGreaterThan(0);
      for (const m of rules) {
        const decls = m[3]!;
        const pb = decls.match(/padding-bottom\s*:\s*([^;]+)/);
        if (pb) expect(pb[1]!.trim(), `padding-bottom у «${m[2]}»`).toMatch(/^0(px)?$/);
        for (const p of decls.matchAll(/(?:^|;)\s*padding\s*:\s*([^;]+)/g)) {
          expect(bottomOf(p[1]!), `низ padding у «${m[2]}»: ${p[1]!.trim()}`).toMatch(/^0(px)?$/);
        }
      }
      const after = [...css.matchAll(new RegExp(`\\.${cls}::after\\s*\\{([^{}]*)\\}`, 'g'))].map((m) => m[1]!);
      expect(after.length, 'є спейсер ::after').toBeGreaterThan(0);
      expect(after.some((d) => /content\s*:/.test(d) && /display\s*:\s*block/.test(d)), 'спейсер — блок із content').toBe(true);
      expect(after.some((d) => /height\s*:/.test(d)), 'спейсер має висоту').toBe(true);
      if (cls !== 'timeline') {
        // бар 64 + safe-area — на ≤767 у висоті спейсера
        const mobile = [...css.matchAll(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}|@media \(max-width: 767px\)\s*\{([^{}]*\{[^{}]*\}[^{}]*)\}/g)]
          .map((m) => (m[1] ?? m[2])!).join('\n');
        expect(mobile, `на ≤767 спейсер .${cls}::after з 64px`).toMatch(new RegExp(`\\.${cls}::after\\s*\\{[^{}]*64px[^{}]*\\}`));
      }
    });
  }
});
