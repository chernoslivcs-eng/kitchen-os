// Пул-2 №5: сирий JSON-уламок моделі ніколи не показується людині як
// репліка. Якщо картка не розпарсилась, а «текст» виглядає як нутрощі —
// чесний фолбек «кинь файлом або частинами».

import { describe, it, expect } from 'vitest';
import { looksLikeModelDebris, INTAKE_TOO_BIG_REPLY } from '../src/reply-guard.js';

describe('looksLikeModelDebris', () => {
  it('ловить обірвані/сирі JSON-відповіді', () => {
    const debris = [
      '{ "reply": "Записую все — це займе хвилину", "card": { "type": "intake_diff", "ops": [ , , ,',
      '```json\n{"kind":"receipt","ops":[{"op":"add"',
      '[{"op": "add", "label": "Spaghetti Barilla", "value": 1',
      '{"type":"intake_diff","ops":[]}',
    ];
    for (const d of debris) expect(looksLikeModelDebris(d), d.slice(0, 40)).toBe(true);
  });

  it('не чіпає нормальні репліки, навіть із фігурними дужками в тексті', () => {
    const fine = [
      'Записав: молоко. Розкласти по коморі?',
      'У коморі є яловичина портерхаус — це теж стейк.',
      'Крок {0} — це плейсхолдер, не хвилюйся.',
      '',
    ];
    for (const f of fine) expect(looksLikeModelDebris(f), f.slice(0, 40)).toBe(false);
  });

  it('фолбек-репліка існує і людська', () => {
    expect(INTAKE_TOO_BIG_REPLY).toMatch(/файлом|частинами/);
    expect(INTAKE_TOO_BIG_REPLY).not.toMatch(/[{}"]/);
  });
});
