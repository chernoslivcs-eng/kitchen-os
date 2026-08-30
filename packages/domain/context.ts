// Як стан кухні описується моделі.
//
// Живе в домені, а не в services/api, з однієї причини: цим користуються двоє —
// прод і eval. Поки серіалізація сиділа в model.ts, eval складав свій власний
// промпт (стан як JSON у user-turn), тобто перевіряв не те, що працює у проді.
// Зелений eval не означав нічого.
//
// Порядок блоків не косметичний. Обмеження стоять ПЕРЕД інвентарем: модель
// читає [КОМОРА] згори вниз, і якщо профіль після — вона встигає перелічити
// алергени, не дійшовши до обмеження (QA5-01).

import { root, meaningfulWords } from '@kitchen/catalog';
import type { PantryBatch, Profile, ShoppingItemRow, MemoryNote, EaterRow } from './types.js';
import { serializeOccasions } from './occasions.js';

export interface RecentCookRunSummary {
  title: string;
  rating: number | null;
  verdict: string | null;
  finished_at: string;
}

export interface KitchenContext {
  pantry: PantryBatch[];
  profile?: Profile | null;
  shopping?: ShoppingItemRow[];
  recentCookRuns?: RecentCookRunSummary[];
  notes?: MemoryNote[];
  eaters?: EaterRow[];
  now?: Date;                            // для тестів — інакше Date.now()
}

export function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Профіль. QA4-02: до цього алергії зберігались, показувались у UI — і не
// впливали ні на що; модель двічі пропонувала мигдаль людині з алергією.
export function serializeProfile(p?: Profile | null): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.allergies.length) {
    parts.push('АЛЕРГІЇ (тверда межа — ніколи не пропонуй сам): ' + p.allergies.join(', '));
  }
  if (p.antipatterns.length) parts.push('НЕ ЇСТЬ / НЕ ЛЮБИТЬ: ' + p.antipatterns.join(', '));
  if (p.wishes.length) parts.push('ЛЮБИТЬ / ТЯГНЕ ДО: ' + p.wishes.join(', '));
  const eq = Object.entries(p.equipment ?? {});
  const has = eq.filter(([, v]) => v === 'has').map(([k]) => k);
  const lacks = eq.filter(([, v]) => v === 'lacks').map(([k]) => k);
  if (has.length) parts.push('Є ТЕХНІКА: ' + has.join(', '));
  if (lacks.length) parts.push('НЕМАЄ ТЕХНІКИ: ' + lacks.join(', '));
  return parts.length ? '\n\n[ПРОФІЛЬ]\n' + parts.join('\n') : '';
}

// Комора: id · назва · зона · кількість · стан. Термін догоряння як «!Nдн»,
// щоб модель могла згадати про нього в репліці (бриф §04: інформація — репліка).
//
// QA5-01: алерген позначається ПРЯМО В РЯДКУ ПАРТІЇ, а не окремим правилом —
// правило за пів промпту від даних ігнорувалось. Збіг за коренем, не за
// підрядком: «шоколад з мигдалем».includes('мигдаль') дає false через відмінок.
export function serializePantry(bs: PantryBatch[], p?: Profile | null, now = Date.now()): string {
  const allergens = (p?.allergies ?? [])
    .filter(Boolean)
    .map((a) => ({ label: a, root: root(a) }));
  return bs
    .filter((b) => b.state !== 'depleted')
    .map((b) => {
      const parts = [b.id, b.label, b.zone];
      if (b.value && b.unit) parts.push(`${b.value}${b.unit}`);
      if (b.state === 'opened') parts.push('вдкр');
      if (b.expires_at) {
        const days = Math.round((new Date(b.expires_at).getTime() - now) / 86_400_000);
        if (days <= 7) parts.push(`!${days}дн`);
      }
      const words = meaningfulWords(b.label).map(root);
      const hit = allergens
        .filter((a) => words.some((w) => w === a.root || w.startsWith(a.root) || a.root.startsWith(w)))
        .map((a) => a.label);
      if (hit.length) parts.push(`⚠АЛЕРГЕН (${hit.join(', ')}) — САМ НЕ ПРОПОНУЙ`);
      return parts.join(' · ');
    })
    .join('\n');
}

// QA6-04: без списку в контексті модель у новій сесії казала «порожній» при
// двох позиціях і додавала дубль за один тап.
export function serializeShopping(items: ShoppingItemRow[]): string {
  if (!items.length) return '';
  const lines = items.map((i) => {
    const parts = [i.label];
    if (i.value != null && i.unit) parts.push(`${i.value}${i.unit}`);
    if (i.checked) parts.push('куплено');
    return parts.join(' · ');
  });
  return '\n\n[СПИСОК ПОКУПОК]\n' + lines.join('\n');
}

// QA4-08: Math.round давав «0дн тому» для готування 20 хвилин тому, і модель
// казала «вчора» — продукт брехав про факт із життя людини.
export function serializeCookRun(r: RecentCookRunSummary, now = Date.now()): string {
  const days = Math.floor((now - new Date(r.finished_at).getTime()) / 86_400_000);
  const when = days === 0 ? 'сьогодні' : days === 1 ? 'вчора' : `${days} дн тому`;
  const parts = [r.title, when];
  if (r.rating != null) parts.push(`★${r.rating}/5`);
  if (r.verdict) parts.push(`«${r.verdict}»`);
  return parts.join(' · ');
}

// Їдці дому: «зі мною живе Оксана, вона веганка». Страва готується на всіх,
// хто за столом, тому алергія їдця — така сама тверда межа, як алергія
// власника, і позначається тими самими словами.
export function serializeEaters(eaters: EaterRow[]): string {
  if (!eaters.length) return '';
  const lines = eaters.map((e) => {
    const parts = [e.name];
    if (e.allergies.length) parts.push(`АЛЕРГІЯ (тверда межа — ніколи не пропонуй сам): ${e.allergies.join(', ')}`);
    if (e.antipatterns.length) parts.push(`не їсть: ${e.antipatterns.join(', ')}`);
    if (e.wishes.length) parts.push(`тягне до: ${e.wishes.join(', ')}`);
    return '— ' + parts.join(' · ');
  });
  return '\n\n[ДОМАШНІ]\n' + lines.join('\n')
    + '\nСтрава готується на всіх за столом: обмеження домашніх враховуй нарівні з профілем.';
}

// Висновки з готування. Це єдине в контексті, що написала не система, а сама
// людина про свою кухню: «фует знімати, щойно краї хрусткі». Тому вони йдуть
// окремим блоком, а не тонуть у профілі серед побажань.
export function serializeNotes(notes: MemoryNote[]): string {
  if (!notes.length) return '';
  const lines = notes.map((n) => {
    const parts = [n.text];
    if (n.recipe_title) parts.push(`до «${n.recipe_title}»`);
    if (n.pinned) parts.push('закріплено');
    return '— ' + parts.join(' · ');
  });
  return '\n\n[ВИСНОВКИ З ГОТУВАННЯ]\n' + lines.join('\n');
}

// Повний блок стану, який іде в системний промпт після composed-промпту.
// Одна функція для прода і для eval — саме тому вона тут, а не в model.ts.
export function buildKitchenContext(ctx: KitchenContext): string {
  const now = ctx.now ?? new Date();
  const cookLog = ctx.recentCookRuns?.length
    ? '\n\n[ОСТАННІ ГОТУВАННЯ]\n'
      + ctx.recentCookRuns.map((r) => serializeCookRun(r, now.getTime())).join('\n')
    : '';
  return serializeProfile(ctx.profile)
    + '\n\n[СЬОГОДНІ] ' + todayLabel(now)
    // Календар іде одразу за датою: він її пояснює. Порожній, якщо нічого не
    // триває — і завжди порожній, поки традиція не розпізнана з побажань.
    + serializeOccasions(now, ctx.profile?.wishes ?? [])
    + '\n\n[КОМОРА]\n' + serializePantry(ctx.pantry, ctx.profile, now.getTime())
    + serializeShopping(ctx.shopping ?? [])
    + cookLog
    + serializeNotes(ctx.notes ?? [])
    + serializeEaters(ctx.eaters ?? []);
}
