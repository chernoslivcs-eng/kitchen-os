// Р151: голосове з Telegram → текст. Транскрипція smart-моделлю через OpenRouter як
// аудіовхід (chat completions, `input_audio`): перевірено 14.09 на google/gemini-3.8-flash —
// wav і m4a проходять (200, ≈ $0.0001, ~2 с). Telegram voice — ogg/opus; формат передаємо
// як є ('ogg'), Gemini його приймає. Інструкція — інлайн, службовий виклик: окремого блоку
// в packages/prompts нема (постановка). Без OPENROUTER_API_KEY — помилка (прямий Anthropic
// аудіо в цьому форматі не приймає) → бот каже «Не розібрав — напиши текстом».
import { hashPromptText } from '@kitchen/prompts';

export const STT_INSTRUCTION = 'Розшифруй цей аудіозапис дослівно українською (якщо мова інша — тією мовою), без коментарів, без часових міток, без лапок. Лише текст. Якщо мови нема — відповідай порожнім рядком.';
export const STT_TIMEOUT_MS = 30_000;

export interface SttResult {
  text: string;
  model: string;
  usage: { input: number; output: number; cost?: number };
  prompt_hash: string;
}

export function audioFormatOf(content_type: string | null | undefined): string {
  const ct = (content_type ?? '').toLowerCase();
  if (ct.includes('ogg') || ct.includes('opus')) return 'ogg';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac') || ct.includes('x-m4a')) return 'm4a';
  if (ct.includes('webm')) return 'webm';
  return 'ogg';
}

export async function transcribeTelegramAudio(buffer: Buffer, content_type: string | null): Promise<SttResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('stt: no OPENROUTER_API_KEY');
  const model = process.env.MODEL_SMART ?? 'google/gemini-3.8-flash';
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 1024, reasoning: { effort: 'minimal' }, usage: { include: true },
      messages: [{ role: 'user', content: [
        { type: 'text', text: STT_INSTRUCTION },
        { type: 'input_audio', input_audio: { data: buffer.toString('base64'), format: audioFormatOf(content_type) } },
      ] }],
    }),
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`stt: openrouter ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
  const text = (j.choices?.[0]?.message?.content ?? '').replace(/^\s*\d{1,2}:\d{2}\s*/gm, '').replace(/\s+/g, ' ').trim();
  return {
    text, model,
    usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cost: j.usage?.cost },
    prompt_hash: hashPromptText(STT_INSTRUCTION),
  };
}
