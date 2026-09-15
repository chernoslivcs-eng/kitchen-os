// AUTH-BRIEF-0915: тарифні картки в режимі «Реєстрація» на лендингу. Статичні
// заглушки під майбутню оплату — коли вона зʼявиться, картки оживають
// (available: true), блок не перебудовується. Ціни — ті самі, що в
// маркетинговому блоці «Ціна» лендингу (copy.ts PLANS: $5/$7), той самий
// знак валюти. `id` === значення "user".plan (міграція 0024) — новий акаунт
// завжди отримує 'beta'.
export interface PlanOption {
  id: string;
  name: string;
  price: string;
  blurb: string;
  available: boolean;
}

export const PLAN_OPTIONS: PlanOption[] = [
  { id: 'beta', name: 'Бета-тест', price: '0 ₴', blurb: 'Усе включено, поки триває бета', available: true },
  { id: 'basic', name: 'Базовий', price: '$5/міс', blurb: 'Одна людина, один дім', available: false },
  { id: 'family', name: 'Сімʼя', price: '$7/міс', blurb: 'Спільна комора на кількох', available: false },
];
