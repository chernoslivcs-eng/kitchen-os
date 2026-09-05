// Вето на пропозиції — після моделі, до збереження. Раунд 4, крок 4:
// загальне вето по індексу (packages/domain/veto.ts) під PROFILE_V2; без
// прапора — стара поведінка за profile.allergies + алергії їдців (нижче,
// без змін). Обгортка applyVeto обирає гілку і віддає лог: кожне відхилення
// — окремий запис {event:'veto', candidate, ingredient, row}.
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

import type { Card, EaterRow, Profile, VetoRow } from '@kitchen/domain';
import { vetoCard, vetoRecipe, stripVetoMentions, type Recipe } from '@kitchen/domain';
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

// Крок 6з: voice v3.1 заборонило моделі згадувати алерген зі своєї
// ініціативи («Молочний з мигдалем теж є, але там алерген — його не беру»),
// але модель тримається старої звички стабільно (qa5-allergen-proactive
// 3/3, KNOWN-FAILURES §10). Промпт не тримає межу — межа йде сервером,
// тим самим законом, що vetoAllergens вище: сервер забороняє те, що впізнав.
//
// «Непрямий запит» тут — не про формулювання людини загалом, а конкретно:
// чи згадала вона САМЕ ЦЕЙ алерген у своїй поточній репліці. Якщо так
// («дай рецепт з горіховим соусом» при алергії на горіхи) — це прямий запит,
// і reply МАЄ назвати алерген вголос (kitchen-policy: «на прямий запит —
// дай, обовʼязково»); чіпати такі речення не можна, інакше зламаємо
// mentions-allergen-out-loud. Якщо алергену немає в репліці людини — його
// згадка в reply завжди самоініціативна, і саме її ми ріжемо.
function splitSentences(text: string): string[] {
  // Проста розбивка по реченнях (крапка/оклик/питання + пробіл) — досить для
  // коротких reply голосу; складніші скорочення тут не трапляються.
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

export const ALLERGEN_REPLY_FALLBACK = 'Тримай варіанти.';

export interface AllergenReplyCleanResult {
  stripped: string[];
}

/** Мутує call.reply: вирізає речення з коренем алергену, якого людина сама не називала. */
export function stripAllergenMentionsFromReply(
  call: { card: Card | null; reply?: string | null },
  profile: Profile | null | undefined,
  eaters: EaterRow[],
  userText: string,
): AllergenReplyCleanResult {
  const none: AllergenReplyCleanResult = { stripped: [] };
  const reply = call.reply;
  if (!reply) return none;
  const roots = allergenRoots(profile, eaters);
  if (!roots.length) return none;

  // Алергени, які людина сама щойно назвала — прямий запит, reply про них
  // мовчати не має.
  const namedByUser = new Set(hits(userText, roots));

  const stripped: string[] = [];
  const kept = splitSentences(reply).filter((s) => {
    const h = hits(s, roots).filter((label) => !namedByUser.has(label));
    if (h.length) { stripped.push(s.trim()); return false; }
    return true;
  });
  if (!stripped.length) return none;

  let next = kept.join(' ').trim();
  if (!next && call.card) next = ALLERGEN_REPLY_FALLBACK;
  call.reply = next;
  return { stripped };
}

// ----- Обгортка з прапором -------------------------------------------------

export interface VetoLogEntry {
  event: 'veto' | 'veto-reply' | 'veto-recipe';
  candidate: string;
  ingredient?: string;
  row?: VetoRow;
  legacy_hits?: string[];
  stripped?: string;
}

export interface ApplyVetoArgs {
  profileV2: boolean | undefined;
  index: VetoRow[];
  profile: Profile | null | undefined;
  eaters: EaterRow[];
  userText: string;
  log: (e: VetoLogEntry) => void;
}

export interface ApplyVetoResult {
  rejected: { title: string; hits: string[] }[];
  emptied: boolean;
  stripped: string[];
}

/** Мутує call (card/reply). Під прапором — індекс; без — allergies. Кожне відхилення йде в log. */
export function applyVeto(call: { card: Card | null; reply?: string | null }, a: ApplyVetoArgs): ApplyVetoResult {
  if (a.profileV2) {
    const r = vetoCard(call, a.index, a.userText);
    for (const x of r.rejected) for (const row of x.rows) a.log({ event: 'veto', candidate: x.title, ingredient: x.ingredient, row });
    const s = stripVetoMentions(call, a.index, a.userText);
    for (const st of s.stripped) a.log({ event: 'veto-reply', candidate: st, stripped: st });
    return {
      rejected: r.rejected.map((x) => ({ title: x.title, hits: x.rows.map((w) => `${w.field}:${w.kind}:${w.ref}`) })),
      emptied: r.emptied,
      stripped: s.stripped,
    };
  }
  const r = vetoAllergens(call, a.profile, a.eaters);
  for (const x of r.removed) a.log({ event: 'veto', candidate: x.title, legacy_hits: x.hits });
  const s = stripAllergenMentionsFromReply(call, a.profile, a.eaters, a.userText);
  for (const st of s.stripped) a.log({ event: 'veto-reply', candidate: st, stripped: st });
  return { rejected: r.removed, emptied: r.emptied, stripped: s.stripped };
}

/**
 * Згенерований рецепт (прямий запит): усі інгредієнти проти індексу. Рядки
 * з allergy=true рецепт не знімають — на прямий запит модель попереджає сама
 * (recipe-generator.md); рядки без прапорця повертаються як список того, без
 * чого треба перегенерувати. Кожен збіг — у лог.
 */
export function recipeVetoHits(recipe: Recipe, index: VetoRow[], log: (e: VetoLogEntry) => void, userText?: string): { avoid: string[] } {
  const hits = vetoRecipe(recipe, index, userText);
  for (const h of hits) log({ event: 'veto-recipe', candidate: recipe.t, ingredient: h.ingredient, row: h.row });
  const avoid = [...new Set(hits.filter((h) => !h.row.allergy).map((h) => h.ingredient))];
  return { avoid };
}
