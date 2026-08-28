// Один канал виклику моделі для проду. Логує версію промпту й usage.
// Без ключа повертає стаб-картку — тести й локальний дев не потребують мережі.

import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, compose } from '@kitchen/prompts';
import type { Card, PantryBatch } from '@kitchen/domain';

export interface ChatArgs {
  user_id: string;
  session_id: string;
  text: string;
  pantry: PantryBatch[];
}

export interface ChatCall {
  reply: string;
  card: Card | null;
  usage: { input: number; output: number; cached?: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live' };
}

const PROFILE_FAST = process.env.MODEL_FAST ?? 'claude-haiku-4-5-20251001';

// Стисла серіалізація комори — та сама, що в прототипі: id · назва · зона · кількість · стан.
function serializePantry(bs: PantryBatch[]): string {
  return bs
    .filter((b) => b.state !== 'depleted')
    .map((b) => {
      const parts = [b.id, b.label, b.zone];
      if (b.value && b.unit) parts.push(`${b.value}${b.unit}`);
      if (b.state === 'opened') parts.push('вдкр');
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return stub(args, prompt.version);

  const client = new Anthropic({ apiKey });
  const system = compose('chat', prompt) + '\n\n[КОМОРА]\n' + serializePantry(args.pantry);
  const resp = await client.messages.create({
    model: PROFILE_FAST,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: args.text }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const parsed = tryParse(text);
  let reply = text;
  let card: Card | null = null;
  if (parsed && typeof parsed === 'object' && 'reply' in parsed && 'card' in parsed) {
    reply = (parsed as { reply: string }).reply ?? '';
    card = (parsed as { card: Card | null }).card;
  }
  return {
    reply,
    card,
    usage: { input: resp.usage.input_tokens, output: resp.usage.output_tokens },
    meta: { promptVersion: prompt.version, model: PROFILE_FAST, mode: 'live' },
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return attachmentStub(atts, prompt.version);

  const client = new Anthropic({ apiKey });
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

  const resp = await client.messages.create({
    model: PROFILE_FAST,
    max_tokens: 4096,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: parts }],
  });
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
    meta: { promptVersion: prompt.version, model: PROFILE_FAST, mode: 'live' },
  };
}

function tryParse(text: string): unknown {
  try { return JSON.parse(text.trim()); } catch {}
  const m = text.match(/\{[\s\S]*\}$/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
