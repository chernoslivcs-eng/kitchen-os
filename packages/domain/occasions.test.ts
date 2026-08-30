import { describe, it, expect } from 'vitest';
import {
  easterDate, traditionsFrom, activeOccasions, upcomingEvents,
  whenLabel, serializeOccasions,
} from './occasions.js';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

describe('пасхалія', () => {
  // Звірено з астрономічними таблицями. Якщо ці дати попливуть — попливе весь
  // рухомий блок: Масниця і піст рахуються від Великодня.
  it('католицький Великдень', () => {
    expect(iso(easterDate(2024, 'catholic'))).toBe('2024-03-31');
    expect(iso(easterDate(2025, 'catholic'))).toBe('2025-04-20');
    expect(iso(easterDate(2026, 'catholic'))).toBe('2026-04-05');
    expect(iso(easterDate(2027, 'catholic'))).toBe('2027-03-28');
  });

  it('православний Великдень', () => {
    expect(iso(easterDate(2024, 'orthodox'))).toBe('2024-05-05');
    expect(iso(easterDate(2025, 'orthodox'))).toBe('2025-04-20');
    expect(iso(easterDate(2026, 'orthodox'))).toBe('2026-04-12');
    expect(iso(easterDate(2027, 'orthodox'))).toBe('2027-05-02');
  });

  it('2025 — рік, коли обидва Великодні збігаються', () => {
    expect(iso(easterDate(2025, 'orthodox'))).toBe(iso(easterDate(2025, 'catholic')));
  });
});

describe('розпізнавання традиції', () => {
  it('порожні побажання — жодної традиції', () => {
    expect(traditionsFrom([])).toEqual([]);
    expect(traditionsFrom(['люблю гостре', 'багато зелені'])).toEqual([]);
  });

  it('«постуємо» → православна', () => {
    expect(traditionsFrom(['постуємо у Великий піст'])).toContain('orthodox');
  });

  it('халяль → ісламська', () => {
    expect(traditionsFrom(['дотримуємось халяль'])).toEqual(['islamic']);
  });

  it('кошер → юдейська', () => {
    expect(traditionsFrom(['кошерна кухня'])).toEqual(['jewish']);
  });

  it('латиниця теж працює — люди пишуть halal', () => {
    expect(traditionsFrom(['halal only'])).toEqual(['islamic']);
  });

  it('змішана сімʼя — дві традиції одночасно', () => {
    const t = traditionsFrom(['святкуємо католицьке Різдво', 'і православний Великдень']);
    expect(t).toContain('catholic');
    expect(t).toContain('orthodox');
  });
});

describe('що триває зараз', () => {
  it('серпень — овочевий пік і кавуни, без свят', () => {
    const act = activeOccasions(d(2026, 8, 20), []);
    expect(act.map((o) => o.id).sort()).toEqual(['melon', 'veg-peak']);
  });

  // Головна перевірка гейта: Спас не показуємо людині, яка не згадувала
  // православʼя. Прототип показував усім — ми цю ваду не переносимо.
  it('Спас лише для тих, у кого розпізнано традицію', () => {
    expect(activeOccasions(d(2026, 8, 19), []).map((o) => o.id)).not.toContain('spas');
    expect(activeOccasions(d(2026, 8, 19), ['orthodox']).map((o) => o.id)).toContain('spas');
  });

  it('Святвечір — вікно через кінець грудня', () => {
    expect(activeOccasions(d(2026, 12, 22), ['orthodox']).map((o) => o.id)).toContain('xmas-eve');
    expect(activeOccasions(d(2026, 12, 26), ['orthodox']).map((o) => o.id)).not.toContain('xmas-eve');
  });

  // 2026 розводить традиції на тиждень: католицький піст 16.02–04.04,
  // православний 23.02–11.04. 8 квітня — вже після католицького Великодня,
  // але ще піст у православних. Якби гілки традицій десь злиплись, тут би впало.
  it('Великий піст 2026 розходиться між традиціями', () => {
    expect(activeOccasions(d(2026, 4, 8), ['orthodox']).map((o) => o.id)).toContain('lent');
    expect(activeOccasions(d(2026, 4, 8), ['catholic']).map((o) => o.id)).not.toContain('lent');
    // А в середині лютого — навпаки: у католиків уже піст, у православних ще Масниця.
    expect(activeOccasions(d(2026, 2, 18), ['catholic']).map((o) => o.id)).toContain('lent');
    expect(activeOccasions(d(2026, 2, 18), ['orthodox']).map((o) => o.id)).toContain('maslyana');
  });

  it('сам Великдень', () => {
    expect(activeOccasions(d(2026, 4, 12), ['orthodox']).map((o) => o.id)).toContain('easter');
  });

  it('Масниця — тиждень перед постом', () => {
    expect(activeOccasions(d(2026, 2, 18), ['orthodox']).map((o) => o.id)).toContain('maslyana');
  });

  it('лютий без традиції — порожньо', () => {
    expect(activeOccasions(d(2026, 2, 26), [])).toEqual([]);
  });
});

describe('що попереду', () => {
  it('події відсортовані й у межах горизонту', () => {
    const ev = upcomingEvents(d(2026, 8, 25), ['orthodox'], 21);
    expect(ev.length).toBeGreaterThan(0);
    const limit = d(2026, 8, 25).getTime() + 21 * 86400000;
    for (const e of ev) {
      expect(e.at).toBeGreaterThan(d(2026, 8, 25).getTime());
      expect(e.at).toBeLessThanOrEqual(limit);
    }
    expect([...ev].sort((a, b) => a.at - b.at)).toEqual(ev);
  });

  it('кінець сезону кавунів потрапляє в горизонт', () => {
    const ev = upcomingEvents(d(2026, 9, 1), [], 21);
    expect(ev.some((e) => e.title.includes('кавуни') && e.title.includes('останні дні'))).toBe(true);
  });

  it('місячні свята позначені як орієнтовні', () => {
    const ev = upcomingEvents(d(2027, 1, 20), ['islamic'], 60);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.approx)).toBe(true);
  });

  it('без традиції християнських свят немає', () => {
    const ev = upcomingEvents(d(2026, 4, 1), [], 30);
    expect(ev.some((e) => e.title.includes('Великдень'))).toBe(false);
  });

  it('горизонт поважається: 3 дні — майже нічого', () => {
    expect(upcomingEvents(d(2026, 6, 10), ['orthodox'], 3)).toEqual([]);
  });
});

describe('whenLabel', () => {
  const now = d(2026, 8, 25).getTime();
  it('перекладає відстань у людське', () => {
    expect(whenLabel(now, now)).toBe('сьогодні');
    expect(whenLabel(now + 86400000, now)).toBe('завтра');
    expect(whenLabel(now + 3 * 86400000, now)).toBe('за 3 дні');
    expect(whenLabel(now + 10 * 86400000, now)).toBe('за тиждень');
    expect(whenLabel(now + 21 * 86400000, now)).toBe('3 тижні');
  });
  it('далеке — конкретна дата', () => {
    expect(whenLabel(now + 90 * 86400000, now)).toMatch(/\d/);
  });
});

describe('блок для промпта', () => {
  it('містить активне й майбутнє', () => {
    const s = serializeOccasions(d(2026, 8, 25), ['постуємо']);
    expect(s).toContain('[СЕЗОН І СВЯТА]');
    expect(s).toContain('ЗАРАЗ:');
    expect(s).toContain('пік овочевого сезону');
    expect(s).toContain('Варто докупити:');
  });

  // Без цього застереження модель починає кожну репліку з календаря.
  it('каже, що це привід, а не обовʼязок', () => {
    const s = serializeOccasions(d(2026, 8, 25), []);
    expect(s).toContain('привід, а не обовʼязок');
    expect(s).toContain('вигадувати їх не можна');
  });

  it('мертвий сезон без традиції — порожній рядок, не витрачаємо токени', () => {
    expect(serializeOccasions(d(2026, 6, 10), [])).toBe('');
  });

  it('традиція змінює вміст блоку', () => {
    const plain = serializeOccasions(d(2026, 4, 12), []);
    const orth = serializeOccasions(d(2026, 4, 12), ['постуємо']);
    expect(plain).not.toContain('Великдень');
    expect(orth).toContain('Великдень');
  });
});
