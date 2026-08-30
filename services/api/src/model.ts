// Один канал виклику моделі для проду. Логує версію промпту й usage.
// Без ключа повертає стаб-картку — тести й локальний дев не потребують мережі.

import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, compose } from '@kitchen/prompts';
import type { Card, PantryBatch, Profile, ShoppingItemRow } from '@kitchen/domain';

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
function fastModel(): string {
  if (process.env.MODEL_FAST) return process.env.MODEL_FAST;
  // Слаги OpenRouter застарівають без попередження — актуальні звіряти на
  // GET https://openrouter.ai/api/v1/models. Перекривається MODEL_FAST у .env
  // / Vercel Env. Стан на 2026-08-29 підтверджено QA-звітом Cowork.
  return isOpenRouter() ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5-20251001';
}
function smartModel(): string {
  if (process.env.MODEL_SMART) return process.env.MODEL_SMART;
  return isOpenRouter() ? 'anthropic/claude-sonnet-4.5' : 'claude-sonnet-5';
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

export interface RecentCookRunSummary {
  title: string;
  rating: number | null;
  verdict: string | null;
  finished_at: string;
}

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
}

export interface ChatCall {
  reply: string;
  card: Card | null;
  usage: { input: number; output: number; cached?: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live' };
}

// Серіалізація готування: назва · коли · рейтинг · verdict. Verdict короткий, тому
// повністю. Це те, що модель бачить як «людина вже пробувала цю штуку — от як їй було».
// QA4-08: Math.round давав «0дн тому» для готування 20 хв тому, і модель казала «вчора».
function serializeCookRun(r: RecentCookRunSummary): string {
  const ms = Date.now() - new Date(r.finished_at).getTime();
  const days = Math.floor(ms / 86_400_000);
  const when = days === 0 ? 'сьогодні' : days === 1 ? 'вчора' : `${days} дн тому`;
  const parts = [r.title, when];
  if (r.rating != null) parts.push(`★${r.rating}/5`);
  if (r.verdict) parts.push(`«${r.verdict}»`);
  return parts.join(' · ');
}

// QA5-07: модель не знала дати й у суботу сказала «Сьогодні середа — піст». Без цього
// рядка вся гілка правил про традиції, свята й «щоп'ятниці риба» не може працювати.
function todayLabel(): string {
  return new Date().toLocaleDateString('uk-UA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Список покупок у контекст. QA6-04: без нього модель у новій сесії казала «список
// порожній» при двох позиціях у ньому — і додавала дубль за один тап. У межах сесії
// рятувала історія, між сесіями — нічого.
function serializeShopping(items: ShoppingItemRow[]): string {
  if (!items.length) return '';
  const lines = items.map((i) => {
    const parts = [i.label];
    if (i.value != null && i.unit) parts.push(`${i.value}${i.unit}`);
    if (i.checked) parts.push('куплено');
    return parts.join(' · ');
  });
  return '\n\n[СПИСОК ПОКУПОК]\n' + lines.join('\n');
}

// Профіль у контекст. QA4-02: до цього алергії зберігались, показувались у UI — і не
// впливали ні на що. Модель двічі пропонувала мигдаль людині з алергією на мигдаль.
function serializeProfile(p: Profile | null | undefined): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.allergies.length) {
    parts.push('АЛЕРГІЇ (тверда межа — ніколи не пропонуй сам): ' + p.allergies.join(', '));
  }
  if (p.antipatterns.length) parts.push('НЕ ЇСТЬ / НЕ ЛЮБИТЬ: ' + p.antipatterns.join(', '));
  if (p.wishes.length) parts.push('ЛЮБИТЬ / ТЯГНЕ ДО: ' + p.wishes.join(', '));
  const eq = Object.entries(p.equipment ?? {});
  const has = eq.filter(([, v]) => v === 'has').map(([k]) => k);
  const lacks = eq.filter(([, v]) => v === 'lacks').map(([k]) => k);
  if (has.length) parts.push('Є ТЕХНІКА: ' + has.join(', '));
  if (lacks.length) parts.push('НЕМАЄ ТЕХНІКИ: ' + lacks.join(', '));
  return parts.length ? '\n\n[ПРОФІЛЬ]\n' + parts.join('\n') : '';
}

// Стисла серіалізація комори — та сама, що в прототипі: id · назва · зона · кількість · стан.
// Термін догоряння додаємо як «!Nдн» щоб модель могла згадати про нього в репліці
// (бриф §04: «Інформація — репліка, а не панель»).
//
// QA5-01: алергени позначаємо ПРЯМО В РЯДКУ ПАРТІЇ, а не окремим правилом. Правило
// «ніколи не пропонуй алерген» стояло за пів промпту вище й ігнорувалось: коли модель
// читає [КОМОРА] і перелічує, що є вдома, її ніщо не зупиняє. Тепер «Шоколад з мигдалем»
// фізично не прочитати без мітки поруч.
function serializePantry(bs: PantryBatch[], profile?: Profile | null): string {
  const now = Date.now();
  const allergens = (profile?.allergies ?? []).map((a) => a.toLowerCase()).filter(Boolean);
  return bs
    .filter((b) => b.state !== 'depleted')
    .map((b) => {
      const parts = [b.id, b.label, b.zone];
      if (b.value && b.unit) parts.push(`${b.value}${b.unit}`);
      if (b.state === 'opened') parts.push('вдкр');
      if (b.expires_at) {
        const days = Math.round((new Date(b.expires_at).getTime() - now) / 86_400_000);
        if (days <= 7) parts.push(`!${days}дн`);
      }
      const label = b.label.toLowerCase();
      const hit = allergens.filter((a) => label.includes(a));
      if (hit.length) parts.push(`⚠АЛЕРГЕН (${hit.join(', ')}) — САМ НЕ ПРОПОНУЙ`);
      return parts.join(' · ');
    })
    .join('\n');
}

// Стаб для тестів і локального дев без ключа. Повертає передбачувану intake_diff-картку
// на текст із «купив X». Все інше — просто reply без картки.
function stub(args: ChatArgs, promptVersion: string): ChatCall {
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

export async function callChat(args: ChatArgs): Promise<ChatCall> {
  const prompt = loadPrompt();
  const client = makeClient();
  if (!client) return stub(args, prompt.version);

  // Чат — це і є продукт: там, де людина чує голос, економити на моделі означає
  // економити на голосі. QA-4 copy-report: haiku-4.5 дав 8 мовних дефектів за прогін
  // (русизми, неіснуючі слова), sonnet-4.5 за чотири прогони — жодного.
  const model = smartModel();
  const cookLog = args.recentCookRuns?.length
    ? '\n\n[ОСТАННІ ГОТУВАННЯ]\n' + args.recentCookRuns.map(serializeCookRun).join('\n')
    : '';
  // Порядок блоків: обмеження ПЕРЕД інвентарем. Модель читає [КОМОРА] згори вниз;
  // якщо профіль стоїть після, вона встигає перелічити алергени до того, як побачить
  // обмеження (QA5-01). Кеш це не ламає — cache_prefix у маніфесті це role+card-rules,
  // обидва блоки й так за ним.
  const system = compose('chat', prompt, { stage: args.stage })
    + serializeProfile(args.profile)
    + '\n\n[СЬОГОДНІ] ' + todayLabel()
    + '\n\n[КОМОРА]\n' + serializePantry(args.pantry, args.profile)
    + serializeShopping(args.shopping ?? [])
    + cookLog;
  // Історія розмови. Без неї модель відповідала на кожну репліку як на першу:
  // ставила уточнення, не бачила відповіді, ставила його знову (QA4-01).
  const messages = [
    ...(args.history ?? []),
    { role: 'user' as const, content: args.text },
  ];
  const resp = await withRetry(() => client.messages.create({
    model,
    max_tokens: 2048,
    system,
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
      card = (o.card ?? null) as Card | null;
    } else if (typeof o.type === 'string' && ['intake_diff', 'proposal', 'shopping', 'profile'].includes(o.type)) {
      card = o as unknown as Card;
      // reply вже дорівнює residualText — те, що модель написала поза JSON.
    }
  }
  return {
    reply,
    card,
    usage: { input: resp.usage.input_tokens, output: resp.usage.output_tokens },
    meta: { promptVersion: prompt.version, model, mode: 'live' },
  };
}

// ---------- генерація рецепта ----------

export interface RecipeIng {
  p?: string;   // id партії з комори — модель показує пальцем
  n?: string;   // назва, коли продукту нема в коморі
  v?: number;
  u?: string;
}

export interface RecipeStep {
  t: string;    // короткий тайтл кроку
  c: string;    // дія з плейсхолдерами {0}, {1} за індексом інгредієнта
  s?: number;   // секунди таймера, якщо крок часовий
}

export interface Recipe {
  t: string;                                      // title
  sv: number;                                     // servings
  tm: number;                                     // total minutes
  ch: string;                                     // характер (час і зусилля)
  d: string;                                      // description
  rk: string;                                     // ключова помилка (не застереження)
  nu?: { kcal: number; p: number; f: number; c: number };
  op?: string[];                                  // варіанти замін
  ing: RecipeIng[];
  st: RecipeStep[];
}

export interface RecipeCall {
  recipe: Recipe | null;
  raw: string;
  usage: { input: number; output: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live' };
}

function recipeStub(title: string, promptVersion: string): RecipeCall {
  // Мінімальний рецепт для тестів без ключа. Не намагається бути «розумним».
  return {
    recipe: {
      t: title,
      sv: 2,
      tm: 20,
      ch: '20 хв, одна пательня',
      d: 'Простий сценарій під те, що ти назвав.',
      rk: 'ПРИМІТКА: не пересолити на початку — краще досолити наприкінці.',
      ing: [
        { n: title, v: 200, u: 'g' },
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
}): Promise<RecipeCall> {
  const prompt = loadPrompt();
  const client = makeClient();
  if (!client) return recipeStub(args.title, prompt.version);

  const model = smartModel();
  const pantryBlock = args.pantry
    ? '\n\n[КОМОРА]\n' + serializePantry(args.pantry, args.profile)
    : '';
  const system = compose('recipe_gen', prompt) + serializeProfile(args.profile) + pantryBlock;
  const userText = args.context
    ? `${args.title}\n\n${args.context}`
    : args.title;
  const resp = await withRetry(() => client.messages.create({
    model,
    max_tokens: 3072,
    system,
    messages: [{ role: 'user', content: userText }],
  }));
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const { parsed } = extractJson(text);
  let recipe: Recipe | null = null;
  if (parsed && typeof parsed === 'object' && 't' in parsed && 'ing' in parsed && 'st' in parsed) {
    recipe = parsed as Recipe;
  }
  return {
    recipe,
    raw: text,
    usage: { input: resp.usage.input_tokens, output: resp.usage.output_tokens },
    meta: { promptVersion: prompt.version, model, mode: 'live' },
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
  usage: { input: number; output: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live' };
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

  const model = fastModel();
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
    max_tokens: 4096,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: parts }],
  }));
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const parsed = tryParse(text) as { kind?: AttachmentCall['raw_kind']; note?: string; ops?: unknown; recipe?: unknown } | null;

  let card: Card | null = null;
  let raw_kind: AttachmentCall['raw_kind'] = null;
  if (parsed?.kind === 'receipt' || parsed?.kind === 'shelf') {
    raw_kind = parsed.kind;
    if (Array.isArray(parsed.ops)) {
      // Схема моделі — attachment-parser.md; тут довіряємо і закладаємось на валідацію в apply.
      card = { type: 'intake_diff', ops: parsed.ops as never };
    }
  } else if (parsed?.kind === 'recipe') {
    raw_kind = 'recipe';
    // Recipe-картка як окрема сутність буде на наступному кроці; поки reply без card.
  } else if (parsed?.kind) {
    raw_kind = parsed.kind;
  }

  return {
    reply: parsed?.note ?? text,
    card,
    raw_kind,
    usage: { input: resp.usage.input_tokens, output: resp.usage.output_tokens },
    meta: { promptVersion: prompt.version, model, mode: 'live' },
  };
}

// Витягає ВСІ верхньорівневі JSON-обʼєкти з тексту й обирає карту з валідним
// `type`. Модель іноді пише два обʼєкти в одну відповідь («ось intake для
// комори, ось proposal для рецепта») — раніше ми брали перший, а другий
// затікав у reply сирим JSON. QA-звіт зафіксував це як FIX-05.
export function extractJson(text: string): { parsed: unknown; residualText: string } {
  const trimmed = text.trim();
  try {
    return { parsed: JSON.parse(trimmed), residualText: '' };
  } catch {}

  const CARD_TYPES = ['intake_diff', 'proposal', 'shopping', 'profile'];
  const found: unknown[] = [];
  let residual = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { residual += text[i++]; continue; }
    const end = matchBrace(text, i);
    if (end === -1) { residual += text[i++]; continue; }
    const slice = text.slice(i, end + 1);
    try {
      found.push(JSON.parse(slice));
    } catch {
      residual += slice;
    }
    i = end + 1;
  }
  // Пріоритет: (1) обгортка {reply,card}; (2) обʼєкт із валідним type;
  // (3) перший знайдений. Тоді при двох JSON з type card вибирається один,
  // а другий не тече в reply.
  const wrapper = found.find((o) =>
    o && typeof o === 'object' && 'reply' in (o as object) && 'card' in (o as object),
  );
  const card = found.find((o) => {
    const t = (o as { type?: unknown } | null)?.type;
    return typeof t === 'string' && CARD_TYPES.includes(t);
  });
  return { parsed: wrapper ?? card ?? found[0] ?? null, residualText: residual.trim() };
}

// Індекс парної '}' для '{' на позиції start; -1 якщо не знайдено.
function matchBrace(text: string, start: number): number {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

// Обгортка для випадків, де нам потрібен лише parsed (у callAttachmentParse).
function tryParse(text: string): unknown {
  return extractJson(text).parsed;
}
