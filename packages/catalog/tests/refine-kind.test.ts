// Етап 3 (CATALOG-KEY-AUDIT-0922.md, п.2–3): резолвер бачив рід і не бачив
// уточнення, яке СТОЇТЬ у назві — «темний», «сухе», «швидкого приготування»,
// «з сиром», «безалкогольне». Усі п'ять підтверджених чужих ключів аудиту —
// саме цього типу. Правило: уточнення або веде на іншу позицію каталогу, або
// ключа нема взагалі; хибний ключ гірший за відсутній.
import { describe, it, expect } from 'vitest';
import { resolveLabelToKey, resolveLabel } from '../logic.js';
import { BY_KEY } from '../seed.js';

describe('вид і стан у назві — п’ять чужих ключів з аудиту', () => {
  it('«темний шоколад Rioba» → чорний, а не молочний (аліас бренда стоїть на молочному)', () => {
    const key = resolveLabelToKey('темний шоколад Rioba з мигдалем та морською сіллю');
    expect(key).not.toBe('milk_chocolate_bar');
    // Не прив'язуюсь до конкретного ключа: правильних чорних шоколадів у
    // каталозі кілька, і сусід із «морською сіллю» точніший за просто «70%».
    const item = BY_KEY.get(key!)!;
    expect(`${item.name} ${item.aliases.join(' ')}`.toLowerCase()).toMatch(/темн|чорн|dark/);
  });

  it('«желе сухе Мрія» → суха суміш, а не готове желе', () => {
    for (const flavour of ['вишня', 'апельсин', 'лісові ягоди']) {
      expect(resolveLabelToKey(`желе сухе Мрія ${flavour}`)).toBe('sweet_jelly_dessert');
    }
  });

  it('«локшина швидкого приготування … яловичина» → локшина ш/п, а не домашня', () => {
    const key = resolveLabelToKey('локшина швидкого приготування з пряною яловичиною')!;
    expect(key).not.toBe('pasta_noodles_homemade');
    // Смак («яловичина») з мітки не вимагаю: у полі product дому стоїть сам
    // рід, і родовий запис тут — чесна відповідь. Вимагаю категорію.
    expect(BY_KEY.get(key)!.categories).toContain('швидке приготування');
  });

  it('«вино безалкогольне Hans Greyl» → безалкогольна позиція, а не звичайне вино зі спиртом', () => {
    expect(resolveLabelToKey('вино безалкогольне Hans Greyl Sauvignon Blanc безалкогольне')).toBe('wine_sauvignon_blanc_nonalcoholic');
  });

  it('«вʼялені томати з сиром» не лягають на «вʼялені томати в олії»', () => {
    const key = resolveLabelToKey('вʼялені томати Helcom з сиром');
    expect(key).not.toBe('paste_sundried_tomatoes');
  });
});

describe('уточнення не ламає те, що вже працювало', () => {
  it('молочний шоколад лишається молочним', () => {
    expect(resolveLabelToKey('шоколад молочний Rioba')).toBe('milk_chocolate_bar');
  });
  it('локшина домашня лишається домашньою', () => {
    expect(resolveLabelToKey('локшина домашня')).toBe('pasta_noodles_homemade');
  });
  it('звичайне вино Совіньйон Блан лишається алкогольним', () => {
    expect(resolveLabelToKey('вино Совіньйон Блан')).toBe('alc_wine_sauvignon_blanc');
  });
  it('мітка без жодного уточнення проходить як була', () => {
    expect(resolveLabelToKey('шоколад молочний')).toBe('milk_chocolate_bar');
  });
});

describe('generic на алкоголі вимагає виду, а не лише роду', () => {
  // Резолвер бачить поле `product` — для всіх трьох лікерів аудиту це просто
  // «лікер», і generic брав перший-ліпший алкогольний рядок роду.
  it('голий рід алкоголю не вгадує вид: або родовий запис gen_, або нічого', () => {
    // Тільки ті роди, у яких збіг іде М'ЯКОЮ планкою. «віскі», «горілка»,
    // «джин» та ін. мають у каталозі точний АЛІАС на типовий представник —
    // це свідомий вибір каталогу, інший механізм, і етап 3 його не чіпає.
    for (const genus of ['лікер', 'вино', 'пиво']) {
      const key = resolveLabel(genus, 'generic')?.key ?? null;
      // gen_ — це САМЕ те, що GENERIC-0915 і задумував: рід без виду.
      // Заборонено інше: конкретний смак/сорт, вибраний випадково.
      expect(key === null || key.startsWith('gen_')).toBe(true);
    }
  });
  it('рід із видом і далі знаходиться', () => {
    expect(resolveLabel('лікер вершковий', 'generic')?.key).toBe('alc_cream_liqueur');
  });
  it('generic поза алкоголем працює як раніше', () => {
    expect(resolveLabel('кисломолочний сир', 'generic')?.key).toBe('r2cz_curd_2');
    expect(resolveLabel('зелень', 'generic')?.key).toBe('herbs_frozen_mix');
  });
});
