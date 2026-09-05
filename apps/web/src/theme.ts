// Auto-theme за prefers-color-scheme: OS каже — ми слухаємо. Раунд 4, крок 6:
// сторінка профілю дає перемикач, який перевизначає OS; вибір живе в
// localStorage і переживає перезавантаження. Без вибору — як було.

const KEY = 'kos-theme';
export type ThemeChoice = 'light' | 'dark';

const media = () => window.matchMedia('(prefers-color-scheme: light)');

function apply(light: boolean) {
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
}

export function themeOverride(): ThemeChoice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}

export function setThemeOverride(v: ThemeChoice | null): void {
  try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* приватний режим */ }
  apply(v ? v === 'light' : media().matches);
}

export function currentTheme(): ThemeChoice {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function initTheme(): void {
  const m = media();
  const o = themeOverride();
  apply(o ? o === 'light' : m.matches);
  // Змін ОС слухаємо в реальному часі — macOS перемикання «день/ніч»
  // без перезавантаження вкладки. Явний вибір людини сильніший за ОС.
  m.addEventListener('change', (e) => { if (!themeOverride()) apply(e.matches); });
}
