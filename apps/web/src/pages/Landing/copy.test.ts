// Постановка 25.09 (BETA_PLAN): один прапорець перемикає картку «Бета-тест»
// у секції «Ціна» — тест на buildPlans(true/false) замість самого PLANS
// (BETA_PLAN — літерал, не env; buildPlans винесено з copy.ts саме заради
// цього тесту, щоб не переzavantaжувати модуль). PLANS = buildPlans(BETA_PLAN)
// перевіряється окремо — фіксує, що прапорець зараз дійсно true.
import { describe, it, expect } from 'vitest';
import { buildPlans, BETA_PLAN, PLANS, PRICE, HERO, FOOTER } from './copy';

// Рішення власника 30.09 (остаточний текст, ітерація 4): нове копі першого
// екрана — гасло «Кухня, яка памʼятає» на паузі (не вживати в нових
// матеріалах).
describe('HERO · копі 30.09', () => {
  it('a/b — остаточне гасло власника (довге тире в a)', () => {
    expect(HERO.a).toBe('Готувати вдома — класно.');
    expect(HERO.b).toBe('Швидко, повільно, за планом або як заманеться.');
  });

  it('lead і leadMobile — однакові', () => {
    expect(HERO.lead).toBe('Готуй так, як тобі зручно. А рутину Kitchen OS візьме на себе.');
    expect(HERO.leadMobile).toBe(HERO.lead);
  });

  it('стара слоган-фраза ніде в HERO/FOOTER не лишилась', () => {
    expect(Object.values(HERO)).not.toContain('Кухня, яка памʼятає.');
    expect(FOOTER.tagline).not.toBe('Кухня, яка памʼятає.');
  });
});

describe('FOOTER · копі 30.09', () => {
  it('tagline/taglineLong — те саме гасло, що HERO.a', () => {
    expect(FOOTER.tagline).toBe('Готувати вдома — класно.');
    expect(FOOTER.taglineLong).toBe('Готувати вдома — класно. Без реклами й проплачених пропозицій усередині.');
  });
});

describe('buildPlans(false) — рівно PR #208, без слідів картки «Бета-тест»', () => {
  const plans = buildPlans(false);

  it('рівно два тарифи: «Для себе», «Для дому» — жодного key:"beta"', () => {
    expect(plans.map((p) => p.key)).toEqual(['solo', 'home']);
  });

  it('обидва тарифи мають активну кнопку (cta:true)', () => {
    expect(plans.every((p) => p.cta === true)).toBe(true);
  });

  it('ціни та переліки — ті самі, що в PR #208', () => {
    expect(plans[0]!).toMatchObject({ key: 'solo', price: '210 ₴', per: '/ місяць', approx: '≈ $5' });
    expect(plans[0]!.lines).toHaveLength(6);
    expect(plans[1]!).toMatchObject({ key: 'home', price: '290 ₴', per: '/ місяць', approx: '≈ $7' });
    expect(plans[1]!.lines).toHaveLength(5);
  });
});

describe('buildPlans(true) — картка «Бета-тест» першою, «Для себе»/«Для дому» без кнопки', () => {
  const plans = buildPlans(true);

  it('три картки, «Бета-тест» першою', () => {
    expect(plans.map((p) => p.key)).toEqual(['beta', 'solo', 'home']);
  });

  it('«Бета-тест»: нейтральна панель (paper), 0 ₴, активна кнопка', () => {
    const beta = plans[0]!;
    expect(beta.tint).toBe('paper');
    expect(beta.price).toBe('0 ₴');
    expect(beta.per).toBe('поки триває бета');
    expect(beta.approx).toBeUndefined();
    expect(beta.cta).toBe(true);
    expect(beta.lines).toHaveLength(3);
  });

  it('«Бета-тест».blurb — той самий рядок, що в packages/domain/plans.ts (не дубльований)', () => {
    expect(plans[0]!.blurb).toBeTruthy();
    expect(typeof plans[0]!.blurb).toBe('string');
  });

  it('«Для себе» і «Для дому» лишають ціни й переліки з PR #208, але без активної кнопки', () => {
    const [, solo, home] = plans;
    expect(solo!).toMatchObject({ key: 'solo', price: '210 ₴', cta: false });
    expect(solo!.lines).toHaveLength(6);
    expect(home!).toMatchObject({ key: 'home', price: '290 ₴', cta: false });
    expect(home!.lines).toHaveLength(5);
  });
});

describe('PLANS = buildPlans(BETA_PLAN) — поточний стан прапорця', () => {
  it('BETA_PLAN зараз true, і PLANS йому відповідає', () => {
    expect(BETA_PLAN).toBe(true);
    expect(PLANS).toEqual(buildPlans(true));
  });

  it('PRICE.afterBeta існує для сірої пігулки на «Для себе»/«Для дому»', () => {
    expect(PRICE.afterBeta).toBe('після бети');
  });
});
