// Auto-theme за prefers-color-scheme: OS каже — ми слухаємо. Раунд 4, крок 6:
// сторінка профілю дає перемикач, який перевизначає OS; вибір живе в
// localStorage і переживає перезавантаження. Без вибору — як було.

const KEY = 'kos-theme';
export type ThemeChoice = 'light' | 'dark';

// Без matchMedia (jsdom у тестах) — темна за замовчуванням, без падіння.
const media = (): Pick<MediaQueryList, 'matches' | 'addEventListener'> =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : { matches: false, addEventListener: () => {} };

// FIXES-V3 №2 (рішення власника 11.09): лендінг і auth-екрани на його
// каркасі — завжди світлі, на всіх ширинах; темна тема належить застосунку
// після входу. Поки прапорець стоїть, ні ОС, ні вибір із профілю тему не
// перемикають — і в темній системній темі на телефоні лендінг не вмикається
// темним, і по лінку з /sent немає стрибка світле → темне.
let lightOnly = false;

function apply(light: boolean) {
  document.documentElement.dataset.theme = light || lightOnly ? 'light' : 'dark';
}

/** Маршрути поза входом — світлі з першого кадру, ще до монтування React. */
export const LIGHT_ONLY_PATHS = /^\/($|sent$|invite$|link\/)/;

export function setLightOnly(on: boolean): void {
  lightOnly = on;
  const o = themeOverride();
  apply(o ? o === 'light' : media().matches);
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

/** «Тема · Світла / Темна / Авто» (профіль, Screens D2a — підтверджене
 *  відхилення від проду): auto = без власного вибору, за ОС. */
export type ThemeSetting = ThemeChoice | 'auto';
export function themeSetting(): ThemeSetting { return themeOverride() ?? 'auto'; }
export function setThemeSetting(v: ThemeSetting): void { setThemeOverride(v === 'auto' ? null : v); }

export function initTheme(): void {
  const m = media();
  const o = themeOverride();
  lightOnly = LIGHT_ONLY_PATHS.test(location.pathname);
  apply(o ? o === 'light' : m.matches);
  // Змін ОС слухаємо в реальному часі — macOS перемикання «день/ніч»
  // без перезавантаження вкладки. Явний вибір людини сильніший за ОС.
  m.addEventListener('change', (e) => { if (!themeOverride()) apply(e.matches); });
}
