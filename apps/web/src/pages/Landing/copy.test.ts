import { describe, it, expect } from 'vitest';
import { PLANS, PRICE, HERO, FOOTER } from './copy';

// Рішення власника 30.09 (остаточний текст, ітерація 4): нове копі першого
// екрана — гасло «Кухня, яка памʼятає» на паузі (не вживати в нових
// матеріалах).
describe('HERO · копі 30.09', () => {
  it('a/b — остаточне гасло власника (довге тире в a)', () => {
    expect(HERO.a).toBe('Готувати вдома — класно.');
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

  // Фікс 30.09: на 390 рядок ламався перед тире («Готувати вдома / — класно.»)
  // — байдужий до пробіла toBe() це не ловить, тому окремо перевіряємо саме
  // код символу перед «—» в HERO.a і FOOTER.*.
  it('перед тире в «вдома — класно» — нерозривний пробіл (U+00A0), не звичайний', () => {
    const dashIndex = HERO.a.indexOf('—');
    expect(HERO.a.charCodeAt(dashIndex - 1)).toBe(0x00a0);
    expect(FOOTER.tagline.charCodeAt(FOOTER.tagline.indexOf('—') - 1)).toBe(0x00a0);
    expect(FOOTER.taglineLong.charCodeAt(FOOTER.taglineLong.indexOf('—') - 1)).toBe(0x00a0);
  });
});

describe('FOOTER · копі 30.09', () => {
  it('tagline/taglineLong — те саме гасло, що HERO.a', () => {
    expect(FOOTER.tagline).toBe('Готувати вдома — класно.');
    expect(FOOTER.taglineLong).toBe('Готувати вдома — класно. Без реклами й проплачених пропозицій усередині.');
  });
});

// Рішення власника 01.10 (спек demo-instead-of-beta §1/§6): безстрокова
// «бета» зникає — PLANS завжди три картки, без прапорця.
describe('PLANS — демо + два тарифи, завжди активні (01.10)', () => {
  it('рівно три картки, «демо» першою', () => {
    expect(PLANS.map((p) => p.key)).toEqual(['demo', 'solo', 'home']);
  });

  it('усі три картки мають активну кнопку (cta:true) — сірих пігулок більше нема', () => {
    expect(PLANS.every((p) => p.cta === true)).toBe(true);
  });

  it('«Демо»: нейтральна панель (paper), 0 ₴, «7 днів · без картки»', () => {
    const demo = PLANS[0]!;
    expect(demo.tint).toBe('paper');
    expect(demo.price).toBe('0 ₴');
    expect(demo.per).toBe('7 днів · без картки');
    expect(demo.approx).toBeUndefined();
    expect(demo.lines).toHaveLength(3);
  });

  it('«Для себе» і «Для дому» — ціни й переліки з PR #208, тепер з активною кнопкою', () => {
    const [, solo, home] = PLANS;
    expect(solo!).toMatchObject({ key: 'solo', price: '210 ₴', per: '/ місяць', approx: '≈ $5', cta: true });
    expect(solo!.lines).toHaveLength(6);
    expect(home!).toMatchObject({ key: 'home', price: '290 ₴', per: '/ місяць', approx: '≈ $7', cta: true });
    expect(home!.lines).toHaveLength(5);
  });

  it('стара «Бета-тест» ніде в PLANS не лишилась', () => {
    const text = JSON.stringify(PLANS);
    expect(text).not.toContain('Бета-тест');
    expect(text).not.toContain('бети');
  });

  // Рішення власника 01.10: кнопка на картках тарифів — скрізь «Почати».
  it('PRICE.cta — коротке «Почати», без хвоста «з того, що є»', () => {
    expect(PRICE.cta).toBe('Почати');
  });
});
