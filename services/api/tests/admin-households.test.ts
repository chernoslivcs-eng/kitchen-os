// Крок А2: список домів і пульс, що приймає дім.
//
// Пілот роздано, і кожна людина за лінком отримує ВЛАСНИЙ дім. Тобто дані
// пілотних людей пишуться з першої хвилини, а власник досі бачив тільки себе.
//
// Тихо ламається тут три речі:
//   — дім БЕЗ активності зникає зі списку (найцінніший рядок на пілоті, і
//     втратити його найлегше — він порожній у кожній таблиці);
//   — чужі гроші й чужі події змішуються зі своїми (тоді юніт-економіка
//     бреше, і бреше непомітно);
//   — сторонній отримує 403 замість 404 і дізнається, що адмінка існує.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
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

describe('GET /v1/admin/households', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let owner: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    process.env.ADMIN_EMAILS = 'owner@kitchen.local';
    owner = await signIn(app, mailer, 'owner@kitchen.local');
  });

  const list = (cookie: string) =>
    app.inject({ method: 'GET', url: '/v1/admin/households', headers: { cookie } });

  it('стороннього не пускає — 404, а не 403', async () => {
    const stranger = await signIn(app, mailer, 'stranger@kitchen.local');
    const r = await list(stranger.cookie);
    // 403 сказав би «список є, тобі не можна». 404 не каже нічого.
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'not_found' });
  });

  it('без сесії до обробника не доходить', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/admin/households' });
    expect(r.statusCode).toBe(401);
  });

  it('дім БЕЗ жодної активності присутній у списку — саме він тут найцінніший', async () => {
    // Людина зайшла за лінком і не написала нічого. На пілоті таких більшість.
    const quiet = await signIn(app, mailer, 'quiet@gmail.com');

    const r = await list(owner.cookie);
    expect(r.statusCode).toBe(200);
    const { households } = r.json() as { households: { id: string; turns: number; last_turn_at: string | null; people: number }[] };

    const row = households.find((h) => h.id === quiet.household_id)!;
    expect(row).toBeTruthy();
    expect(row.turns).toBe(0);
    expect(row.last_turn_at).toBeNull();
    expect(row.people).toBe(1);
  });

  it('дім із розмовою приходить із часом останнього ходу', async () => {
    await app.inject({
      method: 'POST', url: '/v1/chat',
      headers: { cookie: owner.cookie },
      payload: { session_id: 's-1', text: 'привіт' },
    });
    const { households } = (await list(owner.cookie)).json() as {
      households: { id: string; turns: number; last_turn_at: string | null; mine: boolean }[];
    };
    const mine = households.find((h) => h.id === owner.household_id)!;
    expect(mine.turns).toBeGreaterThan(0);
    expect(mine.last_turn_at).toBeTruthy();
    // Свій дім помічений — інакше в списку його не відрізнити від чужого.
    expect(mine.mine).toBe(true);
  });

  it('власника дому видно поіменно: це і є те, за чим власник упізнає людину', async () => {
    const guest = await signIn(app, mailer, 'olya@gmail.com');
    const { households } = (await list(owner.cookie)).json() as {
      households: { id: string; owner_name: string | null; owner_email: string | null; mine: boolean }[];
    };
    const row = households.find((h) => h.id === guest.household_id)!;
    expect(row.owner_email).toBe('olya@gmail.com');
    expect(row.owner_name).toBeTruthy();
    expect(row.mine).toBe(false);
  });

  it('технічні доми за замовчуванням не віддаються, і сказано скільки сховано', async () => {
    // RFC 2606: example.com зарезервовано під приклади, тож така пошта не може
    // належати живій людині. На проді таких дев'ять із шістнадцяти — сміття
    // QA-прогонів, серед якого губився б мовчазний ЖИВИЙ дім.
    await signIn(app, mailer, 'qa7-a@example.com');
    await signIn(app, mailer, 'e2e-smoke@example.com');
    await signIn(app, mailer, 'olya@gmail.com');

    const body = (await list(owner.cookie)).json() as {
      households: { owner_email: string | null }[]; hidden_technical: number; technical_total: number;
    };
    expect(body.households.map((h) => h.owner_email).sort())
      .toEqual(['olya@gmail.com', 'owner@kitchen.local'].sort());
    expect(body.hidden_technical).toBe(2);
    expect(body.technical_total).toBe(2);
  });

  it('прапорець повертає їх у список — нічого не видалено', async () => {
    await signIn(app, mailer, 'qa7-a@example.com');
    const r = await app.inject({
      method: 'GET', url: '/v1/admin/households?technical=1', headers: { cookie: owner.cookie },
    });
    const body = r.json() as { households: { owner_email: string | null; technical: boolean }[]; hidden_technical: number };
    expect(body.households.map((h) => h.owner_email)).toContain('qa7-a@example.com');
    // Показано — отже ховати нема чого; але позначку рядок несе далі.
    expect(body.hidden_technical).toBe(0);
    expect(body.households.find((h) => h.owner_email === 'qa7-a@example.com')!.technical).toBe(true);
  });

  it('СВІЙ дім не ховається, навіть якщо пошта технічна', async () => {
    // Інакше адмін під тестовим акаунтом (локальний стенд) не побачив би себе
    // й вирішив би, що зламався список.
    process.env.ADMIN_EMAILS = 'dev@example.com';
    const dev = await signIn(app, mailer, 'dev@example.com');
    const body = (await list(dev.cookie)).json() as { households: { id: string; mine: boolean }[] };
    expect(body.households.find((h) => h.id === dev.household_id)?.mine).toBe(true);
  });

  it('видно ВСІ доми продукту, не лише свій', async () => {
    await signIn(app, mailer, 'a@gmail.com');
    await signIn(app, mailer, 'b@gmail.com');
    const { households } = (await list(owner.cookie)).json() as { households: unknown[] };
    // owner + a + b; рівно три доми.
    expect(households).toHaveLength(3);
  });
});

describe('GET /v1/admin/pulse?household_id — чужий дім', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let owner: Signed;
  let olya: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    process.env.ADMIN_EMAILS = 'owner@kitchen.local';
    owner = await signIn(app, mailer, 'owner@kitchen.local');
    olya = await signIn(app, mailer, 'olya@gmail.com');
    // У кожному домі — своя розмова.
    await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: owner.cookie }, payload: { session_id: 'o-1', text: 'мій хід' } });
    await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: olya.cookie }, payload: { session_id: 'l-1', text: 'чужий хід' } });
  });

  const pulse = (cookie: string, household_id?: string) => app.inject({
    method: 'GET', headers: { cookie },
    url: `/v1/admin/pulse?day=${localDay()}`
      + (household_id ? `&household_id=${household_id}` : ''),
  });

  it('без параметра — свій дім, як було', async () => {
    const body = (await pulse(owner.cookie)).json();
    expect(body.household_id).toBe(owner.household_id);
    expect(body.guest).toBe(false);
    expect(JSON.stringify(body.turns)).toContain('мій хід');
  });

  it('чужий дім видно ЦІЛКОМ, із текстом розмов', async () => {
    // Рішення власника: він цих людей особисто кликав і дивиться на пілот.
    // Урізати текст означало б зробити адмінку марною саме там, де вона
    // потрібна.
    const body = (await pulse(owner.cookie, olya.household_id)).json();
    expect(body.household_id).toBe(olya.household_id);
    expect(body.guest).toBe(true);
    expect(JSON.stringify(body.turns)).toContain('чужий хід');
  });

  it('чужі розмови не змішуються зі своїми', async () => {
    const mine = (await pulse(owner.cookie)).json();
    const theirs = (await pulse(owner.cookie, olya.household_id)).json();
    expect(JSON.stringify(mine.turns)).not.toContain('чужий хід');
    expect(JSON.stringify(theirs.turns)).not.toContain('мій хід');
  });

  it('гроші й події чужого дому теж не змішуються', async () => {
    const mine = (await pulse(owner.cookie)).json();
    const theirs = (await pulse(owner.cookie, olya.household_id)).json();
    // Люди в блоці грошей — тільки з того дому, який відкрито.
    expect(mine.money.byMember.map((m: { user_id: string }) => m.user_id)).toEqual([owner.user_id]);
    expect(theirs.money.byMember.map((m: { user_id: string }) => m.user_id)).toEqual([olya.user_id]);
    expect(theirs.members.map((m: { user_id: string }) => m.user_id)).toEqual([olya.user_id]);
  });

  it('не-адмін із чужим household_id отримує 404, а не порожню відповідь', async () => {
    // Порожня відповідь підтвердила б, що дім існує: підбором id можна було б
    // перелічити всі доми продукту.
    const r = await pulse(olya.cookie, owner.household_id);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'not_found' });
  });

  it('назва дому приїжджає — заголовок мусить сказати, чий це дім', async () => {
    const body = (await pulse(owner.cookie, olya.household_id)).json();
    expect(body.household_name).toBeTruthy();
  });
});
