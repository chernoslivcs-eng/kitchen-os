// Бот без підписки (спек 2026-09-25 §3): текст, фото й голос → паювел із
// кнопкою на сайт; голос при цьому НЕ їде в STT — платити за транскрипцію
// того, що ми все одно не розберемо, немає за що.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryRepo, signInWithTelegram } from '@kitchen/domain';
import { PAYWALL, SUBSCRIPTION_PATH } from '@kitchen/domain/paywall';
import { handleTelegramText, handleTelegramVoice, resetSeenUpdates } from '../src/telegram.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => log } as never;

async function lapsed() {
  resetSeenUpdates();
  const repo = new InMemoryRepo();
  const tg = await signInWithTelegram(repo, { telegram_user_id: 4242, chat_id: 4242, first_name: 'Т' });
  await repo.saveSubscription({
    household_id: tg.household_id, state: 'lapsed', plan: null, trial_used_at: null, trial_ends_at: null,
    next_charge_at: null, access_until: null, provider_order_id: null, card_mask: null, paid_by_user_id: null,
    deletion_warned_at: null, trial_mail_sent_at: null, updated_at: NOW.toISOString(),
  });
  let sttCalls = 0;
  const deps = {
    repo, appUrl: 'https://app.test', log, now: () => NOW, webTokenSecret: 's',
    downloadFile: async () => ({ buffer: Buffer.from('x'), content_type: 'audio/ogg' }),
    stt: async () => { sttCalls++; return { text: 'молоко', model: 'm', usage: { input: 1, output: 1 }, prompt_hash: 'h' }; },
  } as never;
  return { deps, repo, tg, stt: () => sttCalls };
}

describe('telegram без підписки', () => {
  it('текст → паювел із кнопкою на екран підписки', async () => {
    const { deps } = await lapsed();
    const r = await handleTelegramText(deps, { update_id: randomUUID().length, telegram_user_id: 4242, chat_id: 4242, text: 'що є вдома?' } as never);
    expect(r?.messages).toEqual([PAYWALL.chat.text]);
    const btn = r?.keyboard?.[0]?.[0];
    expect(btn?.text).toBe(PAYWALL.chat.cta);
    expect(decodeURIComponent(btn?.url ?? '')).toContain(SUBSCRIPTION_PATH);
  });

  it('голос → паювел, STT не викликано', async () => {
    const { deps, stt } = await lapsed();
    const r = await handleTelegramVoice(deps, { update_id: 991, telegram_user_id: 4242, chat_id: 4242, file_id: 'f', duration: 3 } as never);
    expect(r?.messages).toEqual([PAYWALL.chat.text]);
    expect(stt()).toBe(0);
  });
});
