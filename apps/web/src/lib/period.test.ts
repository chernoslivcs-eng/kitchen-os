import { describe, it, expect } from 'vitest';
import { leftLabel, nowWhen, nowEmptyText, dedupeTitle, seriesRange, shortDate, toneOfNow, ownKindOf } from './period';

// П2: межі «ще N днів», дубль заголовка в правилі, тон за джерелом.
describe('leftLabel', () => {
  const today = '2026-09-06';
  it('триває — «ще N днів»; останній день; до завтра', () => {
    expect(leftLabel('2026-09-01', '2026-09-30', today)).toBe('ще 24 дні');
    expect(leftLabel('2026-09-01', '2026-09-06', today)).toBe('останній день');
    expect(leftLabel('2026-09-01', '2026-09-07', today)).toBe('до завтра');
  });
  it('минуле — не показувати', () => {
    expect(leftLabel('2026-08-01', '2026-09-05', today)).toBeNull();
  });
  it('попереду — «за N днів» / «завтра»', () => {
    expect(leftLabel('2026-09-12', '2026-09-12', today)).toBe('за 6 днів');
    expect(leftLabel('2026-09-07', '2026-09-08', today)).toBe('завтра');
  });
});

// Етап 4 (PLAN §5, Components · «Дім зараз»): час — кінцем, і в одиницях,
// які людина справді рахує. Канон бандла: «ще 5 тиж», «≈ ще 3 тиж»,
// «≈ ще 5 дн», «до нд». Далеке — тижнями, не «ще 28 днів»; близьке своє —
// днем тижня, бо своя подія читається як зустріч; орієнтовне — з «≈».
describe('nowWhen — слово часу для «Дім зараз»', () => {
  const today = '2026-09-06'; // неділя
  const season = (from: string, to: string, approx = false) => ({ from, to, source: 'catalog' as const, approx });
  const own = (from: string, to: string, approx = false) => ({ from, to, source: 'chat' as const, approx });

  it('далеке — тижнями, округлено', () => {
    expect(nowWhen(season('2026-08-15', '2026-10-11'), today)).toBe('ще 5 тиж');
    expect(nowWhen(season('2026-08-15', '2026-09-27'), today)).toBe('ще 3 тиж');
  });

  it('орієнтовне — «≈» перед словом, і в тижнях, і в днях', () => {
    expect(nowWhen(season('2026-08-15', '2026-09-27', true), today)).toBe('≈ ще 3 тиж');
    expect(nowWhen(season('2026-09-01', '2026-09-11', true), today)).toBe('≈ ще 5 дн');
  });

  it('близьке — днями, «дн» як у бандлі', () => {
    expect(nowWhen(season('2026-09-01', '2026-09-11'), today)).toBe('ще 5 дн');
    expect(nowWhen(season('2026-09-01', '2026-09-19'), today)).toBe('ще 13 дн');
  });

  it('своя подія в межах тижня — днем тижня: «до нд», «до ср»', () => {
    // 2026-09-06 — неділя; 2026-09-09 — середа; 2026-09-13 — наступна неділя.
    expect(nowWhen(own('2026-09-01', '2026-09-09'), today)).toBe('до ср');
    expect(nowWhen(own('2026-09-01', '2026-09-13'), today)).toBe('до нд');
    // сезон із каталогу — не зустріч, лишається днями
    expect(nowWhen(season('2026-09-01', '2026-09-09'), today)).toBe('ще 3 дн');
  });

  it('сьогодні й завтра — словами; минуле — null; попереду — «за N дн»', () => {
    expect(nowWhen(season('2026-09-01', '2026-09-06'), today)).toBe('останній день');
    expect(nowWhen(season('2026-09-01', '2026-09-07'), today)).toBe('до завтра');
    expect(nowWhen(season('2026-08-01', '2026-09-05'), today)).toBeNull();
    expect(nowWhen(season('2026-09-20', '2026-09-30'), today)).toBe('за 14 дн');
  });
});

describe('dedupeTitle', () => {
  it('правило починається з заголовка — лише правило', () => {
    expect(dedupeTitle('білкова', 'білкова — більше білка, менше вуглеводів')).toEqual({ title: null, rule: 'білкова — більше білка, менше вуглеводів' });
    expect(dedupeTitle('Білкова', 'білкова')).toEqual({ title: null, rule: 'білкова' });
  });
  it('правила нема — лише заголовок; різні — обидва', () => {
    expect(dedupeTitle('гості', null)).toEqual({ title: 'гості', rule: null });
    expect(dedupeTitle('гості', 'на шістьох')).toEqual({ title: 'гості', rule: 'на шістьох' });
  });
});

describe('дрібниці', () => {
  it('shortDate без крапки; діапазон серії по місяцях', () => {
    expect(shortDate('2026-04-01')).toBe('1 квіт');
    expect(seriesRange([{ from: '2026-09-11', to: '2026-09-13' }, { from: '2027-04-21', to: '2027-04-29' }])).toBe('вересень 2026 – квітень 2027');
    expect(seriesRange([{ from: '2026-12-01', to: '2026-12-23' }, { from: '2026-12-24', to: '2026-12-26' }])).toBe('грудень 2026');
  });
  it('тон: суворе — слива; свято — слива; сезон — бурштин; своє — шавлія', () => {
    expect(toneOfNow({ kind: 'diet', strict: true, source: 'chat' })).toBe('restrict');
    expect(toneOfNow({ kind: 'tradition', strict: false, source: 'catalog' })).toBe('tradition');
    expect(toneOfNow({ kind: 'season', strict: false, source: 'catalog' })).toBe('season');
    expect(toneOfNow({ kind: 'diet', strict: false, source: 'chat' })).toBe('own');
  });
  it('рід свого: дієта; custom без порцій — своє свято; з порціями — подія дому', () => {
    expect(ownKindOf('diet')).toBe('diet');
    expect(ownKindOf('custom', null)).toBe('holiday');
    expect(ownKindOf('custom', 6)).toBe('custom');
  });
});

// Три порожнечі «Дім зараз» — три різні слова. Живими у вересні їх не дістати
// (сезони з каталогу є завжди), тому — гілками, і на те, що вони не збігаються.
describe('nowEmptyText — три порожнечі, різні слова', () => {
  it('комора порожня — кличе розповісти', () => {
    expect(nowEmptyText({ count: 0, soon: 0 })).toContain('Комора порожня');
  });
  it('комора є, нічого не горить — називає число і спокій', () => {
    expect(nowEmptyText({ count: 113, soon: 0 })).toBe('Нічого не горить. 113 позицій у порядку.');
    expect(nowEmptyText({ count: 1, soon: 0 })).toBe('Нічого не горить. 1 позиція у порядку.');
  });
  it('подій немає, а комора горить або невідома — про календар, не про комору', () => {
    expect(nowEmptyText({ count: 40, soon: 3 })).toContain('нічого не триває');
    expect(nowEmptyText(null)).toContain('нічого не триває');
  });
  it('три слова — три різні', () => {
    const w = new Set([nowEmptyText({ count: 0, soon: 0 }), nowEmptyText({ count: 5, soon: 0 }), nowEmptyText({ count: 5, soon: 2 })]);
    expect(w.size).toBe(3);
  });
});
