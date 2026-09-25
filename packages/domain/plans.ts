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

// Спек 2026-09-25 §1: новий домен підписки оперує тарифами `self`/`home` —
// це НЕ ті самі рядки, що `PlanOption.id` вище (`beta`/`basic`/`family`,
// значення колонки "user".plan з міграції 0024). Старі лишаються на місці:
// поле user.plan цим етапом не видаляється, лише перестає бути джерелом
// правди про доступ. Числом, а не рядком «210 ₴/міс», бо ці значення йдуть
// у суму списання й у текст банера.
export const PLAN_PRICE_UAH: Record<'self' | 'home', number> = { self: 210, home: 290 };
export const PLAN_NAME: Record<'self' | 'home', string> = { self: 'Для себе', home: 'Для дому' };
