// Вечірнє нагадування в Telegram (spec docs/superpowers/specs/2026-09-20-evening-
// notification-design.md) — сервіс над кроном.
//
// Крон щогодини (api/cron-digest.ts) → для кожного з привʼязаним Telegram: чи
// зараз 18 його місцевого часу, чи не слали сьогодні, чи не опт-аут, чи не
// писала за останні 3 години (shouldSendDigest) → форма за пріоритетом
// (pickForm, детерміновано; форма 4 — назва страви з proposal-ходу + рецепт)
// → одне речення голосу (хід моделі з серверною командою) → повідомлення:
// рядок конкретики, рядок голосу, одна inline-кнопка з глибоким лінком
// (той самий 24-годинний токен, що «Відкрити у вебі») → digest_sent_on →
// app_event digest_sent {form, voice}.
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import {
  pickForm, digestRequest, voiceSentence, digestText, shouldSendDigest, localClock, resolveRecipeLabels,
  subscribedRows, subscribedTraditions, BUILTIN_OCCASIONS, getOrCreateTelegramWebToken,
  DIGEST_ACTIVE_WINDOW_MS, type Repo, type DigestCandidateRow, type DigestPick, type Recipe,
} from '@kitchen/domain';
import { runChatTurn, type ChatTurnInput, type ChatTurnOutput, type ChatRouteOpts } from './chat-turn.js';
import { callRecipe } from './model.js';
import type { AttachmentStore } from './attachment-store.js';
import type { QuickKeyboardBtn } from './telegram-nomodel.js';
import { webTokenSecret } from './telegram.js';

export interface DigestDeps {
  repo: Repo;
  store: AttachmentStore;
  chatOpts: ChatRouteOpts;
  /** База для глибоких лінків (APP_URL). */
  appUrl: string;
  /** Доставка в Telegram (grammY api.sendMessage); у тестах — мок. */
  send: (chat_id: number, text: string, keyboard: QuickKeyboardBtn[][]) => Promise<void>;
  log: FastifyBaseLogger;
  now?: () => Date;
  /** Тестовий шов замість runChatTurn (і для proposal-ходу форми 4, і для речення голосу). */
  turn?: (input: ChatTurnInput) => Promise<ChatTurnOutput>;
  /** Тестовий шов замість callRecipe + saveRecipe: назва → id збереженого рецепта (null — не склалось). */
  generate?: (user_id: string, household_id: string, title: string) => Promise<string | null>;
  webTokenSecret?: string;
}

export type DigestOutcome =
  | { user_id: string; status: 'sent'; text: string; form: DigestPick['form']; voice: boolean; button: { text: string; url: string } }
  | { user_id: string; status: 'skipped'; reason: string }
  | { user_id: string; status: 'failed'; error: string };

/** Форма 4: «Що зготувати з того, що є?» → proposal → перша назва → рецепт у бібліотеці. */
export const DIGEST_PROPOSAL_TEXT = 'Що зготувати сьогодні з того, що є в коморі? Одна страва.';

async function dishForm(deps: DigestDeps, c: DigestCandidateRow, pick: DigestPick, turn: NonNullable<DigestDeps['turn']>): Promise<DigestPick | null> {
  const out = await turn({ user: { user_id: c.user_id, household_id: c.household_id }, text: DIGEST_PROPOSAL_TEXT, channel: 'telegram', host: { log: deps.log }, log: deps.log });
  const title = out.card?.type === 'proposal' ? out.card.items?.[0]?.title?.trim() : undefined;
  if (!title) return null;
  const generate = deps.generate ?? ((user_id: string, household_id: string, t: string) => generateRecipe(deps.repo, user_id, household_id, t));
  const id = await generate(c.user_id, c.household_id, title);
  if (!id) return null;
  return { ...pick, facts: title, button: { text: 'Рецепт', next: `/recipe/${encodeURIComponent(id)}?cook=1` } };
}

/** Як go-гілка chat-turn: callRecipe → saveRecipe (origin generated, saved_at null). */
async function generateRecipe(repo: Repo, user_id: string, household_id: string, title: string): Promise<string | null> {
  const [pantry, products, profileText, profileNotes, vetoIndex] = await Promise.all([
    repo.listBatches(household_id), repo.listProducts(household_id), repo.getProfileText(user_id), repo.listProfileNotes(user_id), repo.getVetoIndex(user_id),
  ]);
  const call = await callRecipe({ title, pantry, products, profileText, profileNotes, vetoIndex });
  if (!call.recipe) return null;
  const resolved: Recipe = resolveRecipeLabels(call.recipe, pantry);
  const id = randomUUID();
  await repo.saveRecipe({
    id, owner_id: user_id, origin: 'generated', title: resolved.t, requested_title: title,
    descr: resolved.d ?? null, character: resolved.ch ?? null, risk: resolved.rk ?? null,
    base_servings: resolved.sv ?? 2, time_total: resolved.tm ?? null, nutrition: resolved.nu ?? null, payload: resolved,
    created_at: new Date().toISOString(), saved_at: null,
  });
  return id;
}

/** Один кандидат: усі перевірки → форма → речення → доставка. Ніколи не кидає — крон іде далі. */
export async function runDigestFor(deps: DigestDeps, c: DigestCandidateRow): Promise<DigestOutcome> {
  const now = deps.now?.() ?? new Date();
  try {
    const wrote_recently = await deps.repo.hasUserMessageSince(c.user_id, new Date(now.getTime() - DIGEST_ACTIVE_WINDOW_MS).toISOString());
    const gate = shouldSendDigest({ digest_enabled: c.digest_enabled, digest_sent_on: c.digest_sent_on, tz: c.tz, wrote_recently }, now);
    if (!gate.send) return { user_id: c.user_id, status: 'skipped', reason: gate.reason ?? 'gate' };

    const [pantry, shopping, subs] = await Promise.all([
      deps.repo.listBatches(c.household_id),
      deps.repo.listShoppingItems(c.household_id),
      deps.repo.listOccasionSubscriptions(c.household_id),
    ]);
    const occasionRows = subscribedRows(BUILTIN_OCCASIONS, subs);
    const trads = subscribedTraditions(occasionRows);
    let pick = pickForm({ pantry, shopping, trads, occasionRows, now });
    const turn = deps.turn ?? ((input: ChatTurnInput) => runChatTurn(deps.repo, deps.store, deps.chatOpts, input));
    if (pick?.form === 4) pick = await dishForm(deps, c, pick, turn);
    if (!pick) {
      // Порожньо → не шлемо і не витрачаємо хід; але день закриваємо, щоб не перевіряти щогодини.
      await deps.repo.setDigestSentOn(c.user_id, gate.day);
      return { user_id: c.user_id, status: 'skipped', reason: 'empty' };
    }

    // Одне речення голосу — один хід моделі; порожньо/картка → шлемо без речення.
    let voice: string | null = null;
    try {
      const out = await turn({ user: { user_id: c.user_id, household_id: c.household_id }, action: 'digest', text: digestRequest(pick.theme, pick.facts), channel: 'telegram', host: { log: deps.log }, log: deps.log });
      voice = out.card ? null : voiceSentence(out.reply);
    } catch (err) {
      deps.log.warn({ err: String(err), user_id: c.user_id }, 'digest-voice-failed');
    }

    const { raw_token } = await getOrCreateTelegramWebToken(deps.repo, c.user_id, deps.webTokenSecret ?? webTokenSecret({ repo: deps.repo, appUrl: deps.appUrl }), now);
    const url = `${deps.appUrl}/v1/auth/telegram?token=${encodeURIComponent(raw_token)}&next=${encodeURIComponent(pick.button.next)}`;
    const text = digestText(pick.facts, voice);
    await deps.send(c.chat_id, text, [[{ text: pick.button.text, url }]]);
    await deps.repo.setDigestSentOn(c.user_id, gate.day);
    await deps.repo.saveAppEvents([{
      id: randomUUID(), user_id: c.user_id, household_id: c.household_id, name: 'digest_sent',
      props: { channel: 'telegram', form: pick.form, voice: !!voice }, viewport_w: null, device_class: null, ua_family: null, created_at: now.toISOString(),
    }]).catch((err: unknown) => deps.log.warn({ err: String(err) }, 'digest-event-failed'));
    return { user_id: c.user_id, status: 'sent', text, form: pick.form, voice: !!voice, button: { text: pick.button.text, url } };
  } catch (err) {
    deps.log.warn({ err: String(err), user_id: c.user_id }, 'digest-failed');
    return { user_id: c.user_id, status: 'failed', error: String((err as Error).message ?? err) };
  }
}

/** Прохід крону: усі кандидати, послідовно (ходи моделі — по одному, щоб не впертись у ліміти). */
export async function runDigestCron(deps: DigestDeps): Promise<{ candidates: number; sent: number; skipped: Record<string, number>; failed: number }> {
  const rows = await deps.repo.listDigestCandidates();
  const summary = { candidates: rows.length, sent: 0, skipped: {} as Record<string, number>, failed: 0 };
  for (const c of rows) {
    const r = await runDigestFor(deps, c);
    if (r.status === 'sent') summary.sent++;
    else if (r.status === 'skipped') summary.skipped[r.reason] = (summary.skipped[r.reason] ?? 0) + 1;
    else summary.failed++;
  }
  deps.log.info(summary, 'digest-cron');
  return summary;
}

/** Локальний час (день + година) кандидата — для dry-run і логів. */
export const localClockOf = (c: Pick<DigestCandidateRow, 'tz'>, now = new Date()) => localClock(now, c.tz);
