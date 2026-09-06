import { describe, it, expect } from 'vitest';
import { subscribedRows, activeOccasions, nowItems, serializeNow, occasionSet, BUILTIN_OCCASIONS } from '@kitchen/domain';

// Раунд 5, крок П1, фікстура period-unsubscribe: детерміновано, без моделі.
// Відписка від кавунів прибирає їх звідусіль, підписка на католицькі дає Адвент.
describe('period-unsubscribe', () => {
  const aug = new Date(2026, 7, 20, 12);
  it('відписка від melon: activeOccasions, «Зараз» і [ЗАРАЗ] без кавунів', () => {
    const rows = subscribedRows(BUILTIN_OCCASIONS, [{ occasion_id: 'melon', enabled: false }]);
    expect(activeOccasions(aug, [], rows).map((o) => o.id)).not.toContain('melon');
    expect(nowItems(rows, [], aug).map((i) => i.occasion_id)).not.toContain('melon');
    expect(serializeNow(rows, [], aug)).not.toContain('кавуни');
    // Контроль: за дефолтом кавуни є.
    expect(serializeNow(subscribedRows(BUILTIN_OCCASIONS, []), [], aug)).toContain('кавуни');
  });
  it('підписка catholic → Адвент є в грудні', () => {
    const rows = subscribedRows(BUILTIN_OCCASIONS, occasionSet(BUILTIN_OCCASIONS, 'catholic').map((r) => ({ occasion_id: r.id, enabled: true })));
    const dec = new Date(2026, 11, 10, 12);
    expect(nowItems(rows, [], dec).map((i) => i.title)).toContain('Адвент');
    expect(serializeNow(rows, [], dec)).toContain('Адвент · до 23 груд.');
  });
});
