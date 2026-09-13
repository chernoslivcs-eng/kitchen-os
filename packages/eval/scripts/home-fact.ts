// Р146: евал «факту дому» — 10 знімків домів → ті самі блоки, що бачить чат
// ([СЬОГОДНІ] · [ЗАРАЗ] · [КОМОРА] · [ОСТАННІ ГОТУВАННЯ], серіалізація
// @kitchen/domain) → промпт home-fact.md → 10 рядків у HOME-FACT-EVAL-0913.md
// з вхідними фактами поруч; власник дивиться очима. Без бази, без чату.
//   pnpm --filter @kitchen/eval run home-fact
// Ключ — з кореневого .env (env.ts). Вартість — за тарифами
// services/api/src/pricing.ts (haiku: 1.00 / 5.00 за 1M, кеш 0.10, запис ×1.25).
import '../env.js';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';
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
const model = process.env.MODEL_FAST ?? (process.env.OPENROUTER_API_KEY ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5-20251001');

// Тарифи haiku, USD за 1M (services/api/src/pricing.ts:72-81 — тримати рівними).
const RATE = { input: 1.0, cached: 0.1, output: 5.0, cacheWrite: 1.25 };

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
  let input = 0, output = 0, cached = 0, cacheWrite = 0, calls = 0, bad = 0, dash = 0;
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const facts = inputOf(c);
    process.stdout.write(`${String(i + 1).padStart(2)}. ${c.name} … `);
    const t0 = Date.now();
    const resp = await client.messages.create({
      model, max_tokens: 120,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: facts }],
    }, { timeout: 8_000, maxRetries: 0 });
    const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
    const u = resp.usage as Anthropic.Usage & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
    input += u.input_tokens; output += u.output_tokens; cached += u.cache_read_input_tokens ?? 0; cacheWrite += u.cache_creation_input_tokens ?? 0; calls++;
    const isDash = raw.replace(/[\s.«»"]/g, '') === '—' || raw.replace(/[\s.«»"]/g, '') === '-';
    const clean = isDash ? null : cleanHomeFactText(raw);
    const verdict = isDash ? '— (нема фактів, рядка нема)' : clean ? `✓ ${clean.length} зн.${clean.length < raw.trim().length ? ` (зріз із ${raw.trim().length})` : ''}` : `✗ відкинуто (${raw.length} зн. або не текст) → шаблон`;
    if (isDash) dash++; else if (!clean) bad++;
    rows.push(`### ${i + 1}. ${c.name}\n\nВхід (ті самі блоки, що в чаті):\n\`\`\`\n${facts}\n\`\`\`\n\n> ${raw.replace(/\n/g, ' ')}\n\n${verdict} · ${Date.now() - t0} мс\n`);
    console.log(verdict);
  }
  const cost = (input * RATE.input + cached * RATE.cached + cacheWrite * RATE.input * RATE.cacheWrite + output * RATE.output) / 1_000_000;
  const head = [
    '# «Факт дому» від моделі — евал 13.09 (Р146)',
    '',
    `Промпт \`packages/prompts/versions/${prompt.version}/home-fact.md\` (виклик \`home_fact\`, fast), модель \`${model}\`, max_tokens 120, temperature типова.`,
    `10 знімків домів: лише спливає / лише сезон / лише страви / спливає + страви / усе / порожньо. Вхід — рівно ті блоки, що бачить чат-модель ([СЬОГОДНІ] · [ЗАРАЗ] · [КОМОРА] · [ОСТАННІ ГОТУВАННЯ]), серіалізовані тими самими функціями @kitchen/domain; профіль і покупки не передаються.`,
    `Правило виходу: промпт просить одне–три речення до 180 знаків лише з переданих фактів; сервер зрізає довше за 220 по межі речення, без межі або з емодзі — { text: null } (лишається шаблон); «—» = модель не знайшла фактів.`,
    '',
    `Викликів: ${calls} · відкинуто: ${bad} · «—»: ${dash} · токени: вхід ${input}, кеш-читання ${cached}, кеш-запис ${cacheWrite}, вихід ${output} · вартість прогону ≈ $${cost.toFixed(4)}.`,
    '',
    '---',
    '',
  ];
  writeFileSync(OUT_PATH, head.join('\n') + rows.join('\n'));
  console.log(`\n→ ${OUT_PATH}\nвикликів ${calls} · відкинуто ${bad} · «—» ${dash} · токени in ${input} / cached ${cached} / cache-write ${cacheWrite} / out ${output} · ≈ $${cost.toFixed(4)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
