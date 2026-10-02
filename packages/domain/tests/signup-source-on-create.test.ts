// Джерело реєстрації пишеться РАЗОМ зі створенням акаунта — на кожному шляху
// входу, і ніде більше (той самий принцип, що demo-on-new-household.test.ts).
//
// Чому це тест, а не «очевидно»: забутий шлях входу не падає й нічого не
// ламає — просто реєстрації з нього мовчки не потрапляють у звіт, і канал
// виглядає мертвим.
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '../in-memory-repo.js';
import {
  requestChallenge, verifyChallenge, signInWithVerifiedEmail, signInWithTelegram,
  beginTelegramLogin, attachTelegramLoginUser,
} from '../auth.js';
import { createInvite, acceptInvite } from '../invite.js';

const MARKS = { utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'launch', utm_content: 'post-1', ref: 'olena' };
const NO_MARKS = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, ref: null };
const tg = (id: number) => ({ telegram_user_id: id, chat_id: id, first_name: 'Бот' });

describe('новий акаунт → джерело реєстрації', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  it('пошта: мітки їдуть на challenge і лягають при verify', async () => {
    const { raw_token } = await requestChallenge(repo, { email: 'new@mail.ua', source: MARKS });
    const out = await verifyChallenge(repo, raw_token);
    if (!out.ok) throw new Error(out.reason);
    expect(await repo.getSignupSource(out.result.user_id)).toMatchObject({
      user_id: out.result.user_id, household_id: out.result.household_id, via: 'email', ...MARKS,
    });
  });

  it('Google: той самий вхід за підтвердженою поштою, спосіб — google', async () => {
    const r = await signInWithVerifiedEmail(repo, 'g@mail.ua', 'Ґ', null, null, { via: 'google', marks: { utm_source: 'ads', utm_medium: 'cpc' } });
    expect(await repo.getSignupSource(r.user_id)).toMatchObject({
      household_id: r.household_id, via: 'google', ...NO_MARKS, utm_source: 'ads', utm_medium: 'cpc',
    });
  });

  it('Telegram з лендінгу: мітки привʼязані до токена входу, акаунт створює бот', async () => {
    const { raw_token } = await beginTelegramLogin(repo, null, null, 'start', { utm_source: 'instagram', ref: 'reel' });
    const out = await attachTelegramLoginUser(repo, raw_token, tg(700));
    if (!out.ok) throw new Error(out.reason);
    expect(out.created).toBe(true);
    expect(await repo.getSignupSource(out.user.id)).toMatchObject({
      household_id: await repo.firstHouseholdOf(out.user.id), via: 'telegram', ...NO_MARKS, utm_source: 'instagram', ref: 'reel',
    });
  });

  it('без міток рядок усе одно є: «прийшов сам» — теж відповідь', async () => {
    const mail = await signInWithVerifiedEmail(repo, 'plain@mail.ua', 'П');
    expect(await repo.getSignupSource(mail.user_id)).toMatchObject({ household_id: mail.household_id, via: 'email', ...NO_MARKS });
    // Прямий /start у боті: лендінгу не було, міток теж.
    const bot = await signInWithTelegram(repo, tg(701));
    expect(await repo.getSignupSource(bot.user_id)).toMatchObject({ household_id: bot.household_id, via: 'telegram', ...NO_MARKS });
  });

  it('наявний акаунт: вхід з іншими мітками нічого не пише й не переписує', async () => {
    const first = await signInWithVerifiedEmail(repo, 'again@mail.ua', 'З', null, null, { via: 'email', marks: MARKS });
    const before = await repo.getSignupSource(first.user_id);
    await signInWithVerifiedEmail(repo, 'again@mail.ua', 'З', null, null, { via: 'google', marks: { utm_source: 'ads' } });
    const { raw_token } = await requestChallenge(repo, { email: 'again@mail.ua', source: { utm_source: 'instagram' } });
    await verifyChallenge(repo, raw_token);
    expect(await repo.getSignupSource(first.user_id)).toEqual(before);
  });

  it('акаунт, заведений ДО міток, після входу лишається без рядка', async () => {
    const old = await repo.createUserWithHousehold('old@mail.ua', 'Старий');
    await signInWithVerifiedEmail(repo, 'old@mail.ua', 'Старий', null, null, { via: 'email', marks: MARKS });
    expect(await repo.getSignupSource(old.user_id)).toBeNull();
    const oldTg = await repo.createUserFromTelegram({ telegram_user_id: 702, chat_id: 702, name: 'Старий' });
    await signInWithTelegram(repo, tg(702), null, null, MARKS);
    expect(await repo.getSignupSource(oldTg.user_id)).toBeNull();
  });

  it('запрошений у чужий дім: мітки його, дому в рядку немає, джерело дому не чіпається', async () => {
    const owner = await signInWithVerifiedEmail(repo, 'owner@mail.ua', 'Хазяїн', null, null, { via: 'email', marks: { utm_source: 'linkedin' } });
    const { raw_token } = await createInvite(repo, { household_id: owner.household_id, invited_by: owner.user_id, email: 'guest@mail.ua' });
    const out = await acceptInvite(repo, raw_token, null, null, { utm_source: 'instagram' });
    if (!out.ok) throw new Error(out.reason);
    expect(await repo.getSignupSource(out.result.user_id)).toMatchObject({ household_id: null, via: 'invite', ...NO_MARKS, utm_source: 'instagram' });
    expect(await repo.getSignupSource(owner.user_id)).toMatchObject({ household_id: owner.household_id, utm_source: 'linkedin' });
  });

  it('запрошення приймає людина з наявним акаунтом — нічого не пишемо', async () => {
    const owner = await signInWithVerifiedEmail(repo, 'owner2@mail.ua', 'Хазяїн');
    const old = await repo.createUserWithHousehold('has@mail.ua', 'Має');
    const { raw_token } = await createInvite(repo, { household_id: owner.household_id, invited_by: owner.user_id, email: 'has@mail.ua' });
    await acceptInvite(repo, raw_token, null, null, MARKS);
    expect(await repo.getSignupSource(old.user_id)).toBeNull();
  });
});
