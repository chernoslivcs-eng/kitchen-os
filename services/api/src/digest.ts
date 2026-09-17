// Ранковий дайджест дому (DIGEST-PLAN-0917, PR 1) — сервіс над кроном.
//
// Крон щогодини (api/cron-digest.ts) → для кожного з привʼязаним Telegram:
// чи зараз 07 його місцевого часу, чи не слали сьогодні, чи не опт-аут, чи
// не писав уже до 07:00 (shouldSendDigest) → чи є що казати (digestFacts;
// порожньо — хід не робиться) → хід моделі через runChatTurn(action:
// 'digest') — відповідь лягає в розмову дня як звичайне повідомлення
// асистента → sendMessage у Telegram з емодзі-маркерами й рядом довідок →
// digest_sent_on = сьогодні → app_event digest_sent.
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { digestFacts, digestIsEmpty, shouldSendDigest, digestForTelegram, localClock, type Repo, type DigestCandidateRow } from '@kitchen/domain';
import { runChatTurn, type ChatTurnInput, type ChatTurnOutput, type ChatRouteOpts } from './chat-turn.js';
import type { AttachmentStore } from './attachment-store.js';
import { HELP_KEYBOARD_ROWS } from './telegram-nomodel.js';
import type { QuickKeyboardBtn } from './telegram-nomodel.js';

export interface DigestDeps {
  repo: Repo;
  store: AttachmentStore;
  chatOpts: ChatRouteOpts;
  /** Доставка в Telegram (grammY api.sendMessage); у тестах — мок. */
  send: (chat_id: number, text: string, keyboard: QuickKeyboardBtn[][]) => Promise<void>;
  log: FastifyBaseLogger;
  now?: () => Date;
  /** Тестовий шов замість runChatTurn. */
  turn?: (input: ChatTurnInput) => Promise<ChatTurnOutput>;
}

export type DigestOutcome =
  | { user_id: string; status: 'sent'; text: string }
  | { user_id: string; status: 'skipped'; reason: string }
  | { user_id: string; status: 'failed'; error: string };

/** Один кандидат: усі перевірки → хід → доставка. Ніколи не кидає — крон іде далі. */
export async function runDigestFor(deps: DigestDeps, c: DigestCandidateRow): Promise<DigestOutcome> {
  const now = deps.now?.() ?? new Date();
  try {
    const { day } = localClock(now, c.tz);
    // «Писала до 07:00» — від початку місцевого дня. Рядок 'YYYY-MM-DDT00:00' у поясі людини → ISO.
    const dayStartIso = localMidnightIso(day, c.tz);
    const wrote_today_before = await deps.repo.hasUserMessageSince(c.user_id, dayStartIso);
    const gate = shouldSendDigest({ digest_enabled: c.digest_enabled, digest_sent_on: c.digest_sent_on, tz: c.tz, wrote_today_before }, now);
    if (!gate.send) return { user_id: c.user_id, status: 'skipped', reason: gate.reason ?? 'gate' };

    const [pantry, shopping, events] = await Promise.all([
      deps.repo.listBatches(c.household_id),
      deps.repo.listShoppingItems(c.household_id),
      deps.repo.listOwnEvents(c.household_id, c.user_id),
    ]);
    const facts = digestFacts(pantry, shopping, events, now);
    if (digestIsEmpty(facts)) {
      // Порожньо → не шлемо і не витрачаємо хід; але день закриваємо, щоб не перевіряти щогодини.
      await deps.repo.setDigestSentOn(c.user_id, gate.day);
      return { user_id: c.user_id, status: 'skipped', reason: 'empty' };
    }

    const turn = deps.turn ?? ((input: ChatTurnInput) => runChatTurn(deps.repo, deps.store, deps.chatOpts, input));
    const out = await turn({ user: { user_id: c.user_id, household_id: c.household_id }, action: 'digest', channel: 'telegram', host: { log: deps.log }, log: deps.log });
    const text = (out.reply ?? '').trim();
    if (!text) return { user_id: c.user_id, status: 'failed', error: 'empty reply' };

    await deps.send(c.chat_id, digestForTelegram(text), HELP_KEYBOARD_ROWS);
    await deps.repo.setDigestSentOn(c.user_id, gate.day);
    await deps.repo.saveAppEvents([{
      id: randomUUID(), user_id: c.user_id, household_id: c.household_id, name: 'digest_sent',
      props: { channel: 'telegram', ...facts }, viewport_w: null, device_class: null, ua_family: null, created_at: now.toISOString(),
    }]).catch((err: unknown) => deps.log.warn({ err: String(err) }, 'digest-event-failed'));
    return { user_id: c.user_id, status: 'sent', text };
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

/** 00:00 місцевого дня у поясі → ISO. Без бібліотек: підбираємо зсув через Intl. */
export function localMidnightIso(day: string, tz: string | null | undefined): string {
  const zone = tz || 'Europe/Kyiv';
  const guess = new Date(`${day}T00:00:00Z`).getTime();
  // Зсув пояса в цю мить: скільки годин локальний час випереджає UTC.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  let offsetMin = h * 60 + m;
  if (offsetMin > 12 * 60) offsetMin -= 24 * 60; // західні пояси: локально ще вчора
  return new Date(guess - offsetMin * 60_000).toISOString();
}
