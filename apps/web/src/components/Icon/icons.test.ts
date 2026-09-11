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
