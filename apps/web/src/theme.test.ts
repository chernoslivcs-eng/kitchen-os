// @vitest-environment jsdom
//
// FIXES-V3 №2: лендінг і auth-екрани — завжди світлі; темна тема належить
// застосунку після входу. Перевіряється і механізм (theme.ts), і те, що з
// CSS лендінгу/auth зникли провізорні правила темної.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { initTheme, setLightOnly, setThemeOverride, setThemeSetting, themeSetting, LIGHT_ONLY_PATHS } from './theme';

const darkOS = () => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn() })));
const theme = () => document.documentElement.dataset.theme;

beforeEach(() => { darkOS(); localStorage.clear(); delete document.documentElement.dataset.theme; });

describe('№2 · світлий поза входом', () => {
  it('маршрути поза входом: / · /sent · /invite · /link/* — так; /app і решта — ні', () => {
    for (const p of ['/', '/sent', '/invite', '/link/expired', '/link/consumed', '/welcome', '/welcome/2']) expect(LIGHT_ONLY_PATHS.test(p), p).toBe(true);
    for (const p of ['/app', '/pantry', '/profile', '/r/abc', '/welcomed']) expect(LIGHT_ONLY_PATHS.test(p), p).toBe(false);
  });

  // Профіль за Prototype (рішення власника 13.09): без вибору — Світла всюди;
  // темна ОС вмикає темну лише при явному «Авто».
  it('темна ОС без вибору: і на /, і в застосунку — світлий; «Авто» — за ОС; «Темна» — темний', () => {
    history.replaceState(null, '', '/');
    initTheme();
    expect(theme()).toBe('light');
    history.replaceState(null, '', '/app');
    initTheme();
    expect(theme()).toBe('light');
    expect(themeSetting()).toBe('light');
    setThemeSetting('auto');
    expect(theme()).toBe('dark');
    expect(themeSetting()).toBe('auto');
    setThemeSetting('dark');
    expect(theme()).toBe('dark');
    setThemeSetting('light');
    expect(theme()).toBe('light');
  });

  it('зміна ОС перемикає тему лише при «Авто»', () => {
    let handler: ((e: { matches: boolean }) => void) | null = null;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: (_: string, h: (e: { matches: boolean }) => void) => { handler = h; } })));
    history.replaceState(null, '', '/app');
    initTheme();
    expect(theme()).toBe('light');
    handler!({ matches: false });
    expect(theme(), 'без вибору ОС не слухаємо').toBe('light');
    setThemeSetting('auto');
    handler!({ matches: false });
    expect(theme()).toBe('dark');
    handler!({ matches: true });
    expect(theme()).toBe('light');
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

  // Хотфікс 13.09: онбординг /welcome — лише світлий, як лендінг (усі 11 кроків).
  it('темна ОС: /welcome — світлий з першого кадру; перехід у застосунок і назад перемикає без перезавантаження', () => {
    history.replaceState(null, '', '/welcome');
    initTheme();
    expect(theme()).toBe('light');
    // /welcome → /app: онбординг розмонтовано (cleanup useLightOnly); «Авто» — за ОС (темна)
    setThemeSetting('auto');
    setLightOnly(false);
    expect(theme()).toBe('dark');
    // /app → /welcome: онбординг змонтовано — знову світлий
    setLightOnly(true);
    expect(theme()).toBe('light');
  });

  it('CSS лендінгу, auth і онбордингу не має власних правил темної', () => {
    for (const f of ['pages/Landing/Landing.module.css', 'pages/Auth/Auth.module.css', 'pages/Onboarding/Onboarding.module.css']) {
      const css = readFileSync(resolve(fileURLToPath(import.meta.url), '..', f), 'utf8');
      expect(css.includes("data-theme='dark'"), f).toBe(false);
    }
  });
});
