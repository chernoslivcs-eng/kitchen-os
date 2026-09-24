// AUTH-BRIEF-0915: тарифні картки — заготовка під майбутній екран «Підписка»
// в профілі (бриф 24.09: вибір тарифу з лендінгу прибрано, це туди й
// переїжджає). Наразі модуль ніде не рендериться. Ціни — ті самі, що в
// маркетинговому блоці «Ціна» лендінгу (copy.ts PLANS: 210 ₴/290 ₴), той
// самий знак валюти. `id` === значення "user".plan (міграція 0024) — новий
// акаунт завжди отримує 'beta'.
export interface PlanOption {
  id: string;
  name: string;
  price: string;
  blurb: string;
  available: boolean;
}

export const PLAN_OPTIONS: PlanOption[] = [
  { id: 'beta', name: 'Бета-тест', price: '0 ₴', blurb: 'Усе включено, поки триває бета', available: true },
  { id: 'basic', name: 'Для себе', price: '210 ₴/міс', blurb: 'Одна людина, один дім', available: false },
  { id: 'family', name: 'Для дому', price: '290 ₴/міс', blurb: 'Спільна комора на кількох', available: false },
];
