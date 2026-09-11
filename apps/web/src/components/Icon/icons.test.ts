import { describe, it, expect } from 'vitest';
import { ICONS, RESERVED, SHARED_ON_PURPOSE, PENDING_DESIGN_CHAT, type IconName } from './icons';

const entries = Object.entries(ICONS) as [IconName, (typeof ICONS)[IconName]][];

describe('словник знаків v3', () => {
  it('чотири сімʼї плюс живі стани, і жодна не порожня', () => {
    const byFamily = new Map<string, number>();
    for (const [, s] of entries) byFamily.set(s.family, (byFamily.get(s.family) ?? 0) + 1);
    expect([...byFamily.keys()].sort()).toEqual(['cooking', 'live', 'products', 'system', 'zones']);
    // Зони — рівно шість, як зон у коді (catalog/seed.ts:34).
    expect(byFamily.get('zones')).toBe(6);
  });

  it('шість зон — ті самі шість, що в домені', () => {
    const zones = entries.filter(([, s]) => s.family === 'zones').map(([, s]) => s.label);
    expect(zones.sort()).toEqual(['Морозилка', 'Напої', 'Свіже', 'Суха шафа', 'Холодильник', 'Спеції'].sort());
  });

  it('один знак не несе двох РІЗНИХ значень', () => {
    const byGlyph = new Map<unknown, Set<string>>();
    for (const [, s] of entries) {
      if (!byGlyph.has(s.glyph)) byGlyph.set(s.glyph, new Set());
      byGlyph.get(s.glyph)!.add(s.label);
    }
    const pendingLabels = new Set(PENDING_DESIGN_CHAT.flatMap((p) => p.meanings));
    const clashes = [...byGlyph.values()]
      .filter((labels) => labels.size > 1)
      .map((labels) => [...labels])
      .filter((labels) => !labels.every((l) => SHARED_ON_PURPOSE.includes(l)))
      // Успадковане з бандла й винесене дизайн-чату — названо, не приховано.
      .filter((labels) => !labels.every((l) => pendingLabels.has(l)));
    expect(clashes, 'знак із двома значеннями').toEqual([]);
  });

  it('Р21: flame — тільки «Горить»; chef-hat — тільки тип рецепта; cooking-pot — «Готуємо»', () => {
    for (const { glyph, only } of RESERVED) {
      const used = entries.filter(([, s]) => s.glyph === glyph).map(([, s]) => s.label);
      expect(used, `знак закріплено за «${only}»`).toEqual([only]);
    }
  });

  it('колізії з бандла, що чекають дизайн-чату, справді існують — інакше список застарів', () => {
    // Коли дизайн-чат відповість і знаки розійдуться, ця перевірка впаде —
    // і це сигнал прибрати запис із PENDING_DESIGN_CHAT, а не залишити його.
    for (const p of PENDING_DESIGN_CHAT) {
      const used = entries.filter(([, s]) => s.glyph === p.glyph).map(([, s]) => s.label).sort();
      expect(used, p.question).toEqual([...p.meanings].sort());
    }
  });

  it('кожен ключ має непорожній підпис', () => {
    for (const [key, s] of entries) expect(s.label.length, key).toBeGreaterThan(0);
  });
});

// ── Етап 1.5b · моушн знаків (Icons.dc.html) ────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOTION, CUSTOM_PATHS, LIVE_ICON } from './motion';

const CSS = readFileSync(fileURLToPath(new URL('./Icon.module.css', import.meta.url)), 'utf8');
const TOKENS = readFileSync(fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)), 'utf8');

describe('1.5b · рух частин знака', () => {
  const BUNDLE_SYSTEM: Record<string, string> = {
    'sys.chat': 'bubble', 'sys.pantry': 'door', 'sys.recipes': 'book', 'sys.list': 'checks', 'sys.calendar': 'flip',
    'sys.home': 'home', 'sys.cart': 'roll', 'sys.receipt': 'unroll', 'sys.add': 'turn', 'sys.voice': 'listen',
    'sys.send': 'lift', 'sys.attach': 'draw', 'sys.search': 'orbit', 'sys.filter': 'sliders', 'sys.sort': 'swap',
    'sys.done': 'draw', 'sys.close': 'close', 'sys.undo': 'back', 'sys.next': 'draw', 'sys.out': 'lift',
    'sys.collapse': 'fold', 'sys.theme': 'dial', 'sys.sound': 'waves', 'sys.profile': 'nod',
  };

  it('кожен system-знак має запис у motion.ts; 24 з масиву бандла — свій ключ, решта — статичні', () => {
    const system = (Object.keys(ICONS) as IconName[]).filter((k) => ICONS[k].family === 'system');
    for (const k of system) expect(k in MOTION, `${k} без запису в motion.ts`).toBe(true);
    for (const [k, m] of Object.entries(BUNDLE_SYSTEM)) expect(MOTION[k as keyof typeof MOTION], k).toBe(m);
    const extra = system.filter((k) => !(k in BUNDLE_SYSTEM));
    for (const k of extra) expect(MOTION[k as keyof typeof MOTION], `${k} — рух вигаданий, у бандлі його нема`).toBeNull();
  });

  it('кожен ключ руху має правило наведення в Icon.module.css і свої @keyframes', () => {
    const keys = new Set(Object.values(MOTION).filter((v): v is NonNullable<typeof v> => !!v));
    for (const key of keys) {
      const rule = new RegExp(`\\[data-motion="${key}"\\][^{]*\\{([^}]*)\\}`, 'g');
      const bodies = [...CSS.matchAll(rule)].map((m) => m[1]!);
      expect(bodies.length, `нема правила для ${key}`).toBeGreaterThan(0);
      const names = bodies.flatMap((b) => [...b.matchAll(/animation:\s*([a-zA-Z]+)/g)].map((m) => m[1]!));
      if (key === 'turn') { expect(bodies.some((b) => /rotate\(90deg\)/.test(b)), 'turn — поворот на 90°').toBe(true); continue; }
      expect(names.length, `${key} без animation`).toBeGreaterThan(0);
      for (const n of names) expect(CSS.includes(`@keyframes ${n} `), `@keyframes ${n} для ${key}`).toBe(true);
    }
  });

  it('жоден products-знак не рухається; book і fridge — власні шляхи', () => {
    for (const [k, spec] of Object.entries(ICONS)) {
      if (spec.family === 'products') expect(k in MOTION, `${k} — продукти статичні`).toBe(false);
    }
    expect(CUSTOM_PATHS['sys.recipes']?.length).toBe(4);
    expect(CUSTOM_PATHS['sys.pantry']?.length).toBe(4);
  });

  it('тривалості — лише токенами: ховер 600–900 мс, живі стани — цикл 1.2–1.6 с', () => {
    const tok = (name: string) => Number(TOKENS.match(new RegExp(`--${name}:\\s*(\\d+)ms`))?.[1]);
    for (const n of ['dur-icon-short', 'dur-icon', 'dur-icon-long']) {
      expect(tok(n), n).toBeGreaterThanOrEqual(600); expect(tok(n), n).toBeLessThanOrEqual(900);
    }
    for (const n of ['dur-live-flame', 'dur-live-timer', 'dur-live-mic', 'dur-live-think']) {
      expect(tok(n), n).toBeGreaterThanOrEqual(1200); expect(tok(n), n).toBeLessThanOrEqual(1600);
    }
    // Жодного числа тривалості в самих правилах знака — лише var(--dur-…).
    const body = CSS.replace(/@media\s*\(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g, '');
    for (const m of body.matchAll(/animation:\s*([^;]+);/g)) {
      expect(m[1]!.includes('var(--dur'), `animation без токена: ${m[1]}`).toBe(true);
    }
    for (const live of Object.keys(LIVE_ICON)) expect(CSS.includes(`[data-live="${live}"]`), live).toBe(true);
  });

  it('reduced-motion вимикає всі рухи знака й занулює токени', () => {
    const reduce = CSS.match(/@media\s*\(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(reduce).toMatch(/\.icon > svg, \.icon > svg \* \{[^}]*animation: none !important[^}]*transition: none !important/);
    const zero = TOKENS.match(/@media\s*\(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    for (const n of ['dur-icon-short', 'dur-icon', 'dur-icon-long', 'dur-live-flame', 'dur-live-timer', 'dur-live-mic', 'dur-live-think']) {
      expect(zero.includes(`--${n}: 0ms`), n).toBe(true);
    }
  });
});
