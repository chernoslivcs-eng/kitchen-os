// Переприсвоєння catalog_key у живих даних (власник ухвалив, 22.09.2026) —
// чиста функція над decideKey (rekey.ts), окремо від бази, під тестом.
//
// ТРИ ВИПАДКИ, і жодного четвертого:
//   · ключа нема, резолвер дає  → проставити (fill)
//   · ключ є, резолвер дає ІНШИЙ → переписати (rekey)
//   · резолвер мовчить          → НЕ чіпати НІКОЛИ, і наявний ключ теж не
//     стирати — навіть коли він стоїть ні на чому (обидві планки мовчать).
//
// Це НАВМИСНЕ розходження з decideKey/rekey.ts: там третій випадок — 'erase'
// (стирає), і це задокументована, тестом закріплена поведінка іншого
// скрипта (rekey.test.ts, «яловичина стейк Портер»). Тут — інше рішення
// власника для ЦЬОГО конкретного переприсвоєння: не втрачати ключ, який
// хтось міг поставити руками чи яким користується щось, чого резолвер не
// бачить. Тому — не правка decideKey (вона лишається як є для свого
// власного скрипта), а тонка обгортка, що перемаповує erase → keep.

import { decideKey, type KeyDecision } from './rekey.js';
import { BY_KEY } from '@kitchen/catalog/seed';

export function decideReassign(stored: string | null, product: string, dn: string): KeyDecision {
  const d = decideKey(stored, product, dn);
  if (d.action === 'erase') {
    return { action: 'keep', key: stored, why: `${d.why} — не стираємо (переприсвоєння, не rekey)` };
  }
  return d;
}

// Захист «переписали пів бази через баг у резолвері»: аудит очікує 8 rekey +
// 29 fill ≈ 37 — стеля з запасом. Чиста функція, окремо від argv, під тестом.
export const EXPECTED_MAX = 40;
export function exceedsLimit(total: number): boolean {
  return total > EXPECTED_MAX;
}

// Власник, 22.09, після перегляду першого сухого прогону: серед «переписати»
// є клас, що йде НЕ в бік точності — конкретний ключ під родовий (priority
// -1), хоча конкретний нічому не суперечить («рис» → grain_rice_long
// лишається розумним здогадом і без назви сорту; родовий gen_rice сорт
// просто не знає). Для сметани це пряма втрата жирності (dairy_sour_cream_10
// 10,6 г жиру, usda: → gen_sour_cream 14 г, estimate).
//
// Сигнал: РЕЗУЛЬТАТ — родовий запис каталогу (priority: -1) І стара, і нова
// позиція ведуть в ту саму зону зберігання. Коли зони РІЗНІ — це, навпаки,
// ознака справжньої помилки категорії, не втрати конкретики: «помідори» під
// pomodori_pelati (zone dry, консерви) замість свіжих gen_tomatoes (zone
// fresh) — не сорт, а інший продукт. Так само «чіпси Lay's сир» веде на
// dried_banana — chips_cheese взагалі не родовий (немає priority -1), тому
// під це правило не підпадає і так.
//
// НЕ абсолютна істина — сигнал наближений, не заміна перегляду людиною.
// REVIEWED_EXCEPTIONS нижче — випадки, звірені вручну 22.09, де сигнал
// помилився б:
//   · hh_napkins_table → nf_napkins («серветки»): нехарчове, «столові» проти
//     просто «серветки» ні на що в застосунку не впливає — власник підтвердив
//     явно, лишаємо в переприсвоєнні.
//   · pasta_noodles_homemade → gen_instant_noodles («локшина»): назва партії
//     — «локшина швидкого приготування … з пряною яловичиною» — ПРЯМО
//     суперечить старому ключу «домашня» (два взаємовиключні способи
//     приготування). Це не втрата конкретики, а виправлення реальної
//     помилки категорії — сигнал за зоною (dry→dry) тут не спрацьовує, бо
//     зона в обох та сама, а помилка не в зоні.
const REVIEWED_EXCEPTIONS: ReadonlySet<string> = new Set(['hh_napkins_table', 'pasta_noodles_homemade']);

export function looksLikeGenericDowngrade(oldKey: string, newKey: string): boolean {
  const oldCat = BY_KEY.get(oldKey);
  const newCat = BY_KEY.get(newKey);
  if (!oldCat || !newCat) return false;
  if (newCat.priority !== -1) return false;
  return oldCat.zone_default === newCat.zone_default;
}

/** Тримати ЦЮ конкретну пару (стан «rekey» від decideReassign) — не писати, лишити старий ключ. */
export function shouldHoldBackRekey(oldKey: string, newKey: string): boolean {
  if (REVIEWED_EXCEPTIONS.has(oldKey)) return false;
  return looksLikeGenericDowngrade(oldKey, newKey);
}
