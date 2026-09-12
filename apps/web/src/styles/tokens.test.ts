import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Токени v3 — контракт, не смак. Тест тримає ТОЧНІ значення з
// ai/project/tokens-v3.md (світлі sage/amber/plum — правка 12.09, ANSWERS C2): перейменування шару не має права їх зсунути.
// Той самий рід перевірки, що PROFILE_FIELDS у profile-text.test.ts.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** Значення токена в блоці, позначеному маркером.
 *  Маркер, не селектор: `:root[data-theme='light']` у файлі вже є зі СТАРИМИ
 *  іменами, і пошук за селектором знайшов би саме його. */
function tokenIn(marker: string, name: string): string | null {
  const start = css.indexOf(marker);
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf('}', start));
  const m = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
}

const LIGHT: Record<string, string> = {
  canvas: '#c9ccd0', bg: '#f4f3ef', card: '#ffffff', line: '#f0eee9',
  line2: '#e6e4de', faint: '#c9cbcd', ink: '#1a1c1e', muted: '#6b6f74',
  dim: '#9a9ea3', sage: '#55724a', 'sage-bg': '#e8efe3', amber: '#866425',
  'amber-bg': '#f6ecd6', plum: '#885b77', 'plum-bg': '#f1e5ec', danger: '#b5473c',
};

const DARK: Record<string, string> = {
  canvas: '#0c0d0f', bg: '#16181b', card: '#1f2226', line: '#2a2e33',
  line2: '#33383e', faint: '#4a4f55', ink: '#ecebe7', muted: '#a3a7ac',
  dim: '#6f7379', sage: '#93b48b', 'sage-bg': '#26312a', amber: '#d2ad6b',
  'amber-bg': '#332a1c', plum: '#c99ab4', 'plum-bg': '#2f2329', danger: '#d47f74',
};

describe('токени v3', () => {
  it('світла тема — шістнадцять токенів із точними значеннями', () => {
    for (const [name, value] of Object.entries(LIGHT)) {
      expect(tokenIn('/* v3-light */', name), `--${name}`).toBe(value);
    }
  });

  it('темна тема — ті самі імена, свої значення', () => {
    for (const [name, value] of Object.entries(DARK)) {
      expect(tokenIn('/* v3-dark */', name), `--${name}`).toBe(value);
    }
  });

  it('Р18: :root лишається темним — міграція імен не перевертає дефолт', () => {
    expect(css).toMatch(/:root[^{]*\{[^}]*color-scheme:\s*dark/);
  });

  // Етап 1.6 (Р19): гарнітура одна. Тест стоїть на токенах, а не на 42 файлах
  // CSS: усі три імені — псевдоніми Onest, тому «гарнітур 1» тримається тут.
  it('Р19: усі три шрифтові токени ведуть на Onest', () => {
    for (const name of ['font-display', 'font-body', 'font-mono']) {
      const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
      expect(m?.[1], `--${name}`).toContain("'Onest'");
    }
    // Без коментарів: у комментарі до Р19 обидві гарнітури названі навмисно —
    // там сказано, що їх ЗНЯТО, і тест не має падати на власному поясненні.
    const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(decls, 'Golos Text знято').not.toContain('Golos');
    expect(decls, 'IBM Plex Mono знято').not.toContain('Plex Mono');
  });

  // Етап 1.6 (Р20): капсу немає, тому й трекінгу під капс немає.
  it('Р20: трекінг під капс зведений у нуль', () => {
    expect(css).toMatch(/--tracking-mono:\s*0;/);
    expect(css).toMatch(/--tracking-caps:\s*0;/);
  });
});

const roles = readFileSync(fileURLToPath(new URL('./roles.css', import.meta.url)), 'utf8');

// Роль несе ВСІ параметри: кегль, інтерліньяж, вагу, трекінг. Компонент не має
// власного значення — тільки роль. Числа з tokens-v3.md, таблиця «Типографіка».
const ROLES: Record<string, { size: string; line: string; weight: string; track: string }> = {
  // Рішення 11.09: як на кадрах Screens — display 36, h1 28 (26 на 390, окремий тест нижче).
  display: { size: '36px', line: '1.05', weight: '700', track: '-0.03em' },
  h1:      { size: '28px', line: '1.05', weight: '700', track: '-0.03em' },
  h2:      { size: '22px', line: '1.2',  weight: '600', track: '-0.02em' },
  h3:      { size: '17px', line: '1.3',  weight: '600', track: '-0.01em' },
  body:    { size: '16px', line: '1.55', weight: '400', track: '0' },
  row:     { size: '15px', line: '1.4',  weight: '500', track: '0' },
  small:   { size: '14px', line: '1.5',  weight: '400', track: '0' },
  caption: { size: '13px', line: '1.4',  weight: '400', track: '0' },
  label:   { size: '12px', line: '1.3',  weight: '500', track: '0.01em' },
  timer:   { size: '112px', line: '1',   weight: '700', track: '-0.04em' },
};

describe('ролі типографіки v3', () => {
  it('h1 на 390 — 26, як на кадрах Screens (рішення 11.09)', () => {
    const m = roles.match(/@media \(max-width: 767px\)\s*\{[^}]*\.t-h1\s*\{\s*font-size: 26px;/);
    expect(m, 'медіазапит .t-h1 26px до 767').not.toBeNull();
  });

  it('десять ролей, кожна з повним набором параметрів', () => {
    for (const [name, p] of Object.entries(ROLES)) {
      // Якір на початок рядка обовʼязковий: `.t-timer` стоїть останнім у
      // груповому селекторі спільних правил, і без якоря регексп бере той блок.
      const m = roles.match(new RegExp(`(?:^|\\n)\\.t-${name}\\s*\\{([^}]+)\\}`));
      expect(m, `.t-${name} оголошено`).not.toBeNull();
      const body = m![1]!;
      expect(body, `.t-${name} font-size`).toContain(`font-size: ${p.size}`);
      expect(body, `.t-${name} line-height`).toContain(`line-height: ${p.line}`);
      expect(body, `.t-${name} font-weight`).toContain(`font-weight: ${p.weight}`);
      expect(body, `.t-${name} letter-spacing`).toContain(`letter-spacing: ${p.track}`);
    }
  });

  // Р24: `audit-thresholds.md` вимагає «написань трекінгу ≤ 4» і перелічує
  // чотири: -0.03 / -0.02 / -0.01 / 0.01em. Але таблиця ролей у tokens-v3.md
  // визначає шість написань — до тих чотирьох додаються `0` (body, row, small,
  // caption) і `-0.04em` (timer). Тобто дві специфікації бандла суперечать одна
  // одній, і поріг аудиту недосяжний за власним канонів.
  // Тест тримає те, що канон РОЛЕЙ справді визначає; число порога вирішується
  // в завданні 1.3, де пороги й ставляться.
  it('Р24: написань трекінгу шість — рівно ті, що визначає таблиця ролей', () => {
    const uniq = new Set(
      (roles.match(/letter-spacing:\s*([^;]+);/g) ?? []).map((d) => d.replace(/.*:\s*/, '').replace(/;$/, '').trim()),
    );
    expect([...uniq].sort()).toEqual(['-0.01em', '-0.02em', '-0.03em', '-0.04em', '0', '0.01em']);
  });

  it('табличні цифри — на всіх ролях одним правилом', () => {
    expect(roles).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
