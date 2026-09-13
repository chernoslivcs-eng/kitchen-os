// Р146: евал «факту дому» — 19 знімків домів → ті самі блоки, що бачить чат
// ([СЬОГОДНІ] · [ЗАРАЗ] · [КОМОРА] · [ОСТАННІ ГОТУВАННЯ], серіалізація
// @kitchen/domain) → промпт home-fact.md → 10 рядків у HOME-FACT-EVAL-0913.md
// з вхідними фактами поруч; власник дивиться очима. Без бази, без чату.
//   pnpm --filter @kitchen/eval run home-fact
// Ключ — з кореневого .env (env.ts). Модель — профіль smart, як у чаті
// (MODEL_SMART або типова). Вартість — з OpenRouter (/generation?id, total_cost)
// або, для прямого Anthropic, за тарифами services/api/src/pricing.ts.
// HOME_FACT_WAS=шлях — дописати внизу розділ «було» (попередній прогін).
import '../env.js';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPrompt, compose } from '@kitchen/prompts';
import {
  BUILTIN_OCCASIONS, subscribedRows, subscribedTraditions, fastingActive,
  serializeNow, serializePantry, serializeCookRun, todayLabel, cleanHomeFactText,
  type PantryBatch, type RecentCookRunSummary,
} from '@kitchen/domain';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, '../../../HOME-FACT-EVAL-0913.md');

const apiKey = () => process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const baseURL = () => (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api' : undefined);
const model = process.env.MODEL_SMART ?? (process.env.OPENROUTER_API_KEY ? 'google/gemini-3.8-flash' : 'claude-sonnet-5');

// Тарифи для прямого Anthropic, USD за 1M (services/api/src/pricing.ts — тримати рівними); для OpenRouter — фактична ціна з /generation.
const RATES: Record<string, { input: number; cached: number; output: number }> = { haiku: { input: 1.0, cached: 0.1, output: 5.0 }, sonnet: { input: 3.0, cached: 0.3, output: 15.0 }, opus: { input: 15.0, cached: 1.5, output: 75.0 } };
const CACHE_WRITE = 1.25;
async function openRouterCost(id: string): Promise<number | null> {
  try {
    const r = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
    if (!r.ok) return null;
    const j = await r.json() as { data?: { total_cost?: number } };
    return typeof j.data?.total_cost === 'number' ? j.data.total_cost : null;
  } catch { return null; }
}

type B = { label: string; zone?: PantryBatch['zone']; days?: number; v?: number; u?: PantryBatch['unit']; opened?: boolean };
type Case = { name: string; now: string; batches: B[]; runs: { title: string; daysAgo: number; rating?: number }[] };

const CASES: Case[] = [
  { name: 'лише спливає · одне прострочене', now: '2026-09-13T12:00:00', batches: [{ label: 'помідори', zone: 'fresh', days: -1, v: 500 }, { label: 'рис', zone: 'dry', days: 300, v: 1000 }], runs: [] },
  { name: 'лише спливає · прострочене + спливає, шість позицій', now: '2026-09-13T12:00:00', batches: [{ label: 'сир', zone: 'fridge', days: -3, v: 200 }, { label: 'шпинат', zone: 'fresh', days: -1, v: 150 }, { label: 'сметана', zone: 'fridge', days: 0, v: 350 }, { label: 'огірки', zone: 'fresh', days: 1, v: 400 }, { label: 'хліб', zone: 'dry', days: 2, v: 1, u: 'pcs' }, { label: 'банани', zone: 'fresh', days: 3, v: 4, u: 'pcs' }, { label: 'гречка', zone: 'dry', days: 400, v: 800 }], runs: [] },
  { name: 'лише сезон · вересень (гарбузи, гриби)', now: '2026-09-13T12:00:00', batches: [{ label: 'гречка', zone: 'dry', days: 400, v: 800 }, { label: 'олія', zone: 'dry', days: 200, v: 1000, u: 'ml' }], runs: [] },
  { name: 'лише сезон · червень (полуниця, черешня)', now: '2026-06-10T12:00:00', batches: [{ label: 'макарони', zone: 'dry', days: 300, v: 500 }], runs: [] },
  { name: 'лише страви · три за тиждень', now: '2026-09-13T12:00:00', batches: [{ label: 'сіль', zone: 'spices', days: 900, v: 500 }], runs: [{ title: 'Сирники', daysAgo: 1, rating: 5 }, { title: 'Борщ', daysAgo: 3 }, { title: 'Омлет зі шпинатом', daysAgo: 6 }] },
  { name: 'лише страви · одна й та сама тричі', now: '2026-09-13T12:00:00', batches: [{ label: 'сіль', zone: 'spices', days: 900, v: 500 }], runs: [{ title: 'Паста з томатами', daysAgo: 1 }, { title: 'Паста з томатами', daysAgo: 3 }, { title: 'Паста з томатами', daysAgo: 5 }] },
  { name: 'спливає + страви', now: '2026-09-13T12:00:00', batches: [{ label: 'помідори', zone: 'fresh', days: -1, v: 500 }, { label: 'фета', zone: 'fridge', days: 2, v: 200 }], runs: [{ title: 'Паста з томатами й фетою', daysAgo: 3, rating: 4 }] },
  { name: 'усе · спокійний дім', now: '2026-09-13T12:00:00', batches: [{ label: 'йогурт', zone: 'fridge', days: 3, v: 2, u: 'pcs' }, { label: 'яблука', zone: 'fresh', days: 10, v: 1200 }, { label: 'вівсянка', zone: 'dry', days: 300, v: 700 }], runs: [{ title: 'Вівсянка з яблуками', daysAgo: 0 }, { title: 'Курка з рисом', daysAgo: 2, rating: 4 }] },
  { name: 'усе · переповнений дім (відкриті партії, довгі назви з чека)', now: '2026-09-13T12:00:00', batches: [{ label: 'Йогурт Активіа натуральний 3,5% 290 г', zone: 'fridge', days: 0, v: 290 }, { label: 'молоко', zone: 'fridge', days: -1, v: 1000, u: 'ml' }, { label: 'курка', zone: 'fridge', days: 1, v: 900 }, { label: 'риба', zone: 'fridge', days: 1, v: 600 }, { label: 'зелень', zone: 'fresh', days: 2, v: 100 }, { label: 'ягоди', zone: 'fresh', days: 3, v: 300 }, { label: 'сир «Ферма» 45%', zone: 'fridge', opened: true, days: 5, v: 250 }, { label: 'рис', zone: 'dry', days: 300, v: 1000 }], runs: [{ title: 'Салат із кавуном і фетою', daysAgo: 0 }, { title: 'Рибні котлети', daysAgo: 1, rating: 3 }, { title: 'Курка з овочами', daysAgo: 2 }, { title: 'Сирники', daysAgo: 4 }, { title: 'Борщ', daysAgo: 5 }] },
  { name: 'порожньо · лише крупи, без строків, без страв, без сезону (лютий)', now: '2026-02-10T12:00:00', batches: [{ label: 'гречка', zone: 'dry', days: 400, v: 800 }, { label: 'сіль', zone: 'spices', days: 900, v: 500 }], runs: [] },
  { name: 'спливає · лише відкриті партії без дати (строк ≈ від відкриття)', now: '2026-09-13T12:00:00', batches: [{ label: 'сметана', zone: 'fridge', opened: true, v: 350 }, { label: 'пелаті', zone: 'fridge', opened: true, v: 400 }, { label: 'хумус', zone: 'fridge', opened: true, v: 200 }], runs: [] },
  { name: 'спливає · останній день у трьох', now: '2026-09-13T12:00:00', batches: [{ label: 'молоко', zone: 'fridge', days: 0, v: 1000, u: 'ml' }, { label: 'кефір', zone: 'fridge', days: 0, v: 500, u: 'ml' }, { label: 'сир кисломолочний', zone: 'fridge', days: 0, v: 400 }], runs: [] },
  { name: 'сезон + одна страва вчора', now: '2026-09-13T12:00:00', batches: [{ label: 'сіль', zone: 'spices', days: 900, v: 500 }], runs: [{ title: 'Крем-суп із гарбуза', daysAgo: 1, rating: 5 }] },
  { name: 'страви · пʼять за пʼять днів', now: '2026-09-13T12:00:00', batches: [{ label: 'сіль', zone: 'spices', days: 900, v: 500 }], runs: [{ title: 'Салат із кавуном і фетою', daysAgo: 0 }, { title: 'Рибні котлети', daysAgo: 1, rating: 3 }, { title: 'Курка з овочами', daysAgo: 2 }, { title: 'Сирники', daysAgo: 3 }, { title: 'Борщ', daysAgo: 4, rating: 5 }] },
  { name: 'страви · одна давня', now: '2026-09-13T12:00:00', batches: [{ label: 'сіль', zone: 'spices', days: 900, v: 500 }], runs: [{ title: 'Плов', daysAgo: 19 }] },
  { name: 'спливає + сезон · грудень (мандарини, піст)', now: '2026-12-10T12:00:00', batches: [{ label: 'шинка', zone: 'fridge', days: 1, v: 300 }, { label: 'мандарини', zone: 'fresh', days: 6, v: 1500 }], runs: [] },
  { name: 'усе · квітень (черемша, редиска), прострочене + страва', now: '2026-04-25T12:00:00', batches: [{ label: 'яйця', zone: 'fridge', days: -2, v: 10, u: 'pcs' }, { label: 'редиска', zone: 'fresh', days: 4, v: 300 }], runs: [{ title: 'Омлет зі шпинатом', daysAgo: 2 }] },
  { name: 'спливає · довгі назви з чека, штуки й упаковки', now: '2026-09-13T12:00:00', batches: [{ label: 'Йогурт Активіа натуральний 3,5% 290 г', zone: 'fridge', days: 1, v: 2, u: 'pcs' }, { label: 'Хліб «Київський» нарізний', zone: 'dry', days: 1, v: 1, u: 'pack' }, { label: 'Сир «Ферма» 45%', zone: 'fridge', days: -1, v: 250 }], runs: [] },
  { name: 'страви + сезон · липень (черешня, абрикоси), рейтинги', now: '2026-07-05T12:00:00', batches: [{ label: 'вівсянка', zone: 'dry', days: 300, v: 700 }], runs: [{ title: 'Вареники з черешнею', daysAgo: 1, rating: 5 }, { title: 'Окрошка', daysAgo: 3, rating: 2 }] },
];

function batchesOf(c: Case): PantryBatch[] {
  const now = new Date(c.now).getTime();
  return c.batches.map((b, i) => ({
    id: `b${i}`, household_id: 'h', catalog_key: null, label: b.label, zone: b.zone ?? 'fridge',
    value: b.v ?? null, unit: b.u ?? (b.v != null ? 'g' : null), state: b.opened ? 'opened' : 'sealed',
    opened_at: b.opened ? new Date(now - 2 * 86_400_000).toISOString() : null,
    expires_at: b.days != null ? new Date(now + b.days * 86_400_000).toISOString() : null,
    best_before_opened_days: null, added_at: new Date(now - 5 * 86_400_000).toISOString(), depleted_at: null,
    confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null,
  } as PantryBatch));
}
function inputOf(c: Case): string {
  const now = new Date(c.now);
  const occasions = subscribedRows(BUILTIN_OCCASIONS, []);
  const trads = subscribedTraditions(occasions);
  const runs: RecentCookRunSummary[] = c.runs.map((r) => ({ title: r.title, rating: r.rating ?? null, verdict: null, finished_at: new Date(now.getTime() - r.daysAgo * 86_400_000).toISOString() }));
  const cookLog = runs.length
    ? '\n\n[ОСТАННІ ГОТУВАННЯ]\n' + runs.map((r, i) => serializeCookRun(r, now.getTime(), i === 0)).join('\n')
    : '\n\n[ОСТАННІ ГОТУВАННЯ] порожньо — жодного завершеного готування ще немає.';
  return '[СЬОГОДНІ] ' + todayLabel(now)
    + serializeNow(occasions, [], now)
    + '\n\n[КОМОРА]\n' + serializePantry(batchesOf(c), now.getTime(), fastingActive(now, occasions, trads), 'none', 120, [], '', [])
    + cookLog;
}

async function main() {
  const key = apiKey();
  if (!key) { console.error('home-fact eval: нема OPENROUTER_API_KEY / ANTHROPIC_API_KEY у кореневому .env'); process.exit(1); }
  const prompt = loadPrompt();
  const system = compose('home_fact', prompt);
  const client = new Anthropic({ apiKey: key, baseURL: baseURL() });
  const rows: string[] = [];
  let input = 0, output = 0, cached = 0, cacheWrite = 0, calls = 0, bad = 0, dash = 0; let orCost = 0; let orMissing = 0; let errors = 0;
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const facts = inputOf(c);
    process.stdout.write(`${String(i + 1).padStart(2)}. ${c.name} … `);
    const t0 = Date.now();
    let resp: Anthropic.Message;
    try {
      // max_tokens 1024, не 120: gemini думає за замовчуванням і на 120 віддавав 1–11 знаків
      // (міркування зʼїдали бюджет). Платимо лише за фактичний вихід. usage.include —
      // OpenRouter кладе cost прямо у usage відповіді.
      resp = await client.messages.create({
        model, max_tokens: 1024,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: facts }],
        ...(process.env.OPENROUTER_API_KEY ? ({ usage: { include: true } } as object) : {}),
      }, { timeout: 8_000, maxRetries: 0 });
    } catch (e) {
      // Той самий бюджет, що на сервері: таймаут 8 с або помилка → { text: null }, лишається шаблон.
      errors++;
      const why = e instanceof Error ? e.constructor.name : String(e);
      rows.push(`### ${i + 1}. ${c.name}\n\nВхід (ті самі блоки, що в чаті):\n\`\`\`\n${facts}\n\`\`\`\n\n> (без відповіді)\n\n✗ ${why} за ${Date.now() - t0} мс → на сервері { text: null }, шаблон\n`);
      console.log(`✗ ${why} · ${Date.now() - t0} мс → шаблон`);
      continue;
    }
    const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
    const u = resp.usage as Anthropic.Usage & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
    input += u.input_tokens; output += u.output_tokens; cached += u.cache_read_input_tokens ?? 0; cacheWrite += u.cache_creation_input_tokens ?? 0; calls++;
    if (process.env.OPENROUTER_API_KEY) {
      const inline = (resp.usage as unknown as { cost?: number }).cost;
      const c = typeof inline === 'number' ? inline : await (async () => { await new Promise((z) => setTimeout(z, 600)); return openRouterCost(resp.id); })();
      if (c == null) orMissing++; else orCost += c;
    }
    const isDash = raw.replace(/[\s.«»"]/g, '') === '—' || raw.replace(/[\s.«»"]/g, '') === '-';
    const clean = isDash ? null : cleanHomeFactText(raw);
    const verdict = isDash ? '— (нема фактів, рядка нема)' : clean ? `✓ ${clean.length} зн.${clean.length < raw.trim().length ? ` (зріз із ${raw.trim().length})` : ''}` : `✗ відкинуто (${raw.length} зн. або не текст) → шаблон`;
    if (isDash) dash++; else if (!clean) bad++;
    rows.push(`### ${i + 1}. ${c.name}\n\nВхід (ті самі блоки, що в чаті):\n\`\`\`\n${facts}\n\`\`\`\n\n> ${raw.replace(/\n/g, ' ')}\n\n${verdict} · ${Date.now() - t0} мс\n`);
    console.log(verdict);
  }
  const rate = Object.entries(RATES).find(([k]) => model.includes(k))?.[1];
  const cost = process.env.OPENROUTER_API_KEY
    ? orCost
    : rate ? (input * rate.input + cached * rate.cached + cacheWrite * rate.input * CACHE_WRITE + output * rate.output) / 1_000_000 : NaN;
  const costNote = process.env.OPENROUTER_API_KEY
    ? `вартість прогону ≈ $${cost.toFixed(4)} (OpenRouter /generation, total_cost${orMissing ? `; ${orMissing} без даних` : ''})`
    : Number.isNaN(cost) ? 'вартість: тариф моделі невідомий' : `вартість прогону ≈ $${cost.toFixed(4)}`;
  const head = [
    '# «Факт дому» від моделі — евал 13.09 (Р146)',
    '',
    `Промпт \`packages/prompts/versions/${prompt.version}/home-fact.md\` (виклик \`home_fact\`, профіль smart як у чаті, compose role + home-fact), модель \`${model}\`, max_tokens 1024 (модель думає — 120 не вистачало), temperature типова.`,
    `${CASES.length} знімків домів: лише спливає / лише сезон / лише страви / спливає + страви / усе / порожньо. Вхід — рівно ті блоки, що бачить чат-модель ([СЬОГОДНІ] · [ЗАРАЗ] · [КОМОРА] · [ОСТАННІ ГОТУВАННЯ]), серіалізовані тими самими функціями @kitchen/domain; профіль і покупки не передаються.`,
    `Правило виходу: промпт просить одне–три речення до 180 знаків лише з переданих фактів; сервер зрізає довше за 220 по межі речення, без межі або з емодзі — { text: null } (лишається шаблон); «—» = модель не знайшла фактів.`,
    '',
    `Викликів: ${calls} · без відповіді (таймаут 8 с / помилка): ${errors} · відкинуто: ${bad} · «—»: ${dash} · токени: вхід ${input}, кеш-читання ${cached}, кеш-запис ${cacheWrite}, вихід ${output} · ${costNote}.`,
    '',
    '---',
    '',
  ];
  const was = process.env.HOME_FACT_WAS && existsSync(process.env.HOME_FACT_WAS) ? '\n---\n\n' + readFileSync(process.env.HOME_FACT_WAS, 'utf8') : '';
  writeFileSync(OUT_PATH, head.join('\n') + rows.join('\n') + was);
  console.log(`\n→ ${OUT_PATH}\nвикликів ${calls} · без відповіді ${errors} · відкинуто ${bad} · «—» ${dash} · токени in ${input} / cached ${cached} / cache-write ${cacheWrite} / out ${output} · ${costNote}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
