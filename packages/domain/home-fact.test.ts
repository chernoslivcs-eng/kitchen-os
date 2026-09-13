import { describe, it, expect } from 'vitest';
import { cleanHomeFactText, homeFactTemplate } from './home-fact';

describe('Р146 · факт дому', () => {
  it('вихід: лапки й переноси знімаються; емодзі й порожнє — null; довше за 300 — зріз по реченню', () => {
    expect(cleanHomeFactText('«Помідори вчора перетнули межу.»\n')).toBe('Помідори вчора перетнули межу.');
    expect(cleanHomeFactText('')).toBeNull();
    expect(cleanHomeFactText('Кавуни в силі 🍉')).toBeNull();
    const s1 = 'Молоко вже вчора перетнуло межу, кефір живе останній день, а сметана тримається ще два.';
    const s2 = ' Курка й риба теж мають один день, і хтось із них сьогодні неодмінно стане обідом, бо інакше вони самі вирішать, ким бути.';
    const s3 = ' Сливи й виноград щойно ввійшли в сезон, і вони явно мають намір витіснити з кухні все, що робилось раніше, включно з борщем.';
    const long = s1 + s2 + s3;
    expect(long.length).toBeGreaterThan(300);
    expect(cleanHomeFactText(long)).toBe(s1 + s2.trimEnd());
    expect(cleanHomeFactText('а'.repeat(310))).toBeNull();
    expect(cleanHomeFactText('Помідори вже прострочені на день,'), 'обривок без кінцевого знака').toBeNull();
    expect(cleanHomeFactText('Молоко, кефір.'), 'коротше за 30').toBeNull();
  });
  it('шаблон: пріоритет і тексти Prototype', () => {
    expect(homeFactTemplate({ writtenOffToday: 'Помідори', fast: null, seasonStarted: null, library: null })).toContain('уперше за тиждень у коморі тихо');
    expect(homeFactTemplate({ writtenOffToday: null, fast: null, seasonStarted: null, library: { saved: 2, cooked: 3 } })).toBe('Ти зберіг 2 рецепти і приготував 3. Решта живе життям, про яке ми не говоримо.');
    expect(homeFactTemplate({ writtenOffToday: null, fast: null, seasonStarted: null, library: { saved: 0, cooked: 0 } })).toBeNull();
  });
});
