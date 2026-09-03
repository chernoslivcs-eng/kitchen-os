// Один канал виклику моделі для проду. Логує версію промпту й usage.
// Без ключа повертає стаб-картку — тести й локальний дев не потребують мережі.

import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, compose, hashPromptText, type CallName, type LoadedPrompt } from '@kitchen/prompts';
import { INTAKE_TOO_BIG_REPLY } from './reply-guard.js';
import {
  buildKitchenContext,
  type KitchenMode,
  type HouseholdEventRow,
  extractJson,
  parseAttachmentResponse,
  serializePantry as ctxSerializePantry,
  serializeProfile as ctxSerializeProfile,
  serializeNotes as ctxSerializeNotes,
  buildAliasMap,
  unaliasRecipeIds,
  unaliasProse,
  type RecentCookRunSummary,
} from '@kitchen/domain';
import type {
  Card, PantryBatch, Profile, ShoppingItemRow, MemoryNote, EaterRow, RecipeRow,
  Recipe, RecipeIng, RecipeStep, HouseholdProduct,
} from '@kitchen/domain';
// Recipe/RecipeIng/RecipeStep переїхали в домен: вони потрібні картці рецепта,
// а картки живуть там. Реекспорт — щоб решта services/api не переписувалась.
export type { Recipe, RecipeIng, RecipeStep } from '@kitchen/domain';

// Живий репро 01.09: модель повернула {"type":"shopping","ops":[...]}
// замість items — shopping.items і intake_diff/profile.ops мають майже
// однакову форму елемента ({op,label,...}), тож плутанина природна.
// Ненормалізована картка доходила до summarizeCard/applyCard і кидала
// TypeError на .map() у НАСТУПНОМУ ході (де читається історія) —
// одна погана відповідь моделі блокувала розмову назавжди.
// Перекладаємо в правильне поле замість вигадування даних; якщо рятувати
// нічим (жодного масиву під жодною назвою) — повертаємо як є, це вже
// справа summarizeCard/applyCard деградувати чемно (`?? []`), не тут.
const ITEMS_TYPES = new Set(['shopping']);
const OPS_TYPES = new Set(['intake_diff', 'profile']);
export function normalizeCard(raw: unknown): Card | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== 'string') return null;
  if (ITEMS_TYPES.has(o.type) && !Array.isArray(o.items) && Array.isArray(o.ops)) {
    const { ops, ...rest } = o;
    return { ...rest, items: ops } as unknown as Card;
  }
  if (OPS_TYPES.has(o.type) && !Array.isArray(o.ops) && Array.isArray(o.items)) {
    const { items, ...rest } = o;
    return { ...rest, ops: items } as unknown as Card;
  }
  return o as unknown as Card;
}

// TOKEN_AUDIT п.1: системний промпт (10-15k символів стабільного тексту) їхав
// повним інпутом з КОЖНИМ викликом. cache_control на стабільному префіксі
// (правила з packages/prompts) ріже його ціну до ~10% на кеш-хітах; динаміка
// (комора, профіль, висновки) — окремим блоком БЕЗ кешу, інакше кожен запит
// плодив би новий кеш-запис.
export function cachedSystem(stable: string, dynamic?: string): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
  ];
  if (dynamic) blocks.push({ type: 'text', text: dynamic });
  return blocks;
}

// Cache-поля відповіді: прямий Anthropic їх віддає завжди; чи прокидає їх
// OpenRouter — перевіряється живим викликом (обидва 0 = не прокидає, фіксуємо
// як знахідку, не підганяємо).
export function usageFrom(u: Anthropic.Usage): { input: number; output: number; cached: number; cache_write: number } {
  const ext = u as Anthropic.Usage & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cached: ext.cache_read_input_tokens ?? 0,
    cache_write: ext.cache_creation_input_tokens ?? 0,
  };
}

// Один провайдер моделі — або прямий Anthropic, або OpenRouter (той самий формат
// повідомлень, лише інший baseURL і префіксовані model-id). Обирає autonomly:
//   OPENROUTER_API_KEY у env → OpenRouter (baseURL, префікс anthropic/)
//   ANTHROPIC_API_KEY у env → прямий Anthropic
//   ні того, ні того → stub-режим (див. нижче)
//
// Модель ID: якщо в .env задано MODEL_FAST/MODEL_SMART — беремо як є (юзер знає, що робить).
// Інакше — дефолт під провайдера.

function isOpenRouter(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}
function apiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
}
function baseURL(): string | undefined {
  // OpenRouter має Anthropic-сумісний ендпоінт /api/v1/messages. Anthropic SDK сам
  // додає /v1/messages до baseURL, тож baseURL має бути /api без /v1.
  return isOpenRouter() ? 'https://openrouter.ai/api' : undefined;
}
// Слаги OpenRouter застарівають без попередження — актуальні звіряти на
// GET https://openrouter.ai/api/v1/models. Перекривається MODEL_FAST/MODEL_SMART.
function modelFor(profile: 'fast' | 'smart'): string {
  if (profile === 'fast') {
    return process.env.MODEL_FAST
      ?? (isOpenRouter() ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5-20251001');
  }
  return process.env.MODEL_SMART
    ?? (isOpenRouter() ? 'anthropic/claude-sonnet-4.5' : 'claude-sonnet-5');
}

// Яка модель обслуговує виклик — вирішує маніфест, не код. Доки мапінг жив у
// двох місцях, вони розійшлись (QA5-12).
function modelForCall(call: CallName, prompt: LoadedPrompt): string {
  return modelFor(prompt.manifest.calls[call].profile);
}
function makeClient(): Anthropic | null {
  const key = apiKey();
  if (!key) return null;
  return new Anthropic({ apiKey: key, baseURL: baseURL() });
}

// Тимчасові помилки провайдера — 429 (rate limit), 5xx (їхній сервер), мережеві —
// ретраїмо. Постійні (400/401/403/404) — не ретраїмо, помилка справжня.
function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { status?: number; code?: string; name?: string };
  if (anyErr.status === 429) return true;
  if (anyErr.status && anyErr.status >= 500 && anyErr.status < 600) return true;
  if (anyErr.name === 'APIConnectionError') return true;
  if (anyErr.code === 'ECONNRESET' || anyErr.code === 'ETIMEDOUT' || anyErr.code === 'ECONNREFUSED') return true;
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) throw err;
      // Експоненційний беfoff з невеликим джитером щоб не збилися вдвох тим самим тактом
      const base = 300 * 2 ** i;
      const jitter = Math.floor(Math.random() * 150);
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }
  throw lastErr;
}

export type { RecentCookRunSummary };

export interface ChatArgs {
  user_id: string;
  session_id: string;
  text: string;
  pantry: PantryBatch[];
  stage?: 1 | 2;                       // онбординг: 1 — порожня комора; 2 — комора наповнена, але людину ще не спитали
  recentCookRuns?: RecentCookRunSummary[];
  history?: { role: 'user' | 'assistant'; content: string }[];
  profile?: Profile | null;
  shopping?: ShoppingItemRow[];
  notes?: MemoryNote[];
  eaters?: EaterRow[];
  recentRecipes?: RecipeRow[];
  // Черга Д (№2): продукти дому — теги живлять ⚠-мітки і «~строк≈» комори.
  products?: HouseholdProduct[];
  // M13: чи підключена мережа — гейтить card_go:cart_go в системному промпті.
  retailConnected?: boolean;
  // №4: що зараз відкрито. Рахує маршрут (він має повідомлення сесії),
  // модель отримує готовий факт замість виведення з історії.
  modes?: KitchenMode[];
  // Календар: плани дому, щоб модель могла на них послатись і правити.
  events?: HouseholdEventRow[];
  // 8b: блоки з лімітом на рівні репозиторію показані не повністю.
  notesTruncated?: boolean;
  recipesTruncated?: boolean;
}

export interface ChatCall {
  reply: string;
  card: Card | null;
  usage: { input: number; output: number; cached?: number; cache_write?: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live'; prompt_hash?: string; prompt_chars?: number };
}






// Стаб для тестів і локального дев без ключа. Повертає передбачувану intake_diff-картку
// на текст із «купив X». Все інше — просто reply без картки.
function stub(args: ChatArgs, promptVersion: string): ChatCall {
  // «поміняй в рецепті «X» …» → recipe_edit. Назва — в лапках «» або "".
  // Правило стоїть ПЕРЕД «купив»: репліка про правку рецепта може містити
  // згадку покупки («тільки шо купив») — пріоритет у рецепта.
  if (/(поміняй|заміни|прибери|додай)[^.!?]*рецепт/i.test(args.text)) {
    const q = /[«"]([^»"]+)[»"]/.exec(args.text);
    if (q) {
      return {
        reply: `Заміню в рецепті — зараз оновлю.`,
        card: { type: 'recipe_edit', title: q[1]!.trim(), instruction: args.text },
        usage: { input: 0, output: 0 },
        meta: { promptVersion, model: 'stub', mode: 'stub' },
      };
    }
  }
  // M13: явне прохання оформити список через мережу → cart_go. Тільки коли
  // мережа підключена — інакше стаб (як і живий промпт) веде в Профіль
  // прозою, картки не дає.
  // Корінь «збер»/«зібр» покриває всю парадигму (зберіть/збери/зберемо/
  // зібрати/зібрав) — «збери» самою формою пропускала «зберіть» (і/и
  // чергування в укр. дієслові), і живий тест це впіймав.
  const cartGoMatch = args.text.match(/(замов|оформ|збер|зібр)\S*\s+(.+?)\s+(?:в|у)\s+(сільпо|кошик)/i);
  if (cartGoMatch) {
    if (args.retailConnected) {
      // 01.09: якщо людина назвала конкретні позиції («замов лосось і рис»),
      // а не вжила загальне слово («це», «кошик», «замовлення», «список»),
      // передаємо їх дослівно — cart_go шукає саме їх, а не персистований
      // список.
      const rawItems = cartGoMatch[2] ?? '';
      const middle = rawItems.trim().toLowerCase();
      const generic = new Set(['це', 'кошик', 'замовлення', 'список', 'їх', 'все', 'усе', 'то']);
      const items = generic.has(middle)
        ? undefined
        : rawItems.split(/\s*(?:,|і|та)\s+/i).map((s) => s.trim()).filter(Boolean);
      return {
        reply: 'Зараз гляну ціни й наявність.',
        card: items?.length ? { type: 'cart_go', items } : { type: 'cart_go' },
        usage: { input: 0, output: 0 },
        meta: { promptVersion, model: 'stub', mode: 'stub' },
      };
    }
    return {
      reply: 'Спершу підключи Сільпо: Профіль → Мережі → Підключити.',
      card: null,
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  // 01.09: питання про наявність («які опції є в сільпо по X», «що є з X»)
  // — НЕ замовлення (cart_go) і НЕ список (shopping), сервер сам шукає
  // живцем і відповідає текстом (attemptSearch, chat.ts).
  const searchGoMatch = args.text.match(
    /(?:опці\w*|варіант\w*|смак\w*)[^.!?]*?(?:сільпо|мереж\w*)[^.!?]*?по\s+([а-яіїєґ'ʼ\s-]+)/i,
  );
  if (searchGoMatch) {
    const query = (searchGoMatch[1] ?? '').trim();
    if (args.retailConnected && query) {
      return {
        reply: 'Зараз гляну, що є.',
        card: { type: 'retail_search_go', query },
        usage: { input: 0, output: 0 },
        meta: { promptVersion, model: 'stub', mode: 'stub' },
      };
    }
    return {
      reply: 'Спершу підключи Сільпо: Профіль → Мережі → Підключити.',
      card: null,
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  // Пул-5 №6: явна згода готувати конкретну страву → cook_go.
  const go = /готуємо\s+[«"]([^»"]+)[»"]/i.exec(args.text);
  if (go) {
    return {
      reply: 'Тримай рецепт.',
      card: { type: 'cook_go', title: go[1]!.trim() },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  // №4: «додай X» ПРИ ВІДКРИТОМУ КОШИКУ — це розширення кошика, не список.
  // Стаб повторює правило промпту: без блока [РЕЖИМ] модель цього не знала й
  // вела все в shopping (живий репро M13 п.3). Явне «у список» лишається
  // списком — людина сказала прямо, і ситуація цього не перебиває.
  if (args.modes?.some((m) => m.kind === 'cart_open') && !/списк/i.test(args.text)) {
    const cartAdd = /(?:додай|додати|додайте|і ще|й ще)\s+(.+)/i.exec(args.text);
    if (cartAdd) {
      const items = cartAdd[1]!.split(/\s*(?:,|і|та)\s+/i).map((x) => x.trim()).filter(Boolean);
      if (items.length) {
        return {
          reply: 'Додаю в кошик.',
          card: { type: 'cart_go', items },
          usage: { input: 0, output: 0 },
          meta: { promptVersion, model: 'stub', mode: 'stub' },
        };
      }
    }
  }
  // Явна команда зі списком («додай X у список», «прибери X зі списку») —
  // для тестів auto-apply нижче (card-rules.md: shopping лише на прямий
  // запит про покупки, ніколи пропозиція моделі — тому auto-apply безпечний
  // так само, як для intake_diff).
  const listAdd = /додай\s+(.+?)\s+(?:у|в)\s+список/i.exec(args.text);
  if (listAdd) {
    const label = listAdd[1]!.trim();
    return {
      reply: `Додав ${label} у список.`,
      card: { type: 'shopping', items: [{ op: 'add', label }] },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  const listRemove = /прибери\s+(.+?)\s+зі\s+списку/i.exec(args.text)
    // 01.09: живий репро — «прибери X з замовлення/кошика», не «зі списку».
    // Порядок слів інший (лейбл ПІСЛЯ «з замовлення», не перед «зі списку»),
    // тому окремий патерн, не один спільний.
    ?? /прибери\s+з\s+(?:замовлення|кошика)\s+(.+)/i.exec(args.text);
  if (listRemove) {
    const label = listRemove[1]!.trim();
    return {
      reply: `Прибрав ${label} зі списку.`,
      card: { type: 'shopping', items: [{ op: 'remove', label }] },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  // Намір на тиждень («у суботу гості, шестеро»). Навмисно БЕЗ rule: як і
  // жива модель, стаб віддає лише `when`, а дату рахує сервер (event-when.ts).
  // Саме на цьому зловився порядок у chat.ts — pending-картка писалась до
  // резолву, і applyCard бачив ops без rule.
  // Правка наявного плану без нової дати: «продовж … на тиждень». Стаб бере
  // перший план із контексту (короткий id, як у [ТВОЇ ПЛАНИ]) і повертає
  // лише days — назву й rule має дописати сервер.
  const extend = /продовж/i.exec(args.text);
  if (extend && args.events?.[0]) {
    return {
      reply: 'Продовжив на тиждень.',
      card: { type: 'event', ops: [{ op: 'edit', id: args.events[0].id.slice(0, 8), days: 7 }] },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  // Традиція — перемикач профілю: стаб віддає картку profile з kind tradition,
  // яку сервер застосовує сам (applyModeFor), без «Запамʼятати».
  const trad = /(католи|іслам|мусульман|православ|юдей)/i.exec(args.text);
  if (trad) {
    const label = /католи/i.test(trad[1]!) ? 'catholic' : /іслам|мусульман/i.test(trad[1]!) ? 'islamic' : /православ/i.test(trad[1]!) ? 'orthodox' : 'jewish';
    const removing = /більше не|прибери|видали/i.test(args.text);
    return {
      reply: removing ? 'Прибрав.' : 'Записав, свята вже в календарі.',
      card: { type: 'profile', ops: [{ op: removing ? 'remove' : 'add', kind: 'tradition', label }] },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  const guests = /гост(?:і|ей)/i.exec(args.text);
  if (guests) {
    const servings = /(\d+|шестеро|четверо|двоє|троє)/i.exec(args.text)?.[1];
    const n = servings ? ({ шестеро: 6, четверо: 4, двоє: 2, троє: 3 } as Record<string, number>)[servings.toLowerCase()] ?? Number(servings) : undefined;
    return {
      reply: 'Записав гостей на суботу.',
      card: {
        type: 'event',
        ops: [{ op: 'add', kind: 'custom', title: `гості${n ? `, ${servings}` : ''}`, when: { rel: '+2d' }, ...(n ? { servings: n } : {}) }],
      },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  const m = /куп(?:ив|ила|или)\s+(.+)/i.exec(args.text);
  if (m) {
    const label = m[1]!.trim().replace(/[.!?].*$/, '');
    return {
      reply: `Записав: ${label}. Розкласти по коморі?`,
      card: {
        type: 'intake_diff',
        ops: [{ op: 'add', label, evidence: 'user_statement', confidence: 0.9 }],
      },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  return {
    reply: `[STUB без ANTHROPIC_API_KEY] відповідь на: ${args.text}`,
    card: null,
    usage: { input: 0, output: 0 },
    meta: { promptVersion, model: 'stub', mode: 'stub' },
  };
}

// Складання системного промпту експортоване НАВМИСНЕ: усі справжні баги
// QA-4/5/6 були тут, а не в логіці. «Профіль не доходить до моделі», «список
// не доходить», «правило стоїть після даних» — усе це перевіряється на рядку,
// без мережі й без ключа (tests/model-context.test.ts).
//
// Сам контекст живе в @kitchen/domain — його ділять прод і eval. Поки він сидів
// тут, eval складав власний промпт і перевіряв не те, що працює у проді.
/**
 * Динамічна частина промпту — ОДНА для всіх.
 *
 * Знахідка 03.09: складань було два — тут і всередині callChat, — і вони
 * розійшлись. Прод не передавав modes, а serializeModes віддає блок завжди,
 * тож моделі йшло «[РЕЖИМ] нічого не відкрито» навіть із відкритим кошиком.
 * Тести дивились на buildChatSystem і бачили правильний промпт; прод слав
 * інший. Це той самий клас помилки, через який контекст свого часу переїхав
 * у домен: копія, яку ніхто не звіряє, рано чи пізно бреше.
 */
export function buildDynamicContext(args: ChatArgs): string {
  // Пул-3: згадане в розмові — гарантовано в кепі комори.
  const queryText = [
    args.text,
    ...(args.history ?? []).filter((h) => h.role === 'user').slice(-3).map((h) => h.content),
  ].join('\n');
  return buildKitchenContext({
    pantry: args.pantry,
    profile: args.profile,
    shopping: args.shopping,
    recentCookRuns: args.recentCookRuns,
    notes: args.notes,
    eaters: args.eaters,
    recentRecipes: args.recentRecipes,
    products: args.products,
    events: args.events,
    retailConnected: args.retailConnected,
    modes: args.modes,
    notesTruncated: args.notesTruncated,
    recipesTruncated: args.recipesTruncated,
    queryText,
  });
}

// Складання системного промпту експортоване НАВМИСНЕ: усі справжні баги
// QA-4/5/6 були тут, а не в логіці. «Профіль не доходить до моделі», «список
// не доходить», «правило стоїть після даних» — усе це перевіряється на рядку,
// без мережі й без ключа (tests/model-context.test.ts).
//
// Сам контекст живе в @kitchen/domain — його ділять прод і eval. Поки він сидів
// тут, eval складав власний промпт і перевіряв не те, що працює у проді.
export function buildChatSystem(args: ChatArgs, promptText: string): string {
  return promptText + buildDynamicContext(args);
}

export async function callChat(args: ChatArgs): Promise<ChatCall> {
  const prompt = loadPrompt();
  const client = makeClient();
  if (!client) return stub(args, prompt.version);

  const model = modelForCall('chat', prompt);
  // Кеш-межа: складені правила (role+card-rules+proposal-flow+onboarding) —
  // стабільний префікс; buildKitchenContext — динаміка. buildChatSystem
  // лишається конкатенацією тих самих двох частин для тестів контексту.
  const stable = compose('chat', prompt, { stage: args.stage });
  const dynamic = buildDynamicContext(args);
  // Історія розмови. Без неї модель відповідала на кожну репліку як на першу:
  // ставила уточнення, не бачила відповіді, ставила його знову (QA4-01).
  const messages = [
    ...(args.history ?? []),
    { role: 'user' as const, content: args.text },
  ];
  const resp = await withRetry(() => client.messages.create({
    model,
    // Пул-2 №3: 2048 обрізало картку великого інтейку (інвентар на ~100
    // позицій з трійками й тегами). Платимо лише за фактично згенероване.
    max_tokens: 8192,
    // Температура з маніфесту: на 1.0 (дефолт) поведінка фліпала між
    // запусками — фікстури падали через раз на тих самих правилах.
    temperature: prompt.manifest.calls.chat.temperature,
    system: cachedSystem(stable, dynamic),
    messages,
  }));
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const { parsed, residualText } = extractJson(text);
  // Якщо JSON знайшовся — reply це те, що ЗАЛИШИЛОСЬ поза ним (може бути порожньо).
  // Якщо не знайшовся — residualText вже = text, тобто весь текст як reply.
  let reply = residualText;
  let card: Card | null = null;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    // Модель повертає одне з двох:
    //   { reply, card } — обгортка з окремим текстом і карткою
    //   { type, ops|items|... } — саму картку без обгортки; reply тоді — те,
    //   що модель написала поруч із JSON у тому ж повідомленні
    if ('reply' in o && 'card' in o) {
      reply = typeof o.reply === 'string' ? o.reply : residualText;
      card = normalizeCard(o.card ?? null);
    } else if (typeof o.type === 'string' && ['intake_diff', 'proposal', 'shopping', 'profile', 'recipe_edit', 'event'].includes(o.type)) {
      card = normalizeCard(o);
      // reply вже дорівнює residualText — те, що модель написала поза JSON.
    }
  }
  // Пул-2 №5: відповідь уперлась у стелю і картка не зібралась — юзер не
  // мусить бачити ні уламок, ні бадьоре «Записую все» без картки.
  if (resp.stop_reason === 'max_tokens' && !card) {
    reply = INTAKE_TOO_BIG_REPLY;
  }
  return {
    reply,
    card,
    usage: usageFrom(resp.usage),
    meta: {
      promptVersion: prompt.version, model, mode: 'live',
      // A3: слід тексту, що реально поїхав (стабільний префікс).
      prompt_hash: hashPromptText(stable), prompt_chars: stable.length,
    },
  };
}

// ---------- генерація рецепта ----------

export interface RecipeCall {
  recipe: Recipe | null;
  raw: string;
  usage: { input: number; output: number; cached?: number; cache_write?: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live'; prompt_hash?: string; prompt_chars?: number };
}

function recipeStub(title: string, promptVersion: string, pantry?: PantryBatch[]): RecipeCall {
  // Мінімальний рецепт для тестів без ключа. Не намагається бути «розумним»,
  // але імітує головну механіку живої моделі: якщо партія з комори згадана в
  // назві — «показує пальцем» через p БЕЗ n (QA9-01 перевіряє, що сервер
  // вморожує назву сам).
  const pointed = pantry?.find(
    (b) => b.state !== 'depleted' && title.toLowerCase().includes(b.label.toLowerCase()),
  );
  return {
    recipe: {
      t: title,
      sv: 2,
      tm: 20,
      ch: '20 хв, одна пательня',
      d: 'Простий сценарій під те, що ти назвав.',
      rk: 'ПРИМІТКА: не пересолити на початку — краще досолити наприкінці.',
      ing: [
        pointed ? { p: pointed.id, v: 200, u: 'g' } : { n: title, v: 200, u: 'g' },
      ],
      st: [
        { t: 'Підготувати', c: 'Розкласти інгредієнти на робочому місці.' },
        { t: 'Готувати', c: 'Смажити або варити за смаком, {0}.', s: 300 },
        { t: 'Подати', c: 'Викласти на тарілку, скуштувати, поправити сіль.' },
      ],
    },
    raw: '',
    usage: { input: 0, output: 0 },
    meta: { promptVersion, model: 'stub', mode: 'stub' },
  };
}

export async function callRecipe(args: {
  title: string;
  context?: string;
  pantry?: PantryBatch[];
  profile?: Profile | null;
  // Г-1: без цього recipe_gen НЕ БАЧИВ [ВИСНОВКИ З ГОТУВАННЯ] — щоденник
  // помилок лежав на кухні, а кухар писав рецепти в сусідній кімнаті.
  notes?: MemoryNote[];
  products?: HouseholdProduct[];
  // Пул-4 №4б: recipe_gen сліпий до розмови — «Арборіо є?» → «Буде»
  // губилось між викликами. Хвіст діалогу їде в user-запит (НЕ в кеш).
  conversation?: string;
}): Promise<RecipeCall> {
  const prompt = loadPrompt();
  const client = makeClient();
  if (!client) return recipeStub(args.title, prompt.version, args.pantry);

  const model = modelForCall('recipe_gen', prompt);
  // UX9-03: модель бачить ТІЛЬКИ короткі p1..pN — голі uuid вона переписувала
  // з помилками (спагеті ставали фуетом), а вморожування впевнено підписувало
  // помилку. Переклад назад — детермінований; невідомий аліас → дроп p.
  const alias = buildAliasMap(args.pantry ?? []);
  const pantryBlock = args.pantry
    ? '\n\n[КОМОРА]\n' + ctxSerializePantry(args.pantry, args.profile, Date.now(), [], false, alias.toAlias, 120, args.products ?? [], `${args.title}\n${args.context ?? ''}`)
    : '';
  // Кеш-межа: role+recipe-generator стабільні; профіль/комора/висновки — динаміка.
  const stable = compose('recipe_gen', prompt);
  const dynamic = ctxSerializeProfile(args.profile)
    + pantryBlock
    + ctxSerializeNotes(args.notes ?? []);
  const convBlock = args.conversation
    ? `\n\n[ОСТАННІ РЕПЛІКИ РОЗМОВИ — рішення з них уже ухвалені, не перепитуй]\n${args.conversation}`
    : '';
  const userText = args.context
    ? `${args.title}${convBlock}\n\n${args.context}`
    : `${args.title}${convBlock}`;
  const resp = await withRetry(() => client.messages.create({
    model,
    max_tokens: 3072,
    temperature: prompt.manifest.calls.recipe_gen.temperature,
    system: cachedSystem(stable, dynamic),
    messages: [{ role: 'user', content: userText }],
  }));
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const { parsed } = extractJson(text);
  let recipe: Recipe | null = null;
  if (parsed && typeof parsed === 'object' && 't' in parsed && 'ing' in parsed && 'st' in parsed) {
    recipe = unaliasRecipeIds(parsed as Recipe, alias.toId);
  }
  // Пул-4 №4в: прозова відповідь (recipe null) могла нести аліаси «(р21)» —
  // людина бачила нутрощі. Розіменовуємо на назви партій.
  const aliasLabels = new Map<string, string>();
  for (const b of args.pantry ?? []) {
    const a = alias.toAlias.get(b.id);
    if (a) aliasLabels.set(a, b.label);
  }
  return {
    recipe,
    raw: recipe ? text : unaliasProse(text, aliasLabels),
    usage: usageFrom(resp.usage),
    meta: {
      promptVersion: prompt.version, model, mode: 'live',
      prompt_hash: hashPromptText(stable), prompt_chars: stable.length,
    },
  };
}

// ---------- розбір вкладень ----------

export interface AttachmentPayload {
  kind: 'image' | 'pdf' | 'text';
  content_type: string | null;
  buffer: Buffer;
  hint?: string;
}

export interface AttachmentCall {
  reply: string;
  card: Card | null;
  raw_kind: 'receipt' | 'shelf' | 'recipe' | 'dish' | 'other' | null;
  usage: { input: number; output: number; cached?: number; cache_write?: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live'; prompt_hash?: string; prompt_chars?: number };
}

function attachmentStub(atts: AttachmentPayload[], promptVersion: string): AttachmentCall {
  // Впізнаване правило для тестів: якщо в тексті є «х1» / «х2» — це чек.
  // Вертаємо intake_diff з одним рядком, щоб інтеграція проходила без справжньої моделі.
  const textish = atts.find((a) => a.kind === 'text' && /х\d+/i.test(a.buffer.toString('utf-8').slice(0, 400)));
  if (textish) {
    const line = textish.buffer.toString('utf-8').split('\n').find((l) => /х\d+/i.test(l)) ?? 'позиція з чека';
    const label = line
      .replace(/х\d+.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim() || 'позиція з чека';
    return {
      reply: `Розібрав ${atts.length} вкладення. Все зафіксувати?`,
      raw_kind: 'receipt',
      card: {
        type: 'intake_diff',
        ops: [{ op: 'add', label, evidence: 'receipt_line', confidence: 0.9 }],
      },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  // Другий впізнаваний випадок: текст без «хN», але з назвою в першому рядку
  // й дієсловами готування — рецепт. Стаб тримає той самий контракт, що модель,
  // інакше інтеграційні тести перевіряли б неіснуючий шлях.
  const recipeish = atts.find((a) =>
    a.kind === 'text' && /змішати|смажити|варити|запікати|подавати/i.test(a.buffer.toString('utf-8')));
  if (recipeish) {
    const text = recipeish.buffer.toString('utf-8');
    const title = (text.split('\n').find((l) => l.trim()) ?? 'Рецепт').trim();
    return {
      reply: `${title.toLowerCase()} — розібрав. Лишити в рецептах?`,
      raw_kind: 'recipe',
      card: {
        type: 'recipe',
        recipe: {
          t: title, sv: 2, tm: 40, ch: 'стаб', d: 'стаб', rk: 'стаб',
          ing: [{ n: 'фарш', v: 500, u: 'g' }],
          st: [{ t: 'Готувати', c: text.slice(0, 120) }],
        },
      },
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  // Фото в стабі — «готова страва»: дає інтеграційним тестам шлях dish → журнал.
  if (atts.some((a) => a.kind === 'image')) {
    return {
      reply: 'Виглядає як готова страва.',
      card: null,
      raw_kind: 'dish',
      usage: { input: 0, output: 0 },
      meta: { promptVersion, model: 'stub', mode: 'stub' },
    };
  }
  return {
    reply: `[STUB без ANTHROPIC_API_KEY] отримав ${atts.length} вкладень.`,
    card: null,
    raw_kind: null,
    usage: { input: 0, output: 0 },
    meta: { promptVersion, model: 'stub', mode: 'stub' },
  };
}

// temperature: 0 — щоб той самий знімок давав той самий розбір. Це прямо в правилах промпту.
export async function callAttachmentParse(atts: AttachmentPayload[]): Promise<AttachmentCall> {
  const prompt = loadPrompt();
  const client = makeClient();
  if (!client) return attachmentStub(atts, prompt.version);

  const model = modelForCall('attachment_parse', prompt);
  const system = compose('attachment_parse', prompt);

  const parts: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[] = [];
  for (const a of atts) {
    if (a.kind === 'text') {
      parts.push({ type: 'text', text: a.buffer.toString('utf-8').slice(0, 12_000) });
    } else if (a.kind === 'image') {
      parts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: (a.content_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          data: a.buffer.toString('base64'),
        },
      });
    } else if (a.kind === 'pdf') {
      parts.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: a.buffer.toString('base64'),
        },
      });
    }
    if (a.hint) parts.push({ type: 'text', text: `[уточнення від користувача: ${a.hint}]` });
  }
  parts.push({ type: 'text', text: 'Розбери за схемою й поверни JSON. Користувач бачив вкладення на власні очі — його слово важливіше.' });

  const resp = await withRetry(() => client.messages.create({
    model,
    // Пул-2 №3: інвентар на ~100 позицій з трійками+тегами — це ~10k токенів
    // відповіді; 8192 обрізало живий кейс. Платимо за фактичне.
    max_tokens: 16384,
    temperature: 0,
    // System тут повністю статичний — кешується цілком, без динаміки.
    system: cachedSystem(system),
    messages: [{ role: 'user', content: parts }],
  }));
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  // Розбір — у домені, спільний з eval. Поки він жив тут, eval розбирав
  // відповідь про чек чатовим парсером і перевіряв не той конвеєр.
  const { reply, card, raw_kind } = parseAttachmentResponse(text);

  return {
    reply,
    card,
    raw_kind,
    usage: usageFrom(resp.usage),
    meta: {
      promptVersion: prompt.version, model, mode: 'live',
      prompt_hash: hashPromptText(system), prompt_chars: system.length,
    },
  };
}

// 01.09: фільтр альтернатив кошика Сільпо — вузька класифікація «кандидат
// категорично інший тип товару чи ні». Каталог (packages/catalog) уже
// відсіює те, що впізнав; сюди доходить тільки те, чого каталог НЕ впізнав
// узагалі (resolveLabelToKey → null) — справжня сіра зона.
export interface AltFilterPair { source: string; candidate: string }
export interface AltFilterCall {
  keep: boolean[]; // той самий порядок/довжина, що вхідні pairs
  usage: { input: number; output: number; cached?: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live' };
}

function altFilterStub(pairs: AltFilterPair[], promptVersion: string): AltFilterCall {
  const ALC = /бітер|лікер|віскі|вермут|коньяк|\bром\b|горілк|\bвино\b|\bпиво\b|шампанськ/i;
  const NONFOOD = /крем|бальзам|шампунь|\bмило\b|засіб для|гель для/i;
  const bad = (s: string) => ALC.test(s) || NONFOOD.test(s);
  const keep = pairs.map((p) => !(bad(p.candidate) && !bad(p.source)));
  return { keep, usage: { input: 0, output: 0 }, meta: { promptVersion, model: 'stub', mode: 'stub' } };
}

export async function callAltFilter(pairs: AltFilterPair[]): Promise<AltFilterCall> {
  const prompt = loadPrompt();
  if (!pairs.length) {
    return { keep: [], usage: { input: 0, output: 0 }, meta: { promptVersion: prompt.version, model: 'stub', mode: 'stub' } };
  }
  const client = makeClient();
  if (!client) return altFilterStub(pairs, prompt.version);

  // Збагачення, не критичний шлях: будь-яка проблема (мережа, зламаний JSON) —
  // fail-open, «залишити все як є» (та сама поведінка, що без фільтра),
  // а не звалити збірку кошика через додаткову перевірку.
  try {
    const model = modelForCall('alt_filter', prompt);
    const system = compose('alt_filter', prompt);
    const query = pairs.map((p, i) => `${i}. «${p.source}» → «${p.candidate}»`).join('\n');

    const resp = await withRetry(() => client.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0,
      system: cachedSystem(system),
      messages: [{ role: 'user', content: query }],
    }));
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const { parsed } = extractJson(text);
    const results = (parsed && typeof parsed === 'object' && 'results' in parsed)
      ? ((parsed as { results?: unknown }).results as { i?: number; keep?: boolean }[] | undefined) ?? []
      : [];
    const keep = pairs.map((_, i) => results.find((r) => r?.i === i)?.keep ?? true);

    return {
      keep,
      usage: usageFrom(resp.usage),
      meta: { promptVersion: prompt.version, model, mode: 'live' },
    };
  } catch {
    return {
      keep: pairs.map(() => true),
      usage: { input: 0, output: 0 },
      meta: { promptVersion: prompt.version, model: 'error-fallback', mode: 'live' },
    };
  }
}

