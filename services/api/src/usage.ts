// Один канал запису обліку. Викликається одразу після виклику моделі,
// незалежно від того, live це чи stub. У проді фільтруємо `mode='live'`.

import { randomUUID } from 'node:crypto';
import type { Repo, UserContext, CallName, ModelProfile, CallMode } from '@kitchen/domain';

function deriveProfile(call: CallName, mode: CallMode): ModelProfile {
  if (mode === 'stub') return 'stub';
  if (call === 'recipe_gen' || call === 'recipe_import') return 'smart';
  return 'fast';
}

export async function recordUsage(
  repo: Repo,
  ctx: UserContext,
  call: CallName,
  meta: { promptVersion: string; model: string; mode: CallMode },
  usage: { input: number; output: number; cached?: number },
  started_at_ms: number,
): Promise<void> {
  await repo.logTokenUsage({
    id: randomUUID(),
    user_id: ctx.user_id,
    household_id: ctx.household_id,
    call,
    profile: deriveProfile(call, meta.mode),
    model: meta.model,
    prompt_version: meta.promptVersion,
    mode: meta.mode,
    input_tokens: usage.input ?? 0,
    output_tokens: usage.output ?? 0,
    cached_tokens: usage.cached ?? 0,
    latency_ms: Date.now() - started_at_ms,
    created_at: new Date().toISOString(),
  });
}
