// Один канал запису обліку. Викликається одразу після виклику моделі,
// незалежно від того, live це чи stub. У проді фільтруємо `mode='live'`.

import { randomUUID } from 'node:crypto';
import { loadPrompt } from '@kitchen/prompts';
import type { Repo, UserContext, CallName, ModelProfile, CallMode } from '@kitchen/domain';
import type { ModelCallUsage } from './model.js';

// Третє місце, де жив мапінг «виклик → профіль», і воно теж розійшлось: чат тут
// рахувався як 'fast' навіть після переходу на sonnet. Тепер джерело одне —
// маніфест промпту; тут лишається тільки stub-гілка.
function deriveProfile(call: CallName, mode: CallMode): ModelProfile {
  if (mode === 'stub') return 'stub';
  return loadPrompt().manifest.calls[call].profile;
}

/**
 * Крок А1: до якого ходу належить виклик.
 *
 * Передається тільки там, де хід справді є. Досі pulse.ts зшивав ціну з
 * повідомленням здогадкою — найближчий виклик тієї самої людини в межах
 * хвилини, — і на цій здогадці стояла вся юніт-економіка.
 *
 * Де ходу немає (розбір вкладення до створення повідомлення, генерація
 * рецепта поза чатом, пошук по коморі) — цей аргумент не передається взагалі,
 * і в базу йде null. Прив'язувати виклик до «найближчого» повідомлення ми не
 * будемо: порожньо тут чесніше за здогадку.
 */
export interface UsageTurn {
  /** Повідомлення людини, яке спричинило виклик. Null, коли його ще нема. */
  message_id: string | null;
  session_id: string;
}

/**
 * Крок А4б: РЯДОК ОБЛІКУ = ОДИН ВИКЛИК МОДЕЛІ.
 *
 * Досі обробник, який робив кілька викликів (повтор guard-а в callChat, розбір
 * кількох вкладень паралельно), складав їхній usage і писав ОДИН рядок. Гроші
 * від цього не страждали — сума лишалась правильною, тому підсумок і сходився
 * з рахунком. Страждав знаменник: колонка «ціна одного виклику» ділила
 * правильну суму на занижену кількість і показувала вдвічі більше.
 *
 * Звірка з OpenRouter за 8 вересня: там 11 викликів, у нас 8 рядків, і
 * недостача йшла парами — рівно там, де крок робив два виклики.
 *
 * Тому сюди приїжджає СПИСОК, і кожен його елемент стає окремим рядком.
 * Зшивання хода не міняється: рядки одного кроку несуть той самий
 * `message_id`, і ціна хода лишається їхньою сумою (pulse.ts це вже вміє —
 * «кілька викликів на один хід — норма»).
 *
 * ЛАТЕНТНІСТЬ міряється на КРОК, а не на виклик, і тому стоїть на першому
 * рядку, а решта отримує null. Розмазати її по рядках означало б вигадати
 * дані, яких ми не міряли; продублювати — подвоїти час, який людина чекала,
 * бо і пульс, і середні складають латентність рядків одного ходу.
 */
export async function recordUsage(
  repo: Repo,
  // Читаються рівно два поля. `session_id` рядка приїжджає з `turn`, а не
  // звідси, — тому вимагати повний `UserContext` означало б змушувати
  // виклики без ходу (alt_filter у retail.ts) вигадувати сесію заради
  // поля, яке ця функція навіть не читає.
  ctx: Pick<UserContext, 'user_id' | 'household_id'>,
  call: CallName,
  meta: { promptVersion: string; model: string; mode: CallMode; prompt_hash?: string; prompt_chars?: number },
  calls: ModelCallUsage[],
  started_at_ms: number,
  turn?: UsageTurn,
): Promise<void> {
  const latency_ms = Date.now() - started_at_ms;
  for (const [i, usage] of calls.entries()) {
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
      latency_ms: i === 0 ? latency_ms : null,
      // A3: точний слід тексту промпту на кожен виклик — редагування «на місці»
      // більше не невидиме для телеметрії (аудит: +3,2k ток. під тим самим version).
      prompt_hash: meta.prompt_hash ?? null,
      prompt_chars: meta.prompt_chars ?? null,
      message_id: turn?.message_id ?? null,
      session_id: turn?.session_id ?? null,
      // Крок А5: найдорожчий рід вхідних токенів. model.ts діставав його з
      // відповіді й вів аж сюди, а тут він гинув — поля просто не було в
      // сигнатурі. Тепер доїжджає до бази.
      //
      // `?? null`, а не `?? 0`: провайдер, який поля не прокидає (перевіряється
      // живим викликом), має лишити «не знаємо», а не «записів не було».
      cache_write_tokens: usage.cache_write ?? null,
      created_at: new Date().toISOString(),
    });
  }
}
