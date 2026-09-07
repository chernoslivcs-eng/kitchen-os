// Пульс рахує по ДОМУ, а не по одній людині.
//
// Комора спільна, розмови спільні, і рахунок за модель приходить один. Поки
// сторінка дивилась на власника, витрати й поведінка запрошених у дім не були
// видні ніде взагалі — а платить за них той самий власник.
//
// Ламається це тихо у двох напрямках: недобір (гість витрачає, підсумок цього
// не показує) і перебір (у підсумок затікає чужий дім). Тому обидва боки й
// перевіряються.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type TokenUsageRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

const localDay = () => {
  // Місцева дата, не UTC: `dayBounds` у pulse.ts рахує межі саме в місцевому
  // часі, і між місцевою північчю і UTC-північчю (00:00–03:00 у Києві) UTC-дата
  // вказує на добу, яка вже скінчилась. Тест від цього падав щоночі.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const today = localDay;

interface PulseBody {
  day: string;
  household_id: string;
  members: { user_id: string; name: string; role: string }[];
  turns: { who: string; user_id: string; role: string; text: string | null; usd: number | null }[];
  money: {
    day: { calls: number; usd: number };
    week: { calls: number; usd: number };
    byMember: { user_id: string; name: string; role: string; day: { calls: number; usd: number }; week: { calls: number; usd: number } }[];
  };
  events: { name: string; who: string; user_id: string }[];
}

describe('GET /v1/admin/pulse · дім', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let owner: Signed;
  let guest_id: string;

  /** Виклик моделі однієї людини — рівно те, з чого потім складається рахунок. */
  const usage = (user_id: string, household_id: string | null, input: number, output: number): TokenUsageRow => ({
    id: randomUUID(),
    user_id,
    household_id,
    call: 'chat',
    profile: 'fast',
    model: 'claude-haiku-4-5',
    prompt_version: 'test',
    mode: 'live',
    input_tokens: input,
    output_tokens: output,
    cached_tokens: 0,
    latency_ms: 1200,
    prompt_hash: null,
    prompt_chars: null,
    // Крок А1: цей тест перевіряє гроші дому, а не прив'язку до ходу —
    // зшивання за часом у pulse.ts лишається як було.
    message_id: null,
    session_id: null,
    created_at: new Date().toISOString(),
  });

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    process.env.ADMIN_EMAILS = 'owner@example.com';
    owner = await signIn(app, mailer, 'owner@example.com');
    // Гість: свого дому не має за визначенням — його додають у чужий.
    guest_id = await repo.createUserOnly('guest@example.com', 'Оля');
    await repo.addMember(owner.household_id, guest_id, 'member');
  });

  const pulse = async (cookie = owner.cookie) => {
    const r = await app.inject({ method: 'GET', url: `/v1/admin/pulse?day=${today()}`, headers: { cookie } });
    return { status: r.statusCode, body: r.statusCode === 200 ? (r.json() as PulseBody) : null };
  };

  it('показує обидві суми і їх підсумок', async () => {
    // Мільйон вхідних haiku = $1.00; вихідні по $5/М.
    await repo.logTokenUsage(usage(owner.user_id, owner.household_id, 1_000_000, 0));         // $1.0000
    await repo.logTokenUsage(usage(guest_id, owner.household_id, 0, 100_000));                // $0.5000

    const { status, body } = await pulse();
    expect(status).toBe(200);

    const mine = body!.money.byMember.find((m) => m.user_id === owner.user_id)!;
    const theirs = body!.money.byMember.find((m) => m.user_id === guest_id)!;
    expect(mine.day.usd).toBeCloseTo(1.0, 4);
    expect(theirs.day.usd).toBeCloseTo(0.5, 4);
    // Підсумок дому — це саме сума рядків, а не витрати того, хто відкрив.
    expect(body!.money.day.usd).toBeCloseTo(1.5, 4);
    expect(body!.money.day.calls).toBe(2);
  });

  it('кожен рядок грошей підписаний імʼям і роллю', async () => {
    const { body } = await pulse();
    const roles = Object.fromEntries(body!.money.byMember.map((m) => [m.name, m.role]));
    expect(roles).toEqual({ owner: 'owner', 'Оля': 'member' });
  });

  it('гість без жодного виклику все одно є в таблиці — нулем, а не пропуском', async () => {
    // Інакше «нікого немає» і «нічого не витратив» виглядають однаково.
    await repo.logTokenUsage(usage(owner.user_id, owner.household_id, 1_000_000, 0));
    const { body } = await pulse();
    const theirs = body!.money.byMember.find((m) => m.user_id === guest_id)!;
    expect(theirs).toBeTruthy();
    expect(theirs.day).toMatchObject({ calls: 0, usd: 0 });
  });

  it('чужий дім у підсумок не затікає', async () => {
    const other = await repo.createUserWithHousehold('stranger@example.com', 'Чужий');
    await repo.logTokenUsage(usage(other.user_id, other.household_id, 5_000_000, 0));   // $5 в іншому домі
    await repo.logTokenUsage(usage(owner.user_id, owner.household_id, 1_000_000, 0));   // $1 у нашому

    const { body } = await pulse();
    expect(body!.money.day.usd).toBeCloseTo(1.0, 4);
    expect(body!.money.byMember.map((m) => m.user_id)).toEqual([owner.user_id, guest_id]);
  });

  it('події дому підписані людиною, чужі не видно', async () => {
    const at = new Date().toISOString();
    const ev = (user_id: string, household_id: string | null, name: string) =>
      ({ id: randomUUID(), user_id, household_id, name, props: {}, viewport_w: null, device_class: null, ua_family: null, created_at: at });
    const other = await repo.createUserWithHousehold('stranger2@example.com', 'Чужий2');
    await repo.saveAppEvents([
      ev(owner.user_id, owner.household_id, 'pantry_opened'),
      ev(guest_id, owner.household_id, 'shopping_opened'),
      ev(other.user_id, other.household_id, 'calendar_opened'),
    ]);

    const { body } = await pulse();
    const seen = body!.events.map((e) => `${e.who}:${e.name}`).sort();
    expect(seen).toEqual(['owner:pantry_opened', 'Оля:shopping_opened'].sort());
  });

  it('ходи підписані людиною, і чужі розмови не потрапляють', async () => {
    const mine = await repo.getOrCreateSessionForDay(owner.user_id, today());
    await repo.saveMessage({
      id: randomUUID(), session_id: mine.id, role: 'user',
      text: 'що на вечерю', card: null, applied: 0, created_at: new Date().toISOString(),
    });
    const theirs = await repo.getOrCreateSessionForDay(guest_id, today());
    await repo.saveMessage({
      id: randomUUID(), session_id: theirs.id, role: 'user',
      text: 'купила молоко', card: null, applied: 0, created_at: new Date().toISOString(),
    });
    const stranger = await repo.createUserWithHousehold('stranger3@example.com', 'Чужий3');
    const alien = await repo.getOrCreateSessionForDay(stranger.user_id, today());
    await repo.saveMessage({
      id: randomUUID(), session_id: alien.id, role: 'user',
      text: 'секрет чужого дому', card: null, applied: 0, created_at: new Date().toISOString(),
    });

    const { body } = await pulse();
    expect(body!.turns.map((t) => `${t.who}: ${t.text}`)).toEqual([
      'owner: що на вечерю',
      'Оля: купила молоко',
    ]);
  });

  it('стороннього не пускає — 404, а не 403', async () => {
    const stranger = await signIn(app, mailer, 'not-admin@example.com');
    const { status } = await pulse(stranger.cookie);
    // 403 сказав би «сторінка є, тобі не можна». 404 не каже нічого.
    expect(status).toBe(404);
  });

  it('без ADMIN_EMAILS адмінки не існує ні для кого', async () => {
    delete process.env.ADMIN_EMAILS;
    const { status } = await pulse();
    expect(status).toBe(404);
    process.env.ADMIN_EMAILS = 'owner@example.com';
  });

  it('ціна ходу береться з виклику ТІЄЇ САМОЇ людини, а не найближчого за часом', async () => {
    // У домі двоє пишуть одночасно. Якщо зшивати лише за часом, дорогий виклик
    // одного припишеться ходу іншого — і рядок скаже неправду про обох.
    const now = new Date();
    const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();

    const mine = await repo.getOrCreateSessionForDay(owner.user_id, today());
    await repo.saveMessage({
      id: randomUUID(), session_id: mine.id, role: 'assistant',
      text: 'Записав.', card: null, applied: 0, created_at: iso(1000),
    });
    const theirs = await repo.getOrCreateSessionForDay(guest_id, today());
    await repo.saveMessage({
      id: randomUUID(), session_id: theirs.id, role: 'assistant',
      text: 'Додала.', card: null, applied: 0, created_at: iso(900),
    });

    // Дешевий виклик власника і дорогий — гостя, за секунду один від одного.
    await repo.logTokenUsage({ ...usage(owner.user_id, owner.household_id, 100_000, 0), created_at: iso(1000) });
    await repo.logTokenUsage({ ...usage(guest_id, owner.household_id, 2_000_000, 0), created_at: iso(900) });

    const { body } = await pulse();
    const byWho = Object.fromEntries(body!.turns.map((t) => [t.who, t.usd]));
    expect(byWho['owner']).toBeCloseTo(0.1, 4);
    expect(byWho['Оля']).toBeCloseTo(2.0, 4);
  });

  it('тиждень ширший за день — і в підсумку дому, і в рядку людини', async () => {
    // Без цього «за тиждень» мовчки показував би те саме, що «за день», і
    // колонка існувала б лише як прикраса.
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
    await repo.logTokenUsage({ ...usage(guest_id, owner.household_id, 1_000_000, 0), created_at: threeDaysAgo });
    await repo.logTokenUsage(usage(guest_id, owner.household_id, 500_000, 0));   // сьогодні, $0.50

    const { body } = await pulse();
    const theirs = body!.money.byMember.find((m) => m.user_id === guest_id)!;
    expect(theirs.day.usd).toBeCloseTo(0.5, 4);
    expect(theirs.week.usd).toBeCloseTo(1.5, 4);
    expect(body!.money.day.usd).toBeCloseTo(0.5, 4);
    expect(body!.money.week.usd).toBeCloseTo(1.5, 4);
  });
});

