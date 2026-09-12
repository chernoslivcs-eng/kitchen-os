import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Скло і градієнт v3.1 (glass-gradient-spec §1–§3, §6): токени в ОБИДВА
// блоки тем, градієнт лише на рамці двох екранів, скло — одна оболонка з
// contain: paint, без will-change у дітей, щільний фолбек без прозорості.
const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(resolve(here, 'tokens.css'), 'utf-8');
const glass = readFileSync(resolve(here, 'glass.css'), 'utf-8');
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf-8');

describe('скло і градієнт v3.1', () => {
  it('токени --glass-* у двох блоках тем (§6.2: інакше світла втрачає межу)', () => {
    for (const name of ['glass-bg', 'glass-edge', 'glass-top', 'glass-side', 'glass-sh', 'glass-blur', 'glass-sat', 'chat-grad', 'chat-grad-top']) {
      expect(tokens.match(new RegExp(`--${name}:`, 'g'))?.length, `--${name}`).toBe(2);
    }
    expect(tokens).toMatch(/--glass-bg:\s*color-mix\(in srgb, var\(--card\) 72%, transparent\)/);
    expect(tokens).toMatch(/--glass-bg:\s*color-mix\(in srgb, var\(--card\) 78%, transparent\)/);
    expect(tokens).toMatch(/--chat-grad-top:\s*color-mix\(in srgb, var\(--amber-bg\) 32%, var\(--bg\)\)/);
    expect(tokens).toMatch(/--chat-grad-top:\s*color-mix\(in srgb, var\(--card\) 45%, var\(--bg\)\)/);
    expect(tokens).toMatch(/var\(--bg\) 240px/);
    expect(tokens).toMatch(/var\(--bg\) 260px/);
  });

  it('градієнт — лише на рамці (body[data-screen]) для розмови й публічного рецепта', () => {
    expect(glass).toMatch(/body\[data-screen='chat'\],\s*body\[data-screen='public-recipe'\]\s*\{[^}]*background-image:\s*var\(--chat-grad\)/);
    // Колонки прозорі — градієнт не на них (§6.3).
    expect(read('pages/Feed/Feed.module.css')).toMatch(/\.screen\s*\{[^}]*background:\s*transparent/);
    expect(read('pages/SharedRecipe/SharedRecipe.module.css')).toMatch(/\.screen\s*\{[^}]*background:\s*transparent/);
    // Решта екранів — рівний --bg: жодних chat-grad поза glass.css і токенами.
    for (const p of ['pages/Pantry/Pantry.module.css', 'pages/Recipes/Recipes.module.css', 'pages/Calendar/Calendar.module.css', 'pages/Profile/ProfileV2.module.css', 'pages/Cook/Cook.module.css']) {
      expect(read(p), p).not.toContain('chat-grad');
    }
  });

  it('скло: одна оболонка, contain: paint, isolation на зовнішньому шарі, контур ::after', () => {
    expect(glass).toMatch(/\.glass\s*\{\s*isolation:\s*isolate;\s*\}/);
    for (const cls of ['glass-inner', 'glass-rail', 'glass-bar']) {
      const m = glass.match(new RegExp(`\\.${cls}\\.${cls}\\s*\\{([^}]*)\\}`));
      expect(m, cls).not.toBeNull();
      expect(m![1]).toContain('backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat))');
      expect(m![1]).toContain('contain: paint');
      expect(m![1]).toContain('background: var(--glass-bg)');
    }
    expect(glass).toMatch(/\.glass-inner::after\s*\{[^}]*border:\s*1px solid var\(--glass-edge\)[^}]*inset 0 1px 0 var\(--glass-top\), inset 1px 0 0 var\(--glass-side\)/);
    expect(glass).not.toContain('will-change');
  });

  it('без прозорості — щільний --card без розмиття', () => {
    expect(glass).toMatch(/@media \(prefers-reduced-transparency: reduce\)\s*\{[^}]*\{[^}]*background:\s*var\(--card\);[^}]*backdrop-filter:\s*none/);
  });

  it('оболонки носять класи: панель (два шари за шириною), шторка, рейка, нижній бар', () => {
    const panel = read('components/ArtifactPanel/ArtifactPanel.tsx');
    expect(panel).toMatch(/glass \$\{open && !inFlow \? 'glass-inner' : ''\}/);
    expect(panel).toMatch(/\$\{inFlow \? 'glass-inner' : ''\}/);
    expect(read('components/Sheet/Sheet.tsx')).toContain('glass glass-inner');
    const bar = read('components/TabBar/TabBar.tsx');
    expect(bar).toContain('glass-rail');
    expect(bar).toContain('glass-bar');
    // Щільними лишаються картки контенту, бабли, тости, модалки, крок Cook Mode.
    for (const p of ['pages/Feed/cards.tsx', 'components/ErrorState/Toast.tsx', 'pages/Cook/Cook.tsx', 'components/HomeNow/HomeNow.tsx']) {
      expect(read(p), p).not.toMatch(/glass-inner|glass-rail|glass-bar/);
    }
  });
});
