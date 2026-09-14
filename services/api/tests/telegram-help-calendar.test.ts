import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, HELP_TOPICS_TG, isoDay, type HouseholdEventRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { handleTelegramText, handleQuickCallback, resetSeenUpdates, resetBotUsernameCache } from '../src/telegram.js';
import { renderCalendarText, HELP_KEYBOARD_ROWS } from '../src/telegram-nomodel.js';
import { localDay } from '../src/local-day.js';

// Власник 15.09: шість довідок у боті (HELP-CHIPS-TG-0915) і /calendar на читання.

const APP = 'https://kos.example';
const DAY = 86_400_000;
const day = (d: number) => isoDay(Date.now() + d * DAY);

describe('A · довідки в боті', () => {
  let repo: InMemoryRepo; let seq = 0;
  const upd = (id: number, text: string) => ({ update_id: ++seq, telegram_user_id: id, chat_id: id, text, first_name: 'Олена', username: null });
  const deps = () => ({ repo, store: new InMemoryStore(), appUrl: APP });
  beforeEach(async () => { repo = new InMemoryRepo(); resetSeenUpdates(); resetBotUsernameCache(); process.env.TELEGRAM_BOT_USERNAME = 'KitchenOSBot'; const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer()); await app.ready(); });
  const helpIds = (kb: { data?: string }[][] | undefined) => (kb ?? []).flat().map((b) => b.data).filter((d) => d?.startsWith('help:')).map((d) => d!.slice(5));

  it('/start → hello + inline 2×3 із шістьма довідками; /help — той самий ряд', async () => {
    const r = await handleTelegramText(deps(), upd(1, '/start'));
    expect(r?.keyboard?.length).toBe(3);
    expect(helpIds(r?.keyboard)).toEqual(['start', 'telegram', 'app', 'list', 'pantry', 'calendar']);
    expect(r?.keyboard?.[0]?.[1]?.text).toBe('Kitchen OS у вебі');
    const h = await handleTelegramText(deps(), upd(1, '/help'));
    expect(helpIds(h?.keyboard)).toEqual(['start', 'telegram', 'app', 'list', 'pantry', 'calendar']);
    expect(HELP_KEYBOARD_ROWS.flat().length).toBe(6);
  });

  it('тап «Як працює комора» → TG-текст із <b> і абзацами, ряд без прочитаної; збережено в розмову як scripted (channel telegram)', async () => {
    await handleTelegramText(deps(), upd(2, '/start'));
    const q = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 2, data: 'help:pantry' });
    expect(q?.kind).toBe('reply');
    const reply = q!.kind === 'reply' ? q!.reply : null;
    expect(reply?.html).toBe(true);
    expect(reply?.messages[0]).toContain('<b>Свіже, Холодильник, Морозилка, Суха шафа, Спеції, Напої</b>');
    expect(reply?.messages[0]).toContain('\n\n');
    expect(reply?.messages[0]).not.toContain('**');
    expect(helpIds(reply?.keyboard)).toEqual(['start', 'telegram', 'app', 'list', 'calendar']);
    const user = await repo.getUserByTelegramId(2);
    const session = await repo.getOrCreateSessionForDay(user!.id, localDay());
    const msgs = (await repo.listMessages(session.id)).filter((m) => m.card?.type !== 'onboarding');
    expect(msgs.map((m) => [m.role, m.channel])).toEqual([['user', 'telegram'], ['assistant', 'telegram']]);
    expect(msgs[0]!.text).toBe('Як працює комора');
    expect(msgs[1]!.text).toBe(HELP_TOPICS_TG.find((t) => t.id === 'pantry')!.text);
  });

  it('намір у боті: «як працює комора?» → TG-варіант довідки, не веб', async () => {
    await handleTelegramText(deps(), upd(3, '/start'));
    const r = await handleTelegramText(deps(), upd(3, 'як працює комора?'));
    expect(r?.messages[0]).toContain('Тут — /pantry, на сайті — з пошуком');
    expect(r?.messages[0]).not.toContain('Пошук угорі шукає');
  });
});

describe('B · /calendar', () => {
  const ev = (over: Partial<HouseholdEventRow>): HouseholdEventRow => ({
    id: randomUUID(), household_id: 'h', kind: 'custom', title: 'x', note: null, rule: { t: 'once', at: day(0) } as never, force: 'hint', restricts: null,
    from: day(0), to: day(0), rule_text: null, strict: false, buy: [], recipe_id: null, servings: null, supply: null, created_by: 'u', source: 'user',
    created_at: new Date().toISOString(), expires_at: null, done_at: null, ...over,
  } as HouseholdEventRow);

  it('три секції: Триває (піст до дати, гості · дата), Сезони одним рядком, Далі — три найближчі', () => {
    const text = renderCalendarText({
      now: [
        { kind: 'diet', title: 'Без цукру', from: day(-2), to: day(12), strict: true, source: 'chat' },
        { kind: 'custom', title: 'Гості', from: day(0), to: day(0), strict: false, source: 'chat', servings: 5 },
      ],
      seasons: ['Полуниця', 'Черешня'],
      upcoming: [
        { at: Date.now() + 2 * DAY, title: 'День народження', kind: 'tradition' },
        { at: Date.now() + 5 * DAY, title: 'Трійця', kind: 'tradition' },
        { at: Date.now() + 9 * DAY, title: 'Мама на тиждень', kind: 'tradition' },
        { at: Date.now() + 15 * DAY, title: 'Зайве', kind: 'tradition' },
      ],
    }, Date.now());
    expect(text).toMatch(/<b>Триває<\/b>\n/);
    expect(text).toContain('Без цукру · до ');
    expect(text).toContain('Гості · ');
    expect(text).toContain('<b>Сезони</b>\nПолуниця, Черешня');
    expect(text).toMatch(/<b>Далі<\/b>\n[\s\S]*День народження[\s\S]*Трійця[\s\S]*Мама на тиждень/);
    expect(text).not.toContain('Зайве');
  });
  it('порожньо — підказка словами', () => {
    expect(renderCalendarText({ now: [], seasons: [], upcoming: [] }, Date.now())).toBe('Нічого не триває. Скажи «ми католики» або «в суботу гості» — запишу.');
  });

  describe('команда', () => {
    let repo: InMemoryRepo; let seq = 0;
    const upd = (id: number, text: string) => ({ update_id: ++seq, telegram_user_id: id, chat_id: id, text, first_name: 'Олена', username: null });
    const deps = () => ({ repo, store: new InMemoryStore(), appUrl: APP });
    beforeEach(async () => { repo = new InMemoryRepo(); resetSeenUpdates(); resetBotUsernameCache(); process.env.TELEGRAM_BOT_USERNAME = 'KitchenOSBot'; const app = buildApp(repo, new InMemoryStore(), new ConsoleMailer()); await app.ready(); });

    it('/calendar → секції, кнопки «Свята» і «Відкрити у вебі» (next=/calendar); «Свята» → та сама відповідь + рядок', async () => {
      await handleTelegramText(deps(), upd(10, '/start'));
      const user = await repo.getUserByTelegramId(10);
      const hh = (await repo.firstHouseholdOf(user!.id))!;
      await repo.insertHouseholdEvent(ev({ household_id: hh, created_by: user!.id, title: 'Гості', servings: 4 }));
      const r = await handleTelegramText(deps(), upd(10, '/calendar'));
      expect(r?.html).toBe(true);
      expect(r?.messages[0]).toContain('<b>Триває</b>');
      expect(r?.messages[0]).toContain('Гості');
      const btns = (r?.keyboard ?? []).flat();
      expect(btns.find((b) => b.data === 'calendar:holidays')?.text).toBe('Свята');
      expect(btns.find((b) => b.text === 'Відкрити у вебі')?.url).toMatch(/\/v1\/auth\/telegram\?token=[A-Za-z0-9_-]+&next=%2Fcalendar$/);
      const q = await handleQuickCallback(deps(), { update_id: ++seq, telegram_user_id: 10, data: 'calendar:holidays' });
      expect(q?.kind).toBe('edit');
      expect(q!.kind === 'edit' && q!.text).toContain('Свята додаються словами: «ми католики», «постуємо»');
    });
  });
});
