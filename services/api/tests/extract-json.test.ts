import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/model.js';

// FIX-05: модель іноді видає ДВА верхньорівневі JSON-обʼєкти в одній відповіді.
// Раніше брали перший — другий тікав у reply сирим {…}. Тепер вибираємо той,
// що має валідний type; сирого JSON у residualText не лишається.

describe('extractJson', () => {
  it('чистий JSON', () => {
    const r = extractJson('{"type":"proposal","items":[]}');
    expect((r.parsed as { type: string }).type).toBe('proposal');
    expect(r.residualText).toBe('');
  });

  it('JSON + короткий коментар після', () => {
    const r = extractJson('{"type":"intake_diff","ops":[]} — розкласти?');
    expect((r.parsed as { type: string }).type).toBe('intake_diff');
    expect(r.residualText).toContain('розкласти');
    expect(r.residualText).not.toContain('{');
  });

  it('два JSON: обираємо той із валідним type, сирий не лишається', () => {
    const raw = 'Ось: {"type":"intake_diff","ops":[]} і ще {"type":"proposal","items":[{"title":"X"}]} Обирай.';
    const r = extractJson(raw);
    expect((r.parsed as { type: string }).type).toBe('intake_diff');
    expect(r.residualText).not.toContain('{');
    expect(r.residualText).toContain('Обирай');
  });

  it('обгортка {reply, card} має пріоритет над голими', () => {
    const raw = '{"reply":"Записав","card":{"type":"intake_diff","ops":[]}} {"type":"proposal","items":[]}';
    const r = extractJson(raw);
    const p = r.parsed as { reply?: string; card?: { type: string } };
    expect(p.reply).toBe('Записав');
    expect(p.card?.type).toBe('intake_diff');
  });

  it('JSON зі вкладеною фігурною дужкою + escaped quotes', () => {
    const raw = 'Тест: {"type":"intake_diff","ops":[{"label":"дужка }","evidence":"user_statement"}]}';
    const r = extractJson(raw);
    expect((r.parsed as { type: string }).type).toBe('intake_diff');
  });

  it('без JSON — parsed=null, весь текст у residualText', () => {
    const r = extractJson('привіт, як справи?');
    expect(r.parsed).toBeNull();
    expect(r.residualText).toBe('привіт, як справи?');
  });
});
