// Ворота режиму без підписки (спек 2026-09-25 §2): рішення одне й стоїть на
// вході ходу, а не біля виклику моделі. Перевіряємо три речі разом, бо кожна
// окремо нічого не варта: 402 з тілом паювела, модель не викликана, репліка
// людини НЕ збережена (спек §3 — після оплати не має бути стіни реплік без
// відповідей).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => log } as never;
const host = { log, telemetry: [] } as never;

const callChat = vi.fn();
vi.mock('../src/model.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), callChat }));

const { InMemoryRepo } = await import('@kitchen/domain');
const { InMemoryStore } = await import('../src/attachment-store.js');
const { runChatTurn, ChatTurnHttpError } = await import('../src/chat-turn.js');
const { PAYWALL } = await import('@kitchen/domain/paywall');

const sub = (household_id: string, state: string) => ({
  household_id, state, plan: 'self', trial_used_at: null, trial_ends_at: null,
  next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null,
  paid_by_user_id: null, deletion_warned_at: null, trial_mail_sent_at: null,
  updated_at: new Date().toISOString(),
}) as never;

describe('runChatTurn без підписки', () => {
  beforeEach(() => { callChat.mockReset(); });

  it('lapsed → 402 paywall, модель не викликана, репліка не збережена', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('p@x.test', 'P');
    await repo.saveSubscription(sub(household_id, 'lapsed'));
    const err = await runChatTurn(repo, new InMemoryStore(), {}, { user: { user_id, household_id }, text: 'що на вечерю?', channel: 'web', host, log })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ChatTurnHttpError);
    expect((err as InstanceType<typeof ChatTurnHttpError>).status).toBe(402);
    expect((err as InstanceType<typeof ChatTurnHttpError>).body).toMatchObject({
      kind: 'paywall', state: 'lapsed', text: PAYWALL.chat.text, cta: { label: 'Продовжити', to: '/profile/subscription' },
    });
    expect(callChat).not.toHaveBeenCalled();
    expect(await repo.hasUserMessageSince(user_id, '2000-01-01T00:00:00Z')).toBe(false);
  });

  it('пробний, що ще триває → хід іде далі (ворота не зачіпають full)', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('q@x.test', 'Q');
    await repo.saveSubscription({ ...sub(household_id, 'trial') as object, trial_ends_at: new Date(Date.now() + 86_400_000).toISOString() } as never);
    const err = await runChatTurn(repo, new InMemoryStore(), {}, { user: { user_id, household_id }, text: 'привіт', channel: 'web', host, log })
      .then(() => null, (e: unknown) => e);
    // Далі хід упирається в модель (її мок нічого не віддає) — важливо лише,
    // що це НЕ 402: ворота пропустили.
    expect(err instanceof ChatTurnHttpError && err.status === 402).toBe(false);
  });
});
