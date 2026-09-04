// Тимчасовий скрипт: ізольований тест voice.md — system = ЛИШЕ вміст voice.md
// (у dialog-форматі — без блоку ЗРАЗКИ), без card-contract/routing/policy,
// без buildKitchenContext. Мета — почути голос сам по собі. Звичайний текст
// у відповіді, не JSON. Видалити після використання, не комітити.
import '../env.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VOICE_PATH = join(HERE, '../../prompts/versions/2026-08-28/voice.md');
const OUT_PATH = join(HERE, '../../prompts/VOICE-SOLO.md');

const apiKey = () => process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const baseURL = () => (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api' : undefined);

const MODELS = ['anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-5', 'openai/gpt-5.4'] as const;
const FORMATS = ['prose', 'dialog'] as const;
type Model = (typeof MODELS)[number];
type Format = (typeof FORMATS)[number];

const TEST_TURNS: string[] = [
  'Купив сметану, огірки і кріп, там десь пучок',
  'Ось фото чека',
  'Що на вечерю?\nВдома: курка, рис, шпинат відкритий третій день',
  'Що на вечерю?\nВдома: яйце, пів цибулини, кетчуп',
  'Вчорашній суп вийшов якийсь плаский, ні про що',
  'Дай рецепт салату з кунжутом\nПрофіль: алергія на кунжут',
  'Понеділок, а я вже втомився',
  'Розкажи щось смішне',
  'А чому рис для різото не можна промивати?',
  'Що на вечерю?\nУ календарі: завтра день народження дружини',
  'Дякую, вчора все зʼїли за пʼять хвилин',
  'Купив каву',
];

// Природна репліка людини з рядка «Ситуація» — дослівна цитата, де ситуація
// її наводить, або перефраз у стилі тестових реплік (Що на вечерю?\nВдома: …),
// де ситуація лише описує стан.
const EXAMPLE_USER_LINES: Record<string, string> = {
  'людина написала «купив молоко, яйця і фету, там десь пачка», картка записала.':
    'купив молоко, яйця і фету, там десь пачка',
  'людина скинула фото чека на двадцять покупок.':
    'Скинув фото чека, там покупок на двадцять позицій',
  '«що на вечерю?», а вдома вершки, відкриті третій день.':
    'Що на вечерю?\nВдома: вершки, відкриті третій день',
  '«що на вечерю?», а вдома майже нічого.':
    'Що на вечерю?\nВдома: майже нічого',
  'людина каже, що вчорашня паста вийшла пересолена.':
    'Вчорашня паста вийшла пересолена',
  'людина просить рецепт із горіхами, а в неї позначка «алергія на горіхи». Рецепт даємо, алерген — першою фразою, без усмішки.':
    'Дай рецепт з горіхами\nПрофіль: алергія на горіхи',
  '«слухай, дощ цілий день, настрою нема» — не про їжу.':
    'Слухай, дощ цілий день, настрою нема',
  '«розкажи анекдот» — не про їжу, коротка людська відмова.':
    'Розкажи анекдот',
  'людина питає «а чому вершки 33%, а не 20%?» — розмова про ремесло, тут можна довше.':
    'А чому вершки 33%, а не 20%?',
  'людина питає «що на вечерю?», а в календарі сьогодні ввечері гості.':
    'Що на вечерю?\nУ календарі: сьогодні ввечері гості',
  'людина каже «дякую, було смачно».':
    'Дякую, було смачно',
};

interface ExamplePair { situation: string; user: string; assistant: string }

function loadVoice(): { prose: string; dialogSystem: string; examples: ExamplePair[] } {
  const raw = readFileSync(VOICE_PATH, 'utf8');
  const startMarker = '\nЗРАЗКИ.';
  const endMarker = '\nУКРАЇНСЬКА:';
  const startIdx = raw.indexOf(startMarker);
  const endIdx = raw.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('voice.md: блок ЗРАЗКИ або УКРАЇНСЬКА не знайдено — файл змінив структуру');
  }
  const block = raw.slice(startIdx, endIdx);
  const pairRe = /Ситуація: (.+)\n(.+)/g;
  const examples: ExamplePair[] = [];
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(block))) {
    const situation = m[1]!.trim();
    const assistant = m[2]!.trim();
    const user = EXAMPLE_USER_LINES[situation];
    if (!user) throw new Error(`Немає заготовленої user-репліки для ситуації: ${situation}`);
    examples.push({ situation, user, assistant });
  }
  if (examples.length !== 11) throw new Error(`Очікував 11 зразків, знайшов ${examples.length}`);

  const dialogSystem = raw.slice(0, startIdx).trimEnd() + '\n\n' + raw.slice(endIdx + 1).trimStart();
  return { prose: raw, dialogSystem, examples };
}

function buildMessages(format: Format, examples: ExamplePair[], turn: string): Anthropic.MessageParam[] {
  if (format === 'prose') return [{ role: 'user', content: turn }];
  const history: Anthropic.MessageParam[] = examples.flatMap((e) => [
    { role: 'user' as const, content: e.user },
    { role: 'assistant' as const, content: e.assistant },
  ]);
  return [...history, { role: 'user', content: turn }];
}

async function runOne(client: Anthropic, model: string, temp: number, system: string, messages: Anthropic.MessageParam[]): Promise<string> {
  const resp = await client.messages.create({ model, max_tokens: 1024, temperature: temp, system, messages });
  return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  return {
    model: get('--model') as Model | undefined,
    format: get('--format') as Format | undefined,
    temp: get('--temp') ? Number(get('--temp')) : 0.7,
    matrix: args.includes('--matrix'),
  };
}

async function main() {
  const key = apiKey();
  if (!key) { console.error('SKIPPED: no OPENROUTER_API_KEY / ANTHROPIC_API_KEY'); process.exit(1); }
  const client = new Anthropic({ apiKey: key, baseURL: baseURL() });
  const { prose, dialogSystem, examples } = loadVoice();
  const opts = parseArgs();

  const combos: { model: Model; format: Format }[] = opts.matrix
    ? MODELS.flatMap((model) => FORMATS.map((format) => ({ model, format })))
    : [{ model: (opts.model ?? MODELS[0]), format: (opts.format ?? 'prose') }];

  let md = '';
  for (const { model, format } of combos) {
    const system = format === 'prose' ? prose : dialogSystem;
    const header = `## ${model} — ${format}`;
    console.error(header);
    let section = `${header}\n\n`;
    for (let i = 0; i < TEST_TURNS.length; i++) {
      const turn = TEST_TURNS[i]!;
      const messages = buildMessages(format, examples, turn);
      const text = await runOne(client, model, opts.temp, system, messages);
      console.log(`=== ${model} / ${format} / ${i + 1}. ${turn.replace(/\n/g, ' | ')} ===`);
      console.log(text);
      console.log(`LENGTH ${text.length}`);
      section += `**${i + 1}. ${turn.replace(/\n/g, ' | ')}** (${text.length})\n> ${text.replace(/\n/g, '\n> ')}\n\n`;
    }
    md += section;
  }

  if (opts.matrix) {
    writeFileSync(OUT_PATH, `# VOICE-SOLO.md — ізольований тест голосу, матриця\n\nsystem = лише voice.md (prose: увесь файл; dialog: без блоку ЗРАЗКИ, 11 зразків подані як user/assistant-пари перед тестовою реплікою). temperature ${opts.temp}. Без оцінок.\n\n${md}`);
    console.error(`written: ${OUT_PATH}`);
  }
}

main();
