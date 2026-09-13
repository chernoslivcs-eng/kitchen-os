// Тема застосунку. Раунд 4, крок 6: сторінка профілю дає перемикач Світла ·
// Темна · Авто; вибір живе в localStorage і переживає перезавантаження.
// Профіль за Prototype (рішення власника 13.09): без вибору — Світла; ОС
// (prefers-color-scheme) слухаємо лише при явному «Авто».

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

/** Маршрути поза входом — світлі з першого кадру, ще до монтування React.
 *  Хотфікс 13.09 (рішення власника): онбординг /welcome — теж лише світлий, як
 *  лендінг; на телефонах з «Авто» вдень він був темним і виглядав погано. */
export const LIGHT_ONLY_PATHS = /^\/($|sent$|invite$|link\/|welcome($|\/))/;

export function setLightOnly(on: boolean): void {
  lightOnly = on;
  apply(wantsLight());
}

/** Збережений вибір: light · dark · auto; нема — null. */
function stored(): ThemeSetting | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'auto' ? v : null;
  } catch { return null; }
}

/** Світла чи ні — з вибору. Профіль за Prototype (рішення власника 13.09):
 *  без збереженого вибору — СВІТЛА, не за ОС; ОС слухаємо лише при явному «Авто». */
function wantsLight(): boolean {
  const s = stored();
  if (s === 'auto') return media().matches;
  return s !== 'dark';
}

/** Жорсткий вибір людини (light/dark); «Авто» і відсутність вибору — null. */
export function themeOverride(): ThemeChoice | null {
  const s = stored();
  return s === 'light' || s === 'dark' ? s : null;
}

export function setThemeOverride(v: ThemeChoice | null): void {
  try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* приватний режим */ }
  apply(wantsLight());
}

export function currentTheme(): ThemeChoice {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** «Тема · Світла / Темна / Авто» (профіль): auto — за ОС; без вибору — Світла. */
export type ThemeSetting = ThemeChoice | 'auto';
export function themeSetting(): ThemeSetting { return stored() ?? 'light'; }
export function setThemeSetting(v: ThemeSetting): void {
  try { localStorage.setItem(KEY, v); } catch { /* приватний режим */ }
  apply(wantsLight());
}

export function initTheme(): void {
  const m = media();
  lightOnly = LIGHT_ONLY_PATHS.test(location.pathname);
  apply(wantsLight());
  // Змін ОС слухаємо в реальному часі — macOS перемикання «день/ніч»
  // без перезавантаження вкладки — але лише при явному «Авто».
  m.addEventListener('change', (e) => { if (stored() === 'auto') apply(e.matches); });
}
