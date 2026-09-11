import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Текстові гліфи в розмітці — тест, а не пильність.
 *
 * Канон: «Жодних гліфів-символів у тексті (◌ ● ○ ✓ ✕ ＋ → ☆) — тільки Lucide
 * або слова» (tokens-v3 · Канон компонентів), і `audit-thresholds.md` вимагає
 * «текстових гліфів 0».
 *
 * Чому це живе тут, а не лише в `design-audit.mjs`. Прогін аудиту ходить по
 * шести маршрутах і бачить лише ті стани, у які встиг зайти: `/recipe/:id`,
 * `/cooklog`, панель артефактів і мітки карток він не відкриває ніколи. Через
 * це гліфи «нуль» тричі означало «нуль там, де ми подивились» — і тричі за
 * один день я звітував про знесене, не подивившись (DEBT §26). Патерн не
 * зникає від того, що його назвали; він зникає, коли перевірка стає кроком.
 *
 * Дві купи, і вони різні за природою:
 *
 *   ГЛІФ САМ — символ і є елементом: `<span>→</span>`, `'★'.repeat(n)`,
 *   стрілка-префікс. Це знак, намальований текстом, або дані, намальовані
 *   текстом. Падає.
 *
 *   ГЛІФ У ФРАЗІ — стоїть поруч зі словами: «Готувати →», «Рецепт →». Це
 *   копі, і його переписує копірайтер разом із капсом (COPY-DEBT блок 1).
 *   Рахується й друкується, не падає.
 */
// «⋯» додано 11.09: жив у мобільній пігулці як «нічого не показати» і не був
// у наборі — гейт бачить лише те, що йому назвали.
// Трикрапка «…» у наборі НЕ стоїть: це типографіка — обрізка, «зберігаю…».
const GLYPHS = '◌●○✓✕＋→←↩↗☆★⟳◈✳▤☰◷◉❋⌀▦◇◆■□⋯';
const SKIP_DIRS = ['Landing', 'Admin', 'SignIn'];

const SRC = fileURLToPath(new URL('.', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.includes(name)) walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Прибрати коментарі. Попередній рахунок спіймався саме на них. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

const LETTER = /[\p{L}\p{N}]/u;

/**
 * Чи гліф стоїть САМ. Дивимось найближче оточення в межах свого «шматка
 * тексту»: до найближчої межі — лапки, дужки або кутової. Якщо в шматку є
 * літери чи цифри — це фраза.
 */
function isAlone(text: string, at: number): boolean {
  const isBoundary = (c: string) => `'"\`<>{}`.includes(c);
  let l = at - 1;
  while (l >= 0 && !isBoundary(text[l]!)) l--;
  let r = at + 1;
  while (r < text.length && !isBoundary(text[r]!)) r++;
  const chunk = text.slice(l + 1, r);
  return !LETTER.test(chunk);
}

interface Hit { file: string; line: number; snippet: string }

function scan(): { alone: Hit[]; inPhrase: Hit[] } {
  const alone: Hit[] = [];
  const inPhrase: Hit[] = [];
  for (const file of walk(SRC)) {
    const clean = stripComments(readFileSync(file, 'utf8'));
    for (let i = 0; i < clean.length; i++) {
      if (!GLYPHS.includes(clean[i]!)) continue;
      const line = clean.slice(0, i).split('\n').length;
      const from = clean.lastIndexOf('\n', i) + 1;
      const to = clean.indexOf('\n', i);
      const snippet = clean.slice(from, to < 0 ? undefined : to).trim().slice(0, 88);
      const hit: Hit = { file: file.slice(SRC.length), line, snippet };
      (isAlone(clean, i) ? alone : inPhrase).push(hit);
    }
  }
  return { alone, inPhrase };
}

describe('текстові гліфи в розмітці', () => {
  const { alone, inPhrase } = scan();

  it('гліф САМ як елемент — жодного', () => {
    const report = alone.map((h) => `  ${h.file}:${h.line}  ${h.snippet}`).join('\n');
    expect(alone.length, `знак, намальований текстом, замість Lucide:\n${report}`).toBe(0);
  });

  it('гліф У ФРАЗІ — рахується й лишається копірайтеру (COPY-DEBT блок 1)', () => {
    // Тест не падає: це копі, і переписується воно разом із капсом, одним
    // проходом. Число тут — щоб воно не зростало непомітно.
    // 13 на 11.09: «Готувати →», «Рецепт →», «Знову ⟳», «Увійти в Kitchen OS →».
    // Стеля, а не мета: вона тримає борг від непомітного зростання, поки
    // копірайтер до нього не дійшов. Після проходу — опустити до 0.
    expect(inPhrase.length).toBeLessThanOrEqual(13);
  });
});
