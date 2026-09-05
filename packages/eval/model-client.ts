import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

import { compose, hashPromptText, type CallName, type LoadedPrompt } from '@kitchen/prompts';
import {
  buildKitchenContext, parseModelResponse, parseAttachmentResponse, maskHistoryQuantities,
  buildAliasMap, serializePantry, serializeProfile, serializeNotes, extractJson,
  serializeProfileText, serializeTraditionsV2, profileTextFromLegacy, profileNotesFromLegacy, emptyProfileText,
  PROFILE_FIELD_KEYS, buildVetoIndex, vetoCard, type ProfileText, type ProfileNote, type ProfileFieldKey, type VetoRow,
} from '@kitchen/domain';
import type { PantryBatch, Profile, ShoppingItemRow, MemoryNote, EaterRow, RecipeRow, RecentCookRunSummary, PendingCard } from '@kitchen/domain';
import type { Fixture } from './fixtures/index.js';
import type { ModelOutput } from './invariants.js';

// Той самий системний промпт, що у проді: composed-промпт + контекст кухні
// з @kitchen/domain. Фікстури описують стан спрощено (без household_id,
// added_at тощо) — добиваємо дефолтами, форма важлива, не значення.
// TOKEN_AUDIT п.1: та сама кеш-межа, що в проді (model.ts cachedSystem) —
// stable = складені правила, dynamic = контекст кухні. Розбіжність тут
// означала б, що eval міряє інший конвеєр, ніж працює насправді.
export const profileV2Enabled = () => process.env.PROFILE_V2 === '1';

export function vetoIndexOfText(p: ProfileText): VetoRow[] {
  const f = p.fields;
  return [
    ...(f.no.status === 'filled' ? buildVetoIndex('u1', 'no', f.no.text) : []),
    ...(f.ban.status === 'filled' ? buildVetoIndex('u1', 'ban', f.ban.text) : []),
  ];
}

// Крок 4б (b): прод перегенеровує пропозицію, коли вето зняло всі кандидати,
// одним повторним викликом із «[СЕРВЕР] … без …». Eval робить те саме, щоб
// фікстури не падали на тому, що прод робить правильно. Рядок — той самий
// (withAvoid у services/api/src/model.ts), продубльований тут дослівно:
// eval не імпортує api.
const AVOID_LINE = (avoid: string[]) =>
  `[СЕРВЕР] Попередню пропозицію знято — там було те, чого людина не їсть: ${avoid.join(', ')}. Запропонуй інше, без цього.`;

/** Фікстура: { no: "мʼяса й птиці", ban: "none", … } → ProfileText. */
export function profileTextFromFixture(spec: Record<string, string>): ProfileText {
  const p = emptyProfileText('u1');
  for (const k of PROFILE_FIELD_KEYS as readonly ProfileFieldKey[]) {
    const v = spec[k];
    if (v === undefined) continue;
    p.fields[k] = v === 'none'
      ? { text: '', status: 'none', updated_at: null }
      : { text: v, status: 'filled', updated_at: null };
  }
  return p;
}

function legacyProfileOf(fx: Fixture): Profile | null {
  const p = fx.profile as Partial<Profile> | undefined;
  return p ? { user_id: 'u1', allergies: p.allergies ?? [], wishes: p.wishes ?? [], antipatterns: p.antipatterns ?? [], equipment: p.equipment ?? {}, traditions: p.traditions ?? null } : null;
}

export function composeWithContext(call: CallName, prompt: LoadedPrompt, fx: Fixture): { stable: string; dynamic?: string } {
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
        traditions: p.traditions ?? null,
      }
    : null;
  // Раунд 4: PROFILE_V2=1 — той самий прапор, що в проді. Фікстура з
  // `profile_text` описує сім речень напряму; стара `profile` конвертується
  // TS-двійником міграції 0023, `notes` — у нотатки (lesson як є, intent →
  // «хотів: …»). Так один набір фікстур ганяється під обома прапорами.
  const v2 = profileV2Enabled();
  const profileText: ProfileText | undefined = v2
    ? (fx.profile_text ? profileTextFromFixture(fx.profile_text) : profileTextFromLegacy(profile))
    : undefined;
  const profileNotes: ProfileNote[] | undefined = v2
    ? (fx.profile_notes
        ? (fx.profile_notes as ProfileNote[])
        : profileNotesFromLegacy((fx.notes ?? []) as MemoryNote[]))
    : undefined;
  // Крок 4б: індекс — з no/ban (той самий витяг, що PATCH у проді) → ⚠ у [КОМОРА].
  const vetoIndex: VetoRow[] | undefined = profileText ? vetoIndexOfText(profileText) : undefined;

  // recipe_gen дзеркалить прод callRecipe: профіль + [КОМОРА] з АЛІАСАМИ
  // p1..pN + [ВИСНОВКИ З ГОТУВАННЯ]. Не buildKitchenContext — у проді
  // генерація рецепта не бачить список покупок, журнал і домашніх.
  if (call === 'recipe_gen') {
    const alias = buildAliasMap(pantry);
    const nowMs = fx.now ? new Date(fx.now).getTime() : Date.now();
    const dynamic = (profileText ? serializeProfileText(profileText, profileNotes ?? []) + serializeTraditionsV2(profile) : serializeProfile(profile))
      + '\n\n[КОМОРА]\n' + serializePantry(pantry, profile, nowMs, [], false, alias.toAlias, 120, [], fx.request ?? '', vetoIndex)
      + (profileText ? '' : serializeNotes((fx.notes ?? []) as MemoryNote[]));
    return { stable: base, dynamic };
  }

  // Дата фіксується фікстурою, інакше календарний блок жив би рівно добу
  // й «сезон грибів» ламав би прогін у грудні.
  const dynamic = buildKitchenContext({
    pantry,
    profile,
    profileText,
    profileNotes,
    vetoIndex,
    shopping: (fx.shopping ?? []) as ShoppingItemRow[],
    notes: (fx.notes ?? []) as MemoryNote[],
    queryText: (fx.conversation ?? []).filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join('\n'),
    eaters: (fx.eaters ?? []) as EaterRow[],
    recentRecipes: (fx.recentRecipes ?? []) as RecipeRow[],
    // UX9-28: [ОСТАННІ ГОТУВАННЯ] в eval раніше не було взагалі — фікстури
    // на памʼять готувань не могли існувати.
    recentCookRuns: (fx.recentCookRuns ?? []) as RecentCookRunSummary[],
    now: fx.now ? new Date(fx.now) : undefined,
    // №4: ситуація («кошик відкритий», «рецепт свіжий»). У проді її рахує
    // маршрут із повідомлень сесії; фікстура описує напряму, бо історія в
    // eval подається текстом, а не рядками message.
    modes: fx.modes as never,
    // Плани дому: без них неможливо перевірити правку події по id — модель
    // просто не побачить, що правити.
    events: (fx.events ?? []) as never,
    // Аудит раунд 3, крок 5: [ОСТАННІ ДІЇ] — картки дому, закриті поза цією
    // розмовою. У проді рахує repo.listRecentResolved; фікстура описує
    // напряму, як і events/modes вище.
    recentActions: (fx.recentActions ?? []) as PendingCard[],
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
    // Пул-3, pantry-truth: як у проді — кількості запасів у ІСТОРИЧНИХ ходах
    // маскуються; поточна (остання) репліка йде як є.
    const conv = fx.conversation ?? [];
    return conv.map((m, i): Anthropic.MessageParam => ({
      role: m.role,
      content: i === conv.length - 1 ? m.content : maskHistoryQuantities(m.content),
    }));
  }

  if (fx.call === 'recipe_gen') {
    // Дослівно як у проді (callRecipe): user = title (+ хвіст розмови, як
    // пул-4 №4б, + context одним рядком).
    const conv = (fx.conversation ?? [])
      .map((m) => `${m.role === 'user' ? 'людина' : 'кухар'}: ${m.content}`)
      .join('\n');
    const convBlock = conv ? `\n\n[ОСТАННІ РЕПЛІКИ РОЗМОВИ — рішення з них уже ухвалені, не перепитуй]\n${conv}` : '';
    return [{ role: 'user', content: `${fx.request ?? ''}${convBlock}` }];
  }

  if (fx.call === 'attachment_parse') {
    const parts: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [];
    if (fx.attachment?.kind === 'text' && fx.attachment.content) {
      parts.push({ type: 'text', text: fx.attachment.content });
    }
    // Зображення — дослівно як у проді (callAttachmentParse, model.ts): base64
    // із media_type за розширенням. Доти тут стояв TODO, і це означало, що
    // фотошлях не перевірявся ЖОДНОЮ фікстурою. Живий провал 02.09 саме там:
    // той самий чек текстом розібрався добре, а фотографією дав «хусь»
    // замість хустинок і «батер» замість багета.
    if (fx.attachment?.kind === 'image') {
      const file = join(HERE_FIXTURES, fx.attachment.path);
      const ext = fx.attachment.path.toLowerCase();
      const media_type = ext.endsWith('.png') ? 'image/png'
        : ext.endsWith('.webp') ? 'image/webp'
        : ext.endsWith('.gif') ? 'image/gif'
        : 'image/jpeg';
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type, data: readFileSync(file).toString('base64') },
      });
    }
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
  // Крок 4б (b): чи був повторний виклик після порожнього вето; сира перша відповідь.
  retried?: boolean;
  firstRaw?: string;
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
    let text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    // Той самий парсер, що у проді — і саме той, що відповідає виклику.
    // Чат віддає {reply, card}, вкладення — {kind, note, ops}. Поки eval гнав
    // обидва через чатовий парсер, фікстури на чеки не могли позеленіти
    // в принципі: він шукав card, не знаходив, і клав уламок JSON у reply.
    // recipe_gen віддає голий JSON рецепта — загортаємо в card {type:'recipe'},
    // щоб інваріанти читали його тим самим шляхом, що продиктований рецепт.
    let { reply, card } = call === 'attachment_parse'
      ? parseAttachmentResponse(text)
      : call === 'recipe_gen'
        ? (() => {
            const { parsed } = extractJson(text);
            const ok = parsed && typeof parsed === 'object' && 't' in parsed && 'ing' in parsed;
            return { reply: '', card: ok ? { type: 'recipe' as const, recipe: parsed } : null };
          })()
        : parseModelResponse(text);
    let retried = false;
    let firstRaw = text;
    if (call === 'chat' && profileV2Enabled() && card?.type === 'proposal') {
      const probe = { card: JSON.parse(JSON.stringify(card)) as typeof card, reply };
      const index = vetoIndexOfText(fx.profile_text ? profileTextFromFixture(fx.profile_text) : profileTextFromLegacy(legacyProfileOf(fx)));
      const lastUser = [...(fx.conversation ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
      const r = vetoCard(probe, index, lastUser);
      if (r.emptied) {
        retried = true;
        const avoid = [...new Set(r.rejected.map((x) => x.title))];
        const conv = fixtureAsUserTurn(fx);
        const last = conv[conv.length - 1]!;
        conv[conv.length - 1] = { ...last, content: `${last.content}\n\n${AVOID_LINE(avoid)}` };
        const resp2 = await client.messages.create({
          model, max_tokens: 4096, temperature: spec.temperature ?? 1,
          system: cachedSystem(system.stable, system.dynamic), messages: conv,
        });
        const text2 = resp2.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
        ({ reply, card } = parseModelResponse(text2));
        firstRaw = text;
        text = text2;
      }
    }

    return {
      raw: text,
      reply,
      card,
      promptVersion: prompt.version,
      promptHash: hashPromptText(system.stable),
      dynamic: system.dynamic,
      retried,
      firstRaw: retried ? firstRaw : undefined,
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
