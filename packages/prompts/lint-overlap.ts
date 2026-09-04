// Лінт перетинів: одне правило — один файл-власник.
//
// Аудит 04.09 (AUDIT-ROUND-2.md §2, ToV-документ §3): одне правило жило в
// кількох файлах у неоднакових редакціях — алерген у role, kitchen-policy,
// proposal-flow і recipe-generator; родове слово в attachment-parser і
// card-routing; одиниці в трьох файлах; «дружина веганка» як anti в
// onboarding-stage2 і як member у kitchen-policy. Розкладання card-rules.md
// (2d37e1e) зберегло текст побайтово — і дублікати всередині одного файлу
// стали дублікатами між файлами. Інваріанти дивляться на вихід моделі, не на
// узгодженість входу; цей файл — перша перевірка входу.
//
// Механіка груба і свідомо така: маркер — регулярка на корінь, перетин —
// маркер у двох і більше файлах одного compose. Ловить текстові дублікати,
// не змістовні; змістовні лишаються людині, але їх стає видно, бо текстові
// прибрані. Гейт — не «нуль перетинів», а «не більше, ніж у базовій лінії»
// (OVERLAP-BASELINE.json): наявні перетини відомі й розбираються по одному,
// НОВИЙ перетин — падіння тесту. Той самий принцип, що KNOWN-FAILURES: рядок
// зникає з базової лінії разом із виправленням.

import { loadPrompt, type LoadedPrompt, type CallName } from './registry.js';

export interface Marker {
  id: string;
  what: string;
  re: RegExp;
}

// Маркери — теми, у яких дублювання вже ловилось. Додавати, коли знайдено
// новий клас перетину; не додавати «про всяк випадок» — шум ховає сигнал.
export const MARKERS: Marker[] = [
  { id: 'allergen', what: 'алергія: як записувати, як пропонувати, як відповідати на прямий запит', re: /алерг/i },
  { id: 'generic-word', what: 'родове слово («мʼясо», «риба»): записати й спитати', re: /родов(е|і|их|ого) (слов|назв)/i },
  { id: 'units', what: 'одиниці g|ml|pcs|pack і переведення побутових мір', re: /зубок|зубки|ст\.\s?л|ч\.\s?л|щіпк/i },
  { id: 'no-permission', what: '«не питай дозволу» / зустрічне питання замість картки', re: /не питай дозволу|зустрічн(е|а) (питання|вилк)|відмова під виглядом/i },
  { id: 'urgency-jargon', what: 'внутрішній словник терміновості («горить», «догоряє») у зразках', re: /горить|догоря/i },
  { id: 'vegan', what: 'веган/дієта домашнього: anti чи member', re: /веган/i },
  { id: 'dates-server', what: 'дати не рахує модель', re: /дат[иу]? (ти )?не раху|рахує сервер|порахує сервер/i },
  { id: 'ask-alongside', what: 'уточнення поряд із карткою, не замість', re: /поряд (із|з) карткою/i },
  { id: 'tense', what: 'час дієслова за режимом картки', re: /минул(ий|ому|им) час|майбутн(ій|ьому|ім) час/i },
  { id: 'refusal', what: 'відмова: межа «не про кухню»', re: /відмов(а|ляй) поза|не відмовляй|не моя кухня|поза темою/i },
  { id: 'internal-vocab', what: 'внутрішній словник («позиція», «партія») у зразках реплік', re: /«[^»]*(позиці[яйюї]|парті[яйюї])[^»]*»/i },
];

export interface Hit { file: string; line: number; text: string }
export interface Overlap { marker: Marker; hits: Hit[]; files: string[] }

function filesForCalls(prompt: LoadedPrompt, calls: CallName[]): string[] {
  const out: string[] = [];
  for (const call of calls) {
    for (const n of prompt.manifest.calls[call].compose) {
      const f = n.replace(/\?$/, '');
      if (!out.includes(f)) out.push(f);
    }
  }
  return out;
}

const ALL_CALLS: CallName[] = ['chat', 'recipe_gen', 'attachment_parse', 'alt_filter'];

/**
 * Перетини маркерів у файлах промпту. Перетин = маркер у ≥ minFiles файлах.
 * За замовчуванням — усі виклики разом: «один власник» стосується й
 * recipe-generator з attachment-parser (одиниці, родове слово, алерген).
 */
export function findOverlaps(
  prompt: LoadedPrompt = loadPrompt(),
  calls: CallName[] = ALL_CALLS,
  minFiles = 2,
): Overlap[] {
  const files = filesForCalls(prompt, calls);
  const out: Overlap[] = [];
  for (const marker of MARKERS) {
    const hits: Hit[] = [];
    for (const file of files) {
      const text = prompt.blocks[file];
      if (!text) continue;
      text.split('\n').forEach((line, i) => {
        if (marker.re.test(line)) hits.push({ file, line: i + 1, text: line.trim().slice(0, 140) });
      });
    }
    const uniq = [...new Set(hits.map((h) => h.file))];
    if (uniq.length >= minFiles) out.push({ marker, hits, files: uniq });
  }
  return out;
}

/** Базова лінія: маркер → відсортований список файлів, де він зустрічається. */
export function baselineOf(overlaps: Overlap[]): Record<string, string[]> {
  const b: Record<string, string[]> = {};
  for (const o of overlaps) b[o.marker.id] = [...o.files].sort();
  return b;
}

/** Нові перетини проти базової лінії: файл, якого в лінії для цього маркера не було. */
export function newOverlaps(current: Overlap[], baseline: Record<string, string[]>): { marker: string; files: string[] }[] {
  const out: { marker: string; files: string[] }[] = [];
  for (const o of current) {
    const known = new Set(baseline[o.marker.id] ?? []);
    const extra = o.files.filter((f) => !known.has(f));
    if (extra.length) out.push({ marker: o.marker.id, files: extra });
  }
  return out;
}

export function report(overlaps: Overlap[]): string {
  const lines: string[] = [];
  for (const o of overlaps) {
    lines.push(`## ${o.marker.id} — ${o.marker.what}`);
    lines.push(`файли (${o.files.length}): ${o.files.join(', ')}`);
    for (const h of o.hits) lines.push(`  ${h.file}:${h.line}  ${h.text}`);
    lines.push('');
  }
  return lines.join('\n');
}
