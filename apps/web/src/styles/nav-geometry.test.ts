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
    for (const label of ['.brand-name', '.tab > span:nth-child(2)', '.user-text', '.sessions', '.tab-count', '.tab-pill']) {
      const own = rules.filter((r) => r.sel.split(',').some((s) => s.trim().endsWith(label)));
      expect(own.length, `правила для ${label}`).toBeGreaterThan(0);
      for (const r of own) expect(r.decls, `«${r.sel}»`).not.toMatch(/(^|;)\s*display\s*:\s*(none|inline|block|flex)/);
    }
  });
  it('знак цілі стоїть на тому самому x: поле рейки й поле рядка не міняються в .wide/.open', () => {
    const base = rules.find((r) => r.sel === '.wrap' && /--nav-label-delay/.test(r.decls))!;
    expect(base.decls).toMatch(/padding\s*:\s*16px 8px/);
    const tab = rules.find((r) => r.sel === '.tab')!;
    expect(tab.decls).toMatch(/height\s*:\s*44px/);
    expect(tab.decls).toMatch(/padding\s*:\s*0 13px/);
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
      // Єдине, що змінюється: ширина .wrap.
      const allowed = r.decls.replace(/(^|;)\s*width\s*:\s*(256|300)px/g, '$1');
      expect(allowed, `«${r.sel}»`).not.toMatch(GEOM);
    }
    for (const sel of ['.tab', '.foot .user', '.panel-btn', '.brand-btn', '.wrap']) {
      for (const r of rules.filter((r) => r.sel === sel)) {
        const tr = r.decls.match(/transition\s*:\s*([^;]+)/)?.[1] ?? '';
        expect(tr, `transition у «${sel}»`).not.toMatch(/\b(height|min-height|line-height|padding|gap|top)\b/);
      }
    }
  });
  it('квадрат 44 у рейці 60; «панель» 38 у своєму рядку над профілем; бейдж і крапка — на кутку знака від лівого краю', () => {
    // рейка 60 = 8 + 44 + 8; 768: 64 = 10 + 44 + 10
    const rail768 = rules.find((r) => r.sel === '.wrap' && /width\s*:\s*64px/.test(r.decls))!;
    expect(rail768.decls).toMatch(/padding\s*:\s*14px 10px/);
    const foot = rules.find((r) => r.sel === '.foot')!;
    expect(foot.decls).toMatch(/flex-direction\s*:\s*column-reverse/);
    const panel = rules.find((r) => r.sel === '.panel-btn' && /width\s*:\s*38px/.test(r.decls))!;
    expect(panel.decls).toMatch(/align-self\s*:\s*flex-start/);
    // «панель» лише в розгорнутому стані (власник 13.09): у рейці схована
    // opacity/visibility без плашки, рядок під нею лишається — нічого не їде.
    const panelHidden = rules.find((r) => r.sel === '.panel-btn' && /visibility\s*:\s*hidden/.test(r.decls))!;
    expect(panelHidden.decls).toMatch(/pointer-events\s*:\s*none/);
    const panelBase = rules.find((r) => r.sel === '.panel-btn' && /width\s*:\s*38px/.test(r.decls))!;
    expect(panelBase.decls).not.toMatch(/visibility|opacity/);
    for (const r of rules.filter((r) => /\.(wide|open)\b/.test(r.sel) && /\.panel-btn\s*$/.test(r.sel))) {
      expect(r.decls.replace(/transition\s*:[^;]+;?/, ''), `«${r.sel}»`).not.toMatch(/(width|height|margin|top|left|right)\s*:/);
    }
    const panelChrome = [...css.matchAll(/\.panel-btn\s*\{([^}]*)\}/g)].map((m) => m[1]!).join(';');
    expect(panelChrome, '«панель» без білої плашки').not.toMatch(/background\s*:\s*var\(--card\)|box-shadow/);
    for (const sel of ['.badge', '.tab-dot']) {
      const r = rules.find((r) => r.sel === sel)!;
      expect(r.decls, sel).toMatch(/left\s*:\s*\d+px/);
      expect(r.decls, sel).toMatch(/right\s*:\s*auto/);
      expect(r.decls, sel).not.toMatch(/transition\s*:[^;]*\b(left|right|top)\b/);
      expect(rules.some((x) => /\.(wide|open)\b/.test(x.sel) && x.sel.endsWith(sel) && /(left|right|top|height|font-size)\s*:/.test(x.decls)), `${sel} у .wide/.open не рухається`).toBe(false);
      // у розгорнутому стані — лише opacity (гасне, число показує пілюля/лічильник у кінці рядка)
      for (const x of rules.filter((x) => /\.(wide|open)\b/.test(x.sel) && x.sel.endsWith(sel))) {
        expect(x.decls.replace(/\s/g, ''), `«${x.sel}»`).toMatch(/^opacity:0;?$/);
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
  it('14.09 (власник): .brand — фіксована висота 44 в обох станах, лого й перший таб не зсуваються по y', () => {
    // Без явної height .brand-name (17/700, «Kitchen OS») входить у потік
    // ширшого стану своєю line-height і піднімає .brand на 3–6.5 px —
    // виміряно на проді. Фіксована height рятує в обох станах одразу: цей
    // рядок бере БАЗОВЕ правило .brand (не .wide .brand), тож будь-яке
    // .wide/.open-перевизначення, що додало б свою height, теж зловиться
    // попереднім тестом («нічого не їде по y» — .brand у списку ROWS).
    // Базове правило .brand стоїть ДО anchor «desktop» (спільне для всіх
    // ширин, не лише ≥768) — шукаємо в повному css, не в зрізі rules.
    const brandBase = [...css.matchAll(/(^|\})\s*\.brand\s*\{([^{}]*)\}/g)].map((m) => m[2]!)[0]!;
    expect(brandBase).toMatch(/(^|;)\s*height\s*:\s*44px/);
    // Перший таб іде одразу після .brand у тій самій колонці (.scroll) —
    // фіксована height + без display/flex-direction-перемикань (тест вище)
    // означає: 0 px різниці на y між рейкою і сайдбаром.
    const wideBrandOverrides = rules.filter((r) => /\.(wide|open)\b/.test(r.sel) && /\.brand\s*$/.test(r.sel));
    for (const r of wideBrandOverrides) expect(r.decls, `«${r.sel}»`).not.toMatch(/(^|;)\s*height\s*:/);
  });
  it('14.09 (доповнення, власник — свіжий вимір на проді показав 2.41 px різниці): height:44 повторено й у правилі ≥768 (.brand у рейці/сайдбарі), плюс min/max-height проти автоматичного мінімуму flex-item', () => {
    // .brand — flex-item у .wrap (display:flex; flex-direction:column), а в
    // flex-item «автоматичний мінімум за вмістом» (min-height: auto) міг би
    // перебити явну height, якби overflow десь збився з hidden на visible.
    // Дублюємо в обох правилах, щоб один явний height ніде не був єдиною
    // лінією оборони. Перевірено й живим виміром getBoundingClientRect у
    // браузері: рейка й сайдбар — top 16 (лого) і 62 (перший таб) в обох
    // станах, 0 px різниці.
    const brandBase = [...css.matchAll(/(^|\})\s*\.brand\s*\{([^{}]*)\}/g)].map((m) => m[2]!)[0]!;
    expect(brandBase).toMatch(/(^|;)\s*min-height\s*:\s*44px/);
    expect(brandBase).toMatch(/(^|;)\s*max-height\s*:\s*44px/);
    const brand768 = rules.find((r) => r.sel === '.brand')!;
    expect(brand768.decls).toMatch(/(^|;)\s*height\s*:\s*44px/);
    expect(brand768.decls).toMatch(/(^|;)\s*min-height\s*:\s*44px/);
    expect(brand768.decls).toMatch(/(^|;)\s*max-height\s*:\s*44px/);
    expect(brand768.decls).toMatch(/(^|;)\s*overflow\s*:\s*hidden/);
  });
  it('слова цілей і вордмарк обрізаються по символах трикрапкою, а не проявляються (власник 13.09)', () => {
    const label = rules.find((r) => r.sel === '.brand-name, .tab > span:nth-child(2)')!;
    expect(label.decls).toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(label.decls).toMatch(/min-width\s*:\s*0/);
    const clip = rules.find((r) => r.sel === '.brand-name, .tab > span:nth-child(2), .user-text' && /opacity\s*:\s*1/.test(r.decls))!;
    expect(clip.decls).not.toMatch(/transition\s*:[^;]*opacity/);
    for (const r of rules.filter((r) => /^\.(wide|wrap\.open) \.brand-name, /.test(r.sel) && !/tab-count/.test(r.sel))) {
      expect(r.decls.replace(/\s/g, ''), `«${r.sel}»`).toBe('transition:visibility0s;');
    }
  });
});
