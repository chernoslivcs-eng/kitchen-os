// Рішення про каталожний ключ наявного продукту — чиста функція, без бази.
//
// Винесена зі скрипта окремо навмисно: правило коштує дорого (ключ тягне
// пошук, категорію фільтра, БЖВ на картці, збіг вето і скоромність), а
// перевіряти його на живій базі — єдиний спосіб, який не можна повторити в CI.
// Тут воно перевіряється тестом.
//
// ЧОМУ ДВІ ПЛАНКИ. `resolveLabelToKey` стоїть на суворій `anchored` навмисно
// (logic.ts:249): його головний споживач добирає ним АЛЕРГЕНИ, і там мовчання
// дешевше за здогад. Але для вже збереженого ключа питання інше: не «що
// проставити наосліп», а «чи те, що стоїть, іще правда». На цьому питанні
// сувора планка мовчить на 15 рядках проду з 25 — і 5 із них друга планка,
// `generic` (та сама, якою logic.ts:266 рішає ЗОНУ на родових словах —
// «сметана», «стейк», «сир»), упізнає, причому двом повертає рівно те, що вже
// стоїть у базі. Стирати їх було б втратою, а не прибиранням.
//
// Порядок рядків усередині планки — той самий, що в решті кодової бази:
// спершу `product`, потім `displayName` (apply.ts:485, backfill нижче).

import { resolveLabel, resolveLabelToKey } from '@kitchen/catalog';

export type KeyAction = 'keep' | 'rekey' | 'erase' | 'fill';

export interface KeyDecision {
  action: KeyAction;
  /** Ключ, який має стояти після рішення. `null` — стерти. */
  key: string | null;
  /** Одним рядком, для сухого прогону. */
  why: string;
}

const anchored = (product: string, dn: string): string | null =>
  resolveLabelToKey(product) ?? resolveLabelToKey(dn);

const generic = (product: string, dn: string): string | null =>
  resolveLabel(product, 'generic')?.key ?? resolveLabel(dn, 'generic')?.key ?? null;

/**
 * @param stored  `catalog_key`, який стоїть у базі (null — його немає)
 * @param product поле `product` трійки
 * @param dn      `displayName` продукту (product + brand + variant)
 */
export function decideKey(stored: string | null, product: string, dn: string): KeyDecision {
  const a = anchored(product, dn);

  // Порожній ключ — стара гілка бекфілу, поведінка не змінюється: доливаємо
  // тільки те, що впевнено дає сувора планка. `generic` тут НЕ кличемо:
  // проставити наосліп родовий ключ на порожньому місці — це рівно той
  // здогад, від якого сувора планка й боронить.
  if (!stored) {
    return a
      ? { action: 'fill', key: a, why: `∅ → ${a} (anchored)` }
      : { action: 'keep', key: null, why: 'ключа немає й резолвер мовчить' };
  }

  if (a && a !== stored) return { action: 'rekey', key: a, why: `${stored} → ${a} (anchored)` };
  if (a) return { action: 'keep', key: stored, why: 'anchored підтверджує збережений' };

  const g = generic(product, dn);
  if (g && g !== stored) return { action: 'rekey', key: g, why: `${stored} → ${g} (generic)` };
  if (g) return { action: 'keep', key: stored, why: 'generic підтверджує збережений' };

  // Обидві планки мовчать — ключ ні на чому не тримається. Лишати його
  // означає лишати на картці чужі калорії: «шоколад Korona» показує 44 ккал
  // коли, «яловичина стейк Портер» — 45 ккал портера.
  return { action: 'erase', key: null, why: `${stored} → ∅ (обидві планки мовчать)` };
}
