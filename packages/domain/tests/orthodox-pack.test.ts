// Православний пакет (рішення власника 20.09): ПЦУ, новоюліанський календар, єдиний
// стиль. 15 рядків tradition 'orthodox' (+ спільний Великдень у наборі), новий варіант
// правила easter.until (Петрів піст до 28.06), Спас 05–06.08, Миколай у православному
// наборі, вето нових постів резолвиться в категорії.
import { describe, it, expect } from 'vitest';
import { BUILTIN_OCCASIONS, isWindowRow } from '../occasion-data.js';
import { ruleActive, ruleWindow, easterDate } from '../occasion-rules.js';
import { occasionSet, periodVetoRows } from '../periods.js';

const at = (d: string) => new Date(`${d}T12:00:00`);
const iso = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const byId = (id: string) => BUILTIN_OCCASIONS.find((r) => r.id === id)!;

describe('склад пакета', () => {
  it('15 id з tradition orthodox; набір orthodox = 16 (з Великоднем); Миколай — православний, id той самий', () => {
    const ids = BUILTIN_OCCASIONS.filter((r) => r.tradition === 'orthodox').map((r) => r.id).sort();
    expect(ids).toEqual(['christmas', 'dormition', 'dormition-fast', 'epiphany', 'honey-spas', 'lent', 'maslyana', 'nativity-fast', 'palm-sunday', 'peter-fast', 'pokrova', 'spas', 'st-nicholas', 'trinity', 'xmas-eve']);
    expect(occasionSet(BUILTIN_OCCASIONS, 'orthodox')).toHaveLength(16);
    expect(occasionSet(BUILTIN_OCCASIONS, 'secular').map((r) => r.id)).not.toContain('st-nicholas');
    expect(byId('st-nicholas').tradition).toBe('orthodox');
  });
  it('кожен рядок — window із meaning, buy і seeds; пости — з restricts і veto; старого стилю нема', () => {
    for (const r of BUILTIN_OCCASIONS.filter((x) => x.tradition === 'orthodox')) {
      expect(isWindowRow(r), r.id).toBe(true);
      if (!isWindowRow(r)) continue;
      expect(r.meaning.length, r.id).toBeGreaterThan(20);
      expect(r.buy?.length, r.id).toBeGreaterThan(0);
      expect(r.seeds?.length ?? (r.id === 'maslyana' || r.id === 'lent' ? 1 : 0), r.id).toBeGreaterThan(0);
      expect(r.meaning, r.id).not.toMatch(/14\.10|19\.01|07\.01|28\.08|19\.08|старим стилем/);
    }
    for (const id of ['lent', 'peter-fast', 'dormition-fast', 'nativity-fast']) {
      const r = byId(id);
      expect(isWindowRow(r) && r.restricts, id).toBeTruthy();
      expect(isWindowRow(r) && r.veto?.length, id).toBeTruthy();
    }
  });
});

describe('дати', () => {
  it('Спас — 05–06.08 (новий стиль), Покрова 01.10, Різдво 25–26.12, Водохреща 06.01, Успенський піст 01–14.08', () => {
    const w = (id: string, y = 2026) => { const r = byId(id); const x = ruleWindow(r.rule, y, ['orthodox'])!; return [iso(x.start), iso(x.end)]; };
    expect(w('spas')).toEqual(['2026-08-05', '2026-08-06']);
    expect(w('pokrova')).toEqual(['2026-10-01', '2026-10-01']);
    expect(w('christmas')).toEqual(['2026-12-25', '2026-12-26']);
    expect(w('epiphany')).toEqual(['2026-01-06', '2026-01-06']);
    expect(w('dormition-fast')).toEqual(['2026-08-01', '2026-08-14']);
    expect(w('nativity-fast')).toEqual(['2026-11-15', '2026-12-24']);
  });
  it('рухомі: Вербна −7, Трійця +49..+50; Петрів піст від +57 до 28.06 включно (easter.until)', () => {
    const e = easterDate(2026, 'orthodox');            // 12.04.2026
    expect(iso(e.getTime())).toBe('2026-04-12');
    expect(ruleActive(byId('palm-sunday').rule, at('2026-04-05'), ['orthodox'])).toBe(true);
    expect(ruleActive(byId('palm-sunday').rule, at('2026-04-06'), ['orthodox'])).toBe(false);
    expect(ruleActive(byId('trinity').rule, at('2026-05-31'), ['orthodox'])).toBe(true);
    expect(ruleActive(byId('trinity').rule, at('2026-06-01'), ['orthodox'])).toBe(true);
    const pf = byId('peter-fast').rule;
    expect(ruleWindow(pf, 2026, ['orthodox'])).toEqual({ start: at('2026-06-08').setHours(0, 0, 0, 0), end: at('2026-06-28').setHours(0, 0, 0, 0) });
    expect(ruleActive(pf, at('2026-06-07'), ['orthodox'])).toBe(false);
    expect(ruleActive(pf, at('2026-06-08'), ['orthodox'])).toBe(true);
    expect(ruleActive(pf, at('2026-06-28'), ['orthodox'])).toBe(true);
    expect(ruleActive(pf, at('2026-06-29'), ['orthodox'])).toBe(false);
    // 2027: Великдень 02.05 → +57 = 28.06 — піст в один день.
    const w27 = ruleWindow(pf, 2027, ['orthodox'])!;
    expect([iso(w27.start), iso(w27.end)]).toEqual(['2027-06-28', '2027-06-28']);
    // Без традиції правило easter не рахується.
    expect(ruleActive(pf, at('2026-06-10'), [])).toBe(false);
  });
});

describe('вето нових постів', () => {
  it('periodVetoRows: Петрів і Різдвяний — мʼясо/молочне/яйця (без риби); Успенський — тваринне', () => {
    const rows = occasionSet(BUILTIN_OCCASIONS, 'orthodox');
    const refs = (d: string) => periodVetoRows(rows, [], at(d)).map((r) => `${r.label}:${r.ref}`).sort();
    expect(refs('2026-06-10')).toEqual(['Петрів піст:молочне', 'Петрів піст:мʼясо', 'Петрів піст:яйця'].sort());
    expect(refs('2026-11-20')).toEqual(['Різдвяний піст:молочне', 'Різдвяний піст:мʼясо', 'Різдвяний піст:яйця'].sort());
    expect(refs('2026-08-10')).toEqual(['Успенський піст:тваринне']);
    expect(refs('2026-07-10')).toEqual([]);
  });
});
