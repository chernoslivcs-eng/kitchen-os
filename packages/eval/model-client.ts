import Anthropic from '@anthropic-ai/sdk';
import { compose, hashPromptText, type CallName, type LoadedPrompt } from '@kitchen/prompts';
import {
  buildKitchenContext, parseModelResponse, parseAttachmentResponse,
  buildAliasMap, serializePantry, serializeProfile, serializeNotes, extractJson,
} from '@kitchen/domain';
import type { PantryBatch, Profile, ShoppingItemRow, MemoryNote, EaterRow, RecipeRow, RecentCookRunSummary } from '@kitchen/domain';
import type { Fixture } from './fixtures/index.js';
import type { ModelOutput } from './invariants.js';

// Той самий системний промпт, що у проді: composed-промпт + контекст кухні
// з @kitchen/domain. Фікстури описують стан спрощено (без household_id,
// added_at тощо) — добиваємо дефолтами, форма важлива, не значення.
// TOKEN_AUDIT п.1: та сама кеш-межа, що в проді (model.ts cachedSystem) —
// stable = складені правила, dynamic = контекст кухні. Розбіжність тут
// означала б, що eval міряє інший конвеєр, ніж працює насправді.
function composeWithContext(call: CallName, prompt: LoadedPrompt, fx: Fixture): { stable: string; dynamic?: string } {
  const base = compose(call, prompt, { stage: fx.stage });
  if (call !== 'chat' && call !== 'recipe_gen') return { stable: base };

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
    // Пул-2 №9: фікстури залежаного задають added_at — «дод.Nдн» у серіалізації.
    added_at: b.added_at ?? new Date().toISOString(),
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

  // recipe_gen дзеркалить прод callRecipe: профіль + [КОМОРА] з АЛІАСАМИ
  // p1..pN + [ВИСНОВКИ З ГОТУВАННЯ]. Не buildKitchenContext — у проді
  // генерація рецепта не бачить список покупок, журнал і домашніх.
  if (call === 'recipe_gen') {
    const alias = buildAliasMap(pantry);
    const nowMs = fx.now ? new Date(fx.now).getTime() : Date.now();
    const dynamic = serializeProfile(profile)
      + '\n\n[КОМОРА]\n' + serializePantry(pantry, profile, nowMs, [], false, alias.toAlias)
      + serializeNotes((fx.notes ?? []) as MemoryNote[]);
    return { stable: base, dynamic };
  }

  // Дата фіксується фікстурою, інакше календарний блок жив би рівно добу
  // й «сезон грибів» ламав би прогін у грудні.
  const dynamic = buildKitchenContext({
    pantry,
    profile,
    shopping: (fx.shopping ?? []) as ShoppingItemRow[],
    notes: (fx.notes ?? []) as MemoryNote[],
    eaters: (fx.eaters ?? []) as EaterRow[],
    recentRecipes: (fx.recentRecipes ?? []) as RecipeRow[],
    // UX9-28: [ОСТАННІ ГОТУВАННЯ] в eval раніше не було взагалі — фікстури
    // на памʼять готувань не могли існувати.
    recentCookRuns: (fx.recentCookRuns ?? []) as RecentCookRunSummary[],
    now: fx.now ? new Date(fx.now) : undefined,
  });
  return { stable: base, dynamic };
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

  if (fx.call === 'recipe_gen') {
    // Дослівно як у проді (callRecipe): user = title (+context одним рядком).
    return [{ role: 'user', content: fx.request ?? '' }];
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
  // A3: слід тексту стабільного префікса — знахідки привʼязуються до редакції.
  promptHash?: string;
  model: string;
  call: CallName;
  usage?: { input: number; output: number; cached?: number; cache_write?: number };
  latencyMs: number;
  error?: string;
}

// Дзеркало прод-хелпера cachedSystem (model.ts): stable з cache_control,
// динаміка окремим блоком без нього.
function cachedSystem(stable: string, dynamic?: string): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
  ];
  if (dynamic) blocks.push({ type: 'text', text: dynamic });
  return blocks;
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
      system: cachedSystem(system.stable, system.dynamic),
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
    // recipe_gen віддає голий JSON рецепта — загортаємо в card {type:'recipe'},
    // щоб інваріанти читали його тим самим шляхом, що продиктований рецепт.
    const { reply, card } = call === 'attachment_parse'
      ? parseAttachmentResponse(text)
      : call === 'recipe_gen'
        ? (() => {
            const { parsed } = extractJson(text);
            const ok = parsed && typeof parsed === 'object' && 't' in parsed && 'ing' in parsed;
            return { reply: '', card: ok ? { type: 'recipe' as const, recipe: parsed } : null };
          })()
        : parseModelResponse(text);

    return {
      raw: text,
      reply,
      card,
      promptVersion: prompt.version,
      promptHash: hashPromptText(system.stable),
      model,
      call,
      usage: (() => {
        const u = resp.usage as typeof resp.usage & {
          cache_read_input_tokens?: number | null;
          cache_creation_input_tokens?: number | null;
        };
        return {
          input: u.input_tokens,
          output: u.output_tokens,
          cached: u.cache_read_input_tokens ?? 0,
          cache_write: u.cache_creation_input_tokens ?? 0,
        };
      })(),
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
