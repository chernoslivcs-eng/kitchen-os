// Р146: евал «факту дому» — 20 знімків домів (лише горить / лише сезон / лише
// страви / усе / порожньо) → промпт home-fact.md → 20 рядків у
// HOME-FACT-EVAL-0913.md з вхідними фактами поруч; власник дивиться очима.
// Без бази, без чату: вхід — літерали нижче, серіалізовані тією самою
// функцією, що й на сервері (serializeHomeFacts з @kitchen/domain).
//   pnpm --filter @kitchen/eval run home-fact
// Ключ — з кореневого .env (env.ts). Вартість рахується локально за тарифами
// services/api/src/pricing.ts (haiku: 1.00 / 5.00 за 1M, кеш 0.10, запис ×1.25).
import '../env.js';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPrompt, compose } from '@kitchen/prompts';
import { serializeHomeFacts, homeFactsEmpty, cleanHomeFactText, type HomeFacts } from '@kitchen/domain';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, '../../../HOME-FACT-EVAL-0913.md');

const apiKey = () => process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const baseURL = () => (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api' : undefined);
const model = process.env.MODEL_FAST ?? (process.env.OPENROUTER_API_KEY ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5-20251001');

// Тарифи haiku, USD за 1M (services/api/src/pricing.ts:72-81 — тримати рівними).
const RATE = { input: 1.0, cached: 0.1, output: 5.0, cacheWrite: 1.25 };

const CASES: { name: string; facts: HomeFacts }[] = [
  { name: 'лише горить · одне прострочене', facts: { burning: [{ label: 'помідори', days: -1 }], seasons: [], dishes: [] } },
  { name: 'лише горить · прострочене + спливає', facts: { burning: [{ label: 'йогурт', days: -2 }, { label: 'курка', days: 1 }], seasons: [], dishes: [] } },
  { name: 'лише горить · останній день', facts: { burning: [{ label: 'молоко', days: 0 }], seasons: [], dishes: [] } },
  { name: 'лише горить · шість позицій', facts: { burning: [{ label: 'сир', days: -3 }, { label: 'шпинат', days: -1 }, { label: 'сметана', days: 0 }, { label: 'огірки', days: 1 }, { label: 'хліб', days: 2 }, { label: 'банани', days: 3 }], seasons: [], dishes: [] } },
  { name: 'лише сезон · один, почався цього тижня', facts: { burning: [], seasons: [{ title: 'гарбузи', startedThisWeek: true }], dishes: [] } },
  { name: 'лише сезон · три триваючі', facts: { burning: [], seasons: [{ title: 'кавуни', startedThisWeek: false }, { title: 'персики', startedThisWeek: false }, { title: 'кукурудза', startedThisWeek: false }], dishes: [] } },
  { name: 'лише сезон · триває + новий', facts: { burning: [], seasons: [{ title: 'яблука', startedThisWeek: false }, { title: 'гриби', startedThisWeek: true }], dishes: [] } },
  { name: 'лише страви · одна сьогодні', facts: { burning: [], seasons: [], dishes: [{ title: 'Паста з томатами й фетою', daysAgo: 0 }] } },
  { name: 'лише страви · три за тиждень', facts: { burning: [], seasons: [], dishes: [{ title: 'Сирники', daysAgo: 1 }, { title: 'Борщ', daysAgo: 3 }, { title: 'Омлет зі шпинатом', daysAgo: 6 }] } },
  { name: 'лише страви · давно', facts: { burning: [], seasons: [], dishes: [{ title: 'Плов', daysAgo: 12 }, { title: 'Гречка з грибами', daysAgo: 19 }] } },
  { name: 'лише страви · одна й та сама тричі', facts: { burning: [], seasons: [], dishes: [{ title: 'Паста з томатами', daysAgo: 1 }, { title: 'Паста з томатами', daysAgo: 3 }, { title: 'Паста з томатами', daysAgo: 5 }] } },
  { name: 'горить + сезон', facts: { burning: [{ label: 'молоко', days: 1 }], seasons: [{ title: 'кавуни', startedThisWeek: false }], dishes: [] } },
  { name: 'горить + страви', facts: { burning: [{ label: 'помідори', days: -1 }, { label: 'фета', days: 2 }], seasons: [], dishes: [{ title: 'Паста з томатами й фетою', daysAgo: 3 }] } },
  { name: 'сезон + страви', facts: { burning: [], seasons: [{ title: 'гарбузи', startedThisWeek: true }], dishes: [{ title: 'Крем-суп із гарбуза', daysAgo: 2 }] } },
  { name: 'усе · спокійний дім', facts: { burning: [{ label: 'йогурт', days: 3 }], seasons: [{ title: 'яблука', startedThisWeek: false }], dishes: [{ title: 'Вівсянка з яблуками', daysAgo: 0 }, { title: 'Курка з рисом', daysAgo: 2 }] } },
  { name: 'усе · багато простроченого', facts: { burning: [{ label: 'сметана', days: -4 }, { label: 'шинка', days: -2 }, { label: 'салат', days: -1 }, { label: 'сир', days: 0 }], seasons: [{ title: 'кукурудза', startedThisWeek: true }], dishes: [{ title: 'Піца', daysAgo: 9 }] } },
  { name: 'усе · пʼять страв, шість позицій, шість сезонів', facts: { burning: [{ label: 'молоко', days: -1 }, { label: 'кефір', days: 0 }, { label: 'курка', days: 1 }, { label: 'риба', days: 1 }, { label: 'зелень', days: 2 }, { label: 'ягоди', days: 3 }], seasons: [{ title: 'кавуни', startedThisWeek: false }, { title: 'дині', startedThisWeek: false }, { title: 'сливи', startedThisWeek: true }, { title: 'виноград', startedThisWeek: true }, { title: 'кукурудза', startedThisWeek: false }, { title: 'перець', startedThisWeek: false }], dishes: [{ title: 'Салат із кавуном і фетою', daysAgo: 0 }, { title: 'Рибні котлети', daysAgo: 1 }, { title: 'Курка з овочами', daysAgo: 2 }, { title: 'Сирники', daysAgo: 4 }, { title: 'Борщ', daysAgo: 5 }] } },
  { name: 'усе · назви з великої і з лапками', facts: { burning: [{ label: 'Сир «Ферма» 45%', days: 1 }], seasons: [{ title: 'полуниця', startedThisWeek: true }], dishes: [{ title: 'Панкейки з полуницею', daysAgo: 1 }] } },
  { name: 'горить · назва довга з чека', facts: { burning: [{ label: 'Йогурт Активіа натуральний 3,5% 290 г', days: 0 }], seasons: [], dishes: [] } },
  { name: 'порожньо', facts: { burning: [], seasons: [], dishes: [] } },
];

async function main() {
  const key = apiKey();
  if (!key) { console.error('home-fact eval: нема OPENROUTER_API_KEY / ANTHROPIC_API_KEY у кореневому .env'); process.exit(1); }
  const prompt = loadPrompt();
  const system = compose('home_fact', prompt);
  const client = new Anthropic({ apiKey: key, baseURL: baseURL() });
  const rows: string[] = [];
  let input = 0, output = 0, cached = 0, cacheWrite = 0, calls = 0, bad = 0;
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const facts = serializeHomeFacts(c.facts);
    process.stdout.write(`${String(i + 1).padStart(2)}. ${c.name} … `);
    if (homeFactsEmpty(c.facts)) {
      rows.push(`### ${i + 1}. ${c.name}\n\nВхід: (усі три списки порожні)\n\n> — (модель не викликається, рядка нема)\n`);
      console.log('без виклику');
      continue;
    }
    const t0 = Date.now();
    const resp = await client.messages.create({
      model, max_tokens: 120,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: facts }],
    }, { timeout: 8_000, maxRetries: 0 });
    const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
    const u = resp.usage as Anthropic.Usage & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
    input += u.input_tokens; output += u.output_tokens; cached += u.cache_read_input_tokens ?? 0; cacheWrite += u.cache_creation_input_tokens ?? 0; calls++;
    const clean = cleanHomeFactText(raw);
    const verdict = clean ? `✓ ${clean.length} зн.` : `✗ відкинуто (${raw.length} зн. або не текст) → шаблон`;
    if (!clean) bad++;
    rows.push(`### ${i + 1}. ${c.name}\n\nВхід:\n\`\`\`\n${facts}\n\`\`\`\n\n> ${raw.replace(/\n/g, ' ')}\n\n${verdict} · ${Date.now() - t0} мс\n`);
    console.log(`${verdict}`);
  }
  const cost = (input * RATE.input + cached * RATE.cached + cacheWrite * RATE.input * RATE.cacheWrite + output * RATE.output) / 1_000_000;
  const head = [
    '# «Факт дому» від моделі — евал 13.09 (Р146)',
    '',
    `Промпт \`packages/prompts/versions/${prompt.version}/home-fact.md\` (виклик \`home_fact\`, fast), модель \`${model}\`, max_tokens 120, temperature типова.`,
    `20 знімків домів: лише горить / лише сезон / лише страви / усе / порожньо. Вхід — рівно те, що збирає сервер (\`serializeHomeFacts\`).`,
    `Правило виходу: промпт просить одне–два речення до 180 знаків, лише передані факти; сервер відкидає довше за 220 або з емодзі — тоді лишається шаблон.`,
    '',
    `Викликів: ${calls} · відкинуто: ${bad} · токени: вхід ${input}, кеш-читання ${cached}, кеш-запис ${cacheWrite}, вихід ${output} · вартість прогону ≈ $${cost.toFixed(4)}.`,
    '',
    '---',
    '',
  ];
  writeFileSync(OUT_PATH, head.join('\n') + rows.join('\n'));
  console.log(`\n→ ${OUT_PATH}\nвикликів ${calls} · відкинуто ${bad} · токени in ${input} / cached ${cached} / cache-write ${cacheWrite} / out ${output} · ≈ $${cost.toFixed(4)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
