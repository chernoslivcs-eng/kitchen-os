import Anthropic from '@anthropic-ai/sdk';
import { compose, type CallName, type LoadedPrompt } from '@kitchen/prompts';
import type { Fixture } from './fixtures/index.js';
import type { ModelOutput } from './invariants.js';

// Модельні профілі: fast для парсингу/пошуку, smart для судження.
// Тільки одна дефолтна прив'язка тут — щоб її було легко замінити з .env.
const PROFILES = {
  fast: process.env.MODEL_FAST ?? 'claude-haiku-4-5-20251001',
  smart: process.env.MODEL_SMART ?? 'claude-sonnet-5',
} as const;

const CALL_TO_PROFILE = (call: CallName): 'fast' | 'smart' => {
  switch (call) {
    case 'chat':
    case 'attachment_parse':
    case 'pantry_search':
      return 'fast';
    case 'recipe_gen':
    case 'recipe_import':
      return 'smart';
  }
};

// Дуже дешеве лагодження: якщо модель повернула текст із JSON, витягуємо перший об'єкт.
// Прототип має repairJSON, який дорізає обірваний. Для eval — не критично: інваріант просто впаде.
function tryParse(text: string): any | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}$|\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function fixtureAsUserTurn(fx: Fixture): Anthropic.MessageParam[] {
  if (fx.call === 'chat') {
    // Комора, профіль і адресати підклеюються тут же — вони частина промпту в проді,
    // але для eval лишаємо простий тред, а стан кладемо як префікс до першого user-повідомлення.
    const stateBlock = [
      fx.pantry ? `[КОМОРА]\n${JSON.stringify(fx.pantry, null, 0)}` : '',
      fx.profile ? `[ПРОФІЛЬ]\n${JSON.stringify(fx.profile, null, 0)}` : '',
      fx.audience ? `[АДРЕСАТИ]\n${JSON.stringify(fx.audience, null, 0)}` : '',
    ].filter(Boolean).join('\n\n');

    const turns = (fx.conversation ?? []).map((m, i): Anthropic.MessageParam => ({
      role: m.role,
      content: i === 0 && stateBlock ? `${stateBlock}\n\n${m.content}` : m.content,
    }));
    return turns;
  }

  if (fx.call === 'attachment_parse' || fx.call === 'recipe_import') {
    const parts: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [];
    if (fx.attachment?.kind === 'text' && fx.attachment.content) {
      parts.push({ type: 'text', text: fx.attachment.content });
    }
    // TODO: image branch — load .jpg, base64, push ImageBlockParam. Не тепер.
    parts.push({ type: 'text', text: 'Розбери за схемою й поверни JSON.' });
    return [{ role: 'user', content: parts }];
  }

  throw new Error(`Unhandled fixture kind: ${fx.call}`);
}

export interface RunResult extends ModelOutput {
  promptVersion: string;
  model: string;
  call: CallName;
  usage?: { input: number; output: number };
  latencyMs: number;
  error?: string;
}

export async function runOne(fx: Fixture, prompt: LoadedPrompt): Promise<RunResult> {
  const started = Date.now();
  const call = fx.call as CallName;
  const profile = CALL_TO_PROFILE(call);
  const model = PROFILES[profile];
  const system = compose(call, prompt);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      raw: '',
      promptVersion: prompt.version,
      model,
      call,
      latencyMs: 0,
      error: 'SKIPPED (no ANTHROPIC_API_KEY)',
    };
  }

  const client = new Anthropic({ apiKey });
  const spec = prompt.manifest.calls[call];

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: spec.temperature ?? (call === 'attachment_parse' ? 0 : 1),
      system,
      messages: fixtureAsUserTurn(fx),
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const parsed = tryParse(text);

    // Схема реального прототипу: reply — це текст перед/поза JSON, card — сам JSON.
    // Для eval нам потрібне і те, і те, тому спробуємо розділити.
    let reply: string | undefined;
    let card: any = parsed;
    if (parsed && typeof parsed === 'object' && 'reply' in parsed && 'card' in parsed) {
      reply = parsed.reply;
      card = parsed.card;
    } else if (!parsed) {
      reply = text;
    }

    return {
      raw: text,
      reply,
      card,
      promptVersion: prompt.version,
      model,
      call,
      usage: {
        input: resp.usage.input_tokens,
        output: resp.usage.output_tokens,
      },
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      raw: '',
      promptVersion: prompt.version,
      model,
      call,
      latencyMs: Date.now() - started,
      error: String((err as Error).message ?? err),
    };
  }
}
