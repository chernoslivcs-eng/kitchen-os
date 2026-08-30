import { describe, it, expect } from 'vitest';
import { serializeRecentRecipes, buildKitchenContext } from '../context.js';
import type { RecipeRow } from '../types.js';

// Модель не бачила власних рецептів: «а що ти там пропонував з борщем?» —
// і вона вигадувала борщ заново, з іншим мʼясом. Тепер останні згенеровані
// йдуть блоком у контекст, з інструкцією триматися названого складу.

const row = (over: Partial<RecipeRow> = {}): RecipeRow => ({
  id: 'r1', owner_id: 'u1', origin: 'generated', title: 'Бабусин борщ',
  descr: null, character: null, risk: null, base_servings: 2, time_total: 90,
  nutrition: null,
  payload: {
    t: 'Бабусин борщ', sv: 2, tm: 90, ch: '', d: '', rk: '',
    ing: [
      { n: 'яловичина на кістці', v: 400, u: 'g' },
      { n: 'буряк середній', v: 2, u: 'pcs' },
      { p: 'p9', v: 40, u: 'ml' },              // партія з комори без назви
    ],
    st: [],
  },
  created_at: new Date().toISOString(),
  saved_at: null,
  ...over,
});

describe('[ЗГЕНЕРОВАНІ РЕЦЕПТИ] в контексті', () => {
  it('порожньо — жодного токена', () => {
    expect(serializeRecentRecipes([])).toBe('');
  });

  it('назва і склад видно; безіменні партії не смітять', () => {
    const s = serializeRecentRecipes([row()]);
    expect(s).toContain('[ЗГЕНЕРОВАНІ РЕЦЕПТИ]');
    expect(s).toContain('Бабусин борщ');
    expect(s).toContain('яловичина на кістці');
    expect(s).not.toContain('p9');
  });

  it('інструкція: триматися складу, не вигадувати новий', () => {
    const s = serializeRecentRecipes([row()]);
    expect(s).toContain('тримайся ЦЬОГО складу');
  });

  it('buildKitchenContext прокидає блок', () => {
    const s = buildKitchenContext({
      pantry: [], recentRecipes: [row()], now: new Date('2026-06-10'),
    });
    expect(s).toContain('[ЗГЕНЕРОВАНІ РЕЦЕПТИ]');
    expect(s).toContain('Бабусин борщ');
  });
});
