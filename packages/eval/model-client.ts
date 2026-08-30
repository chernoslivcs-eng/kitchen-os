import Anthropic from '@anthropic-ai/sdk';
import { compose, type CallName, type LoadedPrompt } from '@kitchen/prompts';
import { buildKitchenContext, parseModelResponse, parseAttachmentResponse } from '@kitchen/domain';
import type { PantryBatch, Profile, ShoppingItemRow, MemoryNote } from '@kitchen/domain';
import type { Fixture } from './fixtures/index.js';
import type { ModelOutput } from './invariants.js';

// Той самий системний промпт, що у проді: composed-промпт + контекст кухні
// з @kitchen/domain. Фікстури описують стан спрощено (без household_id,
// added_at тощо) — добиваємо дефолтами, форма важлива, не значення.
function composeWithContext(call: CallName, prompt: LoadedPrompt, fx: Fixture): string {
  const base = compose(call, prompt, { stage: fx.stage });
  if (call !== 'chat' && call !== 'recipe_gen') return base;

  const pantry = ((fx.pantry ?? []) as Partial<PantryBatch>[]).map((b, i) => ({
    id: b.id ?? `p${i}`,
    household_id: 'h1',
    catalog_key: b.catalog_key ?? null,
    label: b.label ?? '',
    zone: b.zone ?? 'dry',
    // фікстури пишуть v/u, домен чекає value/unit
    value: b.value ?? (b as { v?: number }).v ?? null,
    unit: b.unit ?? ((b as { u?: string }).u as PantryBatch['unit']) ?? null,
    state: b.state ?? 'sealed',
    opened_at: b.opened_at ?? null,
    expires_at: b.expires_at ?? null,
    best_before_opened_days: null,
    added_at: new Date().toISOString(),
    depleted_at: null,
    confidence: 1,
    provenance: 'user_statement',
    staple: false,
    last_by: null,
    last_action: null,
  } as PantryBatch));

  const p = fx.profile as Partial<Profile> | undefined;
  const profile: Profile | null = p
    ? {
        user_id: 'u1',
        allergies: p.allergies ?? [],
        wishes: p.wishes ?? [],
        antipatterns: p.antipatterns ?? [],
        equipment: p.equipment ?? {},
      }
    : null;

  // Дата фіксується фікстурою, інакше календарний блок жив би рівно добу
  // й «сезон грибів» ламав би прогін у грудні.
  return base + buildKitchenContext({
    pantry,
    profile,
    shopping: (fx.shopping ?? []) as ShoppingItemRow[],
    notes: (fx.notes ?? []) as MemoryNote[],
    now: fx.now ? new Date(fx.now) : undefined,
  });
}

// Провайдер той самий, що в проді: OpenRouter, якщо є його ключ (українські
// картки Anthropic не приймає), інакше прямий Anthropic. Без цього eval
// скіпав усі фікстури — перевіряв ANTHROPIC_API_KEY, якого в нас немає.
const isOpenRouter = () => !!process.env.OPENROUTER_API_KEY;
const apiKey = () => process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const baseURL = () => (isOpenRouter() ? 'https://openrouter.ai/api' : undefined);

// Дефолти дзеркалять services/api/src/model.ts. Профіль виклику бере з
// маніфесту — там єдине джерело, щоб eval і прод не розійшлись.
const PROFILES = () => ({
  fast: process.env.MODEL_FAST
    ?? (isOpenRouter() ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5-20251001'),
  smart: process.env.MODEL_SMART
    ?? (isOpenRouter() ? 'anthropic/claude-sonnet-4.5' : 'claude-sonnet-5'),
});

function fixtureAsUserTurn(fx: Fixture): Anthropic.MessageParam[] {
  if (fx.call === 'chat') {
    // Стан НЕ підклеюється сюди — він іде в системний промпт через
    // buildKitchenContext(), рівно як у проді (див. composeWithContext).
    // Раніше eval клав комору як JSON у user-turn і через це перевіряв інший
    // промпт, ніж працює насправді: зелений eval нічого не означав.
    return (fx.conversation ?? []).map((m): Anthropic.MessageParam => ({
      role: m.role,
      content: m.content,
    }));
  }

  if (fx.call === 'attachment_parse') {
    const parts: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [];
    if (fx.attachment?.kind === 'text' && fx.attachment.content) {
      parts.push({ type: 'text', text: fx.attachment.content });
    }
    // TODO: image branch — load .jpg, base64, push ImageBlockParam. Не тепер.
    // Дослівно як у проді (callAttachmentParse): хвостова фраза частина промпту.
    parts.push({
      type: 'text',
      text: 'Розбери за схемою й поверни JSON. Користувач бачив вкладення на власні очі — його слово важливіше.',
    });
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
  const model = PROFILES()[prompt.manifest.calls[call].profile];
  const system = composeWithContext(call, prompt, fx);

  const key = apiKey();
  if (!key) {
    return {
      raw: '',
      promptVersion: prompt.version,
      model,
      call,
      latencyMs: 0,
      error: 'SKIPPED (no OPENROUTER_API_KEY / ANTHROPIC_API_KEY)',
    };
  }

  const client = new Anthropic({ apiKey: key, baseURL: baseURL() });
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
    // Той самий парсер, що у проді — і саме той, що відповідає виклику.
    // Чат віддає {reply, card}, вкладення — {kind, note, ops}. Поки eval гнав
    // обидва через чатовий парсер, фікстури на чеки не могли позеленіти
    // в принципі: він шукав card, не знаходив, і клав уламок JSON у reply.
    const { reply, card } = call === 'attachment_parse'
      ? parseAttachmentResponse(text)
      : parseModelResponse(text);

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
