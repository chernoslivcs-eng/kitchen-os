import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard, createInvite, signInWithTelegram, type PeriodCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';
import { handleTelegramText, handleQuickCallback, resetSeenUpdates, resetBotUsernameCache } from '../src/telegram.js';
import { localDay } from '../src/local-day.js';

// Власник 15.09 (до бети): адмінка бачить Telegram-користувачів —
// події з бота в app_event, канал/джерело в пульсі, таблиця «Бета».

const APP = 'https://kos.example';

describe('події з бота → app_event', () => {
  let repo: InMemoryRepo; let seq = 0;
  const upd = (id: number, text: string) => ({ update_id: ++seq, telegram_user_id: id, chat_id: id, text, first_name: 'Олена', username: null });
  const deps = () => ({ repo, store: new InMemoryStore(), appUrl: APP, turn: async () => ({ reply: 'ок', card: null, card_id: null }) });
  beforeEach(async () => { repo = new InMemoryRepo(); resetSeenUpdates(); resetBotUsernameCache(); process.env.TELEGRAM_BOT_USERNAME = 'KitchenOSBot'; const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer()); await app.ready(); });
  const events = async (user_id: string) => (await repo.listAppEvents(user_id, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000), limit: 100 })).map((e) => [e.name, e.props] as const);

  it('tg_start (created), tg_command, tg_help, tg_web_link, tg_message — по одному на дію', async () => {
    await handleTelegramText(deps(), upd(1, '/start'));
    const u = (await repo.getUserByTelegramId(1))!;
    await handleTelegramText(deps(), upd(1, '/pantry'));
    await handleTelegramText(deps(), upd(1, '/help'));
    await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 1, data: 'help:pantry' });
    await handleTelegramText(deps(), upd(1, '/web'));
    await handleTelegramText(deps(), upd(1, 'купив молоко'));
    await handleTelegramText(deps(), upd(1, '/start'));
    const ev = await events(u.id);
    expect(ev).toContainEqual(['tg_start', { created: true }]);
    expect(ev).toContainEqual(['tg_start', { created: false }]);
    expect(ev).toContainEqual(['tg_command', { name: 'pantry' }]);
    expect(ev).toContainEqual(['tg_command', { name: 'help' }]);
    expect(ev).toContainEqual(['tg_help', { topic: 'pantry' }]);
    expect(ev).toContainEqual(['tg_command', { name: 'web' }]);
    // E: /pantry вище вже видав токен, /web перевидає той самий — reused: true.
    expect(ev).toContainEqual(['tg_web_link', { next: '/app', reused: true }]);
    expect(ev).toContainEqual(['tg_message', { kind: 'text' }]);
    // пристрій у бота порожній — подію писав сервер
    const raw = await repo.listAppEvents(u.id, { from: new Date(0), to: new Date(Date.now() + 60_000), limit: 100 });
    expect(raw.every((e) => e.device_class === null && e.household_id)).toBe(true);
  });
});

describe('GET /v1/admin/beta', () => {
  let repo: InMemoryRepo; let mailer: ConsoleMailer; let app: ReturnType<typeof buildApp>;
  const prevAdmins = process.env.ADMIN_EMAILS;
  beforeEach(async () => { repo = new InMemoryRepo(); mailer = new ConsoleMailer(); resetSeenUpdates(); process.env.ADMIN_EMAILS = 'owner@kitchen.local'; process.env.TELEGRAM_BOT_USERNAME = 'KitchenOSBot'; app = buildApp(repo, new InMemoryStore(), mailer); await app.ready(); });
  afterEach(() => { process.env.ADMIN_EMAILS = prevAdmins; });

  it('рядок на людину без адмінських домів; колонки рахуються з наявних таблиць; сортування за останнім візитом', async () => {
    const admin = await signIn(app, mailer, 'owner@kitchen.local');
    // Тестер 1 — з Telegram, активний
    const t1 = await signInWithTelegram(repo, { telegram_user_id: 900, chat_id: 900, first_name: 'Олена' }, null, null);
    for (let i = 0; i < 11; i++) await repo.insertBatch({ id: randomUUID(), household_id: t1.household_id, catalog_key: null, label: `п${i}`, zone: 'dry', value: 1, unit: 'pcs', state: 'sealed', opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date().toISOString(), source: 'user', product_id: null } as never);
    await repo.patchProfileField(t1.user_id, 'no', { text: 'мʼяса' });
    await repo.patchProfileField(t1.user_id, 'ban', { status: 'none' });
    const session = await repo.getOrCreateSessionForDay(t1.user_id, localDay());
    await repo.saveMessage({ id: randomUUID(), session_id: session.id, role: 'user', text: 'що на вечерю?', card: null, applied: 0, created_at: new Date().toISOString(), channel: 'telegram' });
    await repo.saveMessage({ id: randomUUID(), session_id: session.id, role: 'assistant', text: 'ось', card: { type: 'proposal', items: [] } as never, applied: 0, created_at: new Date().toISOString() });
    const rid = randomUUID();
    await repo.saveRecipe({ id: rid, owner_id: t1.user_id, origin: 'generated', title: 'Паста', descr: null, character: null, risk: null, base_servings: 2, time_total: 20, nutrition: null, payload: { t: 'Паста', sv: 2, tm: 20, ch: '', d: '', rk: '', ing: [], st: [] }, created_at: new Date().toISOString(), saved_at: null } as never);
    await repo.saveCookRun({ id: randomUUID(), household_id: t1.household_id, user_id: t1.user_id, recipe_id: rid, servings: 2, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), rating: 4, verdict: 'ок', photo_url: null, changes: null, undone_at: null });
    const guests: PeriodCard = { type: 'period', kind: 'custom', title: 'гості', resolved: { from: '2026-09-18', to: '2026-09-18' } };
    const cid = randomUUID();
    await repo.saveMessage({ id: cid, session_id: session.id, role: 'assistant', text: null, card: guests, applied: 0, created_at: new Date().toISOString() });
    await createPending(repo, { message_id: cid, household_id: t1.household_id, user_id: t1.user_id, card: guests });
    await applyCard(repo, cid, [], t1.user_id);
    await createInvite(repo, { household_id: t1.household_id, invited_by: t1.user_id, email: 'friend@x.local', role: 'member' });
    await repo.upsertRetailConnection({ id: randomUUID(), user_id: t1.user_id, provider: 'silpo', access_token_enc: 'x', refresh_token_enc: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: 'active', connected_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_receipt_at: null });
    // Тестер 2 — з пошти, порожній, візит давніше
    const t2 = await signIn(app, mailer, 'newbie@x.local');
    void t2;

    const res = await app.inject({ method: 'GET', url: '/v1/admin/beta', headers: { cookie: admin.cookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Record<string, unknown>[];
    // Адмінського дому нема; сортування за останнім візитом — newbie заходила останньою.
    expect(rows.map((r) => r.name)).toEqual(['newbie', 'Олена']);
    const r1 = rows[1]!;
    expect(r1).toMatchObject({
      source: 'telegram', pantry: 11, pantry_ok: true, profile_filled: 2, profile_ok: true, dinner_asks: 1,
      cooks: 1, feedback: 1, periods: 1, invites: 1, silpo: true, last_channel: 'telegram',
    });
    expect(typeof r1.started_at).toBe('string');
    expect(r1.active_days_7).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ source: 'email', pantry: 0, pantry_ok: false, profile_filled: 0, dinner_asks: 0, cooks: 0, silpo: false });
  });

  it('не адмін → 404', async () => {
    const me = await signIn(app, mailer, 'someone@x.local');
    expect((await app.inject({ method: 'GET', url: '/v1/admin/beta', headers: { cookie: me.cookie } })).statusCode).toBe(404);
  });
});
