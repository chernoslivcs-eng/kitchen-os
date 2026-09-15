import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, type PeriodCard, type EventCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { handleTelegramText, handleQuickCallback, handleTelegramCallback, resetSeenUpdates, resetBotUsernameCache, type TelegramDeps } from '../src/telegram.js';
import { renderPeriodSeriesText, periodSeriesKeyboard, maskOf, SERIES_TOGGLE_MAX } from '../src/telegram-period.js';
import { localDay } from '../src/local-day.js';

// Власник 15.09: свята з бота — серією з кнопками; гості/дієта/подія — «Записати»/«Ні».

const APP = 'https://kos.example';
const series: PeriodCard = {
  type: 'period', kind: 'tradition', tradition: 'catholic', title: 'католицькі свята',
  items: [
    { occasion_id: 'advent', title: 'Адвент', from: '2026-11-29', to: '2026-12-24', enabled: true, what: 'піст', strict: false },
    { occasion_id: 'xmas-cath', title: 'Різдво', from: '2026-12-25', to: '2026-12-25', enabled: true, what: 'святкова вечеря', strict: false },
    { occasion_id: 'epiphany-cath', title: 'Три Царі', from: '2027-01-06', to: '2027-01-06', enabled: true, what: 'святкова вечеря', strict: false },
  ],
};

describe('серія свят — рендер', () => {
  it('заголовок «📅 {назва} · N свят», рядки ☑/☐ з датою, тогли по рядку, «Записати N» і «Не треба»', () => {
    const id = randomUUID();
    const all = maskOf(series.items!.length);
    const text = renderPeriodSeriesText(series, all);
    expect(text).toContain('<b>📅 Католицькі свята · 3 свята</b>');
    expect(text).toContain('☑ Адвент · 29 лис — 24 гру');
    expect(text).toContain('☑ Різдво · 25 гру');
    const kb = periodSeriesKeyboard(series, id, all);
    expect(kb.length).toBe(4);
    expect(kb[0]![0]).toEqual({ text: '☑ Адвент', data: `pt:${id}:${(all & ~1).toString(16)}` });
    expect(kb[3]).toEqual([{ text: 'Записати 3', data: `pa:${id}:${all.toString(16)}` }, { text: 'Не треба', data: `dismiss:${id}` }]);
    // один тогл знято: рядок ☐, «Записати 2»
    const m = all & ~2;
    expect(renderPeriodSeriesText(series, m)).toContain('☐ Різдво');
    expect(periodSeriesKeyboard(series, id, m)[3]![0]!.text).toBe('Записати 2');
    expect(periodSeriesKeyboard(series, id, m)[1]![0]!.text).toBe('☐ Різдво');
    expect(SERIES_TOGGLE_MAX).toBe(8);
  });
});

describe('серія свят — у боті', () => {
  let repo: InMemoryRepo; let seq = 0; let app: ReturnType<typeof buildApp>;
  const upd = (id: number, text: string) => ({ update_id: ++seq, telegram_user_id: id, chat_id: id, text, first_name: 'Олена', username: null });
  beforeEach(async () => { repo = new InMemoryRepo(); resetSeenUpdates(); resetBotUsernameCache(); process.env.TELEGRAM_BOT_USERNAME = 'KitchenOSBot'; app = buildApp(repo, new InMemoryStore(), new ConsoleMailer()); await app.ready(); });
  const deps = (turn?: TelegramDeps['turn']) => ({ repo, store: new InMemoryStore(), appUrl: APP, ...(turn ? { turn } : {}) });
  async function me(id: number) { await handleTelegramText(deps(), upd(id, '/start')); const u = (await repo.getUserByTelegramId(id))!; const hh = (await repo.firstHouseholdOf(u.id))!; return { user_id: u.id, household_id: hh }; }
  async function pendingCard(household_id: string, user_id: string, card: PeriodCard | EventCard) {
    const session = await repo.getOrCreateSessionForDay(user_id, localDay());
    const card_id = randomUUID();
    await repo.saveMessage({ id: card_id, session_id: session.id, role: 'assistant', text: 'Ось', card, applied: 0, created_at: new Date().toISOString() });
    await createPending(repo, { message_id: card_id, household_id, user_id, card });
    return card_id;
  }

  it('картка tradition з ходу → серія з тоглами, не «Відкрити у вебі»; тогл редагує на місці; «Записати N» → apply з обраними', async () => {
    const m = await me(1);
    const turn = async () => {
      const card_id = await pendingCard(m.household_id, m.user_id, series);
      return { reply: 'Ось католицькі свята.', card: series, card_id, meta: {} };
    };
    const r = await handleTelegramText(deps(turn), upd(1, 'ми католики'));
    expect(r?.messages.join('\n')).toContain('<b>📅 Католицькі свята · 3 свята</b>');
    expect(r?.messages.join('\n')).not.toContain('Відкрити у вебі');
    const toggleXmas = r!.keyboard![1]![0]!;
    expect(toggleXmas.text).toBe('☑ Різдво');
    const q = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 1, data: toggleXmas.data! });
    expect(q?.kind).toBe('edit');
    expect(q!.kind === 'edit' && q!.text).toContain('☐ Різдво');
    const apply = q!.kind === 'edit' ? q!.keyboard.at(-1)![0]! : null;
    expect(apply?.text).toBe('Записати 2');
    const done = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 1, data: apply!.data! });
    expect(done!.kind === 'edit' && done!.text).toContain('Записав у календар · 2');
    // Традиції за замовчуванням вимкнені: увімкнені пишуться рядком, зняте — без рядка.
    const subs = await repo.listOccasionSubscriptions(m.household_id);
    expect(subs.filter((s) => s.enabled).map((s) => s.occasion_id).sort()).toEqual(['advent', 'epiphany-cath']);
    expect(subs.find((s) => s.occasion_id === 'xmas-cath')?.enabled).not.toBe(true);
  });

  it('гості (period custom) і event → «Записати»/«Ні»; після «Записати» — «Записав: гості · дата · на 5»', async () => {
    const m = await me(2);
    const guests: PeriodCard = { type: 'period', kind: 'custom', title: 'гості', servings: 5, resolved: { from: '2026-09-18', to: '2026-09-18' } };
    const turn = async () => ({ reply: 'Записую гостей.', card: guests, card_id: await pendingCard(m.household_id, m.user_id, guests), meta: {} });
    const r = await handleTelegramText(deps(turn), upd(2, 'у пʼятницю гості пʼятеро'));
    const btns = r!.keyboard!.flat();
    expect(btns.map((b) => b.text)).toEqual(['Записати', 'Ні']);
    expect(r?.messages.join('\n')).not.toContain('Відкрити у вебі');
    const st = await handleTelegramCallback(deps(), { update_id: ++seq, telegram_user_id: 2, data: btns[0]!.data! });
    expect(st?.status).toBe('Записав: гості · 18 вер · на 5');
    const events = await repo.listOwnEvents(m.household_id, m.user_id);
    expect(events[0]?.title).toBe('гості');
  });

  it('/calendar → «Свята» → набори традицій → серія (без моделі), «Записати» пише підписки', async () => {
    const m = await me(3);
    await handleTelegramText(deps(), upd(3, '/calendar'));
    const q = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 3, data: 'calendar:holidays' });
    const sets = q!.kind === 'edit' ? q!.keyboard.flat().filter((b) => b.data?.startsWith('cal-set:')) : [];
    expect(sets.map((b) => b.text)).toEqual(['Православні', 'Католицькі', 'Юдейські', 'Ісламські', 'Світські']);
    const s = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 3, data: 'cal-set:catholic' });
    expect(s?.kind).toBe('reply');
    const reply = s!.kind === 'reply' ? s!.reply! : null;
    expect(reply?.messages[0]).toMatch(/<b>📅 Католицькі свята · \d+ свят/);
    const apply = reply!.keyboard!.at(-1)![0]!;
    expect(apply.text).toMatch(/^Записати \d+$/);
    const done = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 3, data: apply.data! });
    expect(done!.kind === 'edit' && done!.text).toMatch(/Записав у календар · \d+/);
    // картка серії лежить у розмові дня і застосована — веб побачить її як серію
    const session = await repo.getOrCreateSessionForDay(m.user_id, localDay());
    const msg = (await repo.listMessages(session.id)).find((x) => x.card?.type === 'period');
    expect(msg?.applied).toBeGreaterThan(0);
  });
});
