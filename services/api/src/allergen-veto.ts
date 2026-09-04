// Вето алергену на пропозиції — після моделі, до збереження.
//
// Еval 04.09 після 1.2: shared-meal-allergen — модель поклала «арахісову
// пасту» в rescues французьких тостів на спільний сніданок, при тому що
// рядок партії в [КОМОРА] ніс «⚠АЛЕРГЕН (арахіс в Оксана) — сам не пропонуй
// і НЕ ЗГАДУЙ». Мітка була, модель її переступила; чи через зсув тексту в
// kitchen-policy (§4 KNOWN-FAILURES описує такий ефект сусідства), чи як
// флап — для людини різниці немає: алерген на столі.
//
// Тверда межа продукту не має залежати від того, куди модель подивилась.
// Той самий закон, що vetoNonfood: сервер має право ЗАБОРОНИТИ те, що
// впізнав, і не має права вигадувати. Матч — за коренем, як ⚠ у context.ts
// (та сама функція root: «арахіс» ловить «арахісова», «арахісом»).
//
// Що робимо: страву з алергеном прибираємо з картки. Лишилась хоч одна —
// картка живе, reply не чіпаємо (він міг згадати страву, але кнопки під
// нею вже нема — гірше було б лишити кнопку). Не лишилось жодної — картка
// null і чесна репліка: людина має дізнатись, що пропозиція знята, і чому.
// Відсічене логується: частоту треба знати, це сигнал про промпт.

import type { Card, EaterRow, Profile } from '@kitchen/domain';
import { root, meaningfulWords } from '@kitchen/catalog';

export interface AllergenVetoResult {
  removed: { title: string; hits: string[] }[];
  emptied: boolean;
}

function allergenRoots(profile: Profile | null | undefined, eaters: EaterRow[]): { root: string; label: string }[] {
  const out: { root: string; label: string }[] = [];
  const push = (a: string, who: string) => {
    for (const w of meaningfulWords(a)) out.push({ root: root(w), label: who ? `${a} (${who})` : a });
  };
  for (const a of profile?.allergies ?? []) push(a, '');
  for (const e of eaters) for (const a of e.allergies ?? []) push(a, e.name);
  return out.filter((r) => r.root.length >= 4);
}

function hits(text: string, roots: { root: string; label: string }[]): string[] {
  const words = meaningfulWords(text).map(root);
  const found = new Set<string>();
  for (const r of roots) {
    // Однобічно: слово починається з кореня алергену. Симетричний матч
    // (як у ⚠ context.ts) ловив «курка» при алергії на «куркуму» —
    // calendar-lent уже флапав на цьому; для вето, що викидає страву,
    // хибне спрацювання дорожче за пропуск, який ⚠ у рядку і так прикриває.
    if (words.some((w) => w === r.root || w.startsWith(r.root))) found.add(r.label);
  }
  return [...found];
}

export const ALLERGEN_VETO_REPLY = 'Зняв пропозицію: у ній був продукт, на який у вас алергія. Скажи, від чого відштовхуватись — запропоную без нього.';

/** Мутує картку: прибирає страви з алергеном. Повертає, що прибрано і чи картка спорожніла. */
export function vetoAllergens(
  call: { card: Card | null; reply?: string | null },
  profile: Profile | null | undefined,
  eaters: EaterRow[],
): AllergenVetoResult {
  const none: AllergenVetoResult = { removed: [], emptied: false };
  if (call.card?.type !== 'proposal' || !Array.isArray(call.card.items)) return none;
  const roots = allergenRoots(profile, eaters);
  if (!roots.length) return none;

  const removed: AllergenVetoResult['removed'] = [];
  const keep = call.card.items.filter((it) => {
    const hay = [it.title, it.desc, it.why, ...(it.rescues ?? []), ...(it.needs ?? [])].filter(Boolean).join(' · ');
    const h = hits(hay, roots);
    if (h.length) { removed.push({ title: it.title, hits: h }); return false; }
    return true;
  });
  if (!removed.length) return none;

  if (keep.length) {
    call.card.items = keep;
    return { removed, emptied: false };
  }
  call.card = null;
  call.reply = ALLERGEN_VETO_REPLY;
  return { removed, emptied: true };
}
