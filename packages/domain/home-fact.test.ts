import { describe, it, expect } from 'vitest';
import { cleanHomeFactText, serializeHomeFacts, homeFactsEmpty, homeFactTemplate } from './home-fact';

describe('Р146 · факт дому', () => {
  it('серіалізація: три рядки, порожні пропускаються, дні словами', () => {
    expect(serializeHomeFacts({ burning: [{ label: 'помідори', days: -1 }, { label: 'йогурт', days: 0 }, { label: 'курка', days: 2 }], seasons: [{ title: 'гарбузи', startedThisWeek: true }, { title: 'яблука', startedThisWeek: false }], dishes: [{ title: 'Борщ', daysAgo: 0 }, { title: 'Сирники', daysAgo: 1 }, { title: 'Плов', daysAgo: 5 }] }))
      .toBe('СПЛИВАЄ: помідори · прострочено 1 дн; йогурт · останній день; курка · лишилось 2 дн\nСЕЗОН: гарбузи (почалось цього тижня); яблука\nОСТАННІ СТРАВИ: Борщ · сьогодні; Сирники · вчора; Плов · 5 днів тому');
    expect(serializeHomeFacts({ burning: [], seasons: [], dishes: [{ title: 'Борщ', daysAgo: 3 }] })).toBe('ОСТАННІ СТРАВИ: Борщ · 3 дні тому');
    expect(homeFactsEmpty({ burning: [], seasons: [], dishes: [] })).toBe(true);
  });
  it('вихід: лапки й переноси знімаються; емодзі й порожнє — null; довше за 220 — зріз по реченню', () => {
    expect(cleanHomeFactText('«Помідори вчора перетнули межу.»\n')).toBe('Помідори вчора перетнули межу.');
    expect(cleanHomeFactText('')).toBeNull();
    expect(cleanHomeFactText('Кавуни в силі 🍉')).toBeNull();
    const s1 = 'Молоко вже вчора перетнуло межу, кефір живе останній день.';
    const s2 = ' Курка й риба теж мають один день, і хтось із них сьогодні стане обідом.';
    const s3 = ' Сливи й виноград щойно ввійшли в сезон, і вони явно мають намір витіснити з кухні все, що робилось раніше, включно з борщем.';
    const long = s1 + s2 + s3;
    expect(long.length).toBeGreaterThan(220);
    expect(cleanHomeFactText(long)).toBe(s1 + s2.trimEnd());
    expect(cleanHomeFactText('а'.repeat(230))).toBeNull();
  });
  it('шаблон: пріоритет і тексти Prototype', () => {
    expect(homeFactTemplate({ writtenOffToday: 'Помідори', fast: null, seasonStarted: null, library: null })).toContain('уперше за тиждень у коморі тихо');
    expect(homeFactTemplate({ writtenOffToday: null, fast: null, seasonStarted: null, library: { saved: 2, cooked: 3 } })).toBe('Ти зберіг 2 рецепти і приготував 3. Решта живе життям, про яке ми не говоримо.');
    expect(homeFactTemplate({ writtenOffToday: null, fast: null, seasonStarted: null, library: { saved: 0, cooked: 0 } })).toBeNull();
  });
});
