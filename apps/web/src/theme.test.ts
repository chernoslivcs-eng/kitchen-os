// @vitest-environment jsdom
//
// FIXES-V3 №2: лендінг і auth-екрани — завжди світлі; темна тема належить
// застосунку після входу. Перевіряється і механізм (theme.ts), і те, що з
// CSS лендінгу/auth зникли провізорні правила темної.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { initTheme, setLightOnly, setThemeOverride, LIGHT_ONLY_PATHS } from './theme';

const darkOS = () => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn() })));
const theme = () => document.documentElement.dataset.theme;

beforeEach(() => { darkOS(); localStorage.clear(); delete document.documentElement.dataset.theme; });

describe('№2 · світлий поза входом', () => {
  it('маршрути поза входом: / · /sent · /invite · /link/* — так; /app і решта — ні', () => {
    for (const p of ['/', '/sent', '/invite', '/link/expired', '/link/consumed']) expect(LIGHT_ONLY_PATHS.test(p), p).toBe(true);
    for (const p of ['/app', '/pantry', '/profile', '/r/abc', '/welcome']) expect(LIGHT_ONLY_PATHS.test(p), p).toBe(false);
  });

  it('темна ОС: на / перший кадр світлий; у застосунку — темний', () => {
    history.replaceState(null, '', '/');
    initTheme();
    expect(theme()).toBe('light');
    history.replaceState(null, '', '/app');
    initTheme();
    expect(theme()).toBe('dark');
  });

  it('прапорець сильніший за вибір із профілю; знято — тема повертається', () => {
    history.replaceState(null, '', '/app');
    initTheme();
    setThemeOverride('dark');
    setLightOnly(true);
    expect(theme()).toBe('light');
    setThemeOverride('dark');
    expect(theme(), 'поки екран поза входом змонтований, вибір не перемикає').toBe('light');
    setLightOnly(false);
    expect(theme()).toBe('dark');
  });

  it('CSS лендінгу й auth не має власних правил темної', () => {
    for (const f of ['pages/Landing/Landing.module.css', 'pages/Auth/Auth.module.css']) {
      const css = readFileSync(resolve(fileURLToPath(import.meta.url), '..', f), 'utf8');
      expect(css.includes("data-theme='dark'"), f).toBe(false);
    }
  });
});
